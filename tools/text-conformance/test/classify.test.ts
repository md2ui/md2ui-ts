import type { TextLine } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { causeOf, classifyDivergence, classifyGap } from "../src/index.ts";

const line = (text: string, width: number): TextLine => ({
  width,
  fragments: [{ span: 0, text, x: 0, width }],
});
const face = "Inter 18pt|Inter18pt-Regular|400|5|0";

test("identical lines are no divergence", () => {
  const lines = [line("one two", 50), line("three", 30)];
  expect(classifyDivergence(lines, lines, 60, 0.005)).toBeUndefined();
});

test("a line over the width by less than the epsilon is the fit-epsilon class", () => {
  const pretext = [line("one two three", 60.004)];
  const md2ui = [line("one two", 40), line("three", 18)];
  expect(classifyDivergence(pretext, md2ui, 60, 0.005)).toMatch(/^fit epsilon/u);
  expect(classifyDivergence(pretext, md2ui, 60, 0.001)).toBe("unclassified");
});

test("breaks inside a word are named by what the word is", () => {
  const md2ui = (w: string) => [line(w, 100)];
  expect(
    classifyDivergence([line("first-", 30), line("run", 20)], md2ui("first-run"), 40, 0.005),
  ).toMatch(/hyphen/u);
  expect(classifyDivergence([line("a/", 10), line("b", 10)], md2ui("a/b"), 40, 0.005)).toMatch(
    /URL/u,
  );
  expect(
    classifyDivergence([line("abc", 30), line("def", 30)], md2ui("abcdef"), 40, 0.005),
  ).toMatch(/^overlong word/u);
});

test("gaps are classified by the word they came from", () => {
  const gap = (text: string) => ({ font: "", face, text });
  expect(classifyGap({ font: "1px serif", face: undefined, text: "x" }, [])).toMatch(
    /never measured/u,
  );
  expect(classifyGap(gap("\u{1F600}"), ["hi"])).toMatch(/^probe/u);
  expect(classifyGap(gap("-"), ["no", "dash"])).toMatch(/^probe/u);
  expect(classifyGap(gap("5"), ["5-7"])).toMatch(/hyphenated/u);
  expect(classifyGap(gap("4"), ["64/100"])).toMatch(/URL/u);
  expect(classifyGap(gap("e"), ["word"])).toBe("unclassified");
  expect(classifyGap(gap("o"), ["word"])).toMatch(/^grapheme/u);
});

test("a segmentation gap explains a difference before a grapheme gap", () => {
  const grapheme = classifyGap({ font: "", face, text: "o" }, ["word"]);
  const hyphen = classifyGap({ font: "", face, text: "5" }, ["5-7"]);
  expect(causeOf(new Set([grapheme, hyphen]))).toBe(hyphen);
  expect(causeOf(new Set(["probe: x"]))).toBeUndefined();
});
