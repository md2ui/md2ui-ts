import { describe, expect, test } from "vitest";
import {
  type Decoded,
  decodeClientFrame,
  decodeServerFrame,
  encodeClientFrame,
  WireFrameError,
} from "../src/index.ts";

function problem(result: Decoded<unknown>): [string, string | undefined] {
  if (result.ok) throw new Error("expected a refusal");
  return [result.error.code, result.error.key];
}

/** An event frame, padded with an unknown key until it is exactly `bytes` long. */
function eventOfBytes(bytes: number, extra: Record<string, unknown> = {}): string {
  const frame = (pad: string) => JSON.stringify({ t: "e", m: "c1", x: 0, q: 1, ...extra, z: pad });
  const base = new TextEncoder().encode(frame("")).length;
  return frame("p".repeat(bytes - base));
}

describe("client frame size caps", () => {
  test("an event of exactly 512 bytes passes and 513 fails", () => {
    expect(decodeClientFrame(eventOfBytes(512)).ok).toBe(true);
    expect(problem(decodeClientFrame(eventOfBytes(513)))).toEqual(["too_large", undefined]);
  });

  test("bytes count, not characters: a slug of multi-byte characters", () => {
    const slug = "😀".repeat(128); // 128 code points, 512 bytes by itself
    expect(
      problem(decodeClientFrame(JSON.stringify({ t: "e", m: "c1", x: 0, q: 1, a: slug }))),
    ).toEqual(["too_large", undefined]);
    const twoByte = { a: "é".repeat(100) };
    expect(decodeClientFrame(eventOfBytes(512, twoByte)).ok).toBe(true);
    expect(problem(decodeClientFrame(eventOfBytes(513, twoByte)))).toEqual([
      "too_large",
      undefined,
    ]);
  });

  test("a hello is capped at 512 bytes like an event", () => {
    const hello = JSON.stringify({ t: "h", v: 1, pad: "x".repeat(600) });
    expect(problem(decodeClientFrame(hello))).toEqual(["too_large", undefined]);
  });

  test("prompt text: 4096 bytes passes, 4097 fails; the frame cap is 8192", () => {
    const prompt = (tx: string) => JSON.stringify({ t: "p", q: 1, tx });
    expect(decodeClientFrame(prompt("a".repeat(4096))).ok).toBe(true);
    expect(problem(decodeClientFrame(prompt("a".repeat(4097))))).toEqual(["too_large", "tx"]);
    expect(problem(decodeClientFrame(prompt("é".repeat(2049))))).toEqual(["too_large", "tx"]);
    const padded = JSON.stringify({ t: "p", q: 1, tx: "a", pad: "x".repeat(8200) });
    expect(problem(decodeClientFrame(padded))).toEqual(["too_large", undefined]);
    const midPad = JSON.stringify({ t: "p", q: 1, tx: "a", pad: "x".repeat(7000) });
    expect(decodeClientFrame(midPad).ok).toBe(true);
  });
});

describe("server frame size caps", () => {
  const message = (md: string) => JSON.stringify({ t: "m", m: "c1", md });

  test("a frame of exactly 262144 bytes passes and one more byte fails", () => {
    const sized = (bytes: number) => message("a".repeat(bytes - message("").length));
    expect(decodeServerFrame(sized(262144)).ok).toBe(true);
    expect(problem(decodeServerFrame(sized(262145)))).toEqual(["too_large", undefined]);
  });

  test("the cap counts UTF-8 bytes, not characters", () => {
    const text = message("é".repeat(131072));
    expect(text.length).toBeLessThan(262144);
    expect(problem(decodeServerFrame(text))).toEqual(["too_large", undefined]);
  });

  test("a delta is capped the same way", () => {
    const delta = (md: string) => JSON.stringify({ t: "d", m: "c1", s: 0, md });
    expect(problem(decodeServerFrame(delta("a".repeat(262144))))).toEqual(["too_large", undefined]);
  });

  test("a message under the Markdown cap whose escaping passes the frame cap is too large", () => {
    // Every control character costs six bytes in JSON, a newline two.
    const md = "\n".repeat(131073);
    expect(md.length).toBeLessThan(262144);
    expect(problem(decodeServerFrame(message(md)))).toEqual(["too_large", undefined]);
  });

  test("an empty message decodes", () => {
    expect(decodeServerFrame(message("")).ok).toBe(true);
  });
});

