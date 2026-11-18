import type { ScrollEntry, TextEntry } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { drawScroll } from "../src/draw/scroll.ts";
import { drawText } from "../src/draw/text.ts";
import { everyEntry, FONT, textBounds } from "./lists.ts";
import { inkInside, inkOutside, pixelAt, testCanvas, testEnv } from "./pixels.ts";

const line: TextEntry = {
  type: "text",
  nodeId: "t",
  bounds: textBounds(40, 60, 80),
  y: 60,
  runs: [{ text: "MMMMM", x: 40, font: FONT, color: "#ff0000ff" }],
};

test("text draws its runs and leaves the frame's font recorded", () => {
  for (const dpr of [1, 2]) {
    const t = testCanvas(200, 120, dpr);
    const env = testEnv(dpr);
    drawText(t.ctx, line, env);
    expect(inkInside(t, line.bounds)).toBeGreaterThan(0);
    expect(inkOutside(t, line.bounds)).toBe(0);
    expect(env.font).toBe(FONT);
  }
});

test("a clipped line paints only inside its clip, and forgets the font after restore", () => {
  const clip = { kind: "rect", x: 40, y: 40, width: 20, height: 30 } as const;
  const t = testCanvas(200, 120, 1);
  const env = testEnv();
  drawText(t.ctx, { ...line, clip }, env);
  expect(inkInside(t, clip)).toBeGreaterThan(0);
  expect(inkOutside(t, clip)).toBe(0);
  expect(env.font).toBeNull();
});

function scrollEntry(): ScrollEntry {
  const entry = everyEntry().find((e) => e.type === "scroll");
  if (entry?.type !== "scroll") throw new Error("fixture");
  return entry;
}

test("a scroll entry stays inside its shape at every offset", () => {
  const entry = scrollEntry();
  for (const offset of [0, 100, 280, 1000]) {
    const t = testCanvas(300, 200, 2);
    drawScroll(t.ctx, entry, testEnv(2, {}, new Map([["scroll", { x: offset, y: 0 }]])));
    expect(inkInside(t, entry.bounds)).toBeGreaterThan(0);
    expect(inkOutside(t, entry.bounds)).toBe(0);
  }
});

test("the right edge fades while code hides there; the left one once scrolled", () => {
  const entry = scrollEntry();
  const edgeRight = { x: entry.shape.x + entry.shape.width - 2, y: entry.shape.y + 30 };
  const edgeLeft = { x: entry.shape.x + 2, y: entry.shape.y + 30 };
  const at0 = testCanvas(300, 200, 1);
  drawScroll(at0.ctx, entry, testEnv());
  expect(pixelAt(at0, edgeRight.x, edgeRight.y)[3]).toBeGreaterThan(200);
  expect(pixelAt(at0, edgeLeft.x, edgeLeft.y)[3]).toBe(0);
  const end = testCanvas(300, 200, 1);
  drawScroll(end.ctx, entry, testEnv(1, {}, new Map([["scroll", { x: 1000, y: 0 }]])));
  expect(pixelAt(end, edgeLeft.x, edgeLeft.y)[3]).toBeGreaterThan(200);
  expect(pixelAt(end, edgeRight.x, edgeRight.y)[3]).toBe(0);
});

test("the offset moves the code left", () => {
  const entry = scrollEntry();
  const ink = (offset: number) => {
    const t = testCanvas(300, 200, 1);
    drawScroll(
      t.ctx,
      { ...entry, fade: null },
      testEnv(1, {}, new Map([["scroll", { x: offset, y: 0 }]])),
    );
    return inkInside(t, { x: entry.shape.x, y: 70, width: 8, height: 30 });
  };
  expect(ink(0)).toBe(0);
  expect(ink(40)).toBeGreaterThan(0);
});

// md2ui 0e974d65: a block cut at `Max lines` scrolls down. Ten lines 20px apart in a
// 100px block with 10px of padding: three fit whole at rest; the fourth's top would
// reach into the window, under the fade.
const SHAPE = {
  kind: "roundRect",
  radii: [8, 8, 8, 8],
  x: 20,
  y: 20,
  width: 200,
  height: 100,
} as const;
const tall: ScrollEntry = {
  type: "scroll",
  nodeId: "tall",
  bounds: { x: 20, y: 20, width: 200, height: 100 },
  shape: SHAPE,
  contentWidth: 200,
  contentHeight: 220,
  window: { x: 20, y: 30, width: 200, height: 80 },
  rest: 3,
  fade: "#f6f8faff",
  entries: Array.from({ length: 10 }, (_, i): TextEntry => {
    const y = 46 + 20 * i;
    return {
      type: "text",
      nodeId: "tall",
      bounds: textBounds(40, y, 70),
      y,
      runs: [{ text: "MMMMM", x: 40, font: FONT, color: "#ff0000ff" }],
    };
  }),
};

