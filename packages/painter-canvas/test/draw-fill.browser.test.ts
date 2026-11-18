import type { FillEntry, Rect, Shape } from "@md2ui/contracts";
import { describe, expect, test } from "vitest";
import type { DecodedImage } from "../src/context.ts";
import { drawFill } from "../src/draw/fill.ts";
import { inkInside, inkOutside, pixelAt, testCanvas, testEnv } from "./pixels.ts";

const RECT: Shape = { kind: "rect", x: 40, y: 40, width: 80, height: 40 };

function entry(shape: Shape, paint: FillEntry["paint"], clip?: Shape): FillEntry {
  const bounds: Rect = { x: shape.x, y: shape.y, width: shape.width, height: shape.height };
  return clip === undefined
    ? { type: "fill", nodeId: "n", bounds, shape, paint }
    : { type: "fill", nodeId: "n", bounds, shape, paint, clip };
}

/** A square whose left half is red and right half blue. */
function halves(): DecodedImage {
  const canvas = new OffscreenCanvas(20, 20);
  const c = canvas.getContext("2d");
  if (c === null) throw new Error("no 2d context");
  c.fillStyle = "#f00";
  c.fillRect(0, 0, 10, 20);
  c.fillStyle = "#00f";
  c.fillRect(10, 0, 10, 20);
  return { source: canvas, width: 20, height: 20, vector: false };
}

