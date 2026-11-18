// A chart leaf's plan (md2ui `render_chart`: `_chart_plan_for`, `_chart_vertical_min_width`,
// `_chart_vertical_bars`, the scale and the axis): its size, orientation, scale and ticks,
// which painting draws from too (md2ui ADR-400). A chart fills its column's width; its
// height depends on whether it draws vertical bars, horizontal rows, or columns of rows,
// and the width that buys vertical bars, tick-label gutter included, is also what a
// stacked section holding it asks for.
import type { ResolvedTheme, TextStyle } from "@md2ui/contracts";
import { compile, type RegexKit } from "../group/py/re.ts";
import { formatG, formatGTo } from "../group/py/str.ts";
import { withUnit } from "../group/value-format.ts";
import { paddingY } from "../theme/query.ts";
import { fontOf } from "./font-set.ts";
import { type LeafKit, LINE_SCALE, type Props } from "./leaf-kit.ts";

export const CHART_ROW_GAP = 12; // vertical gap between horizontal chart rows
export const CHART_VERTICAL_H = 140; // bar area height in vertical orientation
const CHART_COLUMN_W = 240; // min column width before stacking into columns
const CHART_MIN_SLOT = 44; // min per-bar slot width for vertical orientation
const CHART_SERIES_GAP = 2; // gap between one row's series bars, vertical orientation
export const CHART_AXIS_GAP = 6; // between the widest tick label and the bars

/** A chart's rows, as the generator baked them. */
function chartRows(data: Props): Props[] {
  const rows = data["rows"];
  return Array.isArray(rows) ? (rows as Props[]) : [];
}

/** md2ui `str(r.get("label", ""))`: a row's label as text. */
function rowLabel(row: Props): string {
  if (!Object.hasOwn(row, "label")) return "";
  const label = row["label"];
  return label === null ? "None" : String(label);
}

/** md2ui `r.get("values") or [0.0]`: how many series bars one row draws. */
function seriesCount(row: Props): number {
  const values = row["values"];
  return Array.isArray(values) && values.length > 0 ? values.length : 1;
}

/** Python `float // float` for a finite dividend and a positive divisor. */
function floorDiv(a: number, b: number): number {
  const mod = a % b;
  let div = (a - mod) / b;
  if (mod !== 0 && mod < 0) div -= 1;
  const floor = Math.floor(div);
  return div - floor > 0.5 ? floor + 1 : floor;
}

/**
 * md2ui `_chart_scale`: the `[min, max]` a chart's bars are measured against. Percent data
 * scales against 100 so bars read as progress, unless `Percent scale: peak` asks for a
 * comparison; any other unit against the data's peak. A value below zero makes it change
 * data: the scale is then the data's own range, zero included.
 */
function chartScale(
  values: readonly (readonly number[])[],
  unit: unknown,
  percentScale: string,
): [number, number] {
  const flat = values.flat();
  const peak = flat.length === 0 ? 0 : Math.max(...flat);
  const least = flat.length === 0 ? 0 : Math.min(...flat);
  if (least < 0) return [least, Math.max(peak, 0)];
  const progress = unit === "%" && percentScale === "100" && peak <= 100;
  return [0, progress ? 100 : Math.max(peak, 1)];
}

/**
 * md2ui `_chart_ticks`: round values from at or below `lo` to at or above `hi`, about
 * `count` steps apart. Each is a multiple of the step, so zero is always one.
 */
function chartTicks(lo: number, hi: number, count: number): number[] {
  const raw = (hi - lo) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = mag * ([1, 2, 2.5, 5, 10].find((m) => m * mag >= raw * (1 - 1e-9)) as number);
  const first = Math.floor(lo / step + 1e-9);
  const last = Math.ceil(hi / step - 1e-9);
  // Python's `round(v, 10) + 0.0`: ten decimals, and a -0 printed as the 0 it is.
  return Array.from(
    { length: last - first + 1 },
    (_, k) => Number(((first + k) * step).toFixed(10)) + 0,
  );
}

