// A ring's unit label inside the circle (md2ui `render_ring_text`): it
// wraps onto up to two lines that each fit the clear inside at that line's height, shrinks
// no further than 80% of its `Ring Unit` size, and ends in an ellipsis when it still does
// not fit. The leaf's measured box and the painted label read one plan (md2ui ADR-400).
//
// md2ui's `tests/ring_text_tests.py`, on its tests THEME.md's ring (diameter 148, stroke
// 12, value 28, unit 13: the clear inside is 116 px across), measured by the deterministic
// fake measurer instead of md2ui's fonts, so the labels that show each stage are this
// measurer's: a glyph is half its size wide, a space a quarter, its ink 0.7 of the size
// above the baseline, across its advance.
import type { FontSpec, TextEntry, TextMeasurer } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { fontOf } from "../src/measure/font-set.ts";
import { leafHeights } from "../src/measure/leaf-heights.ts";
import { LINE_SCALE, leafKit } from "../src/measure/leaf-kit.ts";
import { leafWidths } from "../src/measure/leaf-widths.ts";
import { ringText } from "../src/measure/ring-text.ts";
import { createFakeMeasurer } from "../src/text/fake-measurer.ts";
import { parseTheme } from "../src/theme/parse.ts";
import { paintMarkdown } from "./scene-kit.ts";

const THEME_TEXT =
  "## Drawing elements\n### Unit Ratios\nStyle: ring\nShow total: no\n\n" +
  "### Ring\nDiameter: 148\nThickness: 12\n- Font size: 28\n- Font weight: 600\n\n" +
  "### Ring Unit\n- Font size: 13\n";
const THEME = parseTheme(THEME_TEXT);
const TEXT = createFakeMeasurer();
const KIT = leafKit(THEME, TEXT, (path) => path ?? "emoji");
const HEIGHTS = leafHeights(KIT);
const WIDTHS = leafWidths(KIT);
const UNIT = 13;

const unit = (text: string) => ({ ring_role: "unit", ring_text: text });
const plan = (text: string) => ringText(THEME, TEXT, KIT.fonts, "unit", text);

/**
 * Whether label line `i` of `count` keeps its ink inside the clear circle (baseline one
 * size below the line's top, centred on its advance), worked out here independently of
 * the module under test.
 */
function inside(line: string, i: number, count: number, font: FontSpec, text = TEXT): boolean {
  const radius = (148 - 2 * 12 - 2 * 4) / 2;
  const valueH = 28 * LINE_SCALE;
  const lineH = font.size * LINE_SCALE;
  const base = -(valueH + count * lineH) / 2 + valueH + i * lineH + font.size;
  const ink = text.inkBounds(line, font);
  const dy = Math.max(Math.abs(base - ink.top), Math.abs(base - ink.top + ink.height));
  const half = text.advance(line, font) / 2;
  const dx = Math.max(half - ink.left, ink.left + ink.width - half);
  return dx ** 2 + dy ** 2 <= radius ** 2;
}

// md2ui ring_text_tests: test_a_label_wider_than_the_ring_wraps_whole
test("a label wider than the ring wraps onto two lines, whole", () => {
  expect(HEIGHTS.leafHeight(null, 148, unit("Structured cards and actions"))).toBe(
    2 * UNIT * LINE_SCALE,
  );
  const p = plan("Structured cards and actions");
  expect(p.lines).toEqual(["Structured cards", "and actions"]);
  expect(p.size).toBe(UNIT);
});

// md2ui ring_text_tests: test_each_line_fits_the_clear_inside_at_its_height
test("each label line fits the clear inside at its own height", () => {
  const rp = unit("Weekly active sessions");
  expect(HEIGHTS.leafHeight(null, 148, rp)).toBe(2 * UNIT * LINE_SCALE);
  const p = plan("Weekly active sessions");
  const font = fontOf(p.faces.typeface, p.size);
  expect(p.lines.map((line, i) => inside(line, i, p.lines.length, font))).toEqual([true, true]);
  expect(inside(p.lines.join(" "), 0, 1, font)).toBe(false);
  expect(WIDTHS.leafNaturalWidth(null, 148, rp)).toBe(
    Math.max(...p.lines.map((ln) => TEXT.advance(ln, font))),
  );
});

// md2ui ring_text_tests: test_two_lines_that_do_not_fit_shrink_before_anything_is_cut
test("a label that two lines cannot hold shrinks, whole", () => {
  const p = plan("Live data with reliable imagery");
  expect(p.lines.join(" ")).toBe("Live data with reliable imagery");
  expect(p.size).toBeGreaterThanOrEqual(UNIT * 0.8);
  expect(p.size).toBeLessThan(UNIT);
  // The largest quarter-pixel step whose lines fit: one step up, they did not.
  expect(p.size).toBe(12.25);
  const up = fontOf(p.faces.typeface, p.size + 0.25);
  expect(p.lines.every((ln, i) => inside(ln, i, 2, up))).toBe(false);
});

