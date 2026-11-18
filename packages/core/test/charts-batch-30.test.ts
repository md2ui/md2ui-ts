// The bar chart's geometry and paint, as md2ui draws them:
// negative values (a scale that is the data's range, bars that run from the zero inside it,
// `Negative color`), `### Chart Grid` (rounded ticks and a gutter for their labels), fill
// bars, units on tick labels and values, and the chart's text following `## Color
// Replacements`. Expected values are md2ui's own tests (chart_plan_tests, negative_bar_tests,
// chart_units_tests, paint_replacement_tests), run through the whole pipeline with the
// deterministic fake measurer. Where md2ui asserts a number measured from Skia fonts, these
// assert the rule instead (a relation, or a number derived from the fake's advances), and
// say so. The Skia canvas calls md2ui patches are the display-list entries here.
import type { DisplayEntry, FillEntry, LineEntry, TextEntry } from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { withUnit } from "../src/group/value-format.ts";
import {
  CHART_ROW_GAP,
  CHART_VERTICAL_H,
  type ChartPlan,
  chartPlan,
  chartSpan,
  chartTick,
  chartTickStyle,
  chartValueY,
  chartVerticalBars,
  chartVerticalMinWidth,
} from "../src/measure/charts.ts";
import { leafHeights } from "../src/measure/leaf-heights.ts";
import { drawChart } from "../src/scene/draw/charts.ts";
import { parseTheme } from "../src/theme/parse.ts";
import { drawBox, kitFor } from "./chart-kit.ts";
import { paintMarkdown } from "./scene-kit.ts";

// --- the data md2ui's tests build --------------------------------------------------------

type Row = { label: string; values: number[]; texts?: string[] };
type ChartData = {
  series: string[] | null;
  unit: string;
  rows: Row[];
  display_unit?: string;
};

/** md2ui `chart_plan_tests._data`: `n` rows of 10, 20, 30 … percent, one value (or more) each. */
function data(n: number, series: string[] | null = null, valuesPerRow = 1): ChartData {
  return {
    series,
    unit: "%",
    rows: Array.from({ length: n }, (_, i) => ({
      label: `Row ${i}`,
      values: Array.from({ length: valuesPerRow }, () => 10 * (i + 1)),
    })),
  };
}

/** md2ui `chart_plan_tests._changes`: one row per value, which may be below zero. */
const changes = (...values: number[]): ChartData => ({
  series: null,
  unit: "%",
  rows: values.map((v, i) => ({ label: `R${i}`, values: [v] })),
});

const FILL = "## Charts\nBar width: fill\nBar thickness: 22\nBar spacing: 10\n";
const GRID = (labels: boolean, lines: boolean): string =>
  `## Charts\n### Chart Grid\nAxis labels: ${labels ? "yes" : "no"}\nHorizontal lines: ${lines ? "yes" : "no"}\n`;

const planOf = (d: ChartData, width: number, themeText = ""): ChartPlan =>
  chartPlan(d, width, kitFor(themeText));
const flipOf = (d: ChartData, themeText = ""): number | null =>
  chartVerticalMinWidth(d, kitFor(themeText));
const barsOf = (d: ChartData, width: number, drawn: number, themeText = "") => {
  const kit = kitFor(themeText);
  return chartVerticalBars(chartPlan(d, width, kit), 0, drawn, 140, kit.theme);
};

// --- the entries a drawn chart records ---------------------------------------------------

const fillsOf = (entries: readonly DisplayEntry[], color: string): FillEntry[] =>
  entries.filter((e): e is FillEntry => e.type === "fill" && colorOf(e) === color);
const colorOf = (e: FillEntry): string | undefined =>
  e.paint.kind === "color" ? e.paint.color : undefined;
const linesOf = (entries: readonly DisplayEntry[]): LineEntry[] =>
  entries.filter((e): e is LineEntry => e.type === "line");
const textsOf = (entries: readonly DisplayEntry[]): TextEntry[] =>
  entries.filter((e): e is TextEntry => e.type === "text");