// md2ui `_WRITTEN_VALUE`: a value's leading symbol, its figure with an optional magnitude
// letter, and whatever follows: `$`, `1.2`, `M`, `` / ``, `200`, ``, ` EUR`.
// py: re.compile(r"^(\D*?)[-−+]?\d[\d.,]*([KMB](?![A-Za-z]))?(.*)$")
const WRITTEN_VALUE = compile(String.raw`^(\D*?)[-−+]?\d[\d.,]*([KMB](?![A-Za-z]))?(.*)$`);
const MAGNITUDES = [
  [1e9, "B"],
  [1e6, "M"],
  [1e3, "K"],
] as const;

/**
 * md2ui `_chart_tick_label`: a tick's label in the unit the chart's values are written in,
 * the symbol and unit word of `sample`, one of them as written (`40%`, `$200`, `200 EUR`, `5K`).
 */
function chartTickLabel(kit: RegexKit, t: number, unit: unknown, sample: string): string {
  const m = unit !== "%" ? kit.re(WRITTEN_VALUE).match(sample) : null;
  if (m === null) return `${formatG(t)}${unit === "%" ? "%" : ""}`;
  const prefix = m.text(1).replace(/^[-−+]+/, "");
  const a = Math.abs(t);
  let figure = formatGTo(a, 10);
  if (m.group(2) || unit === "magnitude") {
    const [size, letter]: readonly [number, string] = MAGNITUDES.find(([s]) => a >= s) ?? [1, ""];
    figure = `${formatGTo(a / size, 10)}${letter}`;
  }
  return (t < 0 ? "-" : "") + prefix + figure + m.text(3);
}

/** md2ui `_chart_sample`: one of the chart's values as written, for its tick labels' unit. */
function chartSample(data: Props): string {
  const texts = chartRows(data)[0]?.["texts"];
  return Array.isArray(texts) && texts.length > 0 ? String(texts[0]) : "";
}

/**
 * md2ui `_chart_tick`: a tick's label, in the values' own unit, or bare with the unit the
 * author declared, as the theme's `Value format` places it.
 */
export function chartTick(t: number, data: Props, leaves: LeafKit): string {
  const label = chartTickLabel(leaves.kit, t, data["unit"], chartSample(data));
  const unit = data["display_unit"];
  return withUnit(label, typeof unit === "string" ? unit : null, leaves.theme.charts.value_format);
}

/** md2ui `_chart_tick_style`: the tick labels' text style. */
export function chartTickStyle(theme: ResolvedTheme): TextStyle {
  const ct = theme.charts;
  return ct.grid.text ?? ct.value_text ?? theme.labels;
}

/**
 * md2ui `_chart_axis`: a vertical chart's ticks and the gutter its tick labels take, by
 * `### Chart Grid`: no ticks when nothing is drawn at them, no gutter when their labels
 * are off.
 */
function chartAxis(data: Props, leaves: LeafKit): { ticks: number[]; axisW: number } {
  const { theme, text, fonts } = leaves;
  const grid = theme.charts.grid;
  if (!(grid.axis_labels || grid.horizontal)) return { ticks: [], axisW: 0 };
  const values = chartRows(data).map(rowValues);
  const [lo, hi] = chartScale(values, data["unit"], theme.charts.percent_scale);
  const ticks = chartTicks(lo, hi, grid.ticks);
  if (!grid.axis_labels) return { ticks, axisW: 0 };
  const font = fontOf(fonts.typeface, chartTickStyle(theme).font_size);
  const widest = Math.max(...ticks.map((t) => text.advance(chartTick(t, data, leaves), font)));
  return { ticks, axisW: widest + CHART_AXIS_GAP };
}

/**
 * md2ui `_chart_vertical_min_width`: the narrowest width at which a chart still draws
 * vertical bars, its tick-label gutter included, or `null` when it draws horizontal rows
 * at every width (four rows or fewer).
 */
export function chartVerticalMinWidth(data: Props, leaves: LeafKit): number | null {
  const rows = chartRows(data);
  const n = rows.length;
  if (n <= 4) return null;
  const { theme, text, fonts } = leaves;
  const labelTs = theme.charts.label_text ?? theme.labels;
  const font = fontOf(fonts.typeface, labelTs.font_size);
  const widest = Math.max(0, ...rows.map((r) => text.advance(rowLabel(r), font)));
  const slots = n * Math.max(CHART_MIN_SLOT, widest + 8);
  const { axisW } = chartAxis(data, leaves);
  const ct = theme.charts;
  if (ct.bar_width !== "fill") return slots + axisW;
  const ns = Math.max(...rows.map(seriesCount));
  const group = ns * ct.bar_thickness + (ns - 1) * CHART_SERIES_GAP;
  return Math.max(slots, n * group + (n - 1) * ct.bar_spacing) + axisW;
}

