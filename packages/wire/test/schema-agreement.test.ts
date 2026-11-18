// The guards follow the vendored JSON Schemas (contract C5): a differential test against a
// real schema validator, which stays out of the bundle (ADR-006). Each valid frame is
// mutated key by key; whatever the schema refuses, the guard must refuse too. Where the
// guard is stricter, it must be for a rule the schema cannot express: a byte size, the
// version this client speaks, a blank prompt, or `vs` naming the fired or a repeated
// ordinal (protocol/README.md).
import clientSchema from "@md2ui/contracts/schema/wire/client-frame.schema.json" with {
  type: "json",
};
import serverSchema from "@md2ui/contracts/schema/wire/server-frame.schema.json" with {
  type: "json",
};
import Ajv2020 from "ajv/dist/2020.js";
import { expect, test } from "vitest";
import { type Decoded, decodeClientFrame, decodeServerFrame } from "../src/index.ts";

type Frame = Record<string, unknown>;

const CLIENT_FRAMES: readonly Frame[] = [
  { t: "h", v: 1 },
  { t: "e", m: "c7.12", x: 0, q: 1, a: "generate-report", c: true, v: 72.5, vs: [[1, 3]] },
  { t: "p", q: 3, tx: "Move the call to Friday" },
  { t: "k" },
];

const SERVER_FRAMES: readonly Frame[] = [
  { t: "m", m: "c7.13", r: "c7.12", md: "Want me to?" },
  { t: "d", m: "c7.14", s: 0, md: "Want me to " },
  { t: "z", m: "c7.12", h: "814bf85aa136f9e8" },
  { t: "x", code: "stale", m: "c7.12", q: 4 },
  { t: "s", s: "w", n: "thinking" },
  { t: "s", s: "l", n: "listening", u: [3, 4] },
];

/** Values that are right for some key and wrong for most. */
const VALUES: readonly unknown[] = [
  -1,
  0,
  1,
  1.5,
  2,
  "",
  " ",
  "\u001c\u0085",
  "x",
  "c7.12",
  "../etc/passwd",
  "a".repeat(64),
  "a".repeat(65),
  "a".repeat(129),
  "a".repeat(201),
  "814bf85aa136f9e8",
  "814BF85AA136F9E8",
  "l",
  "busy",
  "stale",
  "bad_value",
  "h",
  "e",
  "p",
  "k",
  "m",
  "d",
  "z",
  true,
  false,
  null,
  [],
  {},
  [[1, true]],
  [[0, true]],
  [
    [1, 2],
    [1, 3],
  ],
  [[1, "x"]],
  [[1, 2, 3]],
  [[-1, 2]],
  Array.from({ length: 33 }, (_, i) => [i + 1, true]),
  [3, 4],
  [-1],
  Array.from({ length: 64 }, (_, i) => i),
  Array.from({ length: 65 }, (_, i) => i),
];

function mutations(frame: Frame): Frame[] {
  const out: Frame[] = [frame, { ...frame, unknown: "ignored" }];
  for (const key of Object.keys(frame)) {
    const { [key]: _dropped, ...without } = frame;
    out.push(without);
    for (const value of VALUES) out.push({ ...frame, [key]: value });
  }
  return out;
}

/** Blank to Python's `str.strip`: JavaScript's whitespace plus U+001C–U+001F and U+0085. */
const PYTHON_ONLY_SPACE = "\u001c\u001d\u001e\u001f\u0085";
const pythonBlank = (text: string): boolean =>
  [...text].every((char) => char.trim() === "" || PYTHON_ONLY_SPACE.includes(char));

/** A refusal the schema cannot express, so only the guard makes it. */
function beyondSchema(frame: Frame, result: Decoded<unknown>): boolean {
  if (result.ok) return false;
  const { code, key } = result.error;
  if (code === "too_large" || code === "bad_version") return true;
  if (key === "tx") return typeof frame["tx"] === "string" && pythonBlank(frame["tx"]);
  if (key === "vs" && Array.isArray(frame["vs"])) {
    const ordinals = frame["vs"].map((row: unknown) => (Array.isArray(row) ? row[0] : row));
    return ordinals.includes(frame["x"]) || new Set(ordinals).size !== ordinals.length;
  }
  return false;
}

const directions = [
  { name: "client", schema: clientSchema, frames: CLIENT_FRAMES, decode: decodeClientFrame },
  { name: "server", schema: serverSchema, frames: SERVER_FRAMES, decode: decodeServerFrame },
] as const;

for (const { name, schema, frames, decode } of directions) {
  test(`the ${name} guard refuses whatever the ${name} schema refuses`, () => {
    const validate = new Ajv2020({ strict: false }).compile(schema);
    let refusedBySchema = 0;
    for (const frame of frames.flatMap(mutations)) {
      const result = decode(JSON.stringify(frame));
      if (!validate(frame)) {
        refusedBySchema += 1;
        expect(result.ok, `schema refuses ${JSON.stringify(frame)}`).toBe(false);
      } else if (!result.ok) {
        expect(beyondSchema(frame, result), `only the guard refuses ${JSON.stringify(frame)}`).toBe(
          true,
        );
      }
    }
    // The corpus exercises both verdicts, so a vacuous pass is impossible.
    expect(refusedBySchema).toBeGreaterThan(100);
  });
}
