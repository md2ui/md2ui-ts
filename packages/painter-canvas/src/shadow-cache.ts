import type { ShadowEntry } from "@md2ui/contracts";
import type { Context2D, DrawEnv } from "./context.ts";
import { drawShadow } from "./draw/shadow.ts";

/** Transparent device pixels around a sprite, so its blur is never cut at the edge. */
const PAD = 1;

/** Draws shadow entries, reusing a bitmap for each blurred shadow it has drawn before. */
export interface ShadowCache {
  draw(ctx: Context2D, entry: ShadowEntry, env: DrawEnv): void;
  /** Drops every bitmap but those `entries` cast at `scale`. */
  keepOnly(entries: Iterable<ShadowEntry>, scale: number): void;
}

/**
 * Whether `entry` is drawn from a sprite. A crisp shadow (radius 0) costs no blur and
 * would show the snap, and a clipped one is rare, so both are drawn directly.
 */
function sprited(entry: ShadowEntry): boolean {
  const { shape } = entry;
  return entry.radius > 0 && entry.clip === undefined && shape.width > 0 && shape.height > 0;
}

/**
 * Blurred-shadow bitmaps by what they paint, which a host keeps across the lists it
 * paints in turn: a re-sent document or a new width mostly casts the shadows the last
 * list cast. A painter made with them starts a new list; a bitmap neither that list
 * nor the one before it drew is dropped then, so they never hold more than two lists'
 * shadows (no history is kept). Once a new document, theme or width has settled on
 * screen, the host keeps only the bitmaps its list casts (`Painter.settle`): the shadows
 * a re-sent document shares stay, and those of a document it replaced go.
 */
export interface ShadowSprites {
  /** The bitmap drawn for `key`, or null when it could not be; undefined when none was. */
  get(key: string): OffscreenCanvas | null | undefined;
  /** Keeps the bitmap drawn for `key`; null records that none could be. */
  set(key: string, sprite: OffscreenCanvas | null): void;
  /** A new list is painted from now on. */
  nextList(): void;
  /** Drops every bitmap but those for `keys`. */
  keepOnly(keys: ReadonlySet<string>): void;
}

/** An empty store of shadow bitmaps, for a host to pass to each painter it makes. */
export function createShadowSprites(): ShadowSprites {
  let current = new Map<string, OffscreenCanvas | null>();
  let previous = new Map<string, OffscreenCanvas | null>();
  return {
    get(key) {
      if (current.has(key)) return current.get(key);
      if (!previous.has(key)) return undefined;
      const sprite = previous.get(key) ?? null;
      current.set(key, sprite);
      return sprite;
    },
    set(key, sprite) {
      current.set(key, sprite);
    },
    nextList() {
      previous = current;
      current = new Map();
    },
    keepOnly(keys) {
      const kept = new Map<string, OffscreenCanvas | null>();
      for (const held of [previous, current]) {
        for (const [key, sprite] of held) if (keys.has(key)) kept.set(key, sprite);
      }
      current = kept;
      previous = new Map();
    },
  };
}

/** How far a canvas shadow's blur reaches past the edge it softens, in sigmas. */
const BLUR_SIGMAS = 3;
/** Device pixels of slack past that reach: engines round each blur pass up. */
const BLUR_SLACK = 2;

