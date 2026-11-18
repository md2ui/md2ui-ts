// md2ui's layered background (`layout_render._paint_layered_fill`) and outline stroke
// (`render_shadows.draw_stroke`, `stroke_shape`): every background in the document is
// painted by these two, from the root to a chip. One function per quantity, so a fill,
// its clip, its shadows and its stroke are always the same shape.
import type {
  Argb,
  GradientTheme,
  Outline,
  Paint,
  PathShape,
  ResolvedTheme,
  SectionStyle,
  ShadowSpec,
  Shape,
  StrokeAlign,
} from "@md2ui/contracts";
import { opaque, photoSurface, pushBg, replaceColor } from "../backgrounds.ts";
import type { BgStack, SectionBox } from "../boxes.ts";
import { replacedGradient } from "./colors.ts";
import {
  type Box,
  cornerShape,
  css,
  ovalShape,
  type Pen,
  pathNumber,
  pathShape,
  roundShape,
} from "./pen.ts";

/** A photo layer: its source, and what paints while it is not decoded. */
export interface ImageLayer {
  readonly src: string;
  readonly fallbackSrc: string | null;
  readonly opacity?: number;
}

/** What a layered fill paints, each layer optional (md2ui's keyword arguments). */
export interface Layers {
  readonly color: Argb | null;
  readonly image: ImageLayer | null;
  readonly gradient: GradientTheme | null;
  readonly radius: number;
  readonly shadows: readonly ShadowSpec[];
  readonly oval?: boolean;
  /** A table row's shell clip, which every layer is cut to. */
  readonly clip?: Shape;
}

/** The outline a background paints: an oval, a rounded rect, or a rect. */
const outline = (box: Box, radius: number, oval = false): Shape =>
  oval ? ovalShape(box) : roundShape(box, radius);

/** How far a cut may fall from a side and still be on it: float noise, not a cut. */
const ON_SIDE = 1e-9;

/**
 * md2ui `shape_path(..., within=)`: a rounded rect cut to a rect, as one outline, for a box
 * only partly filled (a slider bar is its rounded track up to the value, square at the
 * value edge). Where every corner of the cut keeps its whole radius or none, and they fit,
 * the outline is a rounded rect; where the cut falls inside a rounded corner, it is the
 * exact path (`trackCut`).
 */