describe("ids and hashes", () => {
  const event = (m: string) => JSON.stringify({ t: "e", m, x: 0, q: 1 });

  test("an id of 64 characters passes, 65 fails, a path fails", () => {
    expect(decodeClientFrame(event("a".repeat(64))).ok).toBe(true);
    expect(problem(decodeClientFrame(event("a".repeat(65))))).toEqual(["bad_frame", "m"]);
    expect(problem(decodeClientFrame(event("../etc/passwd")))).toEqual(["bad_frame", "m"]);
    expect(problem(decodeClientFrame(event("")))).toEqual(["bad_frame", "m"]);
    expect(problem(decodeClientFrame(event("ok\n")))).toEqual(["bad_frame", "m"]);
  });

  test("an optional id that is present must be valid", () => {
    const text = JSON.stringify({ t: "m", m: "c1", md: "", r: "no way" });
    expect(problem(decodeServerFrame(text))).toEqual(["bad_frame", "r"]);
  });

  test("a hash is 16 lowercase hex digits", () => {
    const end = (h: string) => JSON.stringify({ t: "z", m: "c1", h });
    expect(decodeServerFrame(end("0123456789abcdef")).ok).toBe(true);
    for (const h of ["0123456789ABCDEF", "0123456789abcde", "0123456789abcdef0", "not-a-hash"]) {
      expect(problem(decodeServerFrame(end(h)))).toEqual(["bad_frame", "h"]);
    }
  });
});

describe("numbers", () => {
  const event = (extra: string) => `{"t":"e","m":"c1","x":0,"q":1,${extra}}`;

  test("1e400 parses to Infinity and is refused as v", () => {
    expect(problem(decodeClientFrame(event('"v":1e400')))).toEqual(["bad_frame", "v"]);
    expect(decodeClientFrame(event('"v":72.5')).ok).toBe(true);
  });

  test("a boolean is not a number", () => {
    expect(problem(decodeClientFrame('{"t":"e","m":"c1","x":true,"q":1}'))).toEqual([
      "bad_frame",
      "x",
    ]);
    expect(problem(decodeClientFrame(event('"v":true')))).toEqual(["bad_frame", "v"]);
  });

  test("a fractional or negative integer field is refused", () => {
    expect(problem(decodeClientFrame('{"t":"e","m":"c1","x":0,"q":1.5}'))).toEqual([
      "bad_frame",
      "q",
    ]);
    expect(problem(decodeClientFrame('{"t":"e","m":"c1","x":-1,"q":1}'))).toEqual([
      "bad_frame",
      "x",
    ]);
    expect(problem(decodeServerFrame('{"t":"d","m":"c1","s":1.5,"md":""}'))).toEqual([
      "bad_frame",
      "s",
    ]);
  });

  test("c must be a boolean", () => {
    expect(problem(decodeClientFrame(event('"c":"yes"')))).toEqual(["bad_frame", "c"]);
    expect(problem(decodeClientFrame(event('"c":null')))).toEqual(["bad_frame", "c"]);
  });
});

