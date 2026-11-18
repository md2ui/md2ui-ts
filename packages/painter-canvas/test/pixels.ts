// Test helpers: a canvas at a pixel ratio, a draw environment, and pixel counts inside
// and outside an entry's bounds.
import type { Rect } from "@md2ui/contracts";
import type { Context2D, DecodedImage, DrawEnv, ScrollOffset } from "../src/context.ts";

export interface TestCanvas {
  readonly ctx: Context2D;
  readonly dpr: number;
}

/** A transparent canvas `width` × `height` CSS px, drawn at `dpr`. */
export function testCanvas(width: number, height: number, dpr = 1): TestCanvas {
  const canvas = new OffscreenCanvas(Math.round(width * dpr), Math.round(height * dpr));
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2d context");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, dpr };
}

export function testEnv(
  dpr = 1,
  images: Readonly<Record<string, DecodedImage>> = {},
  offsets: ReadonlyMap<string, ScrollOffset> = new Map(),
  loading: Readonly<Record<string, DecodedImage>> = {},
): DrawEnv {
  return {
    images: (src) => images[src],
    loading: (src) => loading[src],
    scale: dpr,
    offsets,
    hovered: null,
    variations: undefined,
    font: null,
  };
}

function count(t: TestCanvas, bounds: Rect, margin: number, inside: boolean): number {
  const { ctx, dpr } = t;
  const { width, height } = ctx.canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const x0 = Math.floor(bounds.x * dpr) - margin;
  const y0 = Math.floor(bounds.y * dpr) - margin;
  const x1 = Math.ceil((bounds.x + bounds.width) * dpr) + margin;
  const y1 = Math.ceil((bounds.y + bounds.height) * dpr) + margin;
  let n = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const within = x >= x0 && x < x1 && y >= y0 && y < y1;
      if (within === inside && (data[(y * width + x) * 4 + 3] ?? 0) > 0) n++;
    }
  }
  return n;
}

/**
 * Device pixels with any ink outside `bounds`. One device pixel of slack on each side
 * allows for anti-aliasing at a fractional edge.
 */
export function inkOutside(t: TestCanvas, bounds: Rect): number {
  return count(t, bounds, 1, false);
}

/** Device pixels with any ink inside `bounds`. */
export function inkInside(t: TestCanvas, bounds: Rect): number {
  return count(t, bounds, 0, true);
}

/** The RGBA of one device pixel at CSS point `(x, y)`. */
export function pixelAt(t: TestCanvas, x: number, y: number): readonly number[] {
  return [...t.ctx.getImageData(Math.floor(x * t.dpr), Math.floor(y * t.dpr), 1, 1).data];
}
