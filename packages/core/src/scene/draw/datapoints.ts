// The drawn datapoint displays (md2ui `render_bars`, and the date chip's paint): a bar's
// track and fill, a ring's arc, a date chip's regions, and the painted blocks charts are
// made of (`charts.ts`).
import type { Argb, ResolvedTheme, SectionStyle } from "@md2ui/contracts";
import { filled } from "../../measure/layers.ts";
import { barTrackHeight, dpBarTheme } from "../../measure/leaf-heights.ts";
import { hint, type Props } from "../../measure/leaf-kit.ts";
import { dateChipTextStyle } from "../../measure/theme-styles.ts";
import { GREY_INK, GREY_TRACK } from "../../theme/model.ts";
import { paddingX, paddingY } from "../../theme/query.ts";
import { opaque, pushBg, replaceColor } from "../backgrounds.ts";
import type { BgStack, SectionBox } from "../boxes.ts";
import { replacedGradient } from "./colors.ts";
import type { BoxDrawer, Draw } from "./context.ts";
import {
  type ImageLayer,
  layeredFill,
  type StrokeQueue,
  sectionBackground,
  strokeOutline,
} from "./fills.ts";
import { type Box, cornerShape, css, ovalShape, type Pen } from "./pen.ts";

// Built-in paints used when THEME.md leaves a family unstyled (grayscale).
export const DEFAULT_BAR_FILL: Argb = GREY_INK;
export const DEFAULT_BAR_TRACK: Argb = GREY_TRACK;

/** md2ui `_decode_theme_image(url)`: the URL itself, which the host decodes. */
const themeImage = (url: string | null): ImageLayer | null =>
  filled(url) ? { src: url, fallbackSrc: null } : null;

/** md2ui `_bar_ratio`: a value as a signed share of its whole, -1 to 1. */
function barRatio(props: Props): number {
  const [v, mx] =
    "percent" in props
      ? [Number(props["percent"]), 100]
      : [Number(props["value"] ?? 0), Number(props["max"] ?? 0) || 1];
  return Math.max(-1, Math.min(1, v / mx));
}

/**
 * A bar's fill length (md2ui `_paint_bar`, `_draw_chart_rows`): its share of the track,
 * never shorter than its thickness, so a small value stays visible, and never past the
 * track.
 */
export const barStub = (thickness: number, inner: number, frac: number): number =>
  Math.min(Math.max(thickness, inner * frac), inner);

/**
 * One painted block of a bar or chart: a layered fill with its colours replaced against
 * what it sits on, then its own stroke at once (md2ui `_paint_bar`'s and `_chart_bar_rect`'s
 * fill-and-stroke pairs).
 */
export function paintBlock(
  p: Pen,
  box: Box,
  style: SectionStyle,
  color: Argb,
  stack: BgStack,
  theme: ResolvedTheme,
): void {
  const radius = style.corner_radius;
  layeredFill(p, box, {
    color,
    image: themeImage(style.bg_image),
    gradient: replacedGradient(style.gradient, stack, theme),
    radius,
    shadows: style.shadows,
  });
  if (style.stroke_width > 0 && style.stroke_color !== null) {
    const stroke = replaceColor(style.stroke_color, stack, theme, "stroke");
    strokeOutline(p, box, radius, style.stroke_width, stroke, style.stroke_align);
  }
}

/** A style's first background colour, or the built-in one, replaced against what it sits on. */
export const styleColor = (
  style: SectionStyle,
  fallback: Argb,
  stack: BgStack,
  theme: ResolvedTheme,
): Argb => replaceColor(style.bg_colors[0] ?? fallback, stack, theme, "fill");

/**
 * md2ui `_draw_datapoint_bar` and `_paint_bar`: a bar-only leaf, its track the box's full
 * width and its fill a fraction of the padded inner width, centred vertically. A value
 * below zero reads the track from its right edge, which is zero, and fills leftwards in
 * `Negative color` when the theme sets one. The text beside it is its own leaves; `kind`
 * only picks which bar theme styles it.
 */
