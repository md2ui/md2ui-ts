// The chart leaf's paint (md2ui `render_chart`): a run of `Key: value` rows in one unit,
// as horizontal rows, vertical bars or stacked columns of rows. Everything is drawn from
// the plan sizing measured (`measure/charts.ts`), so the painting is the geometry that
// was reserved. Below zero, bars diverge from a zero line; a vertical chart may be cut by
// `### Chart Grid` into ticks with lines and labels. Every colour, text included, is
// replaced against what the chart sits on.
import type { Argb, ResolvedTheme } from "@md2ui/contracts";
import { formatG } from "../../group/py/str.ts";
import { withUnit } from "../../group/value-format.ts";
import {
  CHART_AXIS_GAP,
  CHART_ROW_GAP,
  CHART_VERTICAL_H,
  type ChartPlan,
  chartPlan,
  chartSpan,
  chartTick,
  chartTickStyle,
  chartValueY,
  chartVerticalBars,
} from "../../measure/charts.ts";
import { fontOf, weightFromStr } from "../../measure/font-set.ts";
import { hint, type Props } from "../../measure/leaf-kit.ts";
import { GREY_DARK, GREY_LIGHT, GREY_MID } from "../../theme/model.ts";
import { paddingX, paddingY } from "../../theme/query.ts";
import { replaceColor } from "../backgrounds.ts";
import type { BgStack } from "../boxes.ts";
import type { BoxDrawer, Draw } from "./context.ts";
import {
  barStub,
  DEFAULT_BAR_FILL,
  DEFAULT_BAR_TRACK,
  paintBlock,
  styleColor,
} from "./datapoints.ts";
import { css, ovalShape, type Pen } from "./pen.ts";
import { labelRuns } from "./text.ts";

/** The series colours a chart cycles when THEME.md sets no `## Charts` list. */
const DEFAULT_SERIES_COLORS = Object.freeze<Argb[]>([
  DEFAULT_BAR_FILL,
  GREY_MID,
  GREY_LIGHT,
  GREY_DARK,
]);
const CHART_COL_GAP = 24; // gap between stacked columns

/**
 * md2ui `_chart_series_color`: a series' colour: the theme's list, else the first bar's
 * colour for the first series, else the built-in cycle; replaced against what it sits on.
 */
export function chartSeriesColor(theme: ResolvedTheme, idx: number, stack: BgStack): Argb {
  const ct = theme.charts;
  const first = ct.bar.bg_colors[0];
  const color =
    ct.series_colors.length > 0
      ? (ct.series_colors[idx % ct.series_colors.length] as Argb)
      : idx === 0 && first !== undefined
        ? first
        : (DEFAULT_SERIES_COLORS[idx % DEFAULT_SERIES_COLORS.length] as Argb);
  return replaceColor(color, stack, theme, "fill");
}

/** md2ui `_chart_bar_color`: `Negative color` below zero when the theme sets one, else the series'. */
function chartBarColor(theme: ResolvedTheme, idx: number, v: number, stack: BgStack): Argb {
  const neg = theme.charts.negative_color;
  if (v < 0 && neg !== null) return replaceColor(neg, stack, theme, "fill");
  return chartSeriesColor(theme, idx, stack);
}

/** One line of text in a chart, at `x` on the baseline `y`; answers its width. */
function chartText(
  d: Draw,
  p: Pen,
  text: string,
  x: number,
  y: number,
  size: number,
  color: Argb,
  bold = false,
): number {
  const { fonts } = d.sizer.leaves;
  const face = bold ? fonts.bold : fonts.typeface;
  const at = labelRuns(d, text, x, face, fonts.emoji, size, color);
  p.text(y, at.runs);
  return at.width;
}

/** A text's width as `chartText` would draw it. */
function chartTextWidth(d: Draw, text: string, size: number, bold = false): number {
  const { fonts } = d.sizer.leaves;
  return labelRuns(d, text, 0, bold ? fonts.bold : fonts.typeface, fonts.emoji, size, 0).width;
}

/**
 * md2ui `_chart_line`: one of the chart's lines, the zero line or a grid line, in the
 * `### Chart Grid` colour and width.
 */
function chartLine(
  p: Pen,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  theme: ResolvedTheme,
  stack: BgStack,
): void {
  const grid = theme.charts.grid;
  p.line(x0, y0, x1, y1, grid.width, replaceColor(grid.color, stack, theme, "stroke"));
}

