// Background-level markers as renderer-ready properties: md2ui's `generator_markers.py`.
// The generator picks the marker a list item, task or quote owns and bakes it, with the
// item's rotation slot applied, into the plain `list_marker` properties the renderer
// paints. Functions take the few fields md2ui reads off the grouper node, by its names,
// so nothing here depends on the grouper's node type.
import type {
  BulletedListStyle,
  HeadingLevel,
  MarkerStyle,
  NumberedListStyle,
  QuoteStyle,
  ResolvedTheme,
} from "@md2ui/contracts";
import {
  bulletedListIsActive,
  numberedListIsActive,
  quoteIsActive,
  quoteIsBar,
  type RotationChain,
  rotateColor,
  syncedSlot,
} from "../theme/query.ts";

const isBulletType = (type: string): boolean =>
  type === "list_item" || type === "task_open" || type === "task_done";

/** md2ui's `NumberedListStyle()` default: a numbered marker nothing configured (inactive). */
const UNCONFIGURED_NUMBERED: NumberedListStyle = Object.freeze({
  text_style: null,
  number_format: "{n}",
  space: 10,
  aside: true,
  alignment: "top",
});

const isBullet = (m: MarkerStyle | null | undefined): m is BulletedListStyle =>
  m != null && "shape" in m;
const isNumbered = (m: MarkerStyle | null | undefined): m is NumberedListStyle =>
  m != null && "number_format" in m;
const isQuote = (m: MarkerStyle | null | undefined): m is QuoteStyle =>
  m != null && "bar_width" in m;

/**
 * md2ui `numbered_style`: the marker an ordered item takes from the background level that
 * owns its list (`list_heading_level`), or from `## Numbered Lists` when no heading does.
 * A level with no numbered marker gives the unconfigured default.
 */
export function numberedStyle(
  listHeadingLevel: number | null,
  theme: ResolvedTheme,
): NumberedListStyle {
  const style =
    listHeadingLevel !== null
      ? theme.sections[listHeadingLevel as HeadingLevel]
      : theme.numbered_lists;
  const marker = style?.marker;
  return isNumbered(marker) ? marker : UNCONFIGURED_NUMBERED;
}

/**
 * md2ui `bullet_style`: the bullet marker of a list item or task. A task whose own marker
 * is inactive borrows the unordered list's.
 */
export function bulletStyle(type: string, theme: ResolvedTheme): BulletedListStyle | null {
  if (type === "list_item") {
    const marker = theme.unordered_lists.marker;
    return isBullet(marker) ? marker : null;
  }
  if (type === "task_open" || type === "task_done") {
    let marker = theme.task_lists.marker;
    if (!isBullet(marker) || !bulletedListIsActive(marker)) marker = theme.unordered_lists.marker;
    return isBullet(marker) ? marker : null;
  }
  return null;
}

/** md2ui `quote_style`: the blockquote marker, when `## Quotes` has one. */
export function quoteStyle(theme: ResolvedTheme): QuoteStyle | null {
  const marker = theme.quotes.marker;
  return isQuote(marker) ? marker : null;
}

/** md2ui `marker_style`: the marker an item of `type` owns; `null` for types with none. */
export function markerStyle(
  item: { type: string; list_heading_level: number | null },
  theme: ResolvedTheme,
): MarkerStyle | null {
  if (isBulletType(item.type)) return bulletStyle(item.type, theme);
  if (item.type === "ordered_item") return numberedStyle(item.list_heading_level, theme);
  if (item.type === "blockquote") return quoteStyle(theme);
  return null;
}

/**
 * md2ui `marker_gutter_x`: the width an active aside marker reserves beside the item,
 * its glyph and its gap; 0 with no theme, no marker, an inactive one, or one stacked above.
 */
export function markerGutterX(
  item: { type: string; list_heading_level: number | null },
  theme: ResolvedTheme | null,
): number {
  if (theme === null) return 0;
  const marker = markerStyle(item, theme);
  if (marker === null) return 0;
  const active = isBullet(marker)
    ? bulletedListIsActive(marker)
    : isNumbered(marker)
      ? numberedListIsActive(marker)
      : quoteIsActive(marker);
  if (!active || !marker.aside) return 0;
  if (isBullet(marker)) return marker.size + marker.space;
  if (isNumbered(marker)) {
    return marker.text_style !== null ? marker.text_style.font_size + marker.space : 0;
  }
  const size = quoteIsBar(marker) ? marker.bar_width : marker.char_text_style.font_size;
  return size + marker.space;
}

