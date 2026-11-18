// The line chart: `Key: a → b → c` as one line over its points, and a list of such items as
// several lines on one axis under a legend; its geometry (the axis fits the data's range, tick
// labels left out where they crowd, a legend that wraps between entries), its layout (the key
// and the last value as written over the drawn leaf) and its paint. Expected values are md2ui's
// own tests (line_chart_tests, line_group_tests, and the `test_line_chart_ticks_are_replaced`
// of paint_replacement_tests), run through the whole pipeline with the deterministic fake
// measurer. Where md2ui asserts a pixel of a Skia canvas, these assert the display-list entry
// that paints it. The grouper half of those files is `grouper-batch-30.test.ts`.
import type { DisplayEntry, FillEntry, FontSpec, StrokeEntry, TextEntry } from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { leafHeights } from "../src/measure/leaf-heights.ts";
import { LINE_SCALE } from "../src/measure/leaf-kit.ts";
import {
  LINE_TICK_GAP,
  lineChartHeight,
  lineLegendRows,
  linePoints,
  lineShownTicks,
} from "../src/measure/line-charts.ts";
import { drawLineChart } from "../src/scene/draw/line-charts.ts";
import { pathNumber } from "../src/scene/draw/pen.ts";
import { drawBox, hintsOf, kitFor, layoutNodes, TEXT } from "./chart-kit.ts";

type Point = { value: number; text: string; tick: string | null };
type Series = { name: string; points: Point[] };
type LineData = Record<string, unknown>;
type Group = LineData & { series: Series[] };

/** md2ui `line_chart_tests._data`: one line over `values`, with the ticks at those positions. */
function line(values: number[], ticks: Record<number, string> = {}): { points: Point[] } {
  return { points: values.map((v, i) => ({ value: v, text: String(v), tick: ticks[i] ?? null })) };
}

const LINES = "## Charts\n### Line Chart\n";
const CHAIN = "Price: $710.14 → $713.94 → $777.24 (Now)";
// md2ui line_group_tests.FUNDS and DECLARED.
const FUNDS =
  "- SPY: $718.66 (Apr) → $756.48 → $767.87 (Now)\n" +
  "- QQQ: $667.74 → $738.31 → $728.08\n" +
  "- DIA: $496.65 → $510.78 → $513.86\n";
const DECLARED = "Price (USD):\n- SPY: 718 → 756 → 767\n- DIA: 496 → 510 → 513\n";

/** The one `line_chart` hint a document lays out, as the leaf carries it. */
function leafData(markdown: string, themeText: string): Group {
  const [found] = hintsOf(layoutNodes(markdown, themeText), "line_chart");
  return found as Group;
}

const entriesOf = (data: LineData, themeText: string, width: number, height = 0) =>
  drawBox(drawLineChart, themeText, { line_chart: data }, { width, height }, []);
const heightOf = (data: LineData, width: number, themeText: string): number =>
  lineChartHeight(data, width, kitFor(themeText));
/** A drawn line: one path stroke (md2ui's `skia.Path`), its points back in content space. */
interface DrawnLine {
  readonly entry: StrokeEntry;
  readonly points: (readonly [number, number])[];
}
const drawnLines = (entries: readonly DisplayEntry[]): DrawnLine[] =>
  entries.flatMap((e) => {
    if (e.type !== "stroke" || e.shape.kind !== "path") return [];
    const { x, y, d } = e.shape;
    const points = [...d.matchAll(/[ML]([-+.\de]+) ([-+.\de]+)/gu)].map(
      ([, px, py]) => [x + Number(px), y + Number(py)] as const,
    );
    return [{ entry: e, points }];
  });
const ovals = (entries: readonly DisplayEntry[]): FillEntry[] =>
  entries.filter((e): e is FillEntry => e.type === "fill" && e.shape.kind === "oval");
const texts = (entries: readonly DisplayEntry[]): TextEntry[] =>
  entries.filter((e): e is TextEntry => e.type === "text");
const words = (entries: readonly DisplayEntry[]): string[] =>
  texts(entries).flatMap((t) => t.runs.map((r) => r.text));

// --- line_chart_tests: layout (generator) --------------------------------------------------

