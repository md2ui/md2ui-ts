// One placed box's paint (md2ui `layout_render.draw_content_box`): a synthetic box draws
// from its render hints (a gutter marker, a separator, a table key, a datapoint display);
// a node's box draws by its type; and a text leaf resolves the faces, size and colour its
// role gives it (a heading, a table cell, a tier, a K-V side, a date chip) before its
// lines are drawn.
import type { Argb, HeadingLevel, ResolvedTheme } from "@md2ui/contracts";
import { isCount } from "../../measure/drawing.ts";
import {
  effectiveLeafNode,
  hint,
  type Props,
  resolveHAlign,
  weightScale,
} from "../../measure/leaf-kit.ts";
import type { SizedNode } from "../../measure/node-index.ts";
import { ringText } from "../../measure/ring-text.ts";
import { tableKeyFonts } from "../../measure/tables.ts";
import { applyDateRole, applyKvRole, effectiveTextFonts } from "../../measure/text-fonts.ts";
import { dateChipTextStyle, scopedTextStyle, tableTextStyle } from "../../measure/theme-styles.ts";
import { argb } from "../../theme/model.ts";
import { rotateColor } from "../../theme/query.ts";
import { opaque, pushBg, replaceColor } from "../backgrounds.ts";
import type { LayoutBox } from "../boxes.ts";
import { drawChart } from "./charts.ts";
import { drawCodeBlock } from "./code-blocks.ts";
import { rotationSlot } from "./colors.ts";
import type { BoxDrawer, Draw } from "./context.ts";
import { drawSlider, drawTaskControl } from "./controls.ts";
import { drawCount } from "./counts.ts";
import { drawBar } from "./datapoints.ts";
import { drawImage } from "./images.ts";
import { drawLineChart } from "./line-charts.ts";
import { drawChip, drawEmoji, drawLink } from "./links.ts";
import { drawListMarker, drawRule, drawSeparator } from "./marks.ts";
import { mutedControl } from "./muted-controls.ts";
import type { Pen } from "./pen.ts";
import { styledText } from "./text.ts";

// md2ui `layout_render.HEADING_COLORS`: a heading's colour when the theme names no style.
const HEADING_COLORS: Readonly<Record<number, Argb>> = Object.freeze({
  1: argb(255, 10, 10, 10),
  2: argb(255, 25, 25, 25),
  3: argb(255, 40, 40, 40),
  4: argb(255, 55, 55, 55),
  5: argb(255, 70, 70, 70),
  6: argb(255, 85, 85, 85),
});

/** md2ui `_heading_level`: the trailing number of a heading type, clamped to 1–6. */
function headingLevel(type: string): number {
  const m = /(\d+)$/.exec(type);
  return m === null ? 1 : Math.max(1, Math.min(6, Number(m[1])));
}

/** md2ui `_weight_scale_and_color`'s colour: `less` mutes, unless an authored tier decided. */
function weightColor(theme: ResolvedTheme, weight: unknown, base: Argb, tier: string | null): Argb {
  return !tier && weight === "less" ? theme.content_weight.less_color : base;
}

/** A heading level's colour, its rotation slot applied (the title took its section's slot). */
function headingColor(d: Draw, level: number, box: LayoutBox): Argb {
  const { theme } = d.sizer;
  const ts = theme.headings[level as HeadingLevel];
  const base = ts?.color ?? (HEADING_COLORS[level] as Argb);
  const node = box.content_id === null ? undefined : d.nodes.get(box.content_id);
  if (ts === undefined || ts.colors.length === 0 || node === undefined) return base;
  const { index, chain } = rotationSlot(node, theme);
  return rotateColor(ts.colors, ts.color, index, theme, "heading", chain) ?? base;
}

/** md2ui `_marker_style`: the block whose `Marker …` keys paint this leaf's inline code. */
function markerStyle(d: Draw, nd: SizedNode, level: number, box: LayoutBox) {
  const { theme } = d.sizer;
  const scopes = nd.text_style_chain;
  let ts =
    nd.table_role && !level
      ? tableTextStyle(theme, nd.table_role)
      : level
        ? (theme.headings[level as HeadingLevel] ?? null)
        : nd.text_style
          ? scopedTextStyle(theme, nd.text_style, scopes)
          : nd.type === "key"
            ? scopedTextStyle(theme, "key", scopes)
            : scopedTextStyle(theme, "text", scopes);
  if (ts === null || (ts.marker_text_color === null && ts.marker_bg_color === null)) {
    ts = scopedTextStyle(theme, "text", scopes);
  }
  // md2ui `_rotated_marker`: a marker cycles on the chip channel.
  const node = box.content_id === null ? undefined : d.nodes.get(box.content_id);
  if (
    node === undefined ||
    (ts.marker_text_colors.length === 0 && ts.marker_bg_colors.length === 0)
  ) {
    return ts;
  }
  const { index, chain } = rotationSlot(node, theme);
  return {
    ...ts,
    marker_text_color: rotateColor(
      ts.marker_text_colors,
      ts.marker_text_color,
      index,
      theme,
      "chip",
      chain,
    ),
    marker_bg_color: rotateColor(
      ts.marker_bg_colors,
      ts.marker_bg_color,
      index,
      theme,
      "chip",
      chain,
    ),
  };
}