const wordsOf = (entries: readonly DisplayEntry[]): string[] =>
  textsOf(entries).flatMap((t) => t.runs.map((r) => r.text));
const inksOf = (entries: readonly DisplayEntry[]): Set<string> =>
  new Set(textsOf(entries).flatMap((t) => t.runs.map((r) => r.color)));

// --- chart_plan_tests: orientation --------------------------------------------------------

describe("a chart's orientation follows its row count and the width it is handed", () => {
  // md2ui chart_plan_tests: test_few_rows_horizontal
  it("few rows are horizontal rows in one column", () => {
    const plan = planOf(data(3), 800);
    expect([plan.orientation, plan.columns]).toEqual(["horizontal", 1]);
  });

  // md2ui chart_plan_tests: test_many_rows_wide_vertical
  it("many rows at a wide width are vertical bars", () => {
    expect(planOf(data(8), 800).orientation).toBe("vertical");
  });

  // md2ui chart_plan_tests: test_many_rows_narrow_columns
  it("many rows with wide labels at a narrow width stack into two columns", () => {
    // The fake's glyphs are half their size wide, so a label of this length is what rules
    // vertical bars out at 500; the rule is the same as md2ui's, the labels this measurer's.
    const d = data(10);
    d.rows.forEach((r, i) => {
      r.label = `Long metric label number ${i}`;
    });
    const plan = planOf(d, 500);
    expect([plan.orientation, plan.columns]).toEqual(["columns", 2]);
  });

  // md2ui chart_plan_tests: test_many_rows_very_narrow_single_column
  it("many rows at a very narrow width are one column of horizontal rows", () => {
    const plan = planOf(data(10), 230);
    expect([plan.orientation, plan.columns]).toEqual(["horizontal", 1]);
  });
});

// --- chart_plan_tests: scale, legend, height -----------------------------------------------

describe("a chart's scale, legend and height", () => {
  // md2ui chart_plan_tests: test_percent_scale_is_100
  it("a percent chart is read against 100", () => {
    expect(planOf(data(3), 800).scaleMax).toBe(100);
  });

  // md2ui chart_plan_tests: test_over_100_scales_to_peak
  it("a value over 100 scales the chart to its peak", () => {
    const d = data(3);
    (d.rows[0] as Row).values = [250];
    expect(planOf(d, 800).scaleMax).toBe(250);
  });

  // md2ui chart_plan_tests: test_series_legend_reserved
  it("series reserve a legend line, and no series reserve none", () => {
    const plan = planOf(data(5, ["A", "B"], 2), 800);
    expect(plan.series).toEqual(["A", "B"]);
    expect(plan.legendH).toBe(plan.labelLineH + 6);
    expect(planOf(data(5), 800).legendH).toBe(0);
  });

  // md2ui chart_plan_tests: test_multi_series_values_shape
  it("every row keeps one value per series", () => {
    const plan = planOf(data(4, ["A", "B"], 2), 800);
    expect(plan.values.every((v) => v.length === 2)).toBe(true);
  });

  // md2ui chart_plan_tests: test_horizontal_height_accounts_rows_and_gaps
  it("horizontal rows add up to their rows and the gaps between", () => {
    const plan = planOf(data(3), 800);
    expect(plan.height).toBe(3 * plan.rowH + 2 * CHART_ROW_GAP);
  });

  // md2ui chart_plan_tests: test_horizontal_height_accounts_for_track_inner_padding
  it("the track's inner padding grows every row", () => {
    const plain = planOf(data(3), 800);
    const padded = planOf(data(3), 800, "## Charts\n### Chart Track\nPadding: 5\n");
    expect(padded.rowH).toBe(plain.rowH + 10);
    expect(padded.height).toBe(plain.height + 30);
  });

  // md2ui chart_plan_tests: test_vertical_height_uses_chart_area
  it("vertical bars are the chart area, a gap and a label line", () => {
    const plan = planOf(data(8), 800);
    expect(plan.height).toBe(CHART_VERTICAL_H + 4 + plan.labelLineH);
  });

  // md2ui chart_plan_tests: test_leaf_height_uses_plan
  it("the leaf is as tall as its plan, the one answer sizing and painting share", () => {
    const d = data(3);
    const kit = kitFor();
    expect(leafHeights(kit).leafHeight(null, 800, { chart: d })).toBe(
      chartPlan(d, 800, kit).height,
    );
  });
});