describe("a chain is laid out as its key and last value over a drawn line", () => {
  // md2ui line_chart_tests: test_without_a_theme_the_chain_draws_a_line
  it("without a theme the chain draws a line, as every display does", () => {
    expect(hintsOf(layoutNodes(CHAIN), "line_chart")).toHaveLength(1);
  });

  // md2ui line_chart_tests: test_a_theme_turns_the_line_off
  it("Enabled: no under ### Line Chart keeps the chain text", () => {
    const off = "## Charts\n### Line Chart\nEnabled: no\n";
    expect(hintsOf(layoutNodes(CHAIN, off), "line_chart")).toEqual([]);
  });

  // md2ui line_chart_tests: test_the_line_sits_under_the_key_and_last_value
  it("the line sits under the key and the last value as written, without its tick", () => {
    const nodes = layoutNodes(CHAIN, LINES);
    expect(hintsOf(nodes, "line_chart")).toHaveLength(1);
    expect(hintsOf(nodes, "text_override")).toEqual(["$777.24"]);
  });

  it("the key stays left and the last value right, the line under the pair", () => {
    const nodes = layoutNodes(CHAIN, LINES);
    const leaf = nodes.find((n) => n.render_properties?.["line_chart"] !== undefined);
    const value = nodes.find((n) => n.render_properties?.["text_override"] !== undefined);
    // `lineChartCol`: a column of [the key and value row, the drawn leaf].
    const col = nodes.find((n) => n.children.includes(leaf as (typeof nodes)[number]));
    expect(col?.type).toBe("col");
    expect(col?.children[1]).toBe(leaf);
    expect(value?.render_properties?.["content_align"]).toBe("right");
    const row = col?.children[0];
    expect(row?.type).toBe("row");
    expect(row?.children).toHaveLength(2);
    expect(row?.children[1]).toBe(value);
  });

  // md2ui line_chart_tests: test_value_format_shows_the_declared_unit_on_the_last_value
  it("Value format shows the declared unit on the last value", () => {
    const chain = "High (°C): 24 (Wed) → 23 (Thu) → 21 (Fri)";
    const unit = hintsOf(layoutNodes(chain, `${LINES}`), "text_override");
    expect(unit).toEqual(["21"]);
    const shown = hintsOf(
      layoutNodes(chain, `## Charts\nValue format: 1unit\n### Line Chart\n`),
      "text_override",
    );
    expect(shown).toEqual(["21°C"]);
  });
});

// --- line_chart_tests: the axis --------------------------------------------------------------

describe("the axis fits the data's range", () => {
  const theme = (point: number, width: number) =>
    kitFor(`${LINES}Point size: ${point}\nLine width: ${width}\n`).theme;

  // md2ui line_chart_tests: test_the_axis_fits_the_data_range
  it("spreads the points evenly, the lowest at the bottom and the highest at the top", () => {
    const t = theme(0, 2);
    const area = t.charts.line.height;
    const pts = linePoints(line([700, 750, 800]).points, 0, 0, 202, t, [700, 800], area);
    // Evenly spread, inset by half the stroke.
    expect(pts.map(([x]) => Number(x.toFixed(6)))).toEqual([1, 101, 201]);
    expect(pts.map(([, y]) => Number(y.toFixed(6)))).toEqual([area - 1, area / 2, 1]);
  });

  it("insets by half a dot when the dot is wider than the stroke", () => {
    const t = theme(10, 2);
    const pts = linePoints(line([1, 2]).points, 20, 30, 100, t, [1, 2], 48);
    expect(pts).toEqual([
      [25, 30 + 48 - 5],
      [115, 35],
    ]);
  });

  it("a line of fewer than two points has none", () => {
    expect(linePoints(line([5]).points, 0, 0, 100, theme(6, 2), [5, 5], 48)).toEqual([]);
  });

  // md2ui line_chart_tests: test_a_flat_line_sits_mid_area
  it("a flat line sits mid-area", () => {
    const t = theme(6, 2);
    const pts = linePoints(line([5, 5, 5]).points, 0, 0, 100, t, [5, 5], t.charts.line.height);
    expect(new Set(pts.map(([, y]) => y))).toEqual(new Set([t.charts.line.height / 2]));
  });
});

// --- line_chart_tests: sizing ------------------------------------------------------------------