/** md2ui `_pin_only_emoji_style`: `## Fixed colors` emoji pins with no other styling. */
function pinsOnly(theme: ResolvedTheme) {
  const pins = theme.emojis.text.fixed_colors;
  return Object.keys(pins).length === 0
    ? null
    : { color: null, font_path: null, fixed_colors: pins };
}

/**
 * md2ui `_date_chip_text_bg_stack`: a split date chip's key or day text sits on its own
 * region's fill.
 */
function dateTextBg(rp: Props | null, box: LayoutBox, theme: ResolvedTheme): LayoutBox {
  const role = hint(rp, "date_role");
  const dc = theme.datapoints.date_chip;
  if (!role || dc.fill !== "split") return box;
  const style = role === "key" ? dc.key_bg : dc.day_bg;
  const first = style.bg_colors[0];
  if (first === undefined) return box;
  const color = replaceColor(first, box.bg_stack, theme, "fill");
  return { ...box, bg_stack: pushBg(box.bg_stack, opaque(color)) };
}

const NO_TEXT_OPTIONS = { emoji: null, marker: null, pins: undefined } as const;

/**
 * A ring's value or unit, centred in the ring, drawn as the ring's text plan laid it out:
 * the value scaled to fit, the label wrapped to the clear inside.
 */
function ringLabel(d: Draw, box: LayoutBox, rp: Props, role: string, p: Pen): void {
  const { theme, leaves } = d.sizer;
  const ring = ringText(theme, leaves.text, leaves.fonts, role, String(rp["ring_text"] ?? ""));
  const sized = { faces: ring.faces, size: ring.size, emoji: leaves.fonts.emoji };
  styledText(d, p, box, ring.text, sized, ring.color, "center", NO_TEXT_OPTIONS);
}

/** The drawer of a synthetic box: one drawn from its render hints, with no node behind it. */
function syntheticDrawer(rp: Props | null): BoxDrawer | null {
  if (hint(rp, "list_marker") !== null) return drawListMarker;
  if (hint(rp, "separator") !== null) return drawSeparator;
  const tk = hint(rp, "table_key") as Props | null;
  if (tk !== null) {
    return (d, box, p) => {
      const key = tableKeyFonts(d.sizer);
      const text = String(tk["text"] ?? "");
      // md2ui `_table_key_fonts`: the default emoji face.
      const sized = { faces: key.faces, size: key.size, emoji: d.sizer.leaves.fonts.emoji };
      styledText(d, p, box, text, sized, key.color, "left", NO_TEXT_OPTIONS);
    };
  }
  if (hint(rp, "datapoint_bar") !== null) return drawBar;
  const ring = hint(rp, "ring_role");
  if (ring !== null) return (d, box, p) => ringLabel(d, box, rp as Props, String(ring), p);
  if (hint(rp, "chart") !== null) return drawChart;
  if (hint(rp, "line_chart") !== null) return drawLineChart;
  return null;
}

/** The drawer of a leaf that is not text, by its type; `null` for text. */
function elementDrawer(d: Draw, nd: SizedNode): BoxDrawer | null {
  const { theme } = d.sizer;
  switch (nd.type) {
    case "link":
      return drawLink;
    case "drawing_element":
      // A count is a slider drawn as digits between two buttons, or not at all. A control
      // written `~~` is drawn faded whole.
      if (isCount(nd.drawing_element))
        return theme.datapoints.sliders.enabled ? mutedControl(nd, drawCount) : () => {};
      if (nd.drawing_element?.["kind"] === "slider" && theme.datapoints.sliders.enabled) {
        return mutedControl(nd, drawSlider);
      }
      return theme.datapoints.task_controls.enabled ? mutedControl(nd, drawTaskControl) : null;
    case "emoji":
      return drawEmoji;
    case "inline_code":
      return drawChip;
    case "code_block":
      return drawCodeBlock;
    case "horizontal_rule":
      return drawRule;
    case "content_break":
    case "spacer":
      // A lone `_` and a `+++` spacer hold their place and paint nothing.
      return () => {};
    case "image":
      return drawImage;
    default:
      return null;
  }
}

