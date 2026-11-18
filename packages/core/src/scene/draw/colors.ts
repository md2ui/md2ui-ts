// Which colour a thing is painted (md2ui `render_colors`): rotation's slot for a node,
// a `## Fixed colors` pin against `## Color Replacements`, and a gradient's stops through
// the fill channel. Pure: a theme, a node and a background stack in, a colour out.
import type { Argb, ColorRole, GradientTheme, GroupingNode, ResolvedTheme } from "@md2ui/contracts";
import { pyRound } from "../../group/py/math.ts";
import { syncedSlot } from "../../theme/query.ts";
import { replaceColor } from "../backgrounds.ts";
import type { BgStack } from "../boxes.ts";

/** A node's `## Fixed colors` pins, by channel (md2ui's `fixed_*` node keys). */
export interface Pins {
  readonly text?: Argb;
  readonly fill?: Argb;
  readonly stroke?: Argb;
  /** Character ranges of the content painted in their own colour (`fixed_text_spans`). */
  readonly spans?: readonly {
    readonly start: number;
    readonly end: number;
    readonly color: Argb;
  }[];
}

/**
 * md2ui `_pin_or_replace`: a pin wins over replacement unless, painted over what shows
 * behind it, it leaves exactly that colour, which would erase the element; then ordinary
 * replacement runs. What shows behind is the stack composited (`backdrop`), so a 10% green
 * fill over a green section is green, and a label pinned green on it is dropped too. A
 * clear pin is an authored "no fill", never a collision, and is always kept.
 */
export function pinOrReplace(
  color: Argb,
  pin: Argb | undefined,
  stack: BgStack,
  theme: ResolvedTheme,
  role: ColorRole = "text",
): Argb {
  if (pin !== undefined) {
    const behind = backdrop(stack);
    if (behind === null || pin >>> 24 === 0 || over(pin, behind) !== behind) return pin;
  }
  return replaceColor(color, stack, theme, role);
}

/** md2ui `_over`: ARGB `top` painted over `under` (source-over), rounded as Python does. */
function over(top: Argb, under: Argb): Argb {
  const ta = (top >>> 24) / 255;
  const ua = (under >>> 24) / 255;
  const oa = ta + ua * (1 - ta);
  if (oa <= 0) return 0;
  let out = pyRound(oa * 255) * 0x1000000;
  for (const shift of [16, 8, 0]) {
    const t = (top >>> shift) & 0xff;
    const u = (under >>> shift) & 0xff;
    out += pyRound((t * ta + u * ua * (1 - ta)) / oa) * 2 ** shift;
  }
  return out;
}

/**
 * md2ui `_backdrop`: the colour that shows behind, translucent layers composited down to
 * the first opaque one; null when an image shows through, or nothing is there.
 */
function backdrop(stack: BgStack): Argb | null {
  let acc: Argb | null = null;
  for (const layer of stack) {
    if (typeof layer !== "number") return null;
    acc = acc === null ? layer : over(acc, layer);
    if (acc >>> 24 === 0xff) break;
  }
  return acc;
}

/**
 * md2ui `_rotation_slot`: a leaf's rotation slot, resolved through `Rotate colors: sync`,
 * and its section ancestry. A fixed style takes its own slot.
 */
export function rotationSlot(
  nd: GroupingNode,
  theme: ResolvedTheme,
): { readonly index: number; readonly chain: readonly (number | string)[] } {
  const chain = nd.rotation_chain ?? [];
  const key = nd.section_style_key;
  const useFixed = key !== undefined && key !== "" && Object.hasOwn(theme.fixed_sections, key);
  const index = (useFixed ? nd.fixed_rotation_index : nd.rotation_index) ?? 0;
  return { index: syncedSlot(index, chain, nd.rotation_path ?? [], theme), chain };
}

/** md2ui `_replaced_gradient`: a gradient whose stops go through the fill channel. */
export function replacedGradient(
  gradient: GradientTheme | null,
  stack: BgStack,
  theme: ResolvedTheme,
): GradientTheme | null {
  if (gradient === null || gradient.colors.length === 0) return gradient;
  return { ...gradient, colors: gradient.colors.map((c) => replaceColor(c, stack, theme, "fill")) };
}

/** The paint channels of a button or chip style that a pin may recolor. */
interface PinnedStyle {
  readonly fill_color: Argb | null;
  readonly bg_image: string | null;
  readonly gradient: GradientTheme | null;
  readonly stroke_width: number | null;
}

/**
 * md2ui `painted_pins`: the pins a button or chip variant can carry. A fill pin needs a
 * fill the variant paints, a stroke pin a stroke it draws; the label is always painted.
 */
export function paintedPins(pins: Pins | undefined, style: PinnedStyle): Pins {
  if (pins === undefined) return {};
  const hasFill =
    (style.fill_color ?? 0) >>> 24 !== 0 ||
    (style.bg_image ?? "") !== "" ||
    style.gradient !== null;
  const hasStroke = (style.stroke_width ?? 0) > 0;
  return {
    ...(hasFill && pins.fill !== undefined && { fill: pins.fill }),
    ...(hasStroke && pins.stroke !== undefined && { stroke: pins.stroke }),
    ...(pins.text !== undefined && { text: pins.text }),
  };
}