describe("a line chart's height", () => {
  // md2ui line_chart_tests: test_ticks_add_a_label_line_to_the_height
  it("a tick adds a label line", () => {
    const t = kitFor(LINES).theme;
    const plain = heightOf(line([1, 2, 3]), 100, LINES);
    const ticked = heightOf(line([1, 2, 3], { 2: "Now" }), 100, LINES);
    expect(plain).toBe(t.charts.line.height);
    expect(ticked).toBeGreaterThan(plain);
    const label = (t.charts.label_text ?? t.labels).font_size;
    expect(ticked - plain).toBeCloseTo(LINE_TICK_GAP + label * LINE_SCALE, 9);
  });

  it("the leaf is as tall as the function sizing and painting share", () => {
    const data = line([1, 2, 3], { 0: "Apr" });
    expect(leafHeights(kitFor(LINES)).leafHeight(null, 300, { line_chart: data })).toBe(
      heightOf(data, 300, LINES),
    );
  });
});

// --- line_chart_tests: crowded tick labels ----------------------------------------------------

describe("tick labels that crowd are left out, never shortened", () => {
  // md2ui line_chart_tests: test_crowded_labels_keep_the_ends_first
  it("keeps the ends first, then halves the runs between", () => {
    const roomy = [
      [0, 20],
      [40, 60],
      [80, 100],
    ] as const;
    expect(lineShownTicks(roomy)).toEqual([0, 1, 2]);
    const crowded = [
      [0, 30],
      [20, 50],
      [40, 70],
      [60, 90],
      [80, 110],
    ] as const;
    // The middle one, then gaps.
    expect(lineShownTicks(crowded)).toEqual([0, 2, 4]);
    // The last one wins.
    expect(
      lineShownTicks([
        [0, 50],
        [30, 80],
      ]),
    ).toEqual([1]);
    expect(lineShownTicks([])).toEqual([]);
  });

  it("a narrow box draws the labels that fit, the last among them", () => {
    const data = line([1, 2, 3, 4, 5], {
      0: "January",
      1: "February",
      2: "March",
      3: "April",
      4: "May",
    });
    const wide = words(entriesOf(data, LINES, 800, 80));
    const narrow = words(entriesOf(data, LINES, 120, 80));
    expect(wide).toEqual(["January", "February", "March", "April", "May"]);
    expect(narrow.length).toBeLessThan(wide.length);
    expect(narrow).toContain("May");
    expect(narrow.every((w) => wide.includes(w))).toBe(true);
  });
});

// --- line_chart_tests: paint --------------------------------------------------------------------

describe("a line is painted over its points in its colour", () => {
  const THEME = `${LINES}Line color: #123456\nLine width: 4\n`;

  // md2ui line_chart_tests: test_the_line_paints_in_its_color
  it("one round-joined, round-capped path through every point, mid-area when flat, in Line color", () => {
    const lines = drawnLines(entriesOf(line([1, 1, 1]), THEME, 100, 60));
    const area = kitFor(THEME).theme.charts.line.height;
    const mid = area / 2;
    expect(lines).toHaveLength(1);
    const [only] = lines as [DrawnLine];
    // The inset is half the larger of the 6 px dot and the 4 px stroke.
    expect(only.points).toEqual([
      [3, mid],
      [50, mid],
      [97, mid],
    ]);
    expect(only.entry).toMatchObject({ color: "#123456ff", width: 4, join: "round", cap: "round" });
    // Its frame is md2ui's area rect, and its ink reaches half the stroke past it.
    expect(only.entry.shape).toMatchObject({ x: 0, y: 0, width: 100, height: area });
    expect(only.entry.bounds).toEqual({ x: -2, y: -2, width: 104, height: area + 4 });
  });

  it("path data never holds a number Path2D would stop at", () => {
    expect(pathNumber(0.1 + 0.2)).toBe("0.30000000000000004");
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => pathNumber(bad)).toThrow(RangeError);
    }
  });

  it("a chart that moves keeps its path data: only the frame moves", () => {
    const at = (x: number, y: number) =>
      drawnLines(
        drawBox(
          drawLineChart,
          THEME,
          { line_chart: line([1, 3, 2]) },
          { x, y, width: 100, height: 60 },
          [],
        ),
      )[0]?.entry.shape;
    const here = at(0, 0);
    const there = at(37.3, 512.1);
    expect(there).toEqual({ ...here, x: 37.3, y: 512.1 });
  });

  // md2ui line_chart_tests: test_points_last_keeps_only_the_last_dot
  it("`Points: last` keeps only the last point's dot; labelled keeps a labelled point's too", () => {
    const data = line([1, 1, 1], { 0: "Apr" });
    const dots = (points: string) =>
      ovals(entriesOf(data, `${THEME}Point size: 10\nPoints: ${points}\n`, 100, 80)).map((e) => ({
        color: e.paint.kind === "color" ? e.paint.color : null,
        centre: e.shape.x + e.shape.width / 2,
        size: e.shape.width,
      }));
    // The inset is half the dot: 5 from either end.
    expect(dots("labelled")).toEqual([
      { color: "#123456ff", centre: 5, size: 10 },
      { color: "#123456ff", centre: 95, size: 10 },
    ]);
    expect(dots("last")).toEqual([{ color: "#123456ff", centre: 95, size: 10 }]);
  });

  it("a ticked line paints its labels under the area, centred on their points and kept inside", () => {
    const entries = entriesOf(line([1, 2, 3], { 0: "Apr", 2: "Jun" }), LINES, 200, 80);
    const [apr, jun] = texts(entries);
    const t = kitFor(LINES).theme;
    const size = (t.charts.label_text ?? t.labels).font_size;
    expect(words(entries)).toEqual(["Apr", "Jun"]);
    expect(apr?.y).toBe(t.charts.line.height + LINE_TICK_GAP + size);
    expect(apr?.y).toBe(jun?.y);
    // The first label would start left of the box, and the last end right of it.
    expect(apr?.runs[0]?.x).toBe(0);
    const width = TEXT.advance("Jun", jun?.runs[0]?.font as FontSpec);
    expect((jun?.runs[0]?.x ?? 0) + width).toBeLessThanOrEqual(200 + 1e-9);
  });
});