// md2ui ring_text_tests: test_past_the_floor_the_label_ends_in_an_ellipsis
test("past the 80% floor the label ends in an ellipsis", () => {
  const p = plan("Average weekly sessions per active member");
  expect(p.size).toBe(UNIT * 0.8);
  expect(p.lines).toEqual(["Average weekly", "sessions per active…"]);
  const font = fontOf(p.faces.typeface, p.size);
  expect(p.lines.map((line, i) => inside(line, i, 2, font))).toEqual([true, true]);
  const rp = unit("Average weekly sessions per active member");
  expect(HEIGHTS.leafHeight(null, 148, rp)).toBe(2 * p.size * LINE_SCALE);
  expect(HEIGHTS.leafFirstBaseline(null, rp)).toBe(p.size);
});

// md2ui `_clear_inside` judges a line by its glyphs' ink, which can reach past its advance
// (Skia's boxes run about a pixel past each end). Under ink that overhangs by 1.5 px on
// each side, a label that fits by its advance alone must wrap or shrink further.
test("horizontal fit is judged on the ink, not the advance", () => {
  const overhang: TextMeasurer = {
    ...TEXT,
    inkBounds: (t, f) => {
      const ink = TEXT.inkBounds(t, f);
      return ink.width === 0 ? ink : { ...ink, left: ink.left - 1.5, width: ink.width + 3 };
    },
  };
  const label = "Live data with reliable imagery";
  const byAdvance = plan(label);
  const byInk = ringText(THEME, overhang, KIT.fonts, "unit", label);
  expect(byInk.size).toBeLessThan(byAdvance.size);
  const font = fontOf(byInk.faces.typeface, byInk.size);
  expect(byInk.lines.map((ln, i) => inside(ln, i, byInk.lines.length, font, overhang))).toEqual(
    byInk.lines.map(() => true),
  );
  const at = fontOf(byAdvance.faces.typeface, byAdvance.size);
  expect(byAdvance.lines.every((ln, i) => inside(ln, i, 2, at, overhang))).toBe(false);
});

// md2ui ring_text_tests: test_a_short_label_and_the_value_keep_one_themed_line
test("a short label and the value keep their one themed line", () => {
  expect(HEIGHTS.leafHeight(null, 148, unit("Kcal"))).toBe(UNIT * LINE_SCALE);
  const value = { ring_role: "value", ring_text: "4/10" };
  expect(HEIGHTS.leafHeight(null, 148, value)).toBe(28 * LINE_SCALE);
});

// Not in md2ui's tests (its value path is unchanged): a value wider than the clear inside
// scales its glyphs to fit, keeps its themed line, and is no wider than the clear inside.
test("a value wider than the ring scales to fit on its themed line", () => {
  const value = { ring_role: "value", ring_text: "123456/1000000" };
  const p = ringText(THEME, TEXT, KIT.fonts, "value", "123456/1000000");
  expect(p.size).toBeLessThan(28);
  expect(p.width).toBe(116);
  expect(TEXT.advance(p.text, fontOf(p.faces.typeface, p.size))).toBeCloseTo(116, 9);
  expect(HEIGHTS.leafHeight(null, 148, value)).toBe(28 * LINE_SCALE);
  expect(HEIGHTS.leafFirstBaseline(null, value)).toBe(p.size);
});

/** Each drawn line of `labels`' rings: its text, font size, and its ink's farthest corner from its ring's centre. */
function drawnLabels(labels: readonly string[]) {
  const doc = labels.map((l, i) => `- ${l}: ${i + 1}/10`).join("\n");
  const { painted } = paintMarkdown(doc, THEME_TEXT, 1280);
  const entries = painted.list.entries;
  const rings = entries.flatMap((e) => (e.type === "arc" ? [e] : []));
  const texts = entries.filter((e): e is TextEntry => e.type === "text");
  return texts
    .filter((t) => t.runs[0]?.font.size !== 28)
    .map((t) => {
      const run = t.runs[0];
      if (run === undefined) throw new Error("a text with no run");
      const ring = rings.find(
        (r) => Math.abs(r.cx - (run.x + TEXT.advance(run.text, run.font) / 2)) < 1,
      );
      if (ring === undefined) throw new Error(`no ring under "${run.text}"`);
      const ink = TEXT.inkBounds(run.text, run.font);
      const half = TEXT.advance(run.text, run.font) / 2;
      const dx = Math.max(half - ink.left, ink.left + ink.width - half);
      const dy = Math.max(
        Math.abs(t.y - ink.top - ring.cy),
        Math.abs(t.y - ink.top + ink.height - ring.cy),
      );
      return { text: run.text, size: run.font.size, reach: Math.hypot(dx, dy) };
    });
}

// What md2ui's sample `tests-ring-label-wraps` shows, painted: the drawn lines are the
// plan's, at the plan's size, and every line's ink stays inside the clear circle.
test("the painted label is the plan measure read: wrapped, shrunk, ellipsized", () => {
  const labels = [
    "Structured cards and actions",
    "Live data with reliable imagery",
    "Average weekly sessions per active member",
  ];
  const drawn = drawnLabels(labels);
  expect(drawn.map(({ text, size }) => ({ text, size }))).toEqual(
    labels.flatMap((l) => {
      const p = plan(l);
      return p.lines.map((text) => ({ text, size: p.size }));
    }),
  );
  expect(drawn.map((d) => d.size)).toEqual([13, 13, 12.25, 12.25, 10.4, 10.4]);
  for (const d of drawn) expect(d.reach).toBeLessThanOrEqual(58 + 1e-9);
});
