// `## Links`: the button variants (`### Primary` .. `### Septenary`, `### Text`), the `### Inline`
// block, and `Segmented`, the section's own key. Ported from md2ui's `_parse_link_style_line`, `_parse_inline_link_line` and
// the `links` branch of `parse_theme`.
import type { LinkStyle, ResolvedTheme } from "@md2ui/contracts";
import { pyMax } from "../group/py/math.ts";
import { strip } from "../group/py/str.ts";
import { parseLayeredLine } from "./background.ts";
import { type Draft, newPadding, takeOverLinks } from "./model.ts";
import {
  appendColorBullet,
  applyPadding,
  type BlockState,
  EMOJI_KEYS,
  hex,
  isYes,
  keyValue,
  newState,
  num,
  setEmojiKey,
  strokeAlign,
} from "./values.ts";

/**
 * One `key: value` line of a link variant, in place. Unset fields are materialized only
 * when a line states them, so a variant that sets one key keeps the others on their
 * Primary fallback. `state.sl` is the open `Fill color` / `Stroke color` bullet list.
 * Shared with the code blocks' `### Copy Button`.
 */
export function parseLinkStyleLine(
  ls: Draft<LinkStyle>,
  key: string,
  val: string,
  state: BlockState,
): void {
  if (key === "corner radius") {
    ls.corner_radius = num(val) ?? ls.corner_radius ?? 0;
  } else if (key.startsWith("padding")) {
    ls.padding ??= newPadding();
    applyPadding(ls.padding, key, val);
  } else if (
    key === "fill color" ||
    key === "fill colors" ||
    key === "background color" ||
    key === "background colors"
  ) {
    state.sl = "fill";
    const c = val.startsWith("#") ? hex(val) : undefined;
    if (c !== undefined) {
      ls.fill_colors.push(c);
      ls.fill_color = ls.fill_colors[0] ?? null;
    }
  } else if (key === "stroke width") {
    ls.stroke_width = num(val) ?? ls.stroke_width ?? 0;
  } else if (key === "stroke color" || key === "stroke colors") {
    state.sl = "stroke";
    const c = val.startsWith("#") ? hex(val) : undefined;
    if (c !== undefined) {
      ls.stroke_colors.push(c);
      ls.stroke_color = ls.stroke_colors[0] ?? null;
    }
  } else if (key === "stroke align" && strokeAlign(val) !== undefined) {
    ls.stroke_align = strokeAlign(val) ?? ls.stroke_align;
  } else if (key === "emoji shape") {
    const v = strip(val).toLowerCase();
    if (v === "circle" || v === "square") ls.emoji_shape = v;
  } else if (key === "disabled fill color") {
    ls.disabled_fill_color = hex(val) ?? ls.disabled_fill_color ?? 0;
  } else if (key === "disabled text color") {
    ls.disabled_text_color = hex(val) ?? ls.disabled_text_color ?? 0;
  } else if (key === "disabled stroke color") {
    ls.disabled_stroke_color = hex(val) ?? ls.disabled_stroke_color ?? 0;
  } else if (key === "emoji gap") {
    ls.emoji_gap = pyMax(0, num(val) ?? ls.emoji_gap ?? 0);
  } else if (EMOJI_KEYS.includes(key)) {
    setEmojiKey(ls, key, val);
  } else {
    state.sl = ""; // an unrecognised key ends the active bullet list
  }
}

/**
 * The buttons that inherit Primary, by wrapper: `*` `**` `***`, then the small `_` `__`
 * `___`. Text is not one of them: it inherits nothing.
 */
export const LINK_BUTTON_VARIANTS = Object.freeze([
  "secondary",
  "tertiary",
  "quaternary",
  "quinary",
  "senary",
  "septenary",
] as const);
type LinkButtonVariant = (typeof LINK_BUTTON_VARIANTS)[number];

/** Whether *name* is a button that inherits Primary. */
export function isLinkButtonVariant(name: string): name is LinkButtonVariant {
  return (LINK_BUTTON_VARIANTS as readonly string[]).includes(name);
}

/** `## Links`. */
export function linksSection(theme: Draft<ResolvedTheme>): (line: string, raw: string) => void {
  takeOverLinks(theme.links); // before its target: Primary is replaced
  let target = theme.links.primary;
  let inline = false;
  let state = newState();
  return (line, raw) => {
    if (line.startsWith("### ")) {
      const sub = strip(line.slice(4)).toLowerCase();
      inline = sub === "inline";
      // Any other name (Primary, or one md2ui does not know) configures Primary.
      target = isLinkButtonVariant(sub) || sub === "text" ? theme.links[sub] : theme.links.primary;
      state = newState();
      return;
    }
    if (!inline && parseLayeredLine(target, line, raw, state)) return;
    if (line.startsWith("- ")) {
      // The list form of Fill/Stroke colour; text style lives in `## Text Styles`.
      if (!inline) {
        appendColorBullet(line, state, { fill: target.fill_colors, stroke: target.stroke_colors });
        if (target.fill_colors.length > 0) target.fill_color = target.fill_colors[0] ?? null;
        if (target.stroke_colors.length > 0) target.stroke_color = target.stroke_colors[0] ?? null;
      }
    } else if (line.includes(":")) {
      const [key, val] = keyValue(line);
      if (key === "segmented") {
        theme.links.segmented = isYes(val); // the section's, from any of its blocks
      } else if (inline) {
        // `### Inline` takes only these two keys.
        const ils = theme.links.inline;
        if (key === "text color") ils.text_color = hex(val) ?? ils.text_color ?? 0;
        else if (key === "underline") ils.underline = isYes(val);
      } else {
        parseLinkStyleLine(target, key, val, state);
      }
    }
  };
}
