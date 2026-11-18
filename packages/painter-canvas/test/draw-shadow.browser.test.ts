import type { Rect, ShadowEntry, Shape } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { drawShadow } from "../src/draw/shadow.ts";
import { inkInside, inkOutside, pixelAt, testCanvas, testEnv } from "./pixels.ts";

const BOX: Rect = { x: 60, y: 60, width: 60, height: 40 };
const SHAPES: readonly (readonly [string, Shape])[] = [
  ["rect", { kind: "rect", ...BOX }],
  ["roundRect", { kind: "roundRect", radii: [10, 10, 10, 10], ...BOX }],
  ["oval", { kind: "oval", ...BOX }],
];

function entry(shape: Shape, over: Partial<ShadowEntry>): ShadowEntry {
  return {
    type: "shadow",
    nodeId: "n",
    bounds: BOX,
    shape,
    inner: false,
    offsetX: 0,
    offsetY: 0,
    color: "#000000ff",
    radius: 12,
    ...over,
  };
}

function grown(r: number, dx: number, dy: number): Rect {
  return {
    x: BOX.x - r / 2 + dx,
    y: BOX.y - r / 2 + dy,
    width: BOX.width + r,
    height: BOX.height + r,
  };
}

/** Draws `e` on a 200x200 canvas at `dpr`. */
function paint(e: ShadowEntry, dpr: number) {
  const t = testCanvas(200, 200, dpr);
  drawShadow(t.ctx, e, testEnv(dpr));
  return t;
}

function ink(t: ReturnType<typeof testCanvas>, r: Rect): number {
  return inkInside(t, r);
}

for (const dpr of [1, 2]) {
  for (const [name, shape] of SHAPES) {
    test(`outer shadow stays in its bounds, not at the centre (${name}, dpr ${dpr})`, () => {
      const t = paint(entry(shape, {}), dpr);
      const bounds = grown(12, 0, 0);
      expect(inkInside(t, bounds)).toBeGreaterThan(0);
      expect(inkOutside(t, bounds)).toBe(0);
      expect(pixelAt(t, 90, 80)[3]).toBe(0);
    });

    test(`offset outer shadow leans below-right (${name}, dpr ${dpr})`, () => {
      const t = paint(entry(shape, { offsetX: 6, offsetY: 6 }), dpr);
      expect(inkOutside(t, grown(12, 6, 6))).toBe(0);
      const below = ink(t, { x: 40, y: 100, width: 120, height: 30 });
      const above = ink(t, { x: 40, y: 30, width: 120, height: 30 });
      const right = ink(t, { x: 120, y: 40, width: 30, height: 80 });
      const left = ink(t, { x: 30, y: 40, width: 30, height: 80 });
      expect(below).toBeGreaterThan(above);
      expect(right).toBeGreaterThan(left);
    });

    test(`inner shadow inks only inside the shape (${name}, dpr ${dpr})`, () => {
      const t = paint(entry(shape, { inner: true, offsetX: 4, offsetY: 4 }), dpr);
      expect(inkInside(t, BOX)).toBeGreaterThan(0);
      expect(inkOutside(t, BOX)).toBe(0);
      const topLeft = ink(t, { x: BOX.x, y: BOX.y, width: 30, height: 20 });
      const bottomRight = ink(t, { x: BOX.x + 30, y: BOX.y + 20, width: 30, height: 20 });
      expect(topLeft).toBeGreaterThan(bottomRight);
    });

    test(`radius 0 paints a crisp offset outer shadow (${name}, dpr ${dpr})`, () => {
      const t = paint(entry(shape, { radius: 0, offsetX: 8, offsetY: 8 }), dpr);
      expect(inkInside(t, grown(0, 8, 8))).toBeGreaterThan(0);
      expect(inkOutside(t, grown(0, 8, 8))).toBe(0);
    });
  }

  test(`a zero-offset inner shadow rings all four edges (dpr ${dpr})`, () => {
    const t = paint(entry(SHAPES[0]?.[1] as Shape, { inner: true }), dpr);
    expect(pixelAt(t, BOX.x + 1, 80)[3]).toBeGreaterThan(0);
    expect(pixelAt(t, BOX.x + BOX.width - 2, 80)[3]).toBeGreaterThan(0);
    expect(pixelAt(t, 90, BOX.y + 1)[3]).toBeGreaterThan(0);
    expect(pixelAt(t, 90, BOX.y + BOX.height - 2)[3]).toBeGreaterThan(0);
  });

  test(`a clip crops the shadow (dpr ${dpr})`, () => {
    const clip: Shape = { kind: "rect", x: 0, y: 0, width: 90, height: 200 };
    const t = paint(entry(SHAPES[0]?.[1] as Shape, { clip }), dpr);
    expect(inkInside(t, grown(12, 0, 0))).toBeGreaterThan(0);
    expect(inkOutside(t, { x: 0, y: 0, width: 90, height: 200 })).toBe(0);
  });
}

test("shadow settings are back to defaults afterwards", () => {
  const t = paint(entry(SHAPES[1]?.[1] as Shape, { offsetX: 3, offsetY: 3 }), 2);
  expect(t.ctx.shadowBlur).toBe(0);
  expect(t.ctx.shadowOffsetX).toBe(0);
  expect(t.ctx.shadowColor).toBe("rgba(0, 0, 0, 0)");
  expect(t.ctx.getTransform().e).toBe(0);
});

test("an empty shape paints nothing", () => {
  const t = paint(entry({ kind: "rect", x: 60, y: 60, width: 0, height: 40 }, {}), 1);
  expect(inkInside(t, { x: 0, y: 0, width: 200, height: 200 })).toBe(0);
});