export const drawBar: BoxDrawer = (d, box, p) => {
  const { theme } = d.sizer;
  const props = hint(box.render_properties, "datapoint_bar") as Props;
  const bt = dpBarTheme(theme, props["kind"] ?? "");
  const trackH = barTrackHeight(bt);
  const x = box.x;
  const y = box.y + Math.max(0, (box.height - trackH) / 2);
  const stack = box.bg_stack;
  if (bt.track_enabled) {
    const color = styleColor(bt.track, DEFAULT_BAR_TRACK, stack, theme);
    paintBlock(p, { x, y, width: box.width, height: trackH }, bt.track, color, stack, theme);
  }
  const pad = bt.track.padding;
  const innerW = Math.max(0, box.width - paddingX(pad));
  const frac = barRatio(props);
  if (frac === 0 || innerW <= 0) return;
  const width = barStub(bt.thickness, innerW, Math.abs(frac));
  const fill = {
    x: x + pad.left + (frac < 0 ? innerW - width : 0),
    y: y + pad.top,
    width,
    height: bt.thickness,
  };
  const color =
    frac < 0 && bt.negative_color !== null
      ? replaceColor(bt.negative_color, stack, theme, "fill")
      : styleColor(bt.bar, DEFAULT_BAR_FILL, stack, theme);
  paintBlock(p, fill, bt.bar, color, stack, theme);
};

/**
 * md2ui `_draw_ring_arc`: the ring card's background, a full-circle track and a round-capped
 * value arc from 12 o'clock, inscribed in the section box.
 */
export function drawRingArc(d: Draw, sbox: SectionBox, p: Pen): void {
  const { theme } = d.sizer;
  const rt = theme.datapoints.ring;
  const diameter = Math.min(sbox.width, sbox.height);
  const cx = sbox.x + sbox.width / 2;
  const cy = sbox.y + sbox.height / 2;
  const r = Math.max(1, (diameter - rt.thickness) / 2);
  const track = styleColor(rt.track, DEFAULT_BAR_TRACK, sbox.bg_stack, theme);
  p.stroke(ovalShape({ x: cx - r, y: cy - r, width: 2 * r, height: 2 * r }), rt.thickness, track);
  // A ring has no side to go below zero on.
  const frac = Math.max(0, barRatio((sbox.ring ?? {}) as Props));
  if (frac <= 0) return;
  const color = styleColor(rt.ring, DEFAULT_BAR_FILL, sbox.bg_stack, theme);
  p.arc(cx, cy, r, -90, frac * 360, rt.thickness, color);
}

/**
 * md2ui `_paint_date_chip_background`: the chip's base fill, gradient and stroke, then,
 * for `Fill: split`, its key region (top corners rounded) over its day region (bottom
 * corners rounded), divided where the two text cells' heights divide it.
 */
export function drawDateChip(d: Draw, sbox: SectionBox, p: Pen, strokes: StrokeQueue): void {
  const { theme } = d.sizer;
  const dc = theme.datapoints.date_chip;
  const first = dc.chip.bg_colors[0];
  const baseColor = first === undefined ? null : replaceColor(first, sbox.bg_stack, theme, "fill");
  const stroke = dc.chip.stroke_color;
  const resolved: SectionStyle = {
    ...dc.chip,
    gradient: replacedGradient(dc.chip.gradient, sbox.bg_stack, theme),
    stroke_color: stroke === null ? null : replaceColor(stroke, sbox.bg_stack, theme, "stroke"),
  };
  // The stroke is already replaced, so it is not replaced again.
  sectionBackground(theme, sbox, resolved, { color: baseColor, image: null }, p, strokes, false);
  const keyColor = dc.key_bg.bg_colors[0];
  const dayColor = dc.day_bg.bg_colors[0];
  if (dc.fill !== "split" || (keyColor === undefined && dayColor === undefined)) return;
  const keyH = dateChipTextStyle(theme, "key").font_size + paddingY(dc.key_bg.padding);
  const dayH = dateChipTextStyle(theme, "day").font_size + paddingY(dc.day_bg.padding);
  const total = keyH + dayH;
  if (total <= 0) return;
  const split = sbox.y + sbox.height * (keyH / total);
  const r = dc.chip.corner_radius;
  const stack = pushBg(sbox.bg_stack, opaque(baseColor));
  if (keyColor !== undefined) {
    const box = { x: sbox.x, y: sbox.y, width: sbox.width, height: split - sbox.y };
    const color = css(replaceColor(keyColor, stack, theme, "fill"));
    p.fill(cornerShape(box, [r, r, 0, 0]), { kind: "color", color });
  }
  if (dayColor !== undefined) {
    const box = { x: sbox.x, y: split, width: sbox.width, height: sbox.y + sbox.height - split };
    const color = css(replaceColor(dayColor, stack, theme, "fill"));
    p.fill(cornerShape(box, [0, 0, r, r]), { kind: "color", color });
  }
}
