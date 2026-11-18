// Every section background, in placement order (md2ui `draw_document`'s section pass):
// a heading section, a list or quote surface, a card, a table's shell and rows, a date
// chip, a ring. Each paints its layered fill now and queues its stroke for after the
// content. A colour cycles by the box's own rotation slot; a box with no node behind it
// (a table row) keeps md2ui's positional counter, per kind and level.
import type { Argb, HeadingLevel, ResolvedTheme, SectionStyle } from "@md2ui/contracts";
import { filled } from "../../measure/layers.ts";
import { rotateColor, sectionIsActive, syncedSlot } from "../../theme/query.ts";
import { paintStyleFor, tableBackgroundColor } from "../backgrounds.ts";
import type { SectionBox } from "../boxes.ts";
import type { Draw } from "./context.ts";
import { drawDateChip, drawRingArc } from "./datapoints.ts";
import { type ImageLayer, type StrokeQueue, sectionBackground } from "./fills.ts";
import type { Pen } from "./pen.ts";

/**
 * md2ui `_paint_style_for`'s image key, as the URL it decoded: the style's own image; a
 * fixed style that states none paints its level's.
 */
function themeImage(sbox: SectionBox, st: SectionStyle, theme: ResolvedTheme): string | null {
  const key = sbox.fixed_style_key;
  const own = key ? theme.fixed_sections[key] : undefined;
  if (own === undefined) return st.bg_image;
  if (filled(own.bg_image) || !filled(st.bg_image)) return own.bg_image;
  return theme.sections[sbox.level as HeadingLevel]?.bg_image ?? null;
}

/** An image card's photo wins, the theme's image painting while it loads. */
function imageLayer(sbox: SectionBox, themed: string | null): ImageLayer | null {
  if (filled(sbox.bg_image_url)) {
    return { src: sbox.bg_image_url, fallbackSrc: filled(themed) ? themed : null };
  }
  return filled(themed) ? { src: themed, fallbackSrc: null } : null;
}

/**
 * md2ui `draw_document`'s section pass: each box's fill by `under(i)`'s pen, its stroke,
 * painted after the content, by `over(i)`'s.
 */
export function drawSections(
  d: Draw,
  sections: readonly SectionBox[],
  under: (i: number) => Pen,
  over: (i: number) => Pen,
): void {
  const counters = new Map<string, number>();
  sections.forEach((sbox, i) => {
    const strokes: StrokeQueue = [];
    drawSection(d, sbox, counters, under(i), strokes);
    for (const stroke of strokes) stroke(over(i));
  });
}

/** One section box; `counters` holds the positional colour slots of boxes with no node. */
function drawSection(
  d: Draw,
  sbox: SectionBox,
  counters: Map<string, number>,
  p: Pen,
  strokes: StrokeQueue,
): void {
  const { theme } = d.sizer;
  if (sbox.kind === "date_chip") {
    drawDateChip(d, sbox, p, strokes);
    return;
  }
  if (sbox.kind === "ring") {
    drawRingArc(d, sbox, p);
    return;
  }
  let st = paintStyleFor(sbox.kind, sbox.level, theme, sbox.fixed_style_key);
  if (st === undefined || (sbox.kind.startsWith("table") && !sectionIsActive(st))) return;
  // A box's own level is part of its gate chain here: "## Heading 2 / Rotate
  // background colors: no" means heading-2 backgrounds do not cycle.
  const fixed = sbox.fixed_style_key;
  const chain = [
    ...sbox.rotation_chain,
    ...(fixed ? [`fixed:${fixed}|${sbox.level}`] : sbox.level ? [sbox.level] : []),
  ];
  const channel = sbox.kind === "card" || sbox.kind === "image_card" ? "card" : "background";
  let color: Argb | null = null;
  if (st.bg_colors.length > 0) {
    let slot: number;
    if (sbox.rotation_index !== null) {
      slot = syncedSlot(sbox.rotation_index, sbox.rotation_chain, sbox.rotation_path, theme);
    } else {
      const key = `${sbox.kind}|${sbox.level}`;
      slot = counters.get(key) ?? 0;
      counters.set(key, slot + 1);
    }
    color =
      sbox.kind === "table_header" || sbox.kind === "table_row"
        ? tableBackgroundColor(st, slot, theme)
        : rotateColor(st.bg_colors, null, slot, theme, channel, chain);
  }
  if (st.stroke_colors.length > 0) {
    const slot = syncedSlot(
      sbox.rotation_index ?? 0,
      sbox.rotation_chain,
      sbox.rotation_path,
      theme,
    );
    st = {
      ...st,
      stroke_color: rotateColor(st.stroke_colors, st.stroke_color, slot, theme, channel, chain),
    };
  }
  const image = imageLayer(sbox, themeImage(sbox, st, theme));
  sectionBackground(theme, sbox, st, { color, image }, p, strokes);
}
