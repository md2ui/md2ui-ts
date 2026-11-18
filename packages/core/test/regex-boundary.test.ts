// md2ui's patterns spell Python's `\b`, which JavaScript reads as ASCII, as lookarounds on
// Python's `\w` (`translate`). Where the pattern itself says one neighbour is a word
// character, only the other side is asked: one lookaround in place of four, which Firefox
// and WebKit compile in about half the time. What a pattern finds must not change:
// each shape is checked against what Python's `re` finds.
import { expect, test } from "vitest";
import { compile, RegexKit } from "../src/group/py/re.ts";

const W = String.raw`[\p{L}\p{N}_]`;
const BOTH = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`;

test("a \\b next to a known word character asks only the other side", () => {
  const source = (pattern: string, i = false): string => compile(pattern, { i }).source;
  expect(source(String.raw`\bfoo`, true)).toBe(`(?<!${W})foo`);
  expect(source(String.raw`foo\b`)).toBe(`foo(?!${W})`);
  expect(source(String.raw`\b\d+\b`)).toBe(`(?<!${W})\\p{Nd}+(?!${W})`);
  expect(source(String.raw`\b(?:Jan|Feb)\.?\b`)).toBe(`(?<!${W})(?:Jan|Feb)\\.?${BOTH}`);
  expect(source(String.raw`\b[A-Z]{0,2}x`)).toBe(`${BOTH}[A-Z]{0,2}x`);
  expect(source(String.raw`(?:ab|-)\b`)).toBe(`(?:ab|-)${BOTH}`);
  expect(source(String.raw`x(?=y)\b`)).toBe(`x(?=y)${BOTH}`);
});

/** The texts each pattern is searched through. */
const TEXTS = [
  "foo food xfoo foo_ 3foo",
  "ab cd abx -ab a- --",
  "12 a12 12b 1_2 \u0663\u0664 x",
  "Jan. Feb Janx jan. FEB.",
  "AB ABC A x Ax AAx .x",
  "a. .b xy x-y",
  "\u212a k \u017f s Ks",
  "\u00e9 ab \u00c9COLE _ __ a_b",
];

/**
 * Per pattern and `re.IGNORECASE`: the spans `finditer` finds in each text. From Python
 * 3.14.4: for each, `[[m.span() for m in re.compile(p, re.I if i else 0)
 * .finditer(t)] for t in TEXTS]`.
 */
// biome-ignore format: one row per pattern, as Python printed it
const PYTHON: [pattern: string, i: boolean, spans: [number, number][][]][] = [
  ["\\bfoo", false, [[[0,3],[4,7],[14,17],],[],[],[],[],[],[],[],],],
  ["\\bfoo", true, [[[0,3],[4,7],[14,17],],[],[],[],[],[],[],[],],],
  ["foo\\b", false, [[[0,3],[10,13],[20,23],],[],[],[],[],[],[],[],],],
  ["foo\\b", true, [[[0,3],[10,13],[20,23],],[],[],[],[],[],[],[],],],
  ["\\b\\d+\\b", false, [[],[],[[0,2],[15,17],],[],[],[],[],[],],],
  ["\\b\\d+\\b", true, [[],[],[[0,2],[15,17],],[],[],[],[],[],],],
  ["(?:ab|cd)\\b", false, [[],[[0,2],[3,5],[11,13],],[],[],[],[],[],[[2,4]],],],
  ["(?:ab|cd)\\b", true, [[],[[0,2],[3,5],[11,13],],[],[],[[0,2]],[],[],[[2,4]],],],
  ["\\b(?:ab|-)", false, [[],[[0,2],[6,8],[11,13],[15,16],],[],[],[],[[10,11]],[],[[2,4]],],],
  ["\\b(?:ab|-)", true, [[],[[0,2],[6,8],[11,13],[15,16],],[],[],[[0,2],[3,5],],[[10,11]],[],[[2,4]],],],
  ["\\b(?:Jan|Feb)\\.?\\b", false, [[],[],[],[[0,3],[5,8],],[],[],[],[],],],
  ["\\b(?:Jan|Feb)\\.?\\b", true, [[],[],[],[[0,3],[5,8],[14,17],[19,22],],[],[],[],[],],],
  ["\\b[A-Z]{2,}\\b", false, [[],[],[],[[19,22]],[[0,2],[3,6],],[],[],[],],],
  ["\\b[A-Z]{2,}\\b", true, [[[0,3],[4,8],[9,13],],[[0,2],[3,5],[6,9],[11,13],],[],[[0,3],[5,8],[9,13],[14,17],[19,22],],[[0,2],[3,6],[11,13],[14,17],],[[6,8]],[[8,10]],[[2,4]],],],
  ["\\b[A-Z]{0,2}x", false, [[[9,10]],[],[[18,19]],[],[[9,10],[11,13],[14,17],[19,20],],[[6,7],[9,10],],[],[],],],
  ["\\b[A-Z]{0,2}x", true, [[[9,10]],[[6,9]],[[18,19]],[],[[9,10],[11,13],[14,17],[19,20],],[[6,7],[9,10],],[],[],],],
  ["\\b\\.", false, [[],[],[],[[3,4],[17,18],[22,23],],[],[[1,2]],[],[],],],
  ["\\b\\.", true, [[],[],[],[[3,4],[17,18],[22,23],],[],[[1,2]],[],[],],],
  ["x(?=y)\\b", false, [[],[],[],[],[],[],[],[]]],
  ["x(?=y)\\b", true, [[],[],[],[],[],[],[],[]]],
  ["(?<=\\bk)\\w", false, [[],[],[],[],[],[],[],[]]],
  ["(?<=\\bk)\\w", true, [[],[],[],[],[],[],[[9,10]],[]]],
  ["\\b(?:k|s)\\w*", false, [[],[],[],[],[],[],[[2,3],[6,7],],[],],],
  ["\\b(?:k|s)\\w*", true, [[],[],[],[],[],[],[[0,1],[2,3],[4,5],[6,7],[8,10],],[],],],
  ["\\w+\\b(?!-)", false, [[[0,3],[4,8],[9,13],[14,18],[19,23],],[[0,2],[3,5],[6,9],[11,13],],[[0,2],[3,6],[7,10],[11,14],[15,17],[18,19],],[[0,3],[5,8],[9,13],[14,17],[19,22],],[[0,2],[3,6],[7,8],[9,10],[11,13],[14,17],[19,20],],[[0,1],[4,5],[6,8],[11,12],],[[0,1],[2,3],[4,5],[6,7],[8,10],],[[0,1],[2,4],[5,10],[11,12],[13,15],[16,19],],],],
  ["\\w+\\b(?!-)", true, [[[0,3],[4,8],[9,13],[14,18],[19,23],],[[0,2],[3,5],[6,9],[11,13],],[[0,2],[3,6],[7,10],[11,14],[15,17],[18,19],],[[0,3],[5,8],[9,13],[14,17],[19,22],],[[0,2],[3,6],[7,8],[9,10],[11,13],[14,17],[19,20],],[[0,1],[4,5],[6,8],[11,12],],[[0,1],[2,3],[4,5],[6,7],[8,10],],[[0,1],[2,4],[5,10],[11,12],[13,15],[16,19],],],],
  ["\\b_\\b", false, [[],[],[],[],[],[],[],[[11,12]]]],
  ["\\b_\\b", true, [[],[],[],[],[],[],[],[[11,12]]]],
];

test("a pattern finds what Python finds around its word boundaries", () => {
  const kit = new RegexKit();
  for (const [pattern, i, spans] of PYTHON) {
    const re = kit.re(compile(pattern, { i }));
    TEXTS.forEach((text, k) => {
      const found = [...re.finditer(text)].map((m) => m.span());
      expect(found, `${pattern} ${i ? "i " : ""}in ${JSON.stringify(text)}`).toEqual(spans[k]);
    });
  }
});