/**
 * md2ui `_draw_chart_grid`: a vertical chart's grid, behind its bars: a line at each tick,
 * a line at each edge of each row's slot, and the tick labels in the gutter left of `x`.
 */
function drawGrid(
  d: Draw,
  p: Pen,
  plan: ChartPlan,
  data: Props,
  x: number,
  width: number,
  baseY: number,
  spans: readonly (readonly [number, number])[],
  stack: BgStack,
): void {
  const { theme, leaves } = d.sizer;
  const grid = theme.charts.grid;
  const top = baseY - CHART_VERTICAL_H;
  if (grid.horizontal) {
    for (const t of plan.ticks) {
      const ty = chartValueY(plan, baseY, t);
      chartLine(p, x, ty, x + width, ty, theme, stack);
    }
  }
  const last = spans.at(-1);
  if (grid.vertical && last !== undefined) {
    // The outer edges, and midway between one slot's end and the next one's start.
    const edges = spans.map(([left], i) => {
      const prev = spans[i - 1];
      return prev === undefined ? left : (prev[0] + prev[1] + left) / 2;
    });
    for (const ex of [...edges, last[0] + last[1]]) {
      chartLine(p, ex, top, ex, baseY, theme, stack);
    }
  }
  if (plan.axisW) {
    const ts = chartTickStyle(theme);
    const m = leaves.text.fontMetrics(fontOf(leaves.fonts.typeface, ts.font_size));
    const ink = replaceColor(ts.color, stack, theme);
    for (const t of plan.ticks) {
      const label = chartTick(t, data, leaves);
      const ty = chartValueY(plan, baseY, t);
      const lx = x - CHART_AXIS_GAP - chartTextWidth(d, label, ts.font_size);
      chartText(d, p, label, lx, ty + (m.ascent - m.descent) / 2, ts.font_size, ink);
    }
  }
}

/** md2ui `_draw_chart_legend`: a dot and a name per series, then any declared unit. */
function drawLegend(d: Draw, x: number, y: number, plan: ChartPlan, stack: BgStack, p: Pen): void {
  const { theme } = d.sizer;
  const labelTs = theme.charts.label_text ?? theme.labels;
  const ink = replaceColor(labelTs.color, stack, theme);
  const dotR = labelTs.font_size * 0.32;
  const names = plan.series ?? [];
  let cx = x;
  names.forEach((name, i) => {
    const cy = y + plan.labelLineH / 2;
    const dot = { x: cx, y: cy - dotR, width: 2 * dotR, height: 2 * dotR };
    p.fill(ovalShape(dot), { kind: "color", color: css(chartSeriesColor(theme, i, stack)) });
    const tx = cx + dotR * 2 + 5;
    const baseline = y + labelTs.font_size;
    const nameW = chartText(d, p, name, tx, baseline, labelTs.font_size, ink);
    if (plan.displayUnit && i === names.length - 1) {
      // The unit the series header declared closes the legend.
      const unit = `(${plan.displayUnit})`;
      chartText(d, p, unit, tx + nameW + 14, baseline, labelTs.font_size, ink);
    }
    cx = tx + nameW + 14;
  });
}

/**
 * md2ui `_draw_chart_rows`: horizontal rows, label left and value right, bars below. Rows
 * that mix signs share a zero line mid-track; a loss fills leftwards from it.
 */