/**
 * Python's `template.format(n=n)` for the templates THEME.md can produce: text around one
 * `{n}`, where the parser keeps the author's characters verbatim. `{{` and `}}` are
 * literal braces, as in Python; any other brace (a field with a conversion or format
 * spec, an unmatched one) is Python's `ValueError`/`KeyError` and throws here. Format
 * specs such as `{n:03}` are not supported, because the parser cannot write one.
 */
function formatNumber(template: string, n: number): string {
  let out = "";
  for (let i = 0; i < template.length; i++) {
    const ch = template.charAt(i);
    if (ch === "{") {
      if (template.charAt(i + 1) === "{") {
        out += "{";
        i++;
      } else if (template.startsWith("{n}", i)) {
        out += String(n);
        i += 2;
      } else {
        throw new Error(`number format ${JSON.stringify(template)}: unsupported replacement field`);
      }
    } else if (ch === "}") {
      if (template.charAt(i + 1) !== "}") {
        throw new Error(`number format ${JSON.stringify(template)}: single '}' in format string`);
      }
      out += "}";
      i++;
    } else {
      out += ch;
    }
  }
  return out;
}

/** What `buildMarkerProps` reads off the item: md2ui's field names on the grouper node. */
export interface MarkerItem {
  type: string;
  list_heading_level: number | null;
  list_ordinal: number | null;
  rotation_index: number;
  rotation_chain: RotationChain;
  rotation_path: readonly number[];
}

/**
 * md2ui `build_marker_props`: the active marker of `item` as the plain `list_marker`
 * render properties (exact keys, in md2ui's order), its colour rotated to the item's
 * slot; `null` when the item owns no marker or the marker is inactive.
 */
export function buildMarkerProps(
  item: MarkerItem,
  theme: ResolvedTheme,
): Record<string, unknown> | null {
  const slot = syncedSlot(item.rotation_index, item.rotation_chain, item.rotation_path, theme);
  const markerColor = (colors: readonly number[], fallback: number | null): number | null =>
    rotateColor(colors, fallback, slot, theme, "background", item.rotation_chain);

  if (isBulletType(item.type)) {
    const marker = bulletStyle(item.type, theme);
    if (marker === null || !bulletedListIsActive(marker)) return null;
    return {
      kind: "bullet",
      shape: marker.shape,
      size: marker.size,
      color: markerColor(marker.colors, marker.color),
      emoji: marker.emoji,
      space: marker.space,
      aside: marker.aside,
      alignment: marker.alignment,
    };
  }
  if (item.type === "ordered_item") {
    const marker = numberedStyle(item.list_heading_level, theme);
    const ts = marker.text_style;
    if (ts === null) return null;
    return {
      kind: "number",
      text: formatNumber(marker.number_format, item.list_ordinal || 1),
      font_name: ts.font_name,
      font_size: ts.font_size,
      font_weight: ts.font_weight,
      color: markerColor(ts.colors, ts.color),
      size: ts.font_size,
      space: marker.space,
      aside: marker.aside,
      alignment: marker.alignment,
    };
  }
  if (item.type === "blockquote") {
    const marker = quoteStyle(theme);
    if (marker === null || !quoteIsActive(marker)) return null;
    if (quoteIsBar(marker)) {
      return {
        kind: "quote",
        mode: "bar",
        bar_width: marker.bar_width,
        bar_length: marker.bar_length,
        color: markerColor(marker.bar_colors, marker.bar_color),
        size: marker.bar_width,
        space: marker.space,
        aside: marker.aside,
        alignment: marker.alignment,
      };
    }
    const ts = marker.char_text_style;
    return {
      kind: "quote",
      mode: "char",
      text: marker.quote_char,
      font_name: ts.font_name,
      font_size: ts.font_size,
      font_weight: ts.font_weight,
      color: markerColor(ts.colors, ts.color),
      size: ts.font_size,
      space: marker.space,
      aside: marker.aside,
      alignment: marker.alignment,
    };
  }
  return null;
}
