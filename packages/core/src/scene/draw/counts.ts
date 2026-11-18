// A count's paint (md2ui `render_counts.draw_count`, ADR-405): its digits between two
// round buttons, never a track. A count is a slider, so each button is a drawing element
// painted as a slider's handle is (`paintPart`), in its own `### Count Button` paint or,
// unset, the quieter button's. The buttons sit at `countRects`, the rectangles the
// measurers size the leaf by and a tap lands on.
import type { Argb, LinkStyle, ResolvedTheme } from "@md2ui/contracts";
import { formatG } from "../../group/py/str.ts";
import { COUNT_DIGITS, countRects } from "../../measure/drawing.ts";
import { fontOf } from "../../measure/font-set.ts";
import { newTextStyle } from "../../theme/model.ts";
import { sectionIsActive } from "../../theme/query.ts";
import { BG_IMAGE, opaque, pushBg, replaceColor } from "../backgrounds.ts";
import { rotationSlot } from "./colors.ts";
import { type BoxDrawer, nodesOf } from "./context.ts";
import { type PartStyle, paintPart } from "./element-paint.ts";
import type { ImageLayer } from "./fills.ts";
import { resolvedLinkStyle } from "./link-styles.ts";
import { disabledLinkStyle, MUTED_OPACITY } from "./muted.ts";
import { type Box, css, type Pen, roundShape } from "./pen.ts";
import { elementImageOf } from "./pill-paint.ts";

// md2ui `draw_count`: a sign's half-length and its least stroke width.
const ARM = 0.22;
const MIN_STROKE = 1.5;

/**
 * md2ui's round-capped line from `(x0, y0)` to `(x1, y1)`, horizontal or vertical: the
 * rounded rect the cap closes it into, since a C4 line has butt caps only.
 */
function roundCapped(p: Pen, x0: number, y0: number, x1: number, y1: number, w: number, c: Argb) {
  const box = {
    x: Math.min(x0, x1) - w / 2,
    y: Math.min(y0, y1) - w / 2,
    width: Math.abs(x1 - x0) + w,
    height: Math.abs(y1 - y0) + w,
  };
  p.fill(roundShape(box, w / 2), { kind: "color", color: css(c) });
}

/**
 * md2ui `_as_layer`: a button's paint as one drawing-element layer, the fill, image,
 * gradient, shadows and stroke its pill would paint.
 */
const asLayer = (style: LinkStyle): PartStyle => ({
  bg_colors: style.fill_color === null ? [] : [style.fill_color],
  bg_image: style.bg_image,
  gradient: style.gradient,
  shadows: style.shadows,
  stroke_width: style.stroke_width ?? 0,
  stroke_color: style.stroke_color,
  stroke_align: style.stroke_align ?? "center",
  corner_radius: 0,
  corner_radius_authored: false,
});

/** One button's paint: its layer, its sign's colour, the picture it inherits, its mute. */
interface CountButton {
  readonly layer: PartStyle;
  readonly ink: Argb;
  readonly picture: ImageLayer | null;
  /** Painted whole at the default mute, as a `~~` slider is. */
  readonly muted: boolean;
}

/**
 * md2ui `_count_button`. With no `### Count Button` key the button is the quieter
 * button's paint (`quiet`) and, when it cannot step, that button's disabled paint, as its
 * pill would be. A theme that keys the count paints its own layer (or the inherited one,
 * for `Symbol color` alone), and a button that cannot step is that layer muted whole.
 */
function countButton(theme: ResolvedTheme, quiet: LinkStyle, live: boolean): CountButton {
  const { button, symbol_color } = theme.datapoints.counts;
  const own = sectionIsActive(button);
  const keyed = own || symbol_color !== null;
  const link = live || keyed ? quiet : disabledLinkStyle(quiet);
  const ink = symbol_color ?? (link.text_style ?? newTextStyle()).color;
  if (own) return { layer: button, ink, picture: null, muted: !live };
  const picture = elementImageOf(link.bg_image, !(live || keyed));
  return { layer: asLayer(link), ink, picture, muted: !live && keyed };
}

/**
 * md2ui `draw_count`: the ➖ and ➕ buttons, each muted when it cannot step (➖ at 0, ➕ at
 * the maximum; `countButton`), and the shown value's digits centred between them. Each
 * button is one drawing-element layer, a circle painted against the stack the count sits
 * on; its sign's ink is replaced against the button's own fill. No label names a sign, so
 * no pin colours it.
 */
export const drawCount: BoxDrawer = (d, box, p) => {
  const found = nodesOf(d, box);
  if (found === null) return;
  const { sized, node } = found;
  const { theme, leaves } = d.sizer;
  const payload = sized.drawing_element;
  const value = Number(payload?.["value"] ?? 0);
  const maximum = Number(payload?.["max"] ?? 0) || 0;
  const [minus, plus] = countRects(box, payload, theme);
  // md2ui resolves the count as a Secondary button: `{**node, "type": "link", …}`.
  const quiet = resolvedLinkStyle(d, { ...sized, type: "link", link_variant: "secondary" }, node);
  const { index, chain } = rotationSlot(node, theme);
  const buttons = [
    [minus, value > 0, false],
    [plus, value < maximum, true],
  ] as const;
  for (const [[x, y, width, height], live, isPlus] of buttons) {
    const { layer, ink, picture, muted } = countButton(theme, quiet, live);
    const paint = (pen: Pen): void => {
      const oval: Box = { x, y, width, height };
      const who = { slot: index, chain, theme };
      const fill = paintPart(pen, oval, 0, layer, who, box.bg_stack, { oval: true, picture });
      const held = pushBg(box.bg_stack, layer.bg_image ? BG_IMAGE : opaque(fill));
      const color = replaceColor(ink, held, theme);
      const w = Math.max(MIN_STROKE, width / 15);
      const cx = x + width / 2;
      const cy = y + height / 2;
      const arm = width * ARM;
      roundCapped(pen, cx - arm, cy, cx + arm, cy, w, color);
      if (isPlus) roundCapped(pen, cx, cy - arm, cx, cy + arm, w, color);
    };
    if (muted) p.layer(MUTED_OPACITY, paint);
    else paint(p);
  }
  const font = fontOf(leaves.fonts.bold, theme.text.font_size * COUNT_DIGITS);
  const text = formatG(value);
  const advance = leaves.text.advance(text, font);
  const m = leaves.text.fontMetrics(font);
  const left = minus[0] + minus[2];
  const x = left + (plus[0] - left - advance) / 2;
  const top = minus[1] + (minus[3] - (m.descent + m.ascent)) / 2;
  const color = css(replaceColor(theme.text.color, box.bg_stack, theme));
  p.text(top + m.ascent, [{ text, x, font, color, width: advance }]);
};
