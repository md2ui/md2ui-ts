// The line chart leaf's paint (md2ui `render_line_chart.draw_line_chart`): a group's
// legend, each line over its points, a dot at each line's latest value (and at each
// labelled point under `Points: labelled`), and the tick labels that fit. The geometry is
// `measure/line-charts.ts`'s, the same numbers the leaf was sized by.
import type { Argb } from "@md2ui/contracts";
import { hint, LINE_SCALE, type Props } from "../../measure/leaf-kit.ts";
import {
  LINE_TICK_GAP,
  lineAreaHeight,
  lineLabels,
  lineLegendHeight,
  lineLegendRows,
  linePoints,
  lineSeries,
  lineShownTicks,
  lineTickStyle,
} from "../../measure/line-charts.ts";
import { replaceColor } from "../backgrounds.ts";
import { chartSeriesColor } from "./charts.ts";
import type { BoxDrawer, Draw } from "./context.ts";
import { css, ovalShape, type Pen, pathNumber, pathShape } from "./pen.ts";
import { labelRuns } from "./text.ts";

/** A filled dot of `diameter` centred on `(cx, cy)`. */
function dot(p: Pen, cx: number, cy: number, diameter: number, color: Argb): void {
  const r = diameter / 2;
  const box = { x: cx - r, y: cy - r, width: diameter, height: diameter };
  p.fill(ovalShape(box), { kind: "color", color: css(color) });
}

/** A label's runs at `x`, in the tick style's face and size. */
function tickRuns(d: Draw, label: string, x: number, size: number, color: Argb) {
  const { fonts } = d.sizer.leaves;
  return labelRuns(d, label, x, fonts.typeface, fonts.emoji, size, color);
}

/** md2ui `draw_line_chart`: one line, or a group of lines on one axis under its legend. */
export const drawLineChart: BoxDrawer = (d, box, p) => {
  const { theme, leaves } = d.sizer;
  const lt = theme.charts.line;
  const stack = box.bg_stack;
  const data = hint(box.render_properties, "line_chart") as Props;
  const series = lineSeries(data);
  const values = series.flat().map((pt) => Number(pt["value"]));
  if (values.length === 0) return;
  const span = [Math.min(...values), Math.max(...values)] as const;
  const ts = lineTickStyle(theme);
  const ink = replaceColor(ts.color, stack, theme);
  const rows = lineLegendRows(data, box.width, leaves);
  let colors: Argb[];
  if (rows.length > 0) {
    colors = series.map((_, i) => chartSeriesColor(theme, i, stack));
    // Each entry where the legend rows placed it, its dot in its line's colour.
    const lineH = ts.font_size * LINE_SCALE;
    const radius = ts.font_size * 0.32;
    rows.forEach((row, r) => {
      const top = box.y + r * lineH;
      for (const entry of row) {
        const x = box.x + entry.x;
        dot(p, x + radius, top + lineH / 2, radius * 2, colors[entry.series] as Argb);
        p.text(
          top + ts.font_size,
          tickRuns(d, entry.label, x + radius * 2 + 5, ts.font_size, ink).runs,
        );
      }
    });
  } else if (lt.color !== null) {
    colors = [replaceColor(lt.color, stack, theme, "fill")];
  } else {
    colors = [chartSeriesColor(theme, 0, stack)];
  }
  const top = box.y + lineLegendHeight(rows, theme);
  const area = lineAreaHeight(data, theme);
  const lines = series.map((points) =>
    linePoints(points, box.x, top, box.width, theme, span, area),
  );
  if (lines.some((pts) => pts.length === 0)) return;
  // Each line is one round-joined, round-capped path over the area (md2ui's `skia.Path`),
  // its points placed in the area's own frame so a chart that moves keeps its path data.
  const frame = { x: box.x, y: top, width: box.width, height: area };
  series.forEach((points, i) => {
    const local = linePoints(points, 0, 0, box.width, theme, span, area);
    const d = local
      .map(([x, y], k) => `${k === 0 ? "M" : "L"}${pathNumber(x)} ${pathNumber(y)}`)
      .join("");
    p.stroke(pathShape(frame, d), lt.width, colors[i] as Argb, undefined, {
      join: "round",
      cap: "round",
    });
  });
  const first = lines[0] ?? [];
  const placed: {
    readonly at: number;
    readonly label: string;
    readonly x: number;
    readonly w: number;
  }[] = [];
  lineLabels(data).forEach((label, i) => {
    const point = first[i];
    if (!label || point === undefined) return;
    const w = tickRuns(d, label, 0, ts.font_size, ink).width;
    const x = Math.min(Math.max(point[0] - w / 2, box.x), box.x + box.width - w);
    placed.push({ at: i, label, x, w });
  });
  const shown = lineShownTicks(placed.map(({ x, w }) => [x, x + w] as const)).map(
    (k) => placed[k] as (typeof placed)[number],
  );
  if (lt.point_size > 0) {
    const labelled = lt.points === "labelled" ? shown.map(({ at }) => at) : [];
    lines.forEach((pts, i) => {
      for (const at of [...new Set([...labelled, pts.length - 1])].sort((a, b) => a - b)) {
        const pt = pts[at];
        if (pt !== undefined) dot(p, pt[0], pt[1], lt.point_size, colors[i] as Argb);
      }
    });
  }
  const baseline = top + area + LINE_TICK_GAP + ts.font_size;
  for (const { label, x } of shown) p.text(baseline, tickRuns(d, label, x, ts.font_size, ink).runs);
};