describe.each([1, 2])("fill at pixel ratio %i", (dpr) => {
  function run(e: FillEntry, images: Record<string, DecodedImage> = {}) {
    const t = testCanvas(200, 200, dpr);
    drawFill(t.ctx, e, testEnv(dpr, images));
    return t;
  }

  test("colour fills a rect", () => {
    const e = entry(RECT, { kind: "color", color: "#00ff00" });
    const t = run(e);
    expect(inkInside(t, e.bounds)).toBeGreaterThan(0);
    expect(inkOutside(t, e.bounds)).toBe(0);
    expect(pixelAt(t, 80, 60)).toEqual([0, 255, 0, 255]);
  });

  test("roundRect honours per-corner radii", () => {
    const shape: Shape = {
      kind: "roundRect",
      x: 40,
      y: 40,
      width: 80,
      height: 60,
      radii: [0, 20, 0, 20],
    };
    const e = entry(shape, { kind: "color", color: "#f00" });
    const t = run(e);
    expect(inkOutside(t, e.bounds)).toBe(0);
    expect(pixelAt(t, 80, 70)).toEqual([255, 0, 0, 255]);
    const alpha = (x: number, y: number) => pixelAt(t, x, y)[3];
    expect(alpha(40.5, 40.5)).toBe(255);
    expect(alpha(119.5, 99.5)).toBe(255);
    expect(alpha(119.5, 40.5)).toBe(0);
    expect(alpha(40.5, 99.5)).toBe(0);
  });

  test("oval leaves its corners empty", () => {
    const shape: Shape = { kind: "oval", x: 40, y: 40, width: 80, height: 60 };
    const e = entry(shape, { kind: "color", color: "#00f" });
    const t = run(e);
    expect(inkOutside(t, e.bounds)).toBe(0);
    expect(pixelAt(t, 80, 70)).toEqual([0, 0, 255, 255]);
    expect(pixelAt(t, 41, 41)[3]).toBe(0);
  });

  test("gradient runs from its start to its end", () => {
    const e = entry(RECT, {
      kind: "linearGradient",
      start: [0, 0],
      end: [1, 0],
      stops: [
        { offset: -1, color: "#ff0000" },
        { offset: 2, color: "#0000ff" },
      ],
    });
    const t = run(e);
    expect(inkInside(t, e.bounds)).toBeGreaterThan(0);
    expect(inkOutside(t, e.bounds)).toBe(0);
    const left = pixelAt(t, 42, 60);
    const right = pixelAt(t, 118, 60);
    expect(left[0]).toBeGreaterThan(200);
    expect(left[2]).toBeLessThan(55);
    expect(right[0]).toBeLessThan(55);
    expect(right[2]).toBeGreaterThan(200);
  });

  test("image cover-fits a wide target, centred", () => {
    const e = entry(RECT, { kind: "image", src: "a", fallbackSrc: null });
    const t = run(e, { a: halves() });
    expect(inkInside(t, e.bounds)).toBeGreaterThan(0);
    expect(inkOutside(t, e.bounds)).toBe(0);
    expect(pixelAt(t, 45, 60)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(t, 115, 60)).toEqual([0, 0, 255, 255]);
  });

  test("image is clipped to a rounded shape", () => {
    const shape: Shape = { kind: "oval", x: 40, y: 40, width: 80, height: 40 };
    const e = entry(shape, { kind: "image", src: "a", fallbackSrc: null });
    const t = run(e, { a: halves() });
    expect(inkOutside(t, e.bounds)).toBe(0);
    expect(pixelAt(t, 41, 41)[3]).toBe(0);
    expect(pixelAt(t, 60, 60)).toEqual([255, 0, 0, 255]);
  });

  test("the fallback paints while the src is missing", () => {
    const e = entry(RECT, { kind: "image", src: "missing", fallbackSrc: "bg" });
    const t = run(e, { bg: halves() });
    expect(inkInside(t, e.bounds)).toBeGreaterThan(0);
    expect(inkOutside(t, e.bounds)).toBe(0);
    expect(pixelAt(t, 45, 60)).toEqual([255, 0, 0, 255]);
  });

  test("nothing paints when the src and the fallback are missing", () => {
    for (const fallbackSrc of [null, "also-missing"]) {
      const e = entry(RECT, { kind: "image", src: "missing", fallbackSrc });
      const t = run(e);
      expect(inkInside(t, { x: 0, y: 0, width: 200, height: 200 })).toBe(0);
    }
  });

  test("nothing paints for an image with no size", () => {
    const empty: DecodedImage = { source: halves().source, width: 0, height: 0, vector: false };
    const e = entry(RECT, { kind: "image", src: "a", fallbackSrc: null });
    const t = run(e, { a: empty });
    expect(inkInside(t, { x: 0, y: 0, width: 200, height: 200 })).toBe(0);
  });

  test("an image's opacity fades it, whatever stands in for it, at the same fit", () => {
    // 0.4 x 255 = 102, md2ui's `round(255 * MUTED_OPACITY)`.
    for (const paint of [
      { kind: "image", src: "a", fallbackSrc: null, opacity: 0.4 },
      { kind: "image", src: "missing", fallbackSrc: "a", opacity: 0.4 },
    ] as const) {
      const e = entry(RECT, paint);
      const t = run(e, { a: halves() });
      expect(inkOutside(t, e.bounds)).toBe(0);
      const [r, , b, alpha] = pixelAt(t, 45, 60);
      expect(alpha).toBeCloseTo(102, -0.5);
      expect([r, b]).toEqual([255, 0]);
      expect(pixelAt(t, 115, 60)[3]).toBeCloseTo(102, -0.5);
    }
  });

  test("an image's opacity multiplies the alpha it is drawn under and restores it", () => {
    const t = testCanvas(200, 200, dpr);
    t.ctx.globalAlpha = 0.5;
    const e = entry(RECT, { kind: "image", src: "a", fallbackSrc: null, opacity: 0.4 });
    drawFill(t.ctx, e, testEnv(dpr, { a: halves() }));
    expect(pixelAt(t, 45, 60)[3]).toBeCloseTo(51, -0.5);
    expect(t.ctx.globalAlpha).toBe(0.5);
  });

  test("a clip limits the ink to the clip", () => {
    const clip: Shape = { kind: "rect", x: 60, y: 50, width: 30, height: 20 };
    const clipBounds: Rect = { x: 60, y: 50, width: 30, height: 20 };
    for (const paint of [
      { kind: "color", color: "#f00" },
      { kind: "image", src: "a", fallbackSrc: null },
    ] as const) {
      const t = run(entry(RECT, paint, clip), { a: halves() });
      expect(inkInside(t, clipBounds)).toBeGreaterThan(0);
      expect(inkOutside(t, clipBounds)).toBe(0);
    }
  });
});