describe("slug and settled values", () => {
  const event = (extra: Record<string, unknown>) =>
    JSON.stringify({ t: "e", m: "c1", x: 4, q: 1, ...extra });

  test("a slug is 1 to 128 code points", () => {
    expect(decodeClientFrame(event({ a: "é".repeat(128) })).ok).toBe(true);
    expect(problem(decodeClientFrame(event({ a: "é".repeat(129) })))).toEqual(["bad_frame", "a"]);
    expect(problem(decodeClientFrame(event({ a: "" })))).toEqual(["bad_frame", "a"]);
    expect(problem(decodeClientFrame(event({ a: 3 })))).toEqual(["bad_frame", "a"]);
  });

  test("vs rows are [ordinal, boolean | number], at most 32, never the fired x or a repeat", () => {
    expect(
      decodeClientFrame(
        event({
          vs: [
            [1, 3],
            [2, true],
          ],
        }),
      ).ok,
    ).toBe(true);
    const rows = (n: number) => Array.from({ length: n }, (_, i) => [i + 10, true]);
    expect(decodeClientFrame(event({ vs: rows(32) })).ok).toBe(true);
    expect(problem(decodeClientFrame(event({ vs: rows(33) })))).toEqual(["bad_frame", "vs"]);
    for (const vs of [
      [[4, 1]],
      [
        [1, 1],
        [1, 2],
      ],
      [[1]],
      [[1, 2, 3]],
      [[-1, 1]],
      [[1, "x"]],
      [[1, null]],
      "nope",
    ]) {
      expect(problem(decodeClientFrame(event({ vs })))).toEqual(["bad_frame", "vs"]);
    }
  });
});

describe("typing", () => {
  test("k carries nothing: unknown keys are dropped, and it is capped at 512 bytes", () => {
    expect(decodeClientFrame('{"t":"k"}')).toEqual({ ok: true, frame: { t: "k" } });
    expect(decodeClientFrame('{"t":"k","tx":"secret"}')).toEqual({ ok: true, frame: { t: "k" } });
    const typingOf = (bytes: number) => {
      const base = '{"t":"k","z":""}'.length;
      return JSON.stringify({ t: "k", z: "p".repeat(bytes - base) });
    };
    expect(decodeClientFrame(typingOf(512)).ok).toBe(true);
    expect(problem(decodeClientFrame(typingOf(513)))).toEqual(["too_large", undefined]);
    expect(encodeClientFrame({ t: "k" })).toBe('{"t":"k"}');
    expect(problem(decodeServerFrame('{"t":"k"}'))).toEqual(["bad_frame", "t"]);
  });
});