/** A sprited shadow's ink, drawn at `x, y` in content px, `width` × `height` device px. */
interface Ink {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

function inkOf(entry: ShadowEntry, scale: number): Ink {
  const { shape } = entry;
  const reach = entry.inner ? 0 : entry.radius / 2;
  return {
    x: shape.x - reach + (entry.inner ? 0 : entry.offsetX),
    y: shape.y - reach + (entry.inner ? 0 : entry.offsetY),
    width: Math.ceil((shape.width + 2 * reach) * scale) + 2 * PAD,
    height: Math.ceil((shape.height + 2 * reach) * scale) + 2 * PAD,
  };
}

/**
 * The device pixels at each end of a sprited shadow's ink within which it can differ
 * from one pixel to the next, or null when it is drawn whole. Past that margin every
 * column of the ink is the same (and every row): the blur of a straight edge, which
 * sits further than the offset, the corner radius and the blur's reach (sigma is
 * `radius / 4`) from every corner and end. So one column and one row of the margin
 * square stand for the whole length, and the middle, cut out (outer) or out of the
 * blur's reach (inner), is empty. An oval has no straight edge, a path need not have one,
 * and a shape not much longer than its margins gains nothing.
 */
function sliceMargin(entry: ShadowEntry, ink: Ink, scale: number): number | null {
  const { shape } = entry;
  if (shape.kind === "oval" || shape.kind === "path") return null;
  const reach = entry.inner ? 0 : entry.radius / 2;
  const corner = shape.kind === "roundRect" ? Math.max(0, ...shape.radii) : 0;
  const blur = BLUR_SIGMAS * (entry.radius / 4);
  const far = reach + Math.abs(entry.offsetX) + Math.abs(entry.offsetY) + corner + blur;
  const margin = Math.ceil(far * scale) + BLUR_SLACK + PAD;
  const square = 2 * margin + 1;
  return ink.width > square + 4 && ink.height > square + 4 ? margin : null;
}

/** What makes two shadows paint the same pixels, wherever they are; `sliced` (`sliceMargin`). */
function spriteKey(entry: ShadowEntry, scale: number, sliced: boolean): string {
  const { shape } = entry;
  // A path's data is in its own frame, so equal data casts an equal shadow anywhere.
  const outline =
    shape.kind === "roundRect" ? shape.radii.join(",") : shape.kind === "path" ? shape.d : "";
  // A sliced shadow's bitmap is the same at any length; only where its far edge falls
  // within a device pixel (the shape's size times the scale, past the point) tells two
  // apart.
  const reach = entry.inner ? 0 : entry.radius / 2;
  const across = sliced ? (((shape.width + 2 * reach) * scale) % 1).toFixed(6) : shape.width;
  const down = sliced ? (((shape.height + 2 * reach) * scale) % 1).toFixed(6) : shape.height;
  return [
    sliced ? "sliced" : "whole",
    scale,
    shape.kind,
    across,
    down,
    outline,
    entry.inner,
    entry.offsetX,
    entry.offsetY,
    entry.color,
    entry.radius,
  ].join("|");
}

/**
 * Blur dominates a frame: shadows were measured at 23 of 24 ms of a frame at
 * pixel ratio 1 and 93 of 96 ms at 2 in Firefox (ADR-402: cache as bitmaps when they
 * do). So each blurred shadow is drawn once into a sprite, and every frame after draws
 * the sprite, at the nearest device pixel. The sprite is the shadow's whole ink: the
 * shape grown by `radius / 2` and moved by the offset (outer), or the shape (inner).
 *
 * A shadow long enough is sliced in nine (`sliceMargin`): its sprite is the shadow of
 * the same shape shortened to its margins, and its edges are stretched to length. A
 * width change blurs a small square at most (a sprite per whole shape made every
 * resize event blur every shadow again, 58–78 % of a resize, and held up to 589 MB).
 *
 * Some shadows are drawn directly (`sprited`). The sprites are `sprites`, which outlive the list
 * when a host keeps them (making them again cost a re-sent document 10 of
 * its 12 ms first frame).
 */
export function createShadowCache(sprites: ShadowSprites): ShadowCache {
  /** The sprite kept for `key`, else `entry`'s shadow drawn into one the size of `ink`. */
  function sprite(key: string, entry: ShadowEntry, env: DrawEnv, ink: Ink) {
    const cached = sprites.get(key);
    if (cached !== undefined) return cached;
    const canvas = new OffscreenCanvas(ink.width, ink.height);
    const ctx = canvas.getContext("2d");
    if (ctx !== null) {
      ctx.setTransform(
        env.scale,
        0,
        0,
        env.scale,
        PAD - ink.x * env.scale,
        PAD - ink.y * env.scale,
      );
      drawShadow(ctx, entry, env);
    }
    const made = ctx === null ? null : canvas;
    sprites.set(key, made);
    return made;
  }

  /** `entry` with its shape shortened by `cutX` device px across and `cutY` down. */
  function shortened(entry: ShadowEntry, cutX: number, cutY: number, scale: number): ShadowEntry {
    const shape = {
      ...entry.shape,
      width: entry.shape.width - cutX / scale,
      height: entry.shape.height - cutY / scale,
    };
    return { ...entry, shape };
  }

  /** Draws `image`, a sliced shadow's sprite, stretched to `ink` at device `x, y`. */
  function stretch(
    ctx: Context2D,
    image: OffscreenCanvas,
    ink: Ink,
    margin: number,
    x: number,
    y: number,
  ) {
    const midX = ink.width - 2 * margin;
    const midY = ink.height - 2 * margin;
    // Source start and length, destination start and length, for each third.
    const cols = [
      [0, margin, x, margin],
      [margin, 1, x + margin, midX],
      [margin + 1, margin, x + margin + midX, margin],
    ] as const;
    const rows = [
      [0, margin, y, margin],
      [margin, 1, y + margin, midY],
      [margin + 1, margin, y + margin + midY, margin],
    ] as const;
    // A stretched pixel is copied, not blended with its neighbours.
    ctx.imageSmoothingEnabled = false;
    rows.forEach(([sy, sh, dy, dh], r) => {
      cols.forEach(([sx, sw, dx, dw], c) => {
        if (r !== 1 || c !== 1) ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
      });
    });
  }

  return {
    draw(ctx, entry, env) {
      if (!sprited(entry)) {
        drawShadow(ctx, entry, env);
        return;
      }
      const ink = inkOf(entry, env.scale);
      const margin = sliceMargin(entry, ink, env.scale);
      const square = margin === null ? 0 : 2 * margin + 1;
      const key = spriteKey(entry, env.scale, margin !== null);
      const image =
        margin === null
          ? sprite(key, entry, env, ink)
          : sprite(key, shortened(entry, ink.width - square, ink.height - square, env.scale), env, {
              ...ink,
              width: square,
              height: square,
            });
      if (image === null) {
        drawShadow(ctx, entry, env);
        return;
      }
      const m = ctx.getTransform();
      const x = Math.round(m.a * ink.x + m.e) - PAD;
      const y = Math.round(m.d * ink.y + m.f) - PAD;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (margin === null) ctx.drawImage(image, x, y);
      else stretch(ctx, image, ink, margin, x, y);
      ctx.restore();
    },
    keepOnly(entries, scale) {
      const keys = new Set<string>();
      for (const entry of entries) {
        if (!sprited(entry)) continue;
        const sliced = sliceMargin(entry, inkOf(entry, scale), scale) !== null;
        keys.add(spriteKey(entry, scale, sliced));
      }
      sprites.keepOnly(keys);
    },
  };
}