/** md2ui `ChartPlan`: what a chart draws at one width, the one answer sizing and painting share. */
export interface ChartPlan {
  readonly orientation: "horizontal" | "vertical" | "columns";
  readonly columns: number;
  readonly labels: readonly string[];
  readonly values: readonly (readonly number[])[];
  readonly series: readonly string[] | null;
  /** Below zero only when a value is: the bars then diverge from a zero line inside the scale. */
  readonly scaleMin: number;
  readonly scaleMax: number;
  /** A vertical chart cut by `### Chart Grid`: the values its lines and labels sit at. */
  readonly ticks: readonly number[];
  /** The tick labels' gutter, left of the bars. */
  readonly axisW: number;
  /** The room above the bars for the top tick label's upper half. */
  readonly topPad: number;
  /** Each row's values as written, which its value label draws. */
  readonly texts: readonly (readonly string[])[];
  /** The unit the author declared for bare values, shown by `Value format`. */
  readonly displayUnit: string | null;
  readonly legendH: number;
  readonly labelLineH: number;
  /** One horizontal row: its label line and its bars. */
  readonly rowH: number;
  readonly height: number;
}

/** md2ui `[float(v) for v in (r.get("values") or [0.0])]`: one row's series values. */
function rowValues(row: Props): number[] {
  const values = row["values"];
  return Array.isArray(values) && values.length > 0 ? values.map(Number) : [0];
}

/**
 * md2ui `_chart_plan_for`: a chart's orientation, column count, scale and height at `width`.
 * The width that buys vertical bars is the one `chartVerticalMinWidth` gives sizing.
 */
export function chartPlan(data: Props, width: number, leaves: LeafKit): ChartPlan {
  const { theme } = leaves;
  const ct = theme.charts;
  const rows = chartRows(data);
  const labels = rows.map(rowLabel);
  const values = rows.map(rowValues);
  const n = Math.max(1, rows.length);
  const ns = Math.max(1, ...values.map((v) => v.length));
  let [scaleMin, scaleMax] = chartScale(values, data["unit"], ct.percent_scale);
  const labelTs = ct.label_text ?? theme.labels;
  const valueTs = ct.value_text ?? theme.labels;
  const labelLineH = Math.max(labelTs.font_size, valueTs.font_size) * LINE_SCALE;
  const series = data["series"];
  const names = Array.isArray(series) && series.length > 0 ? series.map(String) : null;
  const legendH = names === null ? 0 : labelLineH + 6;
  const trackH = ct.bar_thickness + paddingY(ct.track.padding);
  const rowH = labelLineH + 4 + ns * trackH + (ns - 1) * 2;

  const verticalMin = chartVerticalMinWidth(data, leaves);
  let orientation: ChartPlan["orientation"] = "horizontal";
  let columns = 1;
  if (verticalMin !== null && width >= verticalMin) orientation = "vertical";
  else if (verticalMin !== null) {
    columns = Math.max(1, floorDiv(width, CHART_COLUMN_W));
    if (columns > 1) orientation = "columns";
  }
  let ticks: number[] = [];
  let axisW = 0;
  let topPad = 0;
  let height: number;
  if (orientation === "vertical") {
    ({ ticks, axisW } = chartAxis(data, leaves));
    // The scale reaches the round values its lines are drawn at.
    if (ticks.length > 0) [scaleMin, scaleMax] = [ticks[0] as number, ticks.at(-1) as number];
    if (axisW) topPad = chartTickStyle(theme).font_size / 2;
    height = legendH + topPad + CHART_VERTICAL_H + 4 + labelLineH;
  } else {
    if (scaleMin < 0 && 0 < scaleMax) {
      // Rows that mix gains and losses share one zero mid-track, so each side reads
      // against the same reach.
      const reach = Math.max(-scaleMin, scaleMax);
      [scaleMin, scaleMax] = [-reach, reach];
    }
    const rowsPerCol = Math.ceil(n / columns);
    height = legendH + rowsPerCol * rowH + (rowsPerCol - 1) * CHART_ROW_GAP;
  }
  const unit = data["display_unit"];
  return {
    orientation,
    columns,
    labels,
    values,
    series: names,
    scaleMin,
    scaleMax,
    ticks,
    axisW,
    topPad,
    texts: rows.map((r) => (Array.isArray(r["texts"]) ? r["texts"].map(String) : [])),
    displayUnit: typeof unit === "string" ? unit : null,
    legendH,
    labelLineH,
    rowH,
    height,
  };
}

