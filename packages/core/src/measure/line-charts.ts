// A line chart leaf's geometry (md2ui `render_line_chart`): `Key: a → b → c` as one line
// over its points, or a group of such items as several lines on one axis under a legend.
// The measured height and the painting both come from these functions, so the box and
// the drawing agree (md2ui ADR-400).
//
// The points spread evenly along the width, in the order written, and the axis fits the
// data's range: a line does not start at zero, so prices that move within a few percent
// still show their shape. Where tick labels crowd, some are left out, never shortened.
import type { ResolvedTheme, TextStyle } from "@md2ui/contracts";
import { withUnit } from "../group/value-format.ts";
import { fontOf } from "./font-set.ts";
import { type LeafKit, LINE_SCALE, type Props } from "./leaf-kit.ts";

/** Between the line's area and its tick labels, and the least room between two labels. */
export const LINE_TICK_GAP = 4;
const LEGEND_GAP = 6; // between a group's legend and its lines
const LEGEND_SPACING = 14; // between one series' legend entry and the next

/** md2ui `_tick_style`: the style of a line chart's tick labels and legend. */
export function lineTickStyle(theme: ResolvedTheme): TextStyle {
  return theme.charts.label_text ?? theme.labels;
}

function list(v: unknown): readonly Props[] {
  return Array.isArray(v) ? (v as Props[]) : [];
}

/** Whether `data` is a group of lines (it carries `series`), not one line. */
function isGroup(data: Props): boolean {
  return list(data["series"]).length > 0;
}

/** md2ui `_series`: the points of every line `data` draws, one or each series of a group. */
export function lineSeries(data: Props): readonly (readonly Props[])[] {
  if (isGroup(data)) return list(data["series"]).map((s) => list(s["points"]));
  return [list(data["points"])];
}

/** md2ui `_labels`: one label per position, a group's merged labels or a line's own ticks. */
export function lineLabels(data: Props): readonly (string | null)[] {
  if (isGroup(data)) {
    return list(data["labels"]).map((l) => (l === null ? null : String(l)));
  }
  return list(data["points"]).map((p) => {
    const tick = p["tick"];
    return tick === null || tick === undefined ? null : String(tick);
  });
}

/** One legend entry: its series, its text, and its left x inside the box. */
export interface LegendEntry {
  readonly series: number;
  readonly label: string;
  readonly x: number;
}

/**
 * md2ui `_legend_rows`: a group's legend, each series' dot, name and last value as written
 * (with its declared unit, as `Value format` shows it), wrapped to `width` between
 * entries, never inside one. A single line has none: its key and last value are a row the
 * generator built.
 */
export function lineLegendRows(data: Props, width: number, leaves: LeafKit): LegendEntry[][] {
  const { theme, text, fonts } = leaves;
  const ts = lineTickStyle(theme);
  const font = fontOf(fonts.typeface, ts.font_size);
  const dot = ts.font_size * 0.64 + 5; // the dot and its gap to the name
  const unit = data["display_unit"];
  const rows: LegendEntry[][] = [];
  let x = width; // forces the first entry onto a new row
  list(data["series"]).forEach((s, i) => {
    const points = list(s["points"]);
    const last = withUnit(
      String(points.at(-1)?.["text"] ?? ""),
      typeof unit === "string" ? unit : null,
      theme.charts.value_format,
    );
    const label = `${String(s["name"] ?? "")}  ${last}`;
    const entry = dot + text.advance(label, font);
    if (x > 0 && x + entry > width) {
      rows.push([]);
      x = 0;
    }
    (rows.at(-1) as LegendEntry[]).push({ series: i, label, x });
    x += entry + LEGEND_SPACING;
  });
  return rows;
}

/** md2ui `_legend_h`: the legend's rows and the gap under them; nothing without a legend. */
export function lineLegendHeight(rows: readonly unknown[], theme: ResolvedTheme): number {
  if (rows.length === 0) return 0;
  return rows.length * lineTickStyle(theme).font_size * LINE_SCALE + LEGEND_GAP;
}

/** md2ui `_area_h`: the lines' area, `Group height` for several lines, else `Height`. */
export function lineAreaHeight(data: Props, theme: ResolvedTheme): number {
  const lt = theme.charts.line;
  if (isGroup(data) && lt.group_height !== null) return lt.group_height;
  return lt.height;
}

/**
 * md2ui `line_chart_height`: a group's legend, the lines' area, and a line of tick labels
 * when any position has one.
 */
export function lineChartHeight(data: Props, width: number, leaves: LeafKit): number {
  const { theme } = leaves;
  const rows = lineLegendRows(data, width, leaves);
  let h = lineLegendHeight(rows, theme) + lineAreaHeight(data, theme);
  if (lineLabels(data).some(Boolean))
    h += LINE_TICK_GAP + lineTickStyle(theme).font_size * LINE_SCALE;
  return h;
}

/**
 * md2ui `_line_points`: where each point sits, evenly along `width` from `x`, the lowest
 * of `span` at the bottom of the `height`-tall area at `y` and the highest at its top.
 * Inset by half a dot, so neither the first point's dot nor the highest one is cut at
 * the box's edge. A line of fewer than two points has none.
 */
export function linePoints(
  points: readonly Props[],
  x: number,
  y: number,
  width: number,
  theme: ResolvedTheme,
  span: readonly [number, number],
  height: number,
): (readonly [number, number])[] {
  const lt = theme.charts.line;
  const values = points.map((p) => Number(p["value"]));
  if (values.length < 2) return [];
  const [lo, hi] = span;
  const inset = Math.max(lt.point_size, lt.width) / 2;
  const left = x + inset;
  const right = x + width - inset;
  const top = y + inset;
  const bottom = y + height - inset;
  const step = (right - left) / (values.length - 1);
  // A flat line sits mid-area.
  const valueY = (v: number): number =>
    hi === lo ? (top + bottom) / 2 : bottom - ((v - lo) / (hi - lo)) * (bottom - top);
  return values.map((v, i) => [left + i * step, valueY(v)] as const);
}

/**
 * md2ui `_shown_ticks`: which tick labels draw, as indexes into `spans` (each label's left
 * and right x, in point order), so that none runs into another. The ends come first: the
 * last label says where the line is now, the first where it starts, so when both cannot
 * fit only the last stays. The middle ones fill in by halving the runs between labels
 * already placed, so the labels left out spread along the line.
 */
export function lineShownTicks(spans: readonly (readonly [number, number])[]): number[] {
  const n = spans.length;
  const order: number[] = [];
  if (n > 0) {
    order.push(n - 1, 0);
    const ranges: [number, number][] = [[0, n - 1]];
    for (let range = ranges.shift(); range !== undefined; range = ranges.shift()) {
      const [lo, hi] = range;
      if (hi - lo < 2) continue;
      const mid = Math.floor((lo + hi) / 2);
      order.push(mid);
      ranges.push([lo, mid], [mid, hi]);
    }
  }
  const placed: number[] = [];
  for (const k of new Set(order)) {
    const [left, right] = spans[k] as readonly [number, number];
    const clear = placed.every((j) => {
      const [jl, jr] = spans[j] as readonly [number, number];
      return right + LINE_TICK_GAP <= jl || jr + LINE_TICK_GAP <= left;
    });
    if (clear) placed.push(k);
  }
  return placed.sort((a, b) => a - b);
}
