// Exit criterion 4: a 300-entry list scrolls at under 16 ms per
// frame, median and p95, at pixel ratios 1 and 2. A timing budget, so it runs in
// `pnpm perf` on an idle machine, not in the correctness gate (ADR-004). A frame is
// timed from `paint` until a one-pixel read returns, which waits for the canvas to
// finish rasterizing it. The first frame, which makes the shadow sprites, is logged, and
// the timing starts after 10.
import { expect, test } from "vitest";
import { server } from "vitest/browser";
import { createPainter } from "../src/index.ts";
import { longDocument } from "./lists.ts";

const VIEW = { width: 1280, height: 800 };
const FRAMES = 120;

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? Number.NaN;
}

for (const dpr of [1, 2]) {
  test(`300 entries scroll under 16 ms a frame at pixel ratio ${dpr}`, () => {
    const doc = longDocument(300, 1200);
    const painter = createPainter(doc);
    const canvas = document.createElement("canvas");
    canvas.width = VIEW.width * dpr;
    canvas.height = VIEW.height * dpr;
    const ctx = canvas.getContext("2d");
    if (ctx === null) throw new Error("no 2d context");
    const range = Math.max(1, doc.height - VIEW.height);
    const times: number[] = [];
    let first = 0;
    for (let i = 0; i < FRAMES + 10; i++) {
      const start = performance.now();
      painter.paint(ctx, {
        ...VIEW,
        scrollX: 0,
        scrollY: ((i * 97) % FRAMES) * (range / FRAMES),
        pixelRatio: dpr,
        images: () => undefined,
        loading: () => undefined,
        offsets: new Map(),
      });
      ctx.getImageData(0, 0, 1, 1);
      if (i === 0) first = performance.now() - start;
      if (i >= 10) times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const median = percentile(times, 0.5);
    const p95 = percentile(times, 0.95);
    console.log(
      `frame-time ${server.browser} dpr=${dpr} entries=${doc.entries.length} height=${doc.height} first=${first.toFixed(2)}ms median=${median.toFixed(2)}ms p95=${p95.toFixed(2)}ms`,
    );
    expect(median).toBeLessThan(16);
    expect(p95).toBeLessThan(16);
  });
}
