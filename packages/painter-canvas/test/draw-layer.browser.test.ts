// A layer entry (C4 `LayerEntry`, md2ui `saveLayer` with an alpha): its entries are
// painted as one picture and faded together, so where two overlap the one over hides the
// one under, as md2ui's muted controls do; faded entry by entry, the one under would show
// through. At opacity 1 a layer paints exactly what its entries paint, at any pixel ratio
// and fractional offset, text included (WebKit within a few levels at an edge).
import type { DisplayEntry, FillEntry, LayerEntry, Rect, Shape, TextEntry } from "@md2ui/contracts";
import { describe, expect, test } from "vitest";
import { server } from "vitest/browser";
import { createLayers } from "../src/draw/layer.ts";
import { drawEntry } from "../src/painter.ts";
import { createShadowCache, createShadowSprites } from "../src/shadow-cache.ts";
import { pixelAt, testCanvas, testEnv } from "./pixels.ts";

const boundsOf = ({ x, y, width, height }: Shape): Rect => ({ x, y, width, height });

function fill(shape: Shape, color: string): FillEntry {
  return {
    type: "fill",
    nodeId: "n",
    bounds: boundsOf(shape),
    shape,
    paint: { kind: "color", color },
  };
}

function layer(opacity: number, entries: readonly DisplayEntry[]): LayerEntry {
  const xs = entries.map((e) => e.bounds);
  const x = Math.min(...xs.map((b) => b.x));
  const y = Math.min(...xs.map((b) => b.y));
  const width = Math.max(...xs.map((b) => b.x + b.width)) - x;
  const height = Math.max(...xs.map((b) => b.y + b.height)) - y;
  return { type: "layer", nodeId: "n", bounds: { x, y, width, height }, opacity, entries };
}

const TRACK = fill({ kind: "rect", x: 20, y: 20, width: 60, height: 20 }, "#ff0000ff");
const KNOB = fill({ kind: "oval", x: 50, y: 20, width: 20, height: 20 }, "#0000ffff");

const TEXT: TextEntry = {
  type: "text",
  nodeId: "n",
  bounds: { x: 18, y: 50, width: 70, height: 30 },
  y: 70,
  runs: [
    {
      text: "Mute",
      x: 20.3,
      font: { families: ["serif"], size: 17, weight: 700, italic: false },
      color: "#333333ff",
    },
  ],
};

/** The line `TEXT` is, below the layer. */
const BELOW: TextEntry = { ...TEXT, bounds: { x: 18, y: 80, width: 70, height: 20 }, y: 96 };

/** Paints `entries` on a fresh 120 × 100 canvas at `dpr`, moved by `(dx, dy)`, at `alpha`. */
function paint(entries: readonly DisplayEntry[], dpr: number, dx = 0, dy = 0, alpha = 1) {
  const t = testCanvas(120, 100, dpr);
  const env = testEnv(dpr);
  const shadows = createShadowCache(createShadowSprites());
  const layers = createLayers();
  t.ctx.translate(dx, dy);
  t.ctx.globalAlpha = alpha;
  for (const e of entries) drawEntry(t.ctx, e, env, shadows, layers);
  return t;
}

const bytes = (t: ReturnType<typeof paint>) =>
  t.ctx.getImageData(0, 0, t.ctx.canvas.width, t.ctx.canvas.height).data;

describe.each([1, 2])("a layer at pixel ratio %i", (dpr) => {
  test("hides what lies under its own parts, and fades as one", () => {
    const t = paint([layer(0.4, [TRACK, KNOB])], dpr);
    // The knob over the track: blue at 0.4, no red under it (entry by entry: 0.24 red).
    expect(pixelAt(t, 60, 30)).toEqual([0, 0, 255, 102]);
    // The track alone, at 0.4 too.
    expect(pixelAt(t, 30, 30)).toEqual([255, 0, 0, 102]);
    expect(pixelAt(t, 100, 30)).toEqual([0, 0, 0, 0]);
  });

  test("in a layer, multiplies its opacity, and the frame's alpha", () => {
    expect(pixelAt(paint([layer(0.5, [layer(0.4, [KNOB])])], dpr), 60, 30)[3]).toBe(51);
    expect(pixelAt(paint([layer(0.4, [KNOB])], dpr, 0, 0, 0.5), 60, 30)[3]).toBe(51);
  });

  test.each([
    ["whole pixels", 0, 0],
    ["a fractional offset", 0.37, 0.61],
    ["partly off the canvas", -30.4, -12.2],
  ])("at opacity 1 paints what its entries paint, at %s", (_, dx, dy) => {
    // A line of text first, clear of the layer, so the frame has set its font: the
    // layer's context has a font of its own.
    const direct = bytes(paint([BELOW, TRACK, KNOB, TEXT], dpr, dx, dy));
    const layered = bytes(paint([BELOW, layer(1, [TRACK, KNOB, TEXT])], dpr, dx, dy));
    let worst = 0;
    for (let i = 0; i < direct.length; i++) {
      worst = Math.max(worst, Math.abs((direct[i] ?? 0) - (layered[i] ?? 0)));
    }
    // WebKit antialiases a shape's edge at a fractional offset a little differently on a
    // canvas of another size: at most 8 levels, as measured. The others are exact.
    expect(worst).toBeLessThanOrEqual(server.browser === "webkit" ? 8 : 0);
  });
});