// --- chart_plan_tests: the flip point -------------------------------------------------------

describe("the flip point is the width a chart turns into vertical bars", () => {
  // md2ui chart_plan_tests: test_the_flip_point_is_the_width_the_plan_flips_at
  it("is the width the plan itself flips at", () => {
    const d = data(6);
    const flip = flipOf(d) as number;
    expect(flip).not.toBeNull();
    expect(planOf(d, flip).orientation).toBe("vertical");
    expect(planOf(d, flip - 1).orientation).not.toBe("vertical");
  });

  // md2ui chart_plan_tests: test_a_chart_that_never_goes_vertical_has_no_flip_point
  it("four rows or fewer have none, and are horizontal at any width", () => {
    expect(flipOf(data(4))).toBeNull();
    expect(planOf(data(4), 4000).orientation).toBe("horizontal");
  });

  // md2ui chart_plan_tests: test_the_flip_point_grows_with_the_labels
  it("grows with the labels, which is why it is no constant per row count", () => {
    const long = data(6);
    for (const row of long.rows) row.label = "Wednesday afternoon";
    expect(flipOf(long) as number).toBeGreaterThan(flipOf(data(6)) as number);
  });

  // md2ui chart_plan_tests: test_filled_bars_never_go_under_bar_thickness
  it("fits filled bars at their minimum thickness, spacing included", () => {
    const themeText = "## Charts\nBar width: fill\nBar thickness: 60\nBar spacing: 20\n";
    const d = data(6, null, 2);
    const flip = flipOf(d, themeText) as number;
    expect(flip).toBeGreaterThanOrEqual(6 * (2 * 60 + 2) + 5 * 20);
    expect(planOf(d, flip, themeText).orientation).toBe("vertical");
    const { bars } = barsOf(d, flip, flip, themeText);
    expect(Math.min(...bars.map((b) => b.width))).toBeGreaterThanOrEqual(60 - 1e-9);
  });
});

// --- chart_plan_tests: where vertical bars go ----------------------------------------------

describe("vertical bars: fixed in their slots, or filling the width", () => {
  // md2ui chart_plan_tests: test_fixed_bars_stay_thin_and_centred
  it("fixed bars are Bar thickness wide, centred in equal slots, never shorter than wide", () => {
    const { bars, spans } = barsOf(data(5), 600, 600);
    expect(spans).toEqual([0, 1, 2, 3, 4].map((i) => [i * 120, 120]));
    // 10% of the area is 14 tall: the bar's floor, its own width.
    expect(bars[0]).toMatchObject({ x: 53, y: 126, width: 14, height: 14 });
    expect(bars.every((b) => b.width === 14)).toBe(true);
  });

  // md2ui chart_plan_tests: test_filled_bars_span_the_width_with_bar_spacing
  it("filled bars span the width with Bar spacing between them", () => {
    const { bars, spans } = barsOf(data(5), 600, 600, FILL);
    const w = (600 - 4 * 10) / 5;
    expect(bars.map((b) => Number(b.x.toFixed(6)))).toEqual(
      [0, 1, 2, 3, 4].map((i) => Number((i * (w + 10)).toFixed(6))),
    );
    expect(bars.every((b) => Math.abs(b.width - w) < 1e-9)).toBe(true);
    const last = bars.at(-1) as (typeof bars)[number];
    expect(Math.abs(last.x + last.width - 600)).toBeLessThan(1e-9);
    expect(spans[2]).toEqual([
      (bars[2] as (typeof bars)[number]).x,
      (bars[2] as (typeof bars)[number]).width,
    ]);
  });

  // md2ui chart_plan_tests: test_a_filled_bar_floors_at_bar_thickness
  it("a filled bar floors at Bar thickness, not at the bar's width", () => {
    const d = data(5);
    (d.rows[0] as Row).values = [1];
    const { bars } = barsOf(d, 600, 600, FILL);
    expect((bars[0] as (typeof bars)[number]).height).toBe(22);
  });

  // md2ui chart_plan_tests: test_bar_width_parses_fill_and_ignores_the_rest
  it("Bar width reads fill and ignores every other word", () => {
    const parsed = (value: string) =>
      parseTheme(`## Charts\nBar width: ${value}\n`).charts.bar_width;
    expect([parsed("fill"), parsed("Fill"), parsed("fixed"), parsed("wide")]).toEqual([
      "fill",
      "fill",
      "fixed",
      "fixed",
    ]);
  });
});

