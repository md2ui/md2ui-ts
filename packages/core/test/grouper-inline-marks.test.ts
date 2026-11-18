// Marker repair at edges the corpus barely reaches. Expected values were read from
// md2ui's grouper_inline_marks (_balance_markdown_markers, _one_marker_family).
import { expect, test } from "vitest";
import { balanceMarkdownMarkers, oneMarkerFamily } from "../src/group/inline-marks.ts";
import { RegexKit } from "../src/group/py/re.ts";

const kit = new RegexKit();

test("the opener's run length wins, and a stranded closer gets its opener", () => {
  expect(balanceMarkdownMarkers(kit, "__x_")).toBe("__x__");
  expect(balanceMarkdownMarkers(kit, "ppm (2024)**")).toBe("**ppm (2024)**");
});

test("a run flanked by white space at an edge is dead text and goes", () => {
  expect(balanceMarkdownMarkers(kit, "** Crossed on")).toBe("Crossed on");
});

test("a run the source line left unpaired is text, not a broken marker", () => {
  expect(balanceMarkdownMarkers(kit, "B_x", "A_B_x", 2)).toBe("B_x");
});

test("an underscore between two astral letters is intraword, as Python reads it", () => {
  expect(balanceMarkdownMarkers(kit, "\u{1d400}_x_\u{1d401}")).toBe("\u{1d400}_x_\u{1d401}");
  expect(oneMarkerFamily(kit, "\u{1d400}_x_\u{1d401}")).toBe("\u{1d400}_x_\u{1d401}");
});

test("underscore emphasis reads as the asterisk run of the same length", () => {
  expect(oneMarkerFamily(kit, "__x_")).toBe("**x*");
  expect(oneMarkerFamily(kit, "_a_ *b*")).toBe("*a* *b*");
});