describe("types and versions", () => {
  test("hello v=1 passes, v=2 is bad_version, v=0 or v='1' is bad_frame", () => {
    expect(decodeClientFrame('{"t":"h","v":1}').ok).toBe(true);
    expect(problem(decodeClientFrame('{"t":"h","v":2}'))).toEqual(["bad_version", "v"]);
    expect(problem(decodeClientFrame('{"t":"h","v":0}'))).toEqual(["bad_frame", "v"]);
    expect(problem(decodeClientFrame('{"t":"h","v":"1"}'))).toEqual(["bad_frame", "v"]);
  });

  test("an unknown or missing type is bad_frame on t, per direction", () => {
    expect(problem(decodeClientFrame('{"t":"prompt"}'))).toEqual(["bad_frame", "t"]);
    expect(problem(decodeClientFrame("{}"))).toEqual(["bad_frame", "t"]);
    expect(problem(decodeClientFrame('{"t":"s","s":"l"}'))).toEqual(["bad_frame", "t"]);
    expect(problem(decodeServerFrame('{"t":"e","m":"c1","x":0,"q":1}'))).toEqual([
      "bad_frame",
      "t",
    ]);
    expect(problem(decodeServerFrame('{"t":"toString"}'))).toEqual(["bad_frame", "t"]);
  });

  test("not JSON and not an object are bad_frame without a key", () => {
    for (const text of ["", "{", "null", "[]", "3", '"t"']) {
      expect(problem(decodeServerFrame(text))).toEqual(["bad_frame", undefined]);
    }
  });

  test("a server error code outside the schema enum is bad_frame on code", () => {
    expect(problem(decodeServerFrame('{"t":"x","code":"nope"}'))).toEqual(["bad_frame", "code"]);
    for (const code of [
      "bad_frame",
      "too_large",
      "bad_version",
      "unknown_message",
      "stale",
      "bad_target",
      "not_forwarded",
      "slug_mismatch",
      "duplicate",
    ]) {
      expect(decodeServerFrame(JSON.stringify({ t: "x", code })).ok).toBe(true);
    }
  });

  test("a state is l, w or i; a note is at most 200 code points", () => {
    expect(problem(decodeServerFrame('{"t":"s","s":"busy"}'))).toEqual(["bad_frame", "s"]);
    expect(decodeServerFrame(JSON.stringify({ t: "s", s: "i", n: "😀".repeat(200) })).ok).toBe(
      true,
    );
    expect(
      problem(decodeServerFrame(JSON.stringify({ t: "s", s: "i", n: "😀".repeat(201) }))),
    ).toEqual(["bad_frame", "n"]);
  });

  // md2ui ADR-613 (3b7da147e): a placeholder, like a note, is a string of at most 200 code
  // points; the schema allows either on any state.
  test("a state's ph is a string of at most 200 code points", () => {
    for (const s of ["l", "w", "i"]) {
      expect(decodeServerFrame(JSON.stringify({ t: "s", s, ph: "😀".repeat(200) })).ok).toBe(true);
    }
    expect(decodeServerFrame('{"t":"s","s":"l","ph":"Any note for the rider?"}')).toEqual({
      ok: true,
      frame: { t: "s", s: "l", ph: "Any note for the rider?" },
    });
    for (const ph of ["😀".repeat(201), 3, null]) {
      expect(problem(decodeServerFrame(JSON.stringify({ t: "s", s: "l", ph })))).toEqual([
        "bad_frame",
        "ph",
      ]);
    }
  });

  // md2ui ADR-601 (5c7bf1d9): a listening state may name the events it answered; since
  // ADR-612 (8806456fc) any state may, for a click the backend answered itself.
  test("a state may carry u, 1 to 64 sequence numbers, whatever the agent is doing", () => {
    expect(decodeServerFrame('{"t":"s","s":"l","u":[3,4]}')).toEqual({
      ok: true,
      frame: { t: "s", s: "l", u: [3, 4] },
    });
    expect(decodeServerFrame('{"t":"s","s":"l","n":"listening","u":[0]}')).toEqual({
      ok: true,
      frame: { t: "s", s: "l", n: "listening", u: [0] },
    });
    for (const s of ["w", "i"]) {
      expect(decodeServerFrame(`{"t":"s","s":"${s}","u":[3]}`)).toEqual({
        ok: true,
        frame: { t: "s", s, u: [3] },
      });
    }
    const sixtyFour = Array.from({ length: 64 }, (_, i) => i);
    expect(decodeServerFrame(JSON.stringify({ t: "s", s: "l", u: sixtyFour })).ok).toBe(true);
    for (const bad of [
      '{"t":"s","s":"w","u":[]}',
      '{"t":"s","s":"l","u":[]}',
      '{"t":"s","s":"l","u":[-1]}',
      '{"t":"s","s":"l","u":[1.5]}',
      '{"t":"s","s":"l","u":3}',
      JSON.stringify({ t: "s", s: "l", u: [...sixtyFour, 64] }),
    ]) {
      expect(problem(decodeServerFrame(bad)), bad).toEqual(["bad_frame", "u"]);
    }
  });

  test("a prompt must not be blank", () => {
    expect(problem(decodeClientFrame('{"t":"p","q":1,"tx":"  \\n"}'))).toEqual(["bad_frame", "tx"]);
    expect(problem(decodeClientFrame('{"t":"p","q":1}'))).toEqual(["bad_frame", "tx"]);
  });

  test("each Python white-space code point alone is a blank prompt", () => {
    // `str.isspace()`, from python3: [c for c in range(sys.maxunicode + 1) if chr(c).isspace()]
    const spaces = [
      0x09,
      0x0a,
      0x0b,
      0x0c,
      0x0d,
      0x1c,
      0x1d,
      0x1e,
      0x1f,
      0x20,
      0x85,
      0xa0,
      0x1680,
      ...Array.from({ length: 11 }, (_, i) => 0x2000 + i),
      0x2028,
      0x2029,
      0x202f,
      0x205f,
      0x3000,
    ];
    expect(spaces).toHaveLength(29);
    for (const code of spaces) {
      const tx = String.fromCodePoint(code);
      const frame = JSON.stringify({ t: "p", q: 1, tx });
      expect(problem(decodeClientFrame(frame)), code.toString(16)).toEqual(["bad_frame", "tx"]);
    }
  });

  test("U+FEFF is not white space to the server, so a prompt of only that is sent", () => {
    for (const tx of ["\ufeff", " \ufeff ", "\u200b", "\u180e"]) {
      expect(decodeClientFrame(JSON.stringify({ t: "p", q: 1, tx })).ok, tx).toBe(true);
    }
  });

  test("the first failing key wins, in the reference's order", () => {
    expect(problem(decodeClientFrame('{"t":"e","m":"!","x":-1,"q":"a"}'))).toEqual([
      "bad_frame",
      "m",
    ]);
  });
});

