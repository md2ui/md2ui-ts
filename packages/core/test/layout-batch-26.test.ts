// In the generator, a drawn display's column floor is its drawn size. A drawn ring or date
// chip, seen through any single-child wrap, gets no word-count floor, in a run
// (`_cols_for_unit`) and across its kind (`_build_kind_maps`), and a kind's shared count adds
// the chip's card padding as one run does (`column_padding_x`). Each test is md2ui's own
// (`tests/datapoint_layout_tests.py`), run through this port's grouper with md2ui's stand-in
// measurer: every leaf is as wide as the test's `measure_width` says.
import type { ResolvedTheme } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { groupMarkdown } from "../src/group/grouper.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { generate } from "../src/layout/generate.ts";
import { layoutInput } from "../src/layout/input.ts";
import type { LayoutMeasurer } from "../src/layout/measurer.ts";
import type { LayoutNode } from "../src/layout/node.ts";
import { parseTheme } from "../src/theme/parse.ts";

/**
 * md2ui's `measure_width=lambda _n: w`, with no other measurer: no line widths, and no
 * heights, so the aspect cap finds no sliver to widen.
 */
function standIn(w: number): LayoutMeasurer {
  const notAsked = (): never => {
    throw new Error("not asked here");
  };
  return {
    leafMinWidth: () => w,
    leafLineWidth: () => null,
    markerWidth: notAsked,
    blockWidth: notAsked,
    layoutHeight: () => 0,
  };
}

/** The `grid_cols` of every grid in `doc` laid out at `width`. */
function gridCols(doc: string, width: number, theme: ResolvedTheme, leafWidth: number): number[] {
  const kit = new RegexKit();
  const input = layoutInput(kit, groupMarkdown(doc, kit));
  const walk = (n: LayoutNode): LayoutNode[] => [n, ...n.children.flatMap(walk)];
  return walk(generate(input, width, theme, standIn(leafWidth)))
    .filter((n) => n.grid)
    .map((n) => n.grid_cols ?? 0);
}

const twice = (run: string): string => `${run}\n\nBetween the runs.\n\n${run}`;

// --- date chips --------------------------------------------------------------------------

const CHIPS = parseTheme("## Drawing elements\n### Dates\nPadding: 12\n");
const CHIP_RUN = Array.from({ length: 8 }, (_, i) => `Jun-${i + 5}`).join(" - ");

// md2ui datapoint_layout_tests: test_date_chip_columns_are_chip_wide
test("a date chip's column is its text plus its card padding", () => {
  // 8 chips of 28px text and 24px padding fit 652px in one row; LEAF_WIDTH's one-word
  // 80px gridded them 4+4.
  expect(CHIPS.datapoints.date_chip.chip.padding.left).toBe(12);
  expect(gridCols(CHIP_RUN, 652, CHIPS, 28)).toEqual([8]);
});

// md2ui datapoint_layout_tests: test_date_chip_kind_columns_match_one_run
test("a date chip kind's shared columns match one run's", () => {
  // Two runs of one kind share a count (`_kind_cols`), and it must be the one a lone run
  // gets: chip-wide columns plus the card padding — not 80px, nor the text alone.
  for (const width of [450, 652]) {
    const one = gridCols(CHIP_RUN, width, CHIPS, 28);
    expect(gridCols(twice(CHIP_RUN), width, CHIPS, 28)).toEqual([...one, ...one]);
  }
});

// --- rings ---------------------------------------------------------------------------------

const RINGS_THEME = parseTheme("## Drawing elements\n### Unit Ratios\nStyle: ring\n");
// Four rings; only the first member's key is long enough to be `short` (a 200px LEAF_WIDTH
// floor). Every ring draws 96px wide.
const RINGS = [
  "Live data with reliable images: 8/10",
  "Basic text answer: 2/10 difficulty",
  "Structured cards and actions: 4/10",
  "A polished interactive session: 7/10",
];
const list = (items: readonly string[]): string => items.map((i) => `- ${i}`).join("\n");

// md2ui datapoint_layout_tests: test_ring_columns_are_ring_wide_whatever_the_order
test("a ring's column is the ring, whatever its run's order", () => {
  // With the long key first every column was floored at 200px, and four rings that fit
  // one row at 600px gridded 2x2; with a short key first they drew four across.
  const shortFirst = [RINGS[1], RINGS[0], ...RINGS.slice(2)] as string[];
  expect(gridCols(list(RINGS), 600, RINGS_THEME, 30)).toEqual([4]);
  expect(gridCols(list(shortFirst), 600, RINGS_THEME, 30)).toEqual([4]);
});

// md2ui datapoint_layout_tests: test_ring_kind_columns_are_ring_wide
test("a ring kind's shared columns are ring-wide", () => {
  // Two runs of one kind share a count floored by every member (`_kind_cols`).
  expect(gridCols(twice(list(RINGS)), 600, RINGS_THEME, 30)).toEqual([4, 4]);
});

// Not in md2ui's tests: its docstring's other half. A bar writes its words as a line beside
// a bar that stretches, so a bar keeps its key's word-count floor and these four grid two
// across. Expected value measured on md2ui (a scratch script outside
// both repositories, this test's document and stand-in measurer).
test("a bar keeps its word-count floor", () => {
  const bars = parseTheme("## Drawing elements\n### Unit Ratios\nStyle: bar\n");
  expect(gridCols(list(RINGS), 600, bars, 30)).toEqual([2, 2]);
});
