// Whether the theme turns a drawn display on: the gates of md2ui's
// `generator_displays.py` (`_charts_enabled`, `_lines_enabled`, `_drawn_chart`,
// `_dp_display_enabled`, `_unit_ratio_is_ring`). The generator routes on them; the displays themselves are
// built elsewhere.
import type { ResolvedTheme } from "@md2ui/contracts";
import type { GroupNode } from "../group/node.ts";

/** md2ui `_charts_enabled`: `## Charts` is on. */
function chartsEnabled(theme: ResolvedTheme): boolean {
  return theme.charts.enabled;
}

/** md2ui `_lines_enabled`: `### Line Chart` is on. */
function linesEnabled(theme: ResolvedTheme): boolean {
  return theme.charts.line.enabled;
}

/** md2ui `_drawn_chart`: `node` is a chart container the theme draws, as bars or lines. */
export function drawnChart(theme: ResolvedTheme, node: GroupNode): boolean {
  if (node.line_group) return linesEnabled(theme);
  return node.chart_group && chartsEnabled(theme);
}

/** md2ui `_dp_display_enabled`: the theme turns on `node`'s data-point display family. */
export function dpDisplayEnabled(theme: ResolvedTheme, node: GroupNode): boolean {
  const dp = theme.datapoints;
  switch (node.datapoint_display) {
    case "ratio_bar":
      return dp.ratio_bar.enabled;
    case "kv_percent_bar":
      return dp.kv_bar.enabled;
    case "unit_ratio":
      return dp.unit_ratio_enabled;
    case "date_chip":
      return dp.date_chip.enabled;
    case "line_chart":
      return linesEnabled(theme);
    default:
      return false;
  }
}

/** md2ui `_unit_ratio_is_ring`: unit ratios draw as rings, not bars. */
export function unitRatioIsRing(theme: ResolvedTheme): boolean {
  return theme.datapoints.unit_ratio_style === "ring";
}