/**
 * md2ui `_prose_text_is_styled`: whether a style more specific than body Text set a prose
 * leaf's colour, in the order `drawTextLeaf` resolves it: a heading, then a table role or
 * else a tier or the key style, then the muted weight, a K-V role and a date-chip role.
 * A section-scoped `Text` is still body text; a `## Fixed colors` pin is `styledText`'s
 * to add.
 */
function proseTextIsStyled(
  nd: SizedNode,
  weight: unknown,
  kvRole: string | null,
  dateRole: string | null,
  theme: ResolvedTheme,
): boolean {
  if (nd.heading_ctx) return true;
  if (nd.table_role) {
    if (tableTextStyle(theme, nd.table_role) !== null) return true;
  } else if (nd.text_style || nd.type === "key") {
    return true;
  }
  return Boolean((weight === "less" && !nd.text_style) || (kvRole && !nd.text_style) || dateRole);
}

/** A text leaf: its role's faces, size and colour, then its lines. */
function drawTextLeaf(d: Draw, box: LayoutBox, nd: SizedNode, p: Pen): void {
  const { theme, leaves } = d.sizer;
  const { fonts } = leaves;
  const rp = box.render_properties;
  const align = resolveHAlign(rp, theme);
  const weight = hint(rp, "content_weight");
  const pins = d.pins.get(nd.node_id);
  const type = nd.type;
  if (type === "bullet_point") {
    // A bullet keeps its own emoji face and text colour; only the pins reach it.
    const opts = { emoji: pinsOnly(theme), marker: null, pins: undefined };
    const sized = { faces: fonts, size: theme.text.font_size, emoji: fonts.emoji };
    styledText(d, p, box, "•", sized, theme.text.color, align, opts);
    return;
  }
  if (nd.atx_level !== 0 || type.startsWith("heading")) {
    const level = nd.atx_level || headingLevel(type);
    const sized = effectiveTextFonts(type, nd.atx_level, fonts, theme, nd);
    const scaled = { ...sized, size: sized.size * weightScale(theme, weight, null) };
    const color = weightColor(theme, weight, headingColor(d, level, box), null);
    const opts = { emoji: pinsOnly(theme), marker: markerStyle(d, nd, level, box), pins };
    styledText(d, p, box, nd.content, scaled, color, align, opts);
    return;
  }
  // A table cell takes its table style, a piece of a heading line that heading's, an
  // authored tier its tier's, a display pair's key the `Key` style's, anything else the body's.
  const scopes = nd.text_style_chain;
  let base = scopedTextStyle(theme, "text", scopes).color;
  if (nd.heading_ctx) base = headingColor(d, nd.heading_ctx, box);
  const table = nd.table_role ? tableTextStyle(theme, nd.table_role) : null;
  if (table !== null) base = table.color;
  else if (!nd.table_role && nd.text_style) {
    base = scopedTextStyle(theme, nd.text_style, scopes).color;
  } else if (!nd.table_role && type === "key") {
    base = scopedTextStyle(theme, "key", scopes).color;
  }
  let color = weightColor(theme, weight, base, nd.text_style);
  let sized = effectiveTextFonts(type, nd.atx_level, fonts, theme, nd);
  sized = { ...sized, size: sized.size * weightScale(theme, weight, nd.text_style) };
  const kvRole = hint(rp, "kv_role") as string | null;
  sized = applyKvRole(kvRole, sized, theme, fonts, nd);
  if (kvRole && !nd.heading_ctx && !nd.text_style) {
    color = scopedTextStyle(theme, kvRole, scopes).color;
  }
  const dateRole = hint(rp, "date_role") as string | null;
  sized = applyDateRole(dateRole, sized, theme, fonts);
  if (dateRole) color = dateChipTextStyle(theme, dateRole).color;
  const content = dateRole === "key" ? nd.content.toUpperCase() : nd.content;
  const opts = {
    emoji: theme.emojis.text,
    marker: markerStyle(d, nd, nd.heading_ctx, box),
    pins,
    styled: proseTextIsStyled(nd, weight, kvRole, dateRole, theme),
  };
  styledText(d, p, box, content, sized, color, dateRole ? "center" : align, opts);
}

/** md2ui `draw_content_box`: one placed box. */
export function drawBox(d: Draw, placed: LayoutBox, p: Pen): void {
  const rp = placed.render_properties;
  const box = dateTextBg(rp, placed, d.sizer.theme);
  const synthetic = syntheticDrawer(rp);
  if (synthetic !== null) {
    synthetic(d, box, p);
    return;
  }
  const sized = box.content_id === null ? null : (d.sized.get(box.content_id) ?? null);
  const nd = effectiveLeafNode(sized, rp);
  if (nd === null) return;
  const element = elementDrawer(d, nd);
  if (element !== null) element(d, box, p);
  else drawTextLeaf(d, box, nd, p);
}