// --- line_group_tests: layout ---------------------------------------------------------------------

describe("a run of chains is laid out as one drawn leaf (md2ui line_group_tests)", () => {
  // md2ui line_group_tests: test_the_group_is_one_drawn_leaf
  it("the group is one leaf of its series, with a theme and without one", () => {
    const found = hintsOf(layoutNodes(FUNDS, LINES), "line_chart");
    expect(found).toHaveLength(1);
    const data = found[0] as { series: Series[] };
    expect(data.series.map((s) => s.name)).toEqual(["SPY", "QQQ", "DIA"]);
    // md2ui: with no theme it draws the same, as every display does.
    expect(hintsOf(layoutNodes(FUNDS), "line_chart")).toHaveLength(1);
  });

  // md2ui line_group_tests: test_lines_paint_at_every_width
  it("a narrow page keeps every line, and a box of 24 px still draws them", () => {
    const doc = `SPY: $1 → $3 → $2\n\n${FUNDS}`;
    expect(hintsOf(layoutNodes(doc, LINES, 1280), "line_chart")).toHaveLength(2);
    expect(hintsOf(layoutNodes(doc, LINES, 320), "line_chart")).toHaveLength(2);
    const group = leafData(FUNDS, LINES);
    const entries = entriesOf(group, LINES, 24, Math.ceil(heightOf(group, 24, LINES)));
    // Three lines, each through its three points.
    const lines = drawnLines(entries);
    expect(lines.map((l) => l.points.length)).toEqual([3, 3, 3]);
    expect(lines.every((l) => l.points.every(([x]) => x >= 0 && x <= 24))).toBe(true);
  });
});

// --- line_group_tests: sizing and the legend ---------------------------------------------------------

