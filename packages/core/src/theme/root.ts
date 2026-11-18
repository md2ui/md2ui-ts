// `## Root` (and `### Root` under `## Styling & Spacing`): the page background, the
// content box and the cascade's base values. Ported from md2ui's `_parse_root_line`.
import type { ResolvedTheme } from "@md2ui/contracts";
import { pyMax } from "../group/py/math.ts";
import { partition, strip } from "../group/py/str.ts";
import { gradientBullet } from "./background.ts";
import { CONTENT_WIDTH_MIN, type Draft, newGradient } from "./model.ts";
import {
  applyPadding,
  applySpacer,
  type BlockState,
  HORIZONTAL_ALIGN_KEYS,
  hex,
  horizontalAlign,
  isYes,
  keyValue,
  lineAlign,
  newState,
  num,
  openShadow,
  orphanRow,
  shadowBullet,
  shadowKey,
  spacing,
  VERTICAL_ALIGN_KEYS,
  yesNo,
} from "./values.ts";

/** One root line. `state.gl` is the open gradient list, `state.sh` the open shadow. */
export function parseRootLine(
  theme: Draft<ResolvedTheme>,
  line: string,
  raw: string,
  state: BlockState,
): void {
  const c = theme.root;
  if (state.sh !== null && raw.startsWith("- ")) {
    shadowBullet(state.sh, strip(raw.slice(2)));
    return;
  }
  if (raw.startsWith("  - ") && c.gradient !== null) {
    gradientBullet(c.gradient, strip(raw.slice(4)), state.gl);
    return;
  }
  if (raw.startsWith("- ") && c.gradient !== null) {
    const sub = strip(raw.slice(2)).replace(/:+$/, "");
    const key = sub.toLowerCase();
    if (key === "ratios" || key === "colors" || key === "parameters") {
      state.gl = key;
    } else if (key.startsWith("type")) {
      const [, found, rest] = partition(sub, ":");
      if (found) c.gradient.type = strip(rest).toLowerCase();
    }
    return;
  }
  if (!line.includes(":") || line.startsWith("- ")) return;
  const [key, val] = keyValue(line);
  state.sh = null;
  const inner = shadowKey(key);
  const element = spacing(key, val);
  if (inner !== undefined) {
    state.sh = openShadow(c.shadows, inner);
    state.gl = "";
  } else if (key === "background color") {
    c.bg_color = hex(val) ?? c.bg_color;
  } else if (key === "background image") {
    if (val !== "" && !val.startsWith("(")) c.bg_image = val;
  } else if (key === "background gradient") {
    c.gradient = newGradient();
    state.gl = "";
  } else if (key === "box") {
    c.box = isYes(val);
  } else if (key === "box fill color") {
    c.box_fill_color = hex(val) ?? c.box_fill_color;
  } else if (key === "box radius") {
    c.box_radius = num(val) ?? c.box_radius;
  } else if (HORIZONTAL_ALIGN_KEYS.includes(key)) {
    // Root is the base of the cascade: an unset value is its own default.
    c.align = horizontalAlign(val) ?? "left";
  } else if (VERTICAL_ALIGN_KEYS.includes(key)) {
    c.line_align = lineAlign(val) ?? "baseline";
  } else if (key === "orphan row") {
    c.orphan_row = orphanRow(val) ?? "left";
  } else if (key === "max width") {
    c.max_width = pyMax(CONTENT_WIDTH_MIN, num(val) ?? c.max_width);
  } else if (key === "centered") {
    c.centered = yesNo(val, c.centered);
  } else if (key === "stack sections") {
    c.pack_unique = yesNo(val, c.pack_unique);
  } else if (key === "layout") {
    const layout = val.toLowerCase();
    c.layout = layout === "bento" || layout === "auto" ? layout : "default";
  } else if (applySpacer(c.spacers, key, val)) {
    // Applied.
  } else if (key === "element space" || key === "element spacing") {
    const sp = num(val) ?? theme.elements.row_spacing ?? 0;
    theme.elements.row_spacing = sp;
    theme.elements.col_spacing = sp;
  } else if (key === "element row space") {
    theme.elements.row_spacing = num(val) ?? theme.elements.row_spacing ?? 0;
  } else if (key === "element col space") {
    theme.elements.col_spacing = num(val) ?? theme.elements.col_spacing ?? 0;
  } else if (applyPadding(c.padding, key, val)) {
    // Applied.
  } else if (element !== undefined) {
    const [axis, v] = element;
    if (axis !== "col") c.row_spacing = v;
    if (axis !== "row") c.col_spacing = v;
  }
}

/** `## Root`. */
export function rootSection(theme: Draft<ResolvedTheme>): (line: string, raw: string) => void {
  const state = newState();
  return (line, raw) => parseRootLine(theme, line, raw, state);
}
