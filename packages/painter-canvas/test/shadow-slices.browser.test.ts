// A long blurred shadow is drawn from a small sprite sliced in nine (`shadow-cache.ts`):
// its corners as drawn, its edges stretched. That is only sound if, past the slice
// margin, every column of the shadow is the same: the blur of a straight edge must stop
// within 3 sigma and 2 device pixels of it, in every engine. Both are checked here,
// the reach on its own and the result against the shadow blurred whole.
import type { Rect, ShadowEntry, Shape } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { drawShadow } from "../src/draw/shadow.ts";
import { createShadowCache, createShadowSprites, type ShadowSprites } from "../src/shadow-cache.ts";
import { testCanvas, testEnv } from "./pixels.ts";

/** The blur's reach the slices assume, in device px, for a shadow of blur radius `radius`. */
const reach = (radius: number, scale: number): number => 3 * (radius / 4) * scale + 2;

for (const scale of [1, 2, 3]) {
  for (const radius of [4, 8, 16, 32, 64]) {
    test(`a blurred edge stops within 3 sigma and 2 px (radius ${radius}, scale ${scale})`, () => {
      // A half-plane's shadow, its edge at device column `edge`, as `drawShadow` blurs.
      const width = Math.ceil(2 * reach(radius, scale)) + 40;
      const canvas = new OffscreenCanvas(width, 8);
      const ctx = canvas.getContext("2d");
      if (ctx === null) throw new Error("no 2d context");
      const edge = Math.round(width / 2);
      ctx.shadowColor = "#000000";
      ctx.shadowBlur = (radius / 2) * scale;
      ctx.shadowOffsetX = edge + 10_000;
      ctx.fillRect(-10_000 - 10_000, -10_000, 10_000, 20_000);
      const row = ctx.getImageData(0, 4, width, 1).data;
      const far = reach(radius, scale);
      for (let x = 0; x < width; x++) {
        const alpha = row[x * 4 + 3] ?? 0;
        // Beyond the reach outside the edge, nothing; beyond it inside, all but rounding.
        if (x >= edge + far) expect(alpha, `column ${x}`).toBe(0);
        if (x < edge - far) expect(alpha, `column ${x}`).toBeGreaterThanOrEqual(254);
      }
    });
  }
}

const BOX: Rect = { x: 30, y: 24, width: 260, height: 130 };

function entry(shape: Shape, over: Partial<ShadowEntry>): ShadowEntry {
  return {
    type: "shadow",
    nodeId: "n",
    bounds: BOX,
    shape,
    inner: false,
    offsetX: 0,
    offsetY: 0,
    color: "#1a2b3cc0",
    radius: 16,
    ...over,
  };
}

/** Shadows a key of only blur and colour would mix up: one store draws them all. */
const SHADOWS: readonly (readonly [string, ShadowEntry])[] = [
  ["rect", entry({ kind: "rect", ...BOX }, {})],
  ["round", entry({ kind: "roundRect", radii: [12, 12, 12, 12], ...BOX }, {})],
  ["round, other corners", entry({ kind: "roundRect", radii: [2, 20, 6, 0], ...BOX }, {})],
  ["offset", entry({ kind: "roundRect", radii: [12, 12, 12, 12], ...BOX }, { offsetY: 6 })],
  ["offset left", entry({ kind: "rect", ...BOX }, { offsetX: -5, offsetY: 3 })],
  ["inner", entry({ kind: "roundRect", radii: [12, 12, 12, 12], ...BOX }, { inner: true })],
  [
    "inner offset",
    entry({ kind: "rect", ...BOX }, { inner: true, offsetX: 4, offsetY: 4, radius: 10 }),
  ],
  ["fractional size", entry({ kind: "rect", ...BOX, width: 259.3, height: 130.6 }, {})],
  ["fractional size again", entry({ kind: "rect", ...BOX, width: 201.7, height: 99.2 }, {})],
  ["wide blur", entry({ kind: "rect", ...BOX }, { radius: 40 })],
];

/** The store, recording the size of each bitmap blurred into it. */
function recorded(): { readonly sprites: ShadowSprites; readonly sizes: number[] } {
  const sprites = createShadowSprites();
  const sizes: number[] = [];
  return {
    sprites: {
      ...sprites,
      set(key, sprite) {
        sizes.push(sprite === null ? 0 : Math.max(sprite.width, sprite.height));
        sprites.set(key, sprite);
      },
    },
    sizes,
  };
}

/**
 * The largest difference in any premultiplied channel of any device pixel: what is
 * composited. `getImageData` unpremultiplies, so a faint pixel's colour is coarse.
 */
function maxDifference(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let most = 0;
  for (let i = 0; i < a.length; i += 4) {
    const alphaA = (a[i + 3] ?? 0) / 255;
    const alphaB = (b[i + 3] ?? 0) / 255;
    most = Math.max(most, Math.abs(alphaA - alphaB) * 255);
    for (let k = 0; k < 3; k++) {
      most = Math.max(most, Math.abs((a[i + k] ?? 0) * alphaA - (b[i + k] ?? 0) * alphaB));
    }
  }
  return Math.round(most);
}

for (const scale of [1, 2]) {
  test(`sliced shadows paint the shadow blurred whole (scale ${scale})`, () => {
    const { sprites, sizes } = recorded();
    const cache = createShadowCache(sprites);
    for (const [name, shadow] of SHADOWS) {
      const sliced = testCanvas(320, 200, scale);
      const whole = testCanvas(320, 200, scale);
      cache.draw(sliced.ctx, shadow, testEnv(scale));
      drawShadow(whole.ctx, shadow, testEnv(scale));
      const size = [0, 0, 320 * scale, 200 * scale] as const;
      const difference = maxDifference(
        sliced.ctx.getImageData(...size).data,
        whole.ctx.getImageData(...size).data,
      );
      // At most rounding: a blurred edge's last sliver inside its reach (above).
      expect(difference, name).toBeLessThanOrEqual(2);
    }
    // Every bitmap is a small square, not a whole card.
    expect(sizes.length).toBe(SHADOWS.length);
    for (const size of sizes) expect(size).toBeLessThan(BOX.height * scale);
  });
}