describe("several lines share one axis under a legend", () => {
  // md2ui line_group_tests: test_group_height_sizes_several_lines
  it("Group height sizes several lines, and replaces Height for a group only", () => {
    const sized = `${LINES}Height: 40\nGroup height: 120\n`;
    const group = leafData(FUNDS, sized);
    const single = { points: (group.series[0] as Series).points };
    const grown = heightOf(group, 800, sized);
    expect(grown - heightOf(single, 800, sized)).toBeGreaterThan(80);
    const same = heightOf(group, 800, `${LINES}Height: 40\n`);
    expect(Math.abs(grown - same - 80)).toBeLessThan(1e-6);
  });

  // md2ui line_group_tests: test_the_legend_shows_the_declared_unit
  it("the legend shows each name and last value, with the declared unit where Value format puts it", () => {
    const themeText = `## Charts\nValue format: 1 unit\n### Line Chart\n`;
    const group = leafData(DECLARED, themeText);
    const labels = lineLegendRows(group, 800, kitFor(themeText)).flatMap((row) =>
      row.map((e) => e.label),
    );
    expect(labels).toEqual(["SPY  767 USD", "DIA  513 USD"]);
  });

  // md2ui line_group_tests: test_the_legend_wraps_between_entries
  it("the legend wraps between entries, never inside one", () => {
    const group = leafData(FUNDS, LINES);
    const kit = kitFor(LINES);
    expect(lineLegendRows(group, 800, kit)).toHaveLength(1);
    const narrow = lineLegendRows(group, 120, kit);
    // One entry a row, never split, each row starting at the left.
    expect(narrow.map((r) => r.length)).toEqual([1, 1, 1]);
    expect(narrow.every((r) => r[0]?.x === 0)).toBe(true);
    expect(heightOf(group, 120, LINES)).toBeGreaterThan(heightOf(group, 800, LINES));
    // A single line has no legend: its key and last value are a row the generator built.
    const single = { points: (group.series[0] as Series).points };
    expect(lineLegendRows(single, 800, kit)).toEqual([]);
  });

  it("the legend rows add their lines and a gap to the height", () => {
    const group = leafData(FUNDS, LINES);
    const t = kitFor(LINES).theme;
    const label = (t.charts.label_text ?? t.labels).font_size;
    const rows = (width: number) => lineLegendRows(group, width, kitFor(LINES)).length;
    expect(rows(800)).toBe(1);
    expect(rows(120)).toBe(3);
    expect(heightOf(group, 120, LINES) - heightOf(group, 800, LINES)).toBeCloseTo(
      2 * label * LINE_SCALE,
      9,
    );
  });
});

// --- line_group_tests: paint -----------------------------------------------------------------------

describe("several lines are painted each in its series colour, under their legend", () => {
  it("one colour per series for its line and its legend dot", () => {
    const group = leafData(FUNDS, LINES);
    const entries = entriesOf(group, LINES, 800, Math.ceil(heightOf(group, 800, LINES)));
    const lines = drawnLines(entries);
    expect(lines).toHaveLength(3);
    const colours = lines.map((l) => l.entry.color);
    expect(new Set(colours).size).toBe(3);
    // The legend is painted first: a dot per series in its line's colour, then its text.
    const dots = ovals(entries).slice(0, 3);
    expect(dots.map((e) => (e.paint.kind === "color" ? e.paint.color : null))).toEqual(colours);
    expect(words(entries).filter((w) => w.includes("  "))).toEqual([
      "SPY  $767.87",
      "QQQ  $728.08",
      "DIA  $513.86",
    ]);
  });

  it("the lines sit under the legend rows", () => {
    const group = leafData(FUNDS, LINES);
    const wide = entriesOf(group, LINES, 800, 200);
    const narrow = entriesOf(group, LINES, 120, 200);
    const topOf = (entries: readonly DisplayEntry[]) =>
      Math.min(...drawnLines(entries).flatMap((l) => l.points.map(([, y]) => y)));
    const t = kitFor(LINES).theme;
    const label = (t.charts.label_text ?? t.labels).font_size;
    // Two more legend rows push the area down by their height.
    expect(topOf(narrow) - topOf(wide)).toBeCloseTo(2 * label * LINE_SCALE, 9);
  });
});

// --- paint_replacement_tests -------------------------------------------------------------------------

describe("a line chart's text resolves against the surface it sits on (md2ui 142505f1)", () => {
  // md2ui paint_replacement_tests: test_line_chart_ticks_are_replaced
  it("tick labels follow the dark card's rule", () => {
    const DARK = 0xff18181b;
    const themeText =
      `## Text Styles\nLabels:\n- Font color: #7C7C84\n${LINES}` +
      "## Color Replacements\nOn background color: #18181B\n- Text color: #7C7C84, Replacement: #FFFFFF\n";
    const data = line([1, 2, 3], { 0: "Apr", 2: "Jun" });
    const on = drawBox(
      drawLineChart,
      themeText,
      { line_chart: data },
      { width: 200, height: 120 },
      [DARK],
    );
    expect(words(on)).toEqual(["Apr", "Jun"]);
    expect(new Set(texts(on).flatMap((t) => t.runs.map((r) => r.color)))).toEqual(
      new Set(["#ffffffff"]),
    );
    // Off the dark card the same labels keep their authored ink.
    const off = drawBox(
      drawLineChart,
      themeText,
      { line_chart: data },
      { width: 200, height: 120 },
    );
    expect(new Set(texts(off).flatMap((t) => t.runs.map((r) => r.color)))).toEqual(
      new Set(["#7c7c84ff"]),
    );
  });
});
