// The detector's patterns lead with a lookahead for the characters a match can start
// with (`compileFirst`). It must never change what a pattern finds: each shape
// translate writes is searched with and without it through texts that hold every
// character the shapes name, and through texts that start a match nowhere.
import { expect, test } from "vitest";
import { compileFirst } from "../src/group/py/first-lookahead.ts";
import { compile, RegexKit } from "../src/group/py/re.ts";

const SHAPES: readonly [pattern: string, leads: boolean][] = [
  [String.raw`\d+(?:\.\d+)?\s*%`, true],
  [String.raw`(?:USD|\$|€)\s?\d+`, true],
  [String.raw`(?:-|\+)?\d+`, true],
  ["[a-]x|[-b]y|c", true],
  [String.raw`[^\d\s]+!`, true],
  [String.raw`(?P<n>\d+)\s*(?P=n)`, true],
  [String.raw`(?<![\w.])\b\d{1,2}:\d{2}\b`, true],
  ["a?b*c{0,2}d", true],
  ["x{2,}|y{3}", true],
  [String.raw`[\S]z`, true],
  [String.raw`\U0001F600+|ok`, true],
  [String.raw`\.\.\.|\(\d\)`, true],
  ["(?:a|)b", true],
  // No lookahead: a match may be empty, or start at an anchor.
  ["a*", false],
  ["(?:a|b?)", false],
  [String.raw`^\d+`, false],
  [String.raw`(?:^|\s)#\w+`, false],
];

const TEXTS: readonly string[] = [
  "",
  "12.5 % of 3%",
  "USD 40, $5, €7 and -3, +4, 5",
  "ax -x by -y c xa",
  "ab! 1! !! a b!",
  "12 12 and 3 4",
  "at 9:30, a.9:30 and 12:05pm",
  "d bd cd bbccd acd",
  "xx yyy xxxx yy",
  "z az  z",
  "😀😀 ok 😀",
  "... (1) ( 1) ....",
  "b ab cb",
  "aaa bbb",
  "#tag a#tag",
  "no match here at all, NONE",
];

test("a lookahead leads exactly the shapes every match starts with a known character", () => {
  for (const [pattern, leads] of SHAPES) {
    for (const i of [false, true]) {
      const looked = compileFirst(pattern, { i });
      const plain = compile(pattern, { i });
      expect(looked.source !== plain.source, pattern).toBe(leads);
    }
  }
});

test("the lookahead never changes what a pattern finds", () => {
  const kit = new RegexKit();
  const found = (pattern: Parameters<RegexKit["re"]>[0], text: string): unknown =>
    [...kit.re(pattern).finditer(text)].map((m) => [m.span(), m.groups()]);
  for (const [pattern] of SHAPES) {
    for (const i of [false, true]) {
      const looked = compileFirst(pattern, { i });
      const plain = compile(pattern, { i });
      for (const text of [...TEXTS, ...TEXTS.map((t) => t.toUpperCase())]) {
        expect(found(looked, text), `${pattern} in ${text}`).toEqual(found(plain, text));
        expect(kit.re(looked).fullmatch(text)?.span()).toEqual(
          kit.re(plain).fullmatch(text)?.span(),
        );
      }
    }
  }
});