// --- chart_plan_tests: values below zero ---------------------------------------------------

describe("values below zero turn the scale into the data's range", () => {
  // md2ui chart_plan_tests: test_a_chart_without_negatives_still_scales_from_zero
  it("without a negative the scale still runs from zero", () => {
    const plan = planOf(data(5), 800);
    expect([plan.scaleMin, plan.scaleMax]).toEqual([0, 100]);
  });

  // md2ui chart_plan_tests: test_negatives_scale_the_chart_to_the_data_range
  it("a negative scales the chart to the data's range, keeping zero on it", () => {
    const mixed = planOf(changes(-1, 3, 1, -1, 2), 800);
    expect(mixed.orientation).toBe("vertical");
    expect([mixed.scaleMin, mixed.scaleMax]).toEqual([-1, 3]);
    const losses = planOf(changes(-3, -1, -2), 800);
    expect([losses.scaleMin, losses.scaleMax]).toEqual([-3, 0]);
  });

  // md2ui chart_plan_tests: test_mixed_rows_centre_their_zero
  it("horizontal rows that mix gains and losses centre their zero", () => {
    const plan = planOf(changes(-1.55, 2.1, -0.4), 800);
    expect(plan.orientation).toBe("horizontal");
    expect([plan.scaleMin, plan.scaleMax]).toEqual([-2.1, 2.1]);
  });

  // md2ui chart_plan_tests: test_vertical_bars_diverge_from_the_zero_line
  it("vertical bars diverge from the zero line", () => {
    const { bars } = barsOf(changes(-1, 3, 1, -1, 2), 800, 800);
    const [down, up] = bars as [(typeof bars)[number], (typeof bars)[number]];
    // The scale runs -1 .. 3, so zero is three quarters of the way down 140.
    const zeroY = 105;
    expect([down.y, down.y + down.height]).toEqual([zeroY, 140]);
    expect([up.y, up.y + up.height]).toEqual([0, zeroY]);
  });

  it("chartSpan and chartValueY read the same zero", () => {
    const plan = planOf(changes(-1, 3, 1, -1, 2), 800);
    expect(chartSpan(plan, 3)).toEqual([0.25, 1]);
    expect(chartSpan(plan, -1)).toEqual([0, 0.25]);
    expect(chartValueY(plan, 140, 0)).toBe(105);
  });
});

// --- negative bars in the drawn chart ------------------------------------------------------

