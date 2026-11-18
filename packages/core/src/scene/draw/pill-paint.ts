// A button pill's shape, painted once for every control drawn in a button variant's paint
// (md2ui `render_pill_paint.paint_pill`, ADR-400's one normalization point): a button and
// a segmented run's surface (a run of buttons). Its fill and stroke are replaced against
// the stack they sit on and pinned by `## Fixed colors` as a pill's are, its stroke lies
// where the variant's `Stroke align` puts it, and the ink of what it holds is resolved on
// its own replaced fill. None of them computes a colour or stroke of its own. A count's
// round buttons are a slider's drawing elements, painted by `element-paint.ts`, not here.
import type { Argb, LinkStyle, ResolvedTheme } from "@md2ui/contracts";
import { newTextStyle } from "../../theme/model.ts";
import { BG_IMAGE, opaque, pushBg } from "../backgrounds.ts";
import type { BgStack } from "../boxes.ts";
import { type Pins, paintedPins, pinOrReplace, replacedGradient } from "./colors.ts";
import { type ImageLayer, layeredFill, strokeOutline } from "./fills.ts";
import { MUTED_OPACITY } from "./muted.ts";
import type { Box, Pen } from "./pen.ts";

/** A chip's, badge's or button's theme background image, faded when the element is muted. */
export function elementImageOf(src: string | null, muted: boolean): ImageLayer | null {
  if (!src) return null;
  return muted ? { src, fallbackSrc: null, opacity: MUTED_OPACITY } : { src, fallbackSrc: null };
}

/** How a pill is painted beyond its style: md2ui `paint_pill`'s keyword arguments. */
interface PillOptions {
  /** A disabled pill takes no pin and fades its image. */
  readonly disabled?: boolean;
  /** An oval, not a rounded rect: an emoji badge. */
  readonly oval?: boolean;
}

/** What a painted pill hands to what it holds. */
export interface PaintedPill {
  /** The ink of its label, resolved on the replaced fill. */
  readonly ink: Argb;
  /** The stack its contents sit on: the stack it sat on, its own fill on top. */
  readonly stack: BgStack;
}

/**
 * md2ui `paint_pill`: `style`'s shadows, fill and stroke in `box` on `stack`. `pins` are
 * the node's `## Fixed colors` (none for a surface, which no label names).
 */
export function paintPill(
  p: Pen,
  theme: ResolvedTheme,
  box: Box,
  style: LinkStyle,
  pins: Pins | undefined,
  stack: BgStack,
  options: PillOptions = {},
): PaintedPill {
  const { disabled = false, oval = false } = options;
  // Resolved before painting: the fill is also what the label sits on.
  const fixed = disabled ? {} : paintedPins(pins, style);
  const fill = pinOrReplace(style.fill_color ?? 0, fixed.fill, stack, theme, "fill");
  const stroke = pinOrReplace(style.stroke_color ?? 0, fixed.stroke, stack, theme, "stroke");
  const radius = style.corner_radius ?? 16;
  layeredFill(p, box, {
    color: opaque(fill),
    image: elementImageOf(style.bg_image, disabled),
    gradient: replacedGradient(style.gradient, stack, theme),
    radius: oval ? 0 : radius,
    shadows: style.shadows,
    oval,
  });
  const strokeWidth = style.stroke_width ?? 0;
  if (strokeWidth > 0) {
    strokeOutline(p, box, radius, strokeWidth, stroke, style.stroke_align, { oval });
  }
  // What the pill holds sits on its own, replaced, fill: a pill flipped to white
  // recolours its label from the `On background color: #FFFFFF` group.
  const held = pushBg(stack, style.bg_image ? BG_IMAGE : opaque(fill));
  const text = (style.text_style ?? newTextStyle()).color;
  return { ink: pinOrReplace(text, fixed.text, held, theme), stack: held };
}
