// Ports the `## Drawing elements` / `## Datapoints` block of md2ui's `parse_theme` (`pipeline/theme.py`).
import type { ResolvedTheme } from "@md2ui/contracts";
import { pyMax } from "../group/py/math.ts";
import { strip } from "../group/py/str.ts";
import { parseSectionLine } from "./background.ts";
import { type Draft, newTextStyle } from "./model.ts";
import { fontBullet, setTextStyleField } from "./text-styles.ts";
import { hex, isYes, keyValue, newState, num } from "./values.ts";

/** `## Drawing elements` (legacy `## Datapoints`). */
export function datapointsSection(
  theme: Draft<ResolvedTheme>,
): (line: string, raw: string) => void {
  let mode = "";
  let state = newState("stroke");
  return (line, raw) => {
    if (line.startsWith("### ")) {
      mode = strip(line.slice(4)).toLowerCase().replaceAll(" ", "");
      state = newState("stroke");
      return;
    }
    const dp = theme.datapoints;
    const [key, val] = keyValue(line);
    const lower = val.toLowerCase();
    const style = (st: Parameters<typeof parseSectionLine>[0]): void =>
      parseSectionLine(st, line, raw, state);

    const controls = dp.task_controls;
    const sliders = dp.sliders;
    const bar =
      mode === "ratiobars" ? dp.ratio_bar : mode === "keyvaluebars" ? dp.kv_bar : undefined;
    if (mode === "taskcontrols") {
      if (key === "enabled") controls.enabled = isYes(val);
      else if (key === "type" && (lower === "checkbox" || lower === "switch"))
        controls.type = lower;
      else if (key === "size") controls.size = num(val) ?? controls.size ?? 0;
      else if (key === "padding") controls.padding = pyMax(0, num(val) ?? controls.padding);
      else if (key === "corner radius") controls.corner_radius = pyMax(0, num(val) ?? 0);
      else if (key === "space") controls.space = pyMax(0, num(val) ?? controls.space);
    } else if (
      (mode === "checkedinner" || mode === "uncheckedinner") &&
      (key === "symbol" || key === "symbol color")
    ) {
      // A glyph in the state's inner shape; an empty `Symbol:` clears it, and a colour
      // that does not read leaves the field as it was.
      const which = mode === "checkedinner" ? "checked" : "unchecked";
      if (key === "symbol") controls[`${which}_symbol`] = val || null;
      else {
        const color = hex(val);
        if (color !== undefined) controls[`${which}_symbol_color`] = color;
      }
    } else if (mode === "checkedouter") {
      style(controls.checked_outer);
    } else if (mode === "checkedinner") {
      style(controls.checked_inner);
    } else if (mode === "uncheckedouter") {
      style(controls.unchecked_outer);
    } else if (mode === "uncheckedinner") {
      style(controls.unchecked_inner);
    } else if (mode === "sliders") {
      if (key === "enabled") sliders.enabled = isYes(val);
      else if (key === "style" && (lower === "thick" || lower === "line")) sliders.style = lower;
      else if (key === "axis" && (lower === "horizontal" || lower === "vertical"))
        sliders.axis = lower;
      else if (key === "length") sliders.length = pyMax(1, num(val) ?? sliders.length);
      else if (key === "thickness") sliders.thickness = pyMax(1, num(val) ?? 1);
      else if (key === "corner radius") sliders.corner_radius = pyMax(0, num(val) ?? 0);
      else if (key === "circle diameter")
        sliders.circle_diameter = pyMax(1, num(val) ?? sliders.circle_diameter);
      else if (key === "drag bar length")
        sliders.drag_bar_length = pyMax(1, num(val) ?? sliders.drag_bar_length);
      else if (key === "bar thickness" || key === "drag bar thickness")
        sliders.drag_bar_thickness = pyMax(1, num(val) ?? sliders.drag_bar_thickness);
      else if (key === "drag bar gap")
        sliders.drag_bar_gap = pyMax(0, num(val) ?? sliders.drag_bar_gap);
    } else if (mode === "countbutton" && key === "symbol color") {
      // A colour that does not read leaves the field as it was.
      const color = hex(val);
      if (color !== undefined) dp.counts.symbol_color = color;
    } else if (
      (mode === "sliderbar" ||
        mode === "slidertrack" ||
        mode === "sliderhandle" ||
        mode === "countbutton") &&
      key !== "padding"
    ) {
      style(
        mode === "sliderbar"
          ? sliders.bar
          : mode === "slidertrack"
            ? sliders.track
            : mode === "sliderhandle"
              ? sliders.handle
              : dp.counts.button,
      );
    } else if (bar !== undefined) {
      if (key === "enabled") bar.enabled = isYes(val);
      else if (key === "thickness") bar.thickness = num(val) ?? bar.thickness;
      else if (key === "position" && (lower === "above" || lower === "below")) bar.position = lower;
      else if (key === "text side" && (lower === "left" || lower === "right"))
        bar.text_side = lower;
      else if (key === "show key" && mode === "keyvaluebars") bar.show_key = isYes(val);
      else if (key === "show value" && mode === "keyvaluebars") bar.show_value = isYes(val);
      else if (key === "negative color") bar.negative_color = hex(val) ?? bar.negative_color;
      else style(bar.bar);
    } else if (mode === "ratiobartrack" || mode === "keyvaluebartrack" || mode === "ringtrack") {
      const owner =
        mode === "ratiobartrack"
          ? dp.ratio_bar
          : mode === "keyvaluebartrack"
            ? dp.kv_bar
            : undefined;
      if (key === "enabled" && owner !== undefined) owner.track_enabled = isYes(val);
      else style(owner === undefined ? dp.ring.track : owner.track);
    } else if (mode === "unitratios") {
      if (key === "enabled") dp.unit_ratio_enabled = isYes(val);
      else if (key === "style" && (lower === "bar" || lower === "ring"))
        dp.unit_ratio_style = lower;
      else if (key === "show total") dp.unit_ratio_show_total = isYes(val);
      else if (key === "show key") dp.unit_ratio_show_key = isYes(val);
    } else if (mode === "ring") {
      const fb = fontBullet(line);
      if (fb !== undefined) {
        dp.ring.value_text ??= newTextStyle();
        setTextStyleField(dp.ring.value_text, fb[0], fb[1]);
      } else if (key === "thickness") dp.ring.thickness = num(val) ?? dp.ring.thickness;
      else if (key === "diameter") dp.ring.diameter = num(val) ?? dp.ring.diameter;
      else if (key === "spacing") dp.ring.spacing = num(val) ?? dp.ring.spacing;
      else style(dp.ring.ring);
    } else if (mode === "ringunit") {
      const fb = fontBullet(line);
      if (fb !== undefined) {
        dp.ring.unit_text ??= newTextStyle();
        setTextStyleField(dp.ring.unit_text, fb[0], fb[1]);
      }
    } else if (mode === "dates") {
      if (key === "enabled") dp.date_chip.enabled = isYes(val);
      else if (key === "fill" && (lower === "single" || lower === "split"))
        dp.date_chip.fill = lower;
      else if (key === "spacing") dp.date_chip.spacing = num(val) ?? dp.date_chip.spacing;
      else style(dp.date_chip.chip);
    } else if (mode === "datekey" || mode === "dateday") {
      const isKey = mode === "datekey";
      const fb = fontBullet(line);
      if (fb !== undefined) {
        if (isKey) {
          dp.date_chip.key_text ??= newTextStyle();
          setTextStyleField(dp.date_chip.key_text, fb[0], fb[1]);
        } else {
          dp.date_chip.day_text ??= newTextStyle();
          setTextStyleField(dp.date_chip.day_text, fb[0], fb[1]);
        }
      } else {
        style(isKey ? dp.date_chip.key_bg : dp.date_chip.day_bg);
      }
    }
  };
}
