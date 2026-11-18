// Image bleed and image corners (md2ui `render_place.bake_image_bleed`, `_bleed_layer_for`,
// `_apply_bleed`). After placement, an image may reach out over its enclosing layer's
// padding on every inner edge it already touches, and is rounded where it now shares that
// layer's corners. Touching is the whole rule: a neighbour on a side is what stops the
// image touching it, so a bleed never covers anything. Nothing is measured again; the
// padding it grows into was reserved and left empty.
import type { ResolvedTheme, SectionStyle } from "@md2ui/contracts";
import { hint, imageContentWidth } from "../measure/leaf-kit.ts";
import type { NodeIndex } from "../measure/node-index.ts";
import { paintStyleFor } from "./backgrounds.ts";
import type { LayoutBox, SectionBox } from "./boxes.ts";

// md2ui `_BLEED_EPS`: the slack in deciding that a box touches an edge.
const BLEED_EPS = 0.5;

type Radii = readonly [number, number, number, number];

/** A box with the rect it was placed at, before any image bled. */
type Placed = readonly [LayoutBox, number, number, number, number];

/**
 * md2ui `_bleed_layer_for`: the innermost enclosing layer this image acts on. The level
 * that asked (`image_bleed` or `image_corner_radius`) wins, innermost first; an image
 * that asks itself (`bleed: yes`) takes the innermost layer with any padding.
 */
function bleedLayer(
  box: LayoutBox,
  sections: readonly SectionBox[],
  theme: ResolvedTheme,
  ownBleed: unknown,
): { readonly layer: SectionBox; readonly style: SectionStyle } | null {
  const around = sections
    .filter(
      (s) =>
        s.x - BLEED_EPS <= box.x &&
        s.y - BLEED_EPS <= box.y &&
        box.x + box.width <= s.x + s.width + BLEED_EPS &&
        box.y + box.height <= s.y + s.height + BLEED_EPS,
    )
    // Innermost first; Python's sort is stable, as is this.
    .sort((a, b) => a.width * a.height - b.width * b.height);
  for (const layer of around) {
    const style = paintStyleFor(layer.kind, layer.level, theme, layer.fixed_style_key);
    if (style === undefined) continue;
    if (style.image_bleed || style.image_corner_radius > 0) return { layer, style };
    const pad = style.padding;
    if (ownBleed && (pad.left + pad.right || pad.top + pad.bottom)) return { layer, style };
  }
  return null;
}

/**
 * md2ui `_apply_bleed`: grow `box` over `layer`'s padding on each inner edge it touches,
 * and return the radii of the corners the two now share, or `null` when it moved nowhere
 * or the layer has no radius. An image capped narrower than its box does not bleed.
 *
 * The bottom edge counts as touched also when a full-width or aside image ends the
 * layer's content: a card stretched to its band (bento) leaves empty space below its last
 * line, and no sibling stands in it, so the image runs down through it. `placed` is every
 * box's rect before any image bled.
 */
function applyBleed(
  box: LayoutBox,
  layer: SectionBox,
  style: SectionStyle,
  placed: readonly Placed[],
): Radii | null {
  if (imageContentWidth(box.render_properties, box.width) < box.width - BLEED_EPS) return null;
  const pad = layer.padding;
  const innerB = layer.y + layer.height - pad.bottom;
  const left = Math.abs(box.x - (layer.x + pad.left)) <= BLEED_EPS;
  const top = Math.abs(box.y - (layer.y + pad.top)) <= BLEED_EPS;
  const right = Math.abs(box.x + box.width - (layer.x + layer.width - pad.right)) <= BLEED_EPS;
  const boxB = box.y + box.height;
  let bottom = Math.abs(boxB - innerB) <= BLEED_EPS;
  let reach = pad.bottom;
  const edgeImage = (left && right) || (top && (left || right));
  if (!bottom && edgeImage && boxB < innerB && endsLayerContent(box, layer, placed)) {
    bottom = true;
    reach = innerB - boxB + pad.bottom;
  }
  if (!(left || top || right || bottom)) return null;
  if (left) {
    box.x -= pad.left;
    box.width += pad.left;
  }
  if (right) box.width += pad.right;
  if (top) {
    box.y -= pad.top;
    box.height += pad.top;
  }
  if (bottom) box.height += reach;
  const r = style.corner_radius;
  if (r <= 0) return null;
  // A corner is shared only when the image reaches both of its edges.
  return [
    top && left ? r : 0,
    top && right ? r : 0,
    bottom && right ? r : 0,
    bottom && left ? r : 0,
  ];
}

/** md2ui `_ends_layer_content`: whether no other box inside `layer` reached lower than `box`. */
function endsLayerContent(box: LayoutBox, layer: SectionBox, placed: readonly Placed[]): boolean {
  const boxB = box.y + box.height;
  return !placed.some(
    ([other, x, y, w, h]) =>
      other !== box &&
      layer.x - BLEED_EPS <= x &&
      x + w <= layer.x + layer.width + BLEED_EPS &&
      layer.y - BLEED_EPS <= y &&
      y + h <= layer.y + layer.height + BLEED_EPS &&
      y + h > boxB + BLEED_EPS,
  );
}

/**
 * md2ui `bake_image_bleed`, in place: each image leaf bleeds when it or its level asks,
 * and otherwise takes its own corner radius, else its level's. Radii land on the box's
 * render hints as `corner_radii`.
 */
export function bakeImageBleed(
  boxes: readonly LayoutBox[],
  sections: readonly SectionBox[],
  index: NodeIndex,
  theme: ResolvedTheme,
): void {
  if (sections.length === 0) return;
  // Where everything sat before any image bled, so one image's bleed never decides
  // whether the next one ends its card's content.
  const placed: Placed[] = boxes.map((b) => [b, b.x, b.y, b.width, b.height]);
  for (const box of boxes) {
    if (!box.content_id || index.get(box.content_id)?.type !== "image") continue;
    const rp = box.render_properties;
    // The image outranks its level both ways; only an unstated (`null`) choice defers.
    const ownBleed = hint(rp, "bleed");
    const ownRadius = hint(rp, "corner_radius") as number | null;
    const found = bleedLayer(box, sections, theme, ownBleed);
    const bleeds = ownBleed !== null ? Boolean(ownBleed) : Boolean(found?.style.image_bleed);
    let radii: Radii | null = null;
    if (bleeds && found !== null) radii = applyBleed(box, found.layer, found.style, placed);
    if (radii === null) {
      // Not bleeding: the image's own radius needs no layer at all.
      const r = ownRadius ?? found?.style.image_corner_radius ?? 0;
      if (r > 0) radii = [r, r, r, r];
    }
    if (radii?.some((r) => r !== 0)) {
      box.render_properties = { ...rp, corner_radii: radii };
    }
  }
}
