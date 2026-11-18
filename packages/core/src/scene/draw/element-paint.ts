// The drawing-element painter (md2ui `render_element_paint._paint_style`, ADR-400's one
// normalization point): one `SectionStyle` layer of a non-text leaf. A slider's track,
// bar and handle, a task control's outer and inner shapes and a count's round buttons
// are each one layer painted here: its fill rotated and replaced against the stack it
// sits on, its image and gradient, its shadows, and its stroke at its `Stroke align`. No
// colour pin applies: a pin names a label, and none of these layers is one.
import type { Argb, ResolvedTheme, SectionStyle, Shape } from "@md2ui/contracts";
import { rotateColor } from "../../theme/query.ts";
import { replaceColor } from "../backgrounds.ts";
import type { BgStack } from "../boxes.ts";
import { replacedGradient } from "./colors.ts";
import { type ImageLayer, layeredFill, strokeOutline } from "./fills.ts";
import type { Box, Pen } from "./pen.ts";

/** What md2ui `_paint_style` reads of a `SectionStyle`: a drawing element's layer. */
export type PartStyle = Pick<
  SectionStyle,
  | "bg_colors"
  | "bg_image"
  | "gradient"
  | "shadows"
  | "stroke_width"
  | "stroke_color"
  | "stroke_align"
  | "corner_radius"
  | "corner_radius_authored"
>;

/** The node a drawing element is painted for, as its colours are chosen. */
export interface Subject {
  readonly slot: number;
  readonly chain: readonly (number | string)[];
  readonly theme: ResolvedTheme;
}

/** How a layer is painted beyond its style: md2ui `_paint_style`'s keyword arguments. */
interface PartOptions {
  /** Cuts the fill (md2ui's enclosing `clipPath`). */
  readonly clip?: Shape;
  /** A circle, not a rounded rect: a count's button. */
  readonly oval?: boolean;
  /**
   * Painted in place of the style's own image: the picture of a button's paint a count
   * inherits, faded when the button cannot step.
   */
  readonly picture?: ImageLayer | null;
}

/**
 * md2ui `_resolved_fill`: the layer's fill colour, rotated by the node's slot on the
 * `card` channel, then replaced against what is behind it; `null` when it has none.
 */
function resolvedFill(style: PartStyle, who: Subject, stack: BgStack): Argb | null {
  const first = style.bg_colors[0];
  if (first === undefined) return null;
  const color = rotateColor(style.bg_colors, first, who.slot, who.theme, "card", who.chain);
  return replaceColor(color ?? first, stack, who.theme, "fill");
}

/**
 * md2ui `_paint_style`: one layer, its layered fill and its stroke. Returns the fill
 * colour, which what is drawn on top of it replaces its colours against.
 */
export function paintPart(
  p: Pen,
  rect: Box,
  radius: number,
  style: PartStyle,
  who: Subject,
  stack: BgStack,
  options: PartOptions = {},
): Argb | null {
  const { clip, oval = false, picture } = options;
  const fill = resolvedFill(style, who, stack);
  const own = style.bg_image ? { src: style.bg_image, fallbackSrc: null } : null;
  layeredFill(p, rect, {
    color: fill,
    image: picture ?? own,
    gradient: replacedGradient(style.gradient, stack, who.theme),
    radius,
    shadows: style.shadows,
    oval,
    ...(clip !== undefined && { clip }),
  });
  if (style.stroke_width > 0 && style.stroke_color !== null) {
    const stroke = replaceColor(style.stroke_color, stack, who.theme, "stroke");
    strokeOutline(p, rect, radius, style.stroke_width, stroke, style.stroke_align, { oval });
  }
  return fill;
}
