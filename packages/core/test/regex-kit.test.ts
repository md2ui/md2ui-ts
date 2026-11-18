// A kit a view keeps across its documents (ADR-104) holds the patterns the modules
// declare and only the last two runs' patterns built from the text: regrouping the same
// document does not grow it (otherwise every regroup would add an entry for each
// pattern built per call, and a view would keep them all for its life).
import { expect, test } from "vitest";
import { groupMarkdown } from "../src/group/grouper.ts";
import { compile, RegexKit } from "../src/group/py/re.ts";

// Patterns built per call: a fence's closer, the styled spans' wraps, a dedent margin.
const DOCUMENT = [
  "# Built patterns",
  "",
  "__A lead line__ and _a muted one_",
  "",
  "___Display___",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  "~~~~",
  "code",
  "~~~~",
  "",
  "- item",
  "",
  "      indented under the item",
].join("\n");

/** The entries a kit keeps by key; read from outside, as no caller needs the count. */
function entries(kit: RegexKit): number {
  const size = (name: string): number =>
    (Reflect.get(kit, name) as Map<unknown, unknown> | undefined)?.size ?? 0;
  return size("compiled") + size("compiledBefore");
}

test("regrouping one document on a kept kit keeps its pattern count flat", () => {
  const kit = new RegexKit();
  // The first run also enters the module patterns by key; two runs later they are
  // found by object alone.
  for (let i = 0; i < 3; i++) groupMarkdown(DOCUMENT, kit);
  const settled = entries(kit);
  for (let i = 0; i < 10; i++) groupMarkdown(DOCUMENT, kit);
  expect(entries(kit)).toBe(settled);
});

test("a pattern built again from the same source is the one the kit compiled", () => {
  const kit = new RegexKit();
  const first = kit.re(compile("a+b"));
  expect(kit.re(compile("a+b"))).toBe(first);
  // Flags are part of what a pattern is.
  expect(kit.re(compile("a+b", { i: true }))).not.toBe(first);
});

test("a built pattern is forgotten once two runs have not used it", () => {
  const kit = new RegexKit();
  const first = kit.re(compile("x{2}"));
  kit.startRun();
  expect(kit.re(compile("x{2}"))).toBe(first);
  kit.startRun();
  kit.startRun();
  expect(kit.re(compile("x{2}"))).not.toBe(first);
});