describe("a drawn chart's bars run from the zero inside its scale", () => {
  // Colours that tell a bar from its track and from a neighbour's bar.
  const SCHEME =
    "## Charts\nBackground color: #FF0000\nNegative color: #0000FF\n### Chart Track\nBackground color: #EEEEEE\n";
  const draw = (d: ChartData, width: number, themeText = SCHEME) =>
    drawBox(
      drawChart,
      themeText,
      { chart: d },
      { width, height: planOf(d, width, themeText).height },
    );

  // md2ui chart_plan_tests: test_a_horizontal_loss_ends_at_zero
  it("a horizontal loss ends at zero, a gain starts there", () => {
    const entries = draw(changes(-1, 1, 0.5), 200);
    const [loss] = fillsOf(entries, "#0000ffff");
    const [gain, half] = fillsOf(entries, "#ff0000ff");
    // The track is 200 wide, so zero is its middle.
    expect([loss?.shape.x, (loss?.shape.x ?? 0) + (loss?.shape.width ?? 0)]).toEqual([0, 100]);
    expect([gain?.shape.x, (gain?.shape.x ?? 0) + (gain?.shape.width ?? 0)]).toEqual([100, 200]);
    expect([half?.shape.x, (half?.shape.x ?? 0) + (half?.shape.width ?? 0)]).toEqual([100, 150]);
  });

  // md2ui chart_plan_tests: test_all_negative_rows_run_from_the_right_edge
  it("all-negative rows run from the right edge, with no zero line", () => {
    const entries = draw(changes(-2, -1), 200, "## Charts\nBackground color: #FF0000\n");
    const [whole, half] = fillsOf(entries, "#ff0000ff");
    expect([whole?.shape.x, (whole?.shape.x ?? 0) + (whole?.shape.width ?? 0)]).toEqual([0, 200]);
    expect([half?.shape.x, (half?.shape.x ?? 0) + (half?.shape.width ?? 0)]).toEqual([100, 200]);
    // Zero is the track's own edge.
    expect(linesOf(entries)).toEqual([]);
  });

  it("rows that mix signs draw one zero line mid-track, down each track", () => {
    const entries = draw(changes(-1, 1, 0.5), 200);
    const zero = linesOf(entries);
    expect(zero).toHaveLength(3);
    expect(zero.every((l) => l.x0 === 100 && l.x1 === 100 && l.y1 > l.y0)).toBe(true);
  });

  // md2ui chart_plan_tests: test_negative_color_paints_only_bars_below_zero
  it("Negative color paints only bars below zero; unset, a loss keeps its series colour", () => {
    const entries = draw(changes(-1, 1, 0.5), 200);
    expect(fillsOf(entries, "#0000ffff")).toHaveLength(1);
    expect(fillsOf(entries, "#ff0000ff")).toHaveLength(2);
    const unset = draw(changes(-1, 1, 0.5), 200, "## Charts\nBackground color: #FF0000\n");
    expect(fillsOf(unset, "#ff0000ff")).toHaveLength(3);
  });

  it("vertical bars below zero take Negative color and hang below the zero line", () => {
    const d = changes(-1, 3, 1, -1, 2);
    const entries = draw(d, 800);
    expect(planOf(d, 800, SCHEME).orientation).toBe("vertical");
    const losses = fillsOf(entries, "#0000ffff");
    expect(losses).toHaveLength(2);
    // The bars rest on 140 below the zero line the chart draws across its width.
    const [zeroLine] = linesOf(entries);
    expect(zeroLine?.y0).toBe(zeroLine?.y1);
    for (const loss of losses) expect(loss.shape.y).toBe(zeroLine?.y0);
  });

  it("a chart's values are drawn as written, with the declared unit where Value format puts it", () => {
    const d = changes(1, 2, 3);
    d.display_unit = "°C";
    d.rows.forEach((r, i) => {
      r.texts = [String(i + 1)];
    });
    const words = (fmt: string) =>
      wordsOf(draw(d, 400, `## Charts\nValue format: ${fmt}\n`)).filter((w) => !w.startsWith("R"));
    expect(words("1")).toEqual(["1", "2", "3"]);
    expect(words("1 unit")).toEqual(["1 °C", "2 °C", "3 °C"]);
  });
});

// --- negative_bar_tests: a single drawn bar below zero --------------------------------------