const paintTall = (entry: ScrollEntry, y: number, hovered: string | null = null) => {
  const t = testCanvas(240, 140, 1);
  drawScroll(t.ctx, entry, { ...testEnv(1, {}, new Map([["tall", { x: 0, y }]])), hovered });
  return t;
};

test("at rest only the lines that fit whole show: the next does not peek under the fade", () => {
  // Below the third line, down to the window's bottom, where the fourth line's top is.
  const band = { x: 20, y: 93, width: 200, height: 17 };
  expect(inkInside(paintTall({ ...tall, fade: null }, 0), band)).toBe(0);
  // The same band holds ink once the fourth line counts as shown: the band is right.
  expect(inkInside(paintTall({ ...tall, fade: null, rest: 4 }, 0), band)).toBeGreaterThan(0);
});

test("scrolled down, the lines move up inside the window, passing under the space above", () => {
  const t = paintTall({ ...tall, fade: null }, 20);
  // The first line's top now lies above the window: nothing paints over the padding.
  expect(inkInside(t, { x: 20, y: 20, width: 200, height: 10 })).toBe(0);
  // The fourth line moved up into the band it was hidden from.
  expect(inkInside(t, { x: 20, y: 75, width: 200, height: 15 })).toBeGreaterThan(0);
  expect(inkOutside(t, tall.bounds)).toBe(0);
  // And the block shows other pixels than at rest.
  const pixelsOf = (c: ReturnType<typeof paintTall>) =>
    c.ctx.getImageData(0, 0, 240, 140).data.join(",");
  expect(pixelsOf(t)).not.toBe(pixelsOf(paintTall({ ...tall, fade: null }, 0)));
});

test("the bottom fades while more lies below, the top once scrolled past it", () => {
  // x = 200 is past the text, so a pixel there is the fade alone.
  const rest = paintTall(tall, 0);
  expect(pixelAt(rest, 200, 108)[3]).toBeGreaterThan(200);
  expect(pixelAt(rest, 200, 31)[3]).toBe(0);
  const middle = paintTall(tall, 60);
  expect(pixelAt(middle, 200, 108)[3]).toBeGreaterThan(200);
  expect(pixelAt(middle, 200, 31)[3]).toBeGreaterThan(200);
  const end = paintTall(tall, 1000);
  expect(pixelAt(end, 200, 108)[3]).toBe(0);
  expect(pixelAt(end, 200, 31)[3]).toBeGreaterThan(200);
});

test("a scrolled or hovered block shows its vertical thumb, a block at rest none", () => {
  const track = { x: 212, y: 30, width: 4, height: 80 };
  expect(inkInside(paintTall({ ...tall, fade: null }, 0), track)).toBe(0);
  expect(inkInside(paintTall({ ...tall, fade: null }, 0, "tall"), track)).toBeGreaterThan(0);
  const scrolled = paintTall({ ...tall, fade: null }, 120);
  // At the end of its range the thumb sits at the track's end.
  expect(inkInside(scrolled, { ...track, height: 40 })).toBe(0);
  expect(inkInside(scrolled, { ...track, y: 70, height: 40 })).toBeGreaterThan(0);
});

// A platform's bounce reports offsets past either end (iOS rubber-banding a scroller): the
// lines follow it, inside the window, and the thumb waits at its end of the track.
test("bounced past either end, the lines follow the offset inside the window", () => {
  const block = { ...tall, fade: null };
  const pixelsOf = (c: ReturnType<typeof paintTall>) =>
    c.ctx.getImageData(0, 0, 240, 140).data.join(",");
  const track = { x: 212, y: 30, width: 4, height: 80 };
  const top = paintTall(block, -15);
  expect(pixelsOf(top)).not.toBe(pixelsOf(paintTall(block, 0)));
  expect(inkInside(top, { x: 20, y: 20, width: 200, height: 10 })).toBe(0);
  expect(inkInside(top, { x: 20, y: 110, width: 200, height: 10 })).toBe(0);
  expect(inkInside(top, { ...track, height: 30 })).toBeGreaterThan(0);
  expect(inkInside(top, { ...track, y: 70, height: 40 })).toBe(0);
  const bottom = paintTall(block, 135);
  expect(pixelsOf(bottom)).not.toBe(pixelsOf(paintTall(block, 120)));
  expect(inkInside(bottom, { x: 20, y: 110, width: 200, height: 10 })).toBe(0);
  expect(inkInside(bottom, { ...track, y: 70, height: 40 })).toBeGreaterThan(0);
  for (const t of [top, bottom]) expect(inkOutside(t, tall.bounds)).toBe(0);
});