function drawRows(
  d: Draw,
  x: number,
  y: number,
  w: number,
  plan: ChartPlan,
  rows: readonly number[],
  stack: BgStack,
  p: Pen,
): void {
  const { theme } = d.sizer;
  const ct = theme.charts;
  const labelTs = ct.label_text ?? theme.labels;
  const valueTs = ct.value_text ?? theme.labels;
  const bold = weightFromStr(valueTs.font_weight) >= 700;
  const labelInk = replaceColor(labelTs.color, stack, theme);
  const valueInk = replaceColor(valueTs.color, stack, theme);
  const pad = ct.track.padding;
  const trackH = ct.bar_thickness + paddingY(pad);
  const trackColor = styleColor(ct.track, DEFAULT_BAR_TRACK, stack, theme);
  const inner = Math.max(0, w - paddingX(pad));
  const left = x + pad.left;
  let ry = y;
  for (const i of rows) {
    chartText(d, p, plan.labels[i] ?? "", x, ry + labelTs.font_size, labelTs.font_size, labelInk);
    const values = plan.values[i] ?? [];
    const shown = plan.texts[i] ?? [];
    const vtext =
      shown.map((t) => withUnit(t, plan.displayUnit, ct.value_format)).join(", ") ||
      values.map((v) => `${formatG(v)}%`).join(", ");
    const vx = x + w - chartTextWidth(d, vtext, valueTs.font_size, bold);
    chartText(d, p, vtext, vx, ry + valueTs.font_size, valueTs.font_size, valueInk, bold);
    let by = ry + plan.labelLineH + 4;
    values.forEach((v, s) => {
      if (ct.track_enabled) {
        paintBlock(p, { x, y: by, width: w, height: trackH }, ct.track, trackColor, stack, theme);
      }
      if (plan.scaleMin < 0 && 0 < plan.scaleMax) {
        const zeroX = left + inner * (chartSpan(plan, 0)[0] as number);
        chartLine(p, zeroX, by, zeroX, by + trackH, theme, stack);
      }
      const [lo, hi] = chartSpan(plan, v);
      if (hi > lo) {
        const length = barStub(ct.bar_thickness, inner, hi - lo);
        // The floor grows a short bar away from zero, inside the track.
        const start =
          v < 0
            ? Math.max(left, left + inner * hi - length)
            : Math.min(left + inner * lo, left + inner - length);
        const fill = { x: start, y: by + pad.top, width: length, height: ct.bar_thickness };
        paintBlock(p, fill, ct.bar, chartBarColor(theme, s, v, stack), stack, theme);
      }
      by += trackH + 2;
    });
    ry += plan.rowH + CHART_ROW_GAP;
  }
}

/**
 * md2ui `_draw_chart`: one chart leaf, as horizontal rows, vertical bars, or stacked
 * columns of rows, whichever the plan chose at this box's width.
 */
export const drawChart: BoxDrawer = (d, box, p) => {
  const { theme, leaves } = d.sizer;
  const data = hint(box.render_properties, "chart") as Props;
  const plan = chartPlan(data, box.width, leaves);
  const ct = theme.charts;
  const stack = box.bg_stack;
  let y = box.y;
  if (plan.legendH > 0) {
    drawLegend(d, box.x, y, plan, stack, p);
    y += plan.legendH;
  }
  const n = plan.labels.length;
  if (plan.orientation === "vertical") {
    const labelTs = ct.label_text ?? theme.labels;
    const ink = replaceColor(labelTs.color, stack, theme);
    const baseY = y + plan.topPad + CHART_VERTICAL_H;
    const bx = box.x + plan.axisW;
    const bw = box.width - plan.axisW;
    const { bars, spans } = chartVerticalBars(plan, bx, bw, baseY, theme);
    drawGrid(d, p, plan, data, bx, bw, baseY, spans, stack);
    if (plan.scaleMin < 0) {
      const zeroY = chartValueY(plan, baseY, 0);
      chartLine(p, bx, zeroY, bx + bw, zeroY, theme, stack);
    }
    for (const bar of bars) {
      const v = plan.values[bar.row]?.[bar.series] ?? 0;
      paintBlock(p, bar, ct.bar, chartBarColor(theme, bar.series, v, stack), stack, theme);
    }
    plan.labels.forEach((name, i) => {
      const [left, spanW] = spans[i] ?? [bx, 0];
      const centred = left + (spanW - chartTextWidth(d, name, labelTs.font_size)) / 2;
      chartText(d, p, name, centred, baseY + 4 + labelTs.font_size, labelTs.font_size, ink);
    });
    return;
  }
  if (plan.orientation === "columns") {
    const k = plan.columns;
    const colW = (box.width - (k - 1) * CHART_COL_GAP) / k;
    const perCol = Math.ceil(n / k);
    for (let c = 0; c < k; c++) {
      const start = c * perCol;
      const stop = Math.min(n, start + perCol);
      if (start >= stop) break;
      const rows = Array.from({ length: stop - start }, (_, j) => start + j);
      drawRows(d, box.x + c * (colW + CHART_COL_GAP), y, colW, plan, rows, stack, p);
    }
    return;
  }
  const all = Array.from({ length: n }, (_, i) => i);
  drawRows(d, box.x, y, box.width, plan, all, stack, p);
};