/** md2ui `_chart_plan_for(...).height`: a chart's height at `width`. */
export function chartHeight(data: Props, width: number, leaves: LeafKit): number {
  return chartPlan(data, width, leaves).height;
}

/** One vertical bar: its row, its series, and its rect. */
export interface ChartBar {
  readonly row: number;
  readonly series: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * md2ui `_chart_vertical_bars`: where a vertical chart's bars go, and each row's label span
 * `[left, width]` to centre its label in.
 */
export function chartVerticalBars(
  plan: ChartPlan,
  x: number,
  width: number,
  baseY: number,
  theme: ResolvedTheme,
): { readonly bars: ChartBar[]; readonly spans: [number, number][] } {
  const ct = theme.charts;
  const n = Math.max(1, plan.labels.length);
  const ns = Math.max(1, ...plan.values.map((v) => v.length));
  const gap = CHART_SERIES_GAP;
  const least = ns * ct.bar_thickness + (ns - 1) * gap;
  let groupW: number;
  let spans: [number, number][];
  let starts: number[];
  if (ct.bar_width === "fill") {
    groupW = Math.max(least, (width - (n - 1) * ct.bar_spacing) / n);
    spans = Array.from({ length: n }, (_, i): [number, number] => [
      x + i * (groupW + ct.bar_spacing),
      groupW,
    ]);
    starts = spans.map(([left]) => left);
  } else {
    const slotW = width / n;
    groupW = Math.min(slotW * 0.7, least);
    spans = Array.from({ length: n }, (_, i): [number, number] => [x + i * slotW, slotW]);
    starts = spans.map(([left]) => left + (slotW - groupW) / 2);
  }
  const barW = Math.max(3, (groupW - (ns - 1) * gap) / ns);
  const floorH = ct.bar_width === "fill" ? ct.bar_thickness : barW;
  const zeroY = chartValueY(plan, baseY, 0);
  const bars: ChartBar[] = [];
  plan.values.forEach((row, i) => {
    row.forEach((v, s) => {
      const [lo, hi] = chartSpan(plan, v);
      let height = Math.max(floorH, CHART_VERTICAL_H * (hi - lo));
      if (plan.scaleMin < 0) {
        // The floor may not push a bar out of the chart past its edge.
        const room = v < 0 ? baseY - zeroY : zeroY - (baseY - CHART_VERTICAL_H);
        height = Math.min(height, Math.max(CHART_VERTICAL_H * (hi - lo), room));
      }
      bars.push({
        row: i,
        series: s,
        x: (starts[i] as number) + s * (barW + gap),
        y: v < 0 ? zeroY : zeroY - height,
        width: barW,
        height,
      });
    });
  });
  return { bars, spans };
}

/**
 * md2ui `_chart_span`: where a bar of value `v` runs along the value axis, as fractions of
 * it, from zero to `v`, the lower end first. Every orientation places its bars by it.
 */
export function chartSpan(plan: ChartPlan, v: number): readonly [number, number] {
  const span = plan.scaleMax - plan.scaleMin;
  const zero = Math.max(0, Math.min(1, (0 - plan.scaleMin) / span));
  const end = Math.max(0, Math.min(1, (v - plan.scaleMin) / span));
  return [Math.min(zero, end), Math.max(zero, end)];
}

/** md2ui `_chart_value_y`: the y value `v` sits at in a vertical chart whose bars end at `baseY`. */
export function chartValueY(plan: ChartPlan, baseY: number, v: number): number {
  const span = plan.scaleMax - plan.scaleMin;
  return baseY - CHART_VERTICAL_H * Math.max(0, Math.min(1, (v - plan.scaleMin) / span));
}
