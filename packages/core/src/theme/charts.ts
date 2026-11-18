// Ports the `## Charts` block of md2ui's `parse_theme` (`pipeline/theme.py`).
import type { ChartsTheme, ResolvedTheme } from "@md2ui/contracts";
import { pyMax, pyMin } from "../group/py/math.ts";
import { split, strip } from "../group/py/str.ts";
import { parseSectionLine } from "./background.ts";
import { type Draft, newTextStyle } from "./model.ts";
import { fontBullet, setTextStyleField } from "./text-styles.ts";
import { hex, isYes, keyValue, newState, num } from "./values.ts";

/** md2ui's `VALUE_FORMATS`: the places a declared unit can take. */
const VALUE_FORMATS = ["1", "1 unit", "1unit", "unit 1"] as const;

/** `## Charts`. */
export function chartsSection(theme: Draft<ResolvedTheme>): (line: string, raw: string) => void {
  let mode = "";
  let state = newState("stroke");
  return (line, raw) => {
    if (line.startsWith("### ")) {
      mode = strip(line.slice(4)).toLowerCase().replaceAll(" ", "");
      state = newState("stroke");
      return;
    }
    const ct = theme.charts;
    const [key, val] = keyValue(line);
    const lower = val.toLowerCase();
    if (mode === "") {
      const format = VALUE_FORMATS.find((f) => f === split(val).join(" "));
      if (key === "enabled") ct.enabled = isYes(val);
      else if (key === "mode" && (lower === "bar" || lower === "line")) ct.mode = lower;
      else if (key === "bar thickness") ct.bar_thickness = num(val) ?? ct.bar_thickness;
      else if (key === "bar spacing") ct.bar_spacing = num(val) ?? ct.bar_spacing;
      else if (key === "bar width" && (lower === "fixed" || lower === "fill")) ct.bar_width = lower;
      else if (key === "negative color") ct.negative_color = hex(val) ?? ct.negative_color;
      else if (key === "percent scale" && (lower === "100" || lower === "peak"))
        ct.percent_scale = lower;
      else if (key === "value format" && format !== undefined) ct.value_format = format;
      else parseSectionLine(ct.bar, line, raw, state);
    } else if (mode === "charttrack") {
      if (key === "enabled") ct.track_enabled = isYes(val);
      else parseSectionLine(ct.track, line, raw, state);
    } else if (mode === "chartgrid") {
      chartGridLine(ct.grid, line, key, val);
    } else if (mode === "linechart") {
      lineChartLine(ct.line, key, val);
    } else if (mode === "chartseriescolors") {
      if (strip(raw).startsWith("- ")) {
        const c = hex(strip(strip(raw).slice(2)));
        if (c !== undefined) ct.series_colors.push(c);
      }
    } else if (mode === "chartlabels" || mode === "chartvalues") {
      const fb = fontBullet(line);
      if (fb !== undefined) {
        if (mode === "chartlabels") {
          ct.label_text ??= newTextStyle();
          setTextStyleField(ct.label_text, fb[0], fb[1]);
        } else {
          ct.value_text ??= newTextStyle();
          setTextStyleField(ct.value_text, fb[0], fb[1]);
        }
      }
    }
  };
}

/** One line of `### Chart Grid`. */
function chartGridLine(
  grid: Draft<ChartsTheme["grid"]>,
  line: string,
  key: string,
  val: string,
): void {
  const fb = fontBullet(line);
  if (fb !== undefined) {
    grid.text ??= newTextStyle();
    setTextStyleField(grid.text, fb[0], fb[1]);
  } else if (key === "axis labels") grid.axis_labels = isYes(val);
  else if (key === "ticks") {
    // md2ui's `int()` raises on an infinite or NaN count; here it is ignored.
    const n = num(val) ?? grid.ticks;
    if (Number.isFinite(n)) grid.ticks = pyMax(1, pyMin(20, Math.trunc(n)));
  } else if (key === "horizontal lines") grid.horizontal = isYes(val);
  else if (key === "vertical lines") grid.vertical = isYes(val);
  else if (key === "line color") grid.color = hex(val) ?? grid.color;
  else if (key === "line width") grid.width = pyMax(0, num(val) ?? grid.width);
  else if (key === "line dash") {
    const dash = split(val).map((d) => num(d) ?? 0);
    grid.dash = dash.length > 0 && dash.every((d) => d > 0) ? dash : [];
  }
}

/** One line of `### Line Chart`. */
function lineChartLine(lt: Draft<ChartsTheme["line"]>, key: string, val: string): void {
  const lower = val.toLowerCase();
  if (key === "enabled") lt.enabled = isYes(val);
  else if (key === "height") lt.height = pyMax(8, num(val) ?? lt.height);
  else if (key === "group height") lt.group_height = pyMax(8, num(val) ?? lt.height);
  else if (key === "line width") lt.width = pyMax(0.5, num(val) ?? lt.width);
  else if (key === "line color") lt.color = hex(val) ?? lt.color;
  else if (key === "point size") lt.point_size = pyMax(0, num(val) ?? lt.point_size);
  else if (key === "points" && (lower === "labelled" || lower === "last")) lt.points = lower;
}