describe("a single bar below zero fills from the right", () => {
  // md2ui's built-in greys.
  const TRACK = "#e5e5e5ff";
  const FILL_COLOR = "#222222ff";
  const GREY = "#b4b4bbff";
  // A 10-thick bar, and a percentage with the sign this test is about.
  const THEME = "## Drawing elements\n### Key Value Bars\nThickness: 10\n";
  const bar = (percent: string, themeText = THEME) => {
    const painted = paintMarkdown(`# T\n\nChange: ${percent}\n`, themeText);
    const entries = painted.painted.list.entries;
    const [track] = fillsOf(entries, TRACK);
    const box = painted.scene.boxes.find((b) => b.render_properties?.["datapoint_bar"]);
    return { entries, track: track as FillEntry, box };
  };
  const edges = (e: FillEntry | undefined): [number, number] => [
    e?.shape.x ?? Number.NaN,
    (e?.shape.x ?? Number.NaN) + (e?.shape.width ?? Number.NaN),
  ];

  // md2ui negative_bar_tests: test_a_negative_fill_runs_left_from_the_right_edge
  it("a negative fill runs left from the track's right edge", () => {
    const { entries, track } = bar("-50%");
    const [fill] = fillsOf(entries, FILL_COLOR);
    const [left, right] = edges(track);
    expect(edges(fill)).toEqual([left + (right - left) / 2, right]);
  });

  // md2ui negative_bar_tests: test_a_whole_negative_fills_the_track
  it("a whole negative fills the track", () => {
    const { entries, track } = bar("-100%");
    expect(edges(fillsOf(entries, FILL_COLOR)[0])).toEqual(edges(track));
  });

  // md2ui negative_bar_tests: test_the_ratio_keeps_its_sign_and_stops_at_the_whole
  it("a share past the whole stops at it, keeping its sign", () => {
    const { entries, track } = bar("-150%");
    expect(edges(fillsOf(entries, FILL_COLOR)[0])).toEqual(edges(track));
  });

  // md2ui negative_bar_tests: test_a_tiny_negative_keeps_the_thickness_floor_at_the_right
  it("a tiny negative keeps the thickness floor, at the right", () => {
    const { entries, track } = bar("-1%");
    const [fill] = fillsOf(entries, FILL_COLOR);
    expect(fill?.shape.width).toBe(10);
    expect(edges(fill)[1]).toBe(edges(track)[1]);
  });

  // md2ui negative_bar_tests: test_a_positive_bar_still_fills_from_the_left
  it("a positive bar still fills from the left", () => {
    const { entries, track } = bar("50%");
    const [fill] = fillsOf(entries, FILL_COLOR);
    expect(edges(fill)[0]).toBe(edges(track)[0]);
    expect(fill?.shape.width).toBeCloseTo(track.shape.width / 2, 9);
  });

  // md2ui negative_bar_tests: test_negative_color_paints_only_below_zero
  it("Negative color paints only below zero", () => {
    const themeText = `${THEME}Negative color: #B4B4BB\n`;
    expect(fillsOf(bar("-50%", themeText).entries, GREY)).toHaveLength(1);
    expect(fillsOf(bar("-50%", themeText).entries, FILL_COLOR)).toHaveLength(0);
    expect(fillsOf(bar("50%", themeText).entries, GREY)).toHaveLength(0);
    expect(fillsOf(bar("50%", themeText).entries, FILL_COLOR)).toHaveLength(1);
  });

  // md2ui negative_bar_tests: test_a_ring_below_zero_stays_empty
  it("a ring below zero stays empty, and one above draws its arc", () => {
    const ring = "## Drawing elements\n### Unit Ratios\nStyle: ring\n";
    const arcs = (md: string) =>
      paintMarkdown(`# T\n\n${md}\n`, ring).painted.list.entries.filter((e) => e.type === "arc");
    expect(arcs("Score: 4/10")).toHaveLength(1);
    expect(arcs("Score: -4/10")).toHaveLength(0);
  });
});

// --- chart_plan_tests: Chart Grid ------------------------------------------------------------