export function cutOutline(box: Box, radius: number, within: Box): Outline {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  const x0 = Math.max(box.x, within.x);
  const y0 = Math.max(box.y, within.y);
  const x1 = Math.min(right, within.x + within.width);
  const y1 = Math.min(bottom, within.y + within.height);
  // How far the cut moved each side in: left, top, right, bottom.
  const sides = [x0 - box.x, y0 - box.y, right - x1, bottom - y1].map((d) =>
    d > ON_SIDE ? d : 0,
  ) as [number, number, number, number];
  const [l, t, r, b] = sides;
  const corner = (dx: number, dy: number): number =>
    radius > 0 ? Math.max(0, radius - Math.max(dx, dy)) : 0;
  const radii = [corner(l, t), corner(r, t), corner(r, b), corner(l, b)] as const;
  const cut = { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
  const [tl, tr, br, bl] = radii;
  // A corner cut part-way, or whole corners the cut leaves too little room for (a value
  // within a radius of the fixed end), is no rounded rect. A box no side of which moved is
  // its own rounded rect, however its radii were rounded off.
  const room = (a: number, b: number, length: number): boolean => a + b <= length + ON_SIDE;
  const fits =
    room(tl, tr, cut.width) &&
    room(bl, br, cut.width) &&
    room(tl, bl, cut.height) &&
    room(tr, br, cut.height);
  const moved = sides.some((d) => d > 0);
  if (moved && (!fits || radii.some((k) => k > 0 && k < radius))) {
    return trackCut(box, radius, cut, sides);
  }
  return radii.every((k) => k === radii[0]) ? roundShape(cut, radii[0]) : cornerShape(cut, radii);
}

/**
 * The rounded track `box` kept from one end to `cut`, which moved one side of it inside a
 * rounded corner (`sides`: how far each of left, top, right, bottom moved): the slider
 * bar's cut (`draw_slider`), the only one the scene makes. The track runs along u from its
 * fixed end (0) to its length L, and across v (0 to its thickness T); each orientation is
 * a rotation of that frame, so every arc keeps sweep 1.
 */
function trackCut(
  box: Box,
  radius: number,
  cut: Box,
  sides: readonly [number, number, number, number],
): PathShape {
  const [left, top, right] = sides.map((d) => d > 0);
  if (sides.filter((d) => d > 0).length !== 1) {
    throw new RangeError("a cut outline moves exactly one side of its box");
  }
  const along = left || right;
  const L = along ? box.width : box.height;
  const T = along ? box.height : box.width;
  const c = along ? cut.width : cut.height;
  const R = Math.min(radius, L / 2, T / 2);
  // (u, v) in the cut's own frame, its top-left at (0, 0).
  const at = (u: number, v: number): string => {
    const [x, y] = right ? [u, v] : top ? [v, c - u] : left ? [c - u, T - v] : [T - v, u];
    return `${pathNumber(x)} ${pathNumber(y)}`;
  };
  const arc = (u: number, v: number): string =>
    `A${pathNumber(R)} ${pathNumber(R)} 0 0 1 ${at(u, v)}`;
  if (c < R) {
    // Inside the fixed end's corners: a slice of its cap, square at the cut.
    const h = Math.sqrt(Math.max(0, R * R - (R - c) ** 2));
    return pathShape(
      cut,
      `M${at(c, R - h)}L${at(c, T - R + h)}${arc(0, T - R)}L${at(0, R)}${arc(c, R - h)}Z`,
    );
  }
  // Inside the far end's corners: the whole fixed cap, and part of the far one's arcs.
  const h = Math.sqrt(Math.max(0, R * R - (c - (L - R)) ** 2));
  return pathShape(
    cut,
    `M${at(R, 0)}L${at(L - R, 0)}${arc(c, R - h)}L${at(c, T - R + h)}${arc(L - R, T)}` +
      `L${at(R, T)}${arc(0, T - R)}L${at(0, R)}${arc(R, 0)}Z`,
  );
}

/** A box grown by `d` on every side (shrunk when negative). */
const grownBy = (box: Box, d: number): Box => ({
  x: box.x - d,
  y: box.y - d,
  width: box.width + 2 * d,
  height: box.height + 2 * d,
});

/** A linear gradient over the shape's rect; unset ratios spread the stops evenly. */
function gradientPaint(g: GradientTheme): Paint {
  const n = g.colors.length;
  const even = g.ratios.length !== n;
  return {
    kind: "linearGradient",
    start: g.start,
    end: g.end,
    stops: g.colors.map((color, i) => ({
      offset: even ? i / (n - 1) : (g.ratios[i] as number),
      color: css(color),
    })),
  };
}

/** md2ui `paint_shadows`: one half of a background's shadows, in declared order. */
export function shadows(
  p: Pen,
  shape: Outline,
  specs: readonly ShadowSpec[],
  inner: boolean,
  clip?: Shape,
): void {
  if (shape.width <= 0 || shape.height <= 0) return;
  for (const sh of specs) {
    // md2ui `ShadowSpec.paints`: a fully transparent layer puts no ink down.
    if (sh.inner !== inner || sh.color >>> 24 === 0) continue;
    p.shadow(shape, sh, clip);
  }
}

/**
 * md2ui `_paint_layered_fill`: outer shadows, then the colour, the image and the
 * gradient clipped to the shape, then inner shadows. A box with shadows and no fill still
 * casts them: the silhouette is the shape.
 */
export function layeredFill(p: Pen, box: Box, layers: Layers): void {
  const { color, image, gradient, radius, clip } = layers;
  const shape = outline(box, radius, layers.oval);
  shadows(p, shape, layers.shadows, false, clip);
  if (color !== null) p.fill(shape, { kind: "color", color: css(color) }, clip);
  if (image !== null) p.fill(shape, { kind: "image", ...image }, clip);
  if (gradient !== null && gradient.colors.length >= 2)
    p.fill(shape, gradientPaint(gradient), clip);
  shadows(p, shape, layers.shadows, true, clip);
}

/** How a stroke's outline is shaped beyond its box and radius. */
type OutlineOptions =
  | { readonly oval?: boolean; readonly clip?: Shape; readonly within?: never }
  | {
      /** The rect the outline is cut to (`cutOutline`); a cut outline is never an oval. */
      readonly within: Box;
      readonly oval?: never;
      readonly clip?: Shape;
    };

/**
 * md2ui `draw_stroke` and `stroke_shape`: an outline stroke at its `Stroke align`.
 * `outside` grows the shape by half the width so the line lies outside it, `inside`
 * shrinks it; a rounded corner's radius moves with the edge, a sharp one stays sharp.
 * A cut outline's cut moves by the same rule, so the line closes along it.
 */
export function strokeOutline(
  p: Pen,
  box: Box,
  radius: number,
  width: number,
  color: Argb,
  align: StrokeAlign | null,
  options: OutlineOptions = {},
): void {
  const d = align === "inside" ? -width / 2 : align === "outside" ? width / 2 : 0;
  const moved = grownBy(box, d);
  const r = radius > 0 ? Math.max(0, radius + d) : 0;
  const shape =
    options.within === undefined
      ? outline(moved, r, options.oval)
      : cutOutline(moved, r, grownBy(options.within, d));
  p.stroke(shape, width, color, options.clip);
}

/** Strokes queued for after the content: a photo or card reaching an edge must not cover one. */
export type StrokeQueue = ((p: Pen) => void)[];

/** md2ui `_clip_to_shell`: a merged table shell's rounded rect, which its rows are cut to. */
function shellClip(clip: SectionBox["clip"]): Shape | undefined {
  if (clip === null) return undefined;
  const [x, y, width, height, radius] = clip;
  return roundShape({ x, y, width, height }, radius);
}

/**
 * md2ui `render_fills.replaced_surface`: a section, card or list item's fill, replaced as
 * a pill's fill is. The fill is a paint first, resolved against the surface it sits on,
 * and only then the context for what it holds.
 */
function replacedSurface(
  color: Argb | null,
  gradient: GradientTheme | null,
  stack: BgStack,
  theme: ResolvedTheme,
): { readonly color: Argb | null; readonly gradient: GradientTheme | null } {
  return {
    color: color === null ? null : replaceColor(color, stack, theme, "fill"),
    gradient: replacedGradient(gradient, stack, theme),
  };
}

/**
 * md2ui `_paint_section_background`: one section's layered fill, and its stroke queued
 * for after the content. The fill, gradient and stroke are replaced against what the box
 * sits on unless the caller already resolved them (`replaceStroke: false`, as a date chip
 * does, which md2ui paints without a theme).
 */
export function sectionBackground(
  theme: ResolvedTheme,
  sbox: SectionBox,
  style: SectionStyle,
  fill: { readonly color: Argb | null; readonly image: ImageLayer | null },
  p: Pen,
  strokes: StrokeQueue,
  replaceStroke = true,
): void {
  const clip = shellClip(sbox.clip);
  const radius = style.corner_radius;
  const surface = replaceStroke
    ? replacedSurface(fill.color, style.gradient, sbox.bg_stack, theme)
    : { color: fill.color, gradient: style.gradient };
  layeredFill(p, sbox, {
    color: surface.color,
    image: fill.image,
    gradient: surface.gradient,
    radius,
    shadows: style.shadows,
    ...(clip !== undefined && { clip }),
  });
  const stroke = style.stroke_color;
  if (style.stroke_width <= 0 || stroke === null) return;
  let color = stroke;
  if (replaceStroke) {
    // md2ui `_own_surface`: what this box's own paint counts as, for the stroke on it.
    const own =
      sbox.bg_image_url || style.bg_image
        ? photoSurface(sbox.fixed_style_key)
        : opaque(surface.color);
    color = replaceColor(stroke, pushBg(sbox.bg_stack, own), theme, "stroke");
  }
  strokes.push((q) =>
    strokeOutline(q, sbox, radius, style.stroke_width, color, style.stroke_align, {
      ...(clip !== undefined && { clip }),
    }),
  );
}
