import type { ArcEntry, LineEntry, Rect, Shape, StrokeEntry } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { drawArc } from "../src/draw/arc.ts";
import { drawLine } from "../src/draw/line.ts";
import { drawStroke } from "../src/draw/stroke.ts";
import { inkInside, inkOutside, pixelAt, testCanvas } from "./pixels.ts";

const ratios = [1, 2];

function grow(r: Rect, by: number): Rect {
  return { x: r.x - by, y: r.y - by, width: r.width + 2 * by, height: r.height + 2 * by };
}

const box = { x: 40, y: 40, width: 80, height: 60 };
const shapes: Shape[] = [
  { kind: "rect", ...box },
  { kind: "roundRect", radii: [10, 10, 10, 10], ...box },
  { kind: "oval", ...box },
];

for (const dpr of ratios) {
  for (const shape of shapes) {
    test(`stroke ${shape.kind} at ${dpr}x paints its edge only`, () => {
      const t = testCanvas(200, 200, dpr);
      const entry: StrokeEntry = {
        type: "stroke",
        nodeId: "s",
        bounds: grow(shape, 3),
        shape,
        width: 6,
        color: "#ff0000",
      };
      drawStroke(t.ctx, entry);
      expect(inkInside(t, entry.bounds)).toBeGreaterThan(0);
      expect(inkOutside(t, entry.bounds)).toBe(0);
      expect(pixelAt(t, 80, 70)[3]).toBe(0);
      if (shape.kind === "rect") expect(pixelAt(t, 80, 40)).toEqual([255, 0, 0, 255]);
    });
  }

  test(`line horizontal and vertical at ${dpr}x`, () => {
    const t = testCanvas(200, 200, dpr);
    const h: LineEntry = {
      type: "line",
      nodeId: "h",
      bounds: grow({ x: 40, y: 50, width: 100, height: 0 }, 0.5),
      x0: 40,
      y0: 50,
      x1: 140,
      y1: 50,
      width: 1,
      color: "#0000ff",
    };
    const v: LineEntry = {
      type: "line",
      nodeId: "v",
      bounds: grow({ x: 160, y: 40, width: 0, height: 100 }, 0.5),
      x0: 160,
      y0: 40,
      x1: 160,
      y1: 140,
      width: 1,
      color: "#0000ff",
    };
    drawLine(t.ctx, h);
    drawLine(t.ctx, v);
    expect(inkInside(t, h.bounds)).toBeGreaterThan(0);
    expect(inkInside(t, v.bounds)).toBeGreaterThan(0);
    expect(pixelAt(t, 90, 50)[3]).toBeGreaterThan(0);
    expect(pixelAt(t, 160, 90)[3]).toBeGreaterThan(0);
    // Ink outside both bounds: paint each alone on a fresh canvas.
    const a = testCanvas(200, 200, dpr);
    drawLine(a.ctx, h);
    expect(inkOutside(a, h.bounds)).toBe(0);
    const b = testCanvas(200, 200, dpr);
    drawLine(b.ctx, v);
    expect(inkOutside(b, v.bounds)).toBe(0);
  });

  test(`line is cut by its clip at ${dpr}x`, () => {
    const t = testCanvas(200, 200, dpr);
    const entry: LineEntry = {
      type: "line",
      nodeId: "c",
      bounds: grow({ x: 40, y: 80, width: 100, height: 0 }, 2),
      x0: 40,
      y0: 80,
      x1: 140,
      y1: 80,
      width: 4,
      color: "#000000",
      clip: { kind: "rect", x: 40, y: 70, width: 50, height: 20 },
    };
    drawLine(t.ctx, entry);
    expect(pixelAt(t, 60, 80)[3]).toBe(255);
    expect(pixelAt(t, 120, 80)[3]).toBe(0);
    expect(inkOutside(t, entry.bounds)).toBe(0);
  });

  test(`arc quadrants at ${dpr}x`, () => {
    const cx = 100;
    const cy = 100;
    const radius = 40;
    const width = 8;
    const bounds = grow(
      { x: cx - radius, y: cy - radius, width: 2 * radius, height: 2 * radius },
      width / 2,
    );
    const quarter: ArcEntry = {
      type: "arc",
      nodeId: "a",
      bounds,
      cx,
      cy,
      radius,
      startAngle: -90,
      sweepAngle: 90,
      width,
      color: "#00ff00",
    };
    const t = testCanvas(200, 200, dpr);
    drawArc(t.ctx, quarter);
    expect(inkInside(t, bounds)).toBeGreaterThan(0);
    expect(inkOutside(t, bounds)).toBe(0);
    expect(pixelAt(t, cx + 28, cy - 28)[3]).toBe(255);
    expect(pixelAt(t, cx - 28, cy + 28)[3]).toBe(0);
    expect(pixelAt(t, cx, cy)[3]).toBe(0);
    expect(t.ctx.lineCap).toBe("butt");

    const full = testCanvas(200, 200, dpr);
    drawArc(full.ctx, { ...quarter, sweepAngle: 360 });
    expect(inkOutside(full, bounds)).toBe(0);
    for (const [sx, sy] of [
      [1, -1],
      [1, 1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      expect(pixelAt(full, cx + sx * 28, cy + sy * 28)[3]).toBe(255);
    }
  });

  test(`arc with a negative sweep goes anticlockwise at ${dpr}x`, () => {
    const t = testCanvas(200, 200, dpr);
    drawArc(t.ctx, {
      type: "arc",
      nodeId: "n",
      bounds: { x: 56, y: 56, width: 88, height: 88 },
      cx: 100,
      cy: 100,
      radius: 40,
      startAngle: -90,
      sweepAngle: -90,
      width: 8,
      color: "#00ff00",
    });
    expect(pixelAt(t, 72, 72)[3]).toBe(255);
    expect(pixelAt(t, 128, 72)[3]).toBe(0);
  });
}

/** Every device pixel of two canvases, as one string: equal when they paint the same. */
function pixelsOf(t: ReturnType<typeof testCanvas>): string {
  const { width, height } = t.ctx.canvas;
  return t.ctx.getImageData(0, 0, width, height).data.join(",");
}

/** A line chart's line (C4 `PathShape`): points relative to its frame at (30, 40). */
const chart: StrokeEntry = {
  type: "stroke",
  nodeId: "l",
  bounds: { x: 28.5, y: 38.5, width: 143, height: 83 },
  shape: {
    kind: "path",
    x: 30,
    y: 40,
    width: 140,
    height: 80,
    d: "M0.25 60.5L40.75 0.125L80.5 70.375L120.125 10.75L140 50",
  },
  width: 3,
  color: "#2060e0ff",
  join: "round",
  cap: "round",
};

for (const dpr of ratios) {
  test(`a path stroke at ${dpr}x is one round-joined, round-capped line at its frame`, () => {
    const t = testCanvas(200, 160, dpr);
    drawStroke(t.ctx, chart);
    // md2ui's `skia.Path`: one path through the points, in content space.
    const ref = testCanvas(200, 160, dpr);
    ref.ctx.lineJoin = "round";
    ref.ctx.lineCap = "round";
    ref.ctx.lineWidth = 3;
    ref.ctx.strokeStyle = "#2060e0ff";
    ref.ctx.beginPath();
    ref.ctx.moveTo(30.25, 100.5);
    ref.ctx.lineTo(70.75, 40.125);
    ref.ctx.lineTo(110.5, 110.375);
    ref.ctx.lineTo(150.125, 50.75);
    ref.ctx.lineTo(170, 90);
    ref.ctx.stroke();
    expect(pixelsOf(t)).toBe(pixelsOf(ref));
    expect(inkOutside(t, chart.bounds)).toBe(0);
  });

  test(`a stroke's sharp corner is bevelled past Skia's miter limit of 4 at ${dpr}x`, () => {
    // A 20° corner: its miter would reach 5.8 widths, past 4 (Skia) and short of 10 (Canvas).
    const shape: StrokeEntry["shape"] = {
      kind: "path",
      x: 20,
      y: 20,
      width: 160,
      height: 60,
      d: "M0 0L160 30L0 60",
    };
    const t = testCanvas(220, 120, dpr);
    drawStroke(t.ctx, {
      type: "stroke",
      nodeId: "m",
      bounds: { x: 8, y: 8, width: 184, height: 84 },
      shape,
      width: 6,
      color: "#000000ff",
    });
    const ref = testCanvas(220, 120, dpr);
    ref.ctx.lineJoin = "bevel";
    ref.ctx.lineWidth = 6;
    ref.ctx.strokeStyle = "#000000ff";
    ref.ctx.beginPath();
    ref.ctx.moveTo(20, 20);
    ref.ctx.lineTo(180, 50);
    ref.ctx.lineTo(20, 80);
    ref.ctx.stroke();
    expect(pixelsOf(t)).toBe(pixelsOf(ref));
  });
}