describe("### Chart Grid: tick labels, lines and the gutter they take", () => {
  // md2ui chart_plan_tests: test_a_chart_without_a_grid_reserves_nothing_for_one
  it("a chart without a grid reserves nothing for one", () => {
    const plan = planOf(data(6), 800);
    expect(plan.orientation).toBe("vertical");
    expect([plan.ticks, plan.axisW, plan.topPad]).toEqual([[], 0, 0]);
  });

  // md2ui chart_plan_tests: test_axis_labels_take_a_gutter_and_tick_the_percent_scale
  it("axis labels take a gutter and tick the percent scale", () => {
    const plan = planOf(data(6), 800, GRID(true, false));
    expect(plan.ticks).toEqual([0, 25, 50, 75, 100]);
    expect(plan.axisW).toBeGreaterThan(0);
    expect(plan.height).toBe(plan.topPad + CHART_VERTICAL_H + 4 + plan.labelLineH);
    // Room for the top label's upper half: half the tick labels' font size.
    expect(plan.topPad).toBeGreaterThan(0);
    expect(plan.topPad).toBe(chartTickStyle(kitFor(GRID(true, false)).theme).font_size / 2);
  });

  // md2ui chart_plan_tests: test_the_gutter_is_part_of_the_flip_width
  it("the gutter is part of the flip width", () => {
    const plain = flipOf(data(6)) as number;
    const gutter = planOf(data(6), 800, GRID(true, false)).axisW;
    expect(flipOf(data(6), GRID(true, false))).toBe(plain + gutter);
  });

  // md2ui chart_plan_tests: test_ticks_round_the_scale_and_keep_zero
  it("ticks round the scale and keep zero; lines alone take no gutter", () => {
    const plan = planOf(changes(-1.55, 2.1, -0.4, 1, 0.5), 800, GRID(false, true));
    expect(plan.axisW).toBe(0);
    expect(plan.ticks).toEqual([-2, -1, 0, 1, 2, 3]);
    // The bars meet the lines.
    expect([plan.scaleMin, plan.scaleMax]).toEqual([-2, 3]);
  });

  // md2ui chart_plan_tests: test_a_horizontal_chart_ignores_the_grid
  it("a horizontal chart ignores the grid", () => {
    const plan = planOf(data(3), 800, GRID(false, true));
    expect(plan.orientation).toBe("horizontal");
    expect([plan.ticks, plan.axisW, plan.scaleMax]).toEqual([[], 0, 100]);
  });

  it("the tick labels' text style sizes the gutter (grid text, else value text, else labels)", () => {
    const small = planOf(data(6), 800, `${GRID(true, false)}### Chart Grid\n- Font size: 8\n`);
    const large = planOf(data(6), 800, `${GRID(true, false)}### Chart Grid\n- Font size: 24\n`);
    expect(large.axisW).toBeGreaterThan(small.axisW);
  });

  it("tick labels are written in the values' own unit", () => {
    const entries = drawBox(
      drawChart,
      GRID(true, true),
      { chart: data(6) },
      { width: 800, height: planOf(data(6), 800, GRID(true, true)).height },
    );
    const ticks = wordsOf(entries).filter((w) => w.endsWith("%"));
    expect(ticks).toEqual(["0%", "25%", "50%", "75%", "100%"]);
    // One horizontal line per tick, each across the bars (the gutter excluded).
    const across = linesOf(entries).filter((l) => l.y0 === l.y1);
    expect(across).toHaveLength(5);
    const gutter = planOf(data(6), 800, GRID(true, true)).axisW;
    expect(across.every((l) => l.x0 === gutter && l.x1 === 800)).toBe(true);
  });
});

// --- chart_units_tests: units on a chart's numbers ------------------------------------------