describe("decoded frames", () => {
  test("unknown keys are dropped and the frame is a new object", () => {
    const result = decodeServerFrame('{"t":"m","m":"c1","md":"hi","extra":1,"r":"c0"}');
    expect(result).toEqual({ ok: true, frame: { t: "m", m: "c1", md: "hi", r: "c0" } });
    const event = decodeClientFrame('{"t":"e","m":"c1","x":0,"q":1,"zzz":[1]}');
    expect(event).toEqual({ ok: true, frame: { t: "e", m: "c1", x: 0, q: 1 } });
    expect(Object.keys(event.ok ? event.frame : {})).toEqual(["t", "m", "x", "q"]);
  });
});

describe("encodeClientFrame", () => {
  test("produces compact JSON that round-trips", () => {
    const frame = {
      t: "e",
      m: "c7",
      x: 4,
      q: 9,
      a: "proceed",
      vs: [
        [1, 3],
        [2, true],
      ],
    } as const;
    const text = encodeClientFrame(frame);
    expect(text).toBe('{"t":"e","m":"c7","x":4,"q":9,"a":"proceed","vs":[[1,3],[2,true]]}');
    expect(decodeClientFrame(text)).toEqual({ ok: true, frame });
    expect(encodeClientFrame({ t: "h", v: 1 })).toBe('{"t":"h","v":1}');
  });

  test("throws a WireFrameError with the code and key", () => {
    const refusal = (run: () => unknown): [string, string | undefined] => {
      try {
        run();
      } catch (error) {
        if (error instanceof WireFrameError) return [error.code, error.key];
        throw error;
      }
      throw new Error("expected a throw");
    };
    expect(refusal(() => encodeClientFrame({ t: "e", m: "c1", x: -1, q: 1 }))).toEqual([
      "bad_frame",
      "x",
    ]);
    expect(refusal(() => encodeClientFrame({ t: "e", m: "c1", x: 1.5, q: 1 }))).toEqual([
      "bad_frame",
      "x",
    ]);
    expect(
      refusal(() => encodeClientFrame({ t: "e", m: "c1", x: 0, q: 1, v: Number.NaN })),
    ).toEqual(["bad_frame", "v"]);
    expect(
      refusal(() => encodeClientFrame({ t: "e", m: "c1", x: 0, q: 1, a: "a".repeat(129) })),
    ).toEqual(["bad_frame", "a"]);
    expect(
      refusal(() => encodeClientFrame({ t: "e", m: "c1", x: 0, q: 1, a: "😀".repeat(128) })),
    ).toEqual(["too_large", undefined]);
    expect(refusal(() => encodeClientFrame({ t: "p", q: 1, tx: " " }))).toEqual([
      "bad_frame",
      "tx",
    ]);
    expect(refusal(() => encodeClientFrame({ t: "p", q: 1, tx: "a".repeat(4097) }))).toEqual([
      "too_large",
      "tx",
    ]);
    expect(refusal(() => encodeClientFrame({ t: "h", v: 2 }))).toEqual(["bad_version", "v"]);
  });
});