describe("a chart's numbers carry their unit", () => {
  const sample = (unit: string, text: string): ChartData => ({
    series: null,
    unit,
    rows: [{ label: "a", values: [1], texts: [text] }],
  });
  const tick = (t: number, d: ChartData) => chartTick(t, d, kitFor());

  // md2ui chart_units_tests: test_tick_labels_take_the_values_unit
  it("tick labels take the values' unit", () => {
    expect(tick(50, { ...sample("%", "") })).toBe("50%");
    expect(tick(200, sample("currency USD", "$220.06"))).toBe("$200");
    expect(tick(-5, sample("currency USD", "$220.06"))).toBe("-$5");
    expect(tick(200, sample("currency EUR", "200 EUR"))).toBe("200 EUR");
    expect(tick(5000, sample("magnitude", "5K"))).toBe("5K");
    expect(tick(1500000, sample("currency USD", "$1.2M"))).toBe("$1.5M");
    expect(tick(1200000, sample("currency USD", "$990"))).toBe("$1200000");
  });

  // md2ui chart_units_tests: test_percent_scale_peak_compares_the_rows
  it("Percent scale: peak compares the rows instead of reading them as progress", () => {
    const small: ChartData = {
      series: null,
      unit: "%",
      rows: [1.2, 2.4, 3.1].map((v, i) => ({ label: `R${i}`, values: [v] })),
    };
    const scale = (themeText: string) => {
      const plan = planOf(small, 800, themeText);
      return [plan.scaleMin, plan.scaleMax];
    };
    expect(scale("")).toEqual([0, 100]);
    expect(scale("## Charts\nPercent scale: peak\n")).toEqual([0, 3.1]);
    // Any other unit is read against the data's peak.
    const money: ChartData = {
      series: null,
      unit: "currency USD",
      rows: [
        { label: "a", values: [220] },
        { label: "b", values: [30] },
      ],
    };
    expect(planOf(money, 800).scaleMax).toBe(220);
  });

  // md2ui chart_units_tests: test_value_format_places_the_declared_unit
  it("Value format places the declared unit", () => {
    expect(withUnit("24", "°C", "1")).toBe("24");
    expect(withUnit("24", "°C", "1unit")).toBe("24°C");
    expect(withUnit("24", "°C", "1 unit")).toBe("24 °C");
    expect(withUnit("24", "$", "unit 1")).toBe("$ 24");
    expect(withUnit("24", null, "1 unit")).toBe("24");
  });

  it("a tick label shows the declared unit where Value format puts it", () => {
    const d = { ...sample("", ""), display_unit: "count" };
    const kit = kitFor("## Charts\nValue format: 1 unit\n");
    expect(chartTick(25, d, kit)).toBe("25 count");
  });
});

// --- paint_replacement_tests: a chart's text follows ## Color Replacements -------------------

describe("a chart's text resolves against the surface the chart sits on (md2ui 142505f1)", () => {
  const DARK = 0xff18181b;
  const WHITE = "#ffffffff";
  const INK = "#7c7c84ff";
  const THEME = (grid = "") =>
    `## Text Styles\nLabels:\n- Font color: #7C7C84\n## Charts\n${grid}` +
    "## Color Replacements\nOn background color: #18181B\n- Text color: #7C7C84, Replacement: #FFFFFF\n";
  const onDark = (d: ChartData, width: number, themeText: string) =>
    drawBox(
      drawChart,
      themeText,
      { chart: d },
      { width, height: planOf(d, width, themeText).height },
      [DARK],
    );

  // md2ui paint_replacement_tests: test_chart_rows_labels_and_values_are_replaced
  it("row labels and values follow the dark card's rule", () => {
    const entries = onDark(data(3), 220, THEME());
    expect(wordsOf(entries)).toEqual(["Row 0", "10%", "Row 1", "20%", "Row 2", "30%"]);
    expect(inksOf(entries)).toEqual(new Set([WHITE]));
    // Off the dark card the same chart keeps its authored ink.
    const plain = drawBox(drawChart, THEME(), { chart: data(3) }, { width: 220, height: 100 });
    expect(inksOf(plain)).toEqual(new Set([INK]));
  });

  // md2ui paint_replacement_tests: test_chart_legend_is_replaced
  it("a legend follows the dark card's rule", () => {
    const entries = onDark(data(2, ["A", "B"], 2), 220, THEME());
    expect(wordsOf(entries)).toContain("A");
    expect(wordsOf(entries)).toContain("B");
    expect(inksOf(entries)).toEqual(new Set([WHITE]));
  });

  // md2ui paint_replacement_tests: test_chart_tick_labels_are_replaced
  it("tick labels follow the dark card's rule", () => {
    const entries = onDark(data(6), 800, THEME("### Chart Grid\nAxis labels: yes\n"));
    const ticks = textsOf(entries).filter((t) => t.runs.some((r) => r.text.endsWith("%")));
    expect(ticks.map((t) => t.runs[0]?.text)).toEqual(["0%", "25%", "50%", "75%", "100%"]);
    expect(inksOf(entries)).toEqual(new Set([WHITE]));
  });
});
