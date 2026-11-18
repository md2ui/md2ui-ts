// FLIP between two lists: the ends are the two lists themselves, a moved node is
// where its box's corner has got to, and what a restyled node did not change never
// dims; what goes fades out first and what comes fades in last. Diffs are written out
// here as the core's `diffDisplayLists` gives them.
import type { DisplayList, FillEntry, ListDiff, Rect } from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { createPainter, createTransition, type Frame } from "../src/index.ts";
import { list } from "./lists.ts";
import { pixelAt, testCanvas } from "./pixels.ts";

const VIEW = { width: 400, height: 400 };

function frame(dpr = 1): Frame {
  return {
    ...VIEW,
    scrollX: 0,
    scrollY: 0,
    pixelRatio: dpr,
    images: () => undefined,
    loading: () => undefined,
    offsets: new Map(),
  };
}

function fill(nodeId: string, rect: Rect, color: string): FillEntry {
  return {
    type: "fill",
    nodeId,
    bounds: rect,
    shape: { kind: "rect", ...rect },
    paint: { kind: "color", color },
  };
}

const RED = "#ff0000ff";
const BLUE = "#0000ffff";
const GREEN = "#00ff00ff";

/** Every pixel of a frame painted by `paint`, as bytes. */
function pixels(paint: (t: ReturnType<typeof testCanvas>) => void): Uint8ClampedArray {
  const t = testCanvas(VIEW.width, VIEW.height);
  paint(t);
  return t.ctx.getImageData(0, 0, VIEW.width, VIEW.height).data;
}

const listPixels = (l: DisplayList) => pixels((t) => createPainter(l).paint(t.ctx, frame()));

const NO_CHANGE: ListDiff = { added: [], removed: [], moved: [], restyled: [] };

describe("createTransition", () => {
  const a = { x: 20, y: 20, width: 100, height: 40 };
  const b = { x: 20, y: 220, width: 100, height: 40 };
  const before = list([fill("box", a, RED), fill("gone", { ...b, x: 200 }, GREEN)]);
  const after = list([fill("box", b, RED), fill("new", { ...a, x: 200 }, BLUE)]);
  const diff: ListDiff = {
    added: ["new"],
    removed: ["gone"],
    moved: [{ nodeId: "box", from: a, to: b }],
    restyled: [],
  };
  const transition = createTransition(before, after, diff);
  const at = (p: number) => pixels((t) => transition.paint(t.ctx, frame(), p));

  it("paints the earlier list at 0 and the later at 1", () => {
    expect(at(0)).toEqual(listPixels(before));
    expect(at(1)).toEqual(listPixels(after));
  });

  it("slides a moved node's box corner in the move stage", () => {
    const t = testCanvas(VIEW.width, VIEW.height);
    transition.paint(t.ctx, frame(), 0.5);
    // Halfway: the box is at y 120–160, nowhere else.
    expect(pixelAt(t, 70, 140)).toEqual([255, 0, 0, 255]);
    expect(pixelAt(t, 70, 40)[3]).toBe(0);
    expect(pixelAt(t, 70, 240)[3]).toBe(0);
    // Each stage's own progress, as a host eases them, places it as the whole's does.
    const staged = testCanvas(VIEW.width, VIEW.height);
    transition.paint(staged.ctx, frame(), { exit: 1, move: 0.5, enter: 0 });
    expect(staged.ctx.getImageData(0, 0, VIEW.width, VIEW.height).data).toEqual(
      t.ctx.getImageData(0, 0, VIEW.width, VIEW.height).data,
    );
  });

  it("stages the fades: what goes fades out first, what comes fades in last", () => {
    const alphaAt = (p: number, x: number, y: number) => {
      const t = testCanvas(VIEW.width, VIEW.height);
      transition.paint(t.ctx, frame(), p);
      return pixelAt(t, x, y)[3] ?? 0;
    };
    const gone = [250, 240] as const;
    const come = [250, 40] as const;
    // Early: the removed node is half faded, the added one not yet begun.
    expect(alphaAt(0.2, ...gone)).toBeGreaterThan(100);
    expect(alphaAt(0.2, ...gone)).toBeLessThan(155);
    expect(alphaAt(0.2, ...come)).toBe(0);
    // Late: the removed node has gone, the added one is half in.
    expect(alphaAt(0.775, ...gone)).toBe(0);
    expect(alphaAt(0.775, ...come)).toBeGreaterThan(100);
    expect(alphaAt(0.775, ...come)).toBeLessThan(155);
    // Between, while the moved node passes its midway, neither shows.
    expect(alphaAt(0.5, ...gone)).toBe(0);
    expect(alphaAt(0.5, ...come)).toBe(0);
  });

  it("keeps a restyled node's unchanged paint opaque while the change cross-fades", () => {
    const card = { x: 20, y: 20, width: 200, height: 100 };
    const mark = { x: 40, y: 40, width: 20, height: 20 };
    const was = list([fill("task", card, GREEN), fill("task", mark, RED)]);
    const now = list([fill("task", card, GREEN), fill("task", mark, BLUE)]);
    const restyle = createTransition(was, now, { ...NO_CHANGE, restyled: ["task"] });
    const t = testCanvas(VIEW.width, VIEW.height);
    restyle.paint(t.ctx, frame(), 0.5);
    expect(pixelAt(t, 150, 90)).toEqual([0, 255, 0, 255]);
    // The mark: blue fading in over the card, red fading out over both.
    const [r = 0, g = 0, bl = 0, alpha = 0] = pixelAt(t, 50, 50);
    expect(alpha).toBe(255);
    expect(r).toBeGreaterThan(80);
    expect(bl).toBeGreaterThan(40);
    expect(g).toBeLessThan(128);
    // Its ends are the two lists.
    const ends = (p: number) => pixels((c) => restyle.paint(c.ctx, frame(), p));
    expect(ends(0)).toEqual(listPixels(was));
    expect(ends(1)).toEqual(listPixels(now));
  });

  it("places the earlier list by the host's shift, so an anchored node does not move", () => {
    const top = { x: 20, y: 20, width: 100, height: 40 };
    const anchor = { x: 20, y: 100, width: 100, height: 40 };
    const was = list([fill("anchor", anchor, RED)]);
    // A block of 60 px was inserted above, and the host scrolled 60 px to keep the anchor.
    const now = list([fill("top", top, BLUE), fill("anchor", { ...anchor, y: 160 }, RED)]);
    const shifted = createTransition(
      was,
      now,
      {
        ...NO_CHANGE,
        added: ["top"],
        moved: [{ nodeId: "anchor", from: anchor, to: { ...anchor, y: 160 } }],
      },
      { shift: { x: 0, y: 60 } },
    );
    for (const p of [0, 0.3, 0.7, 1]) {
      const t = testCanvas(VIEW.width, VIEW.height);
      shifted.paint(t.ctx, frame(), p);
      expect(pixelAt(t, 70, 180)).toEqual([255, 0, 0, 255]);
      expect(pixelAt(t, 70, 150)[3]).toBe(0);
    }
  });

  it("cross-fades a restyled card's old fill under what it holds, not over it", () => {
    // A card's box: its fill under the content, its edge (here a fill too) over it. It
    // grew, so its paint changed; what it holds did not.
    const card = (height: number) => ({ x: 20, y: 20, width: 200, height });
    const text = { x: 40, y: 40, width: 40, height: 20 };
    const edge = (height: number) => ({ x: 20, y: 20 + height - 4, width: 200, height: 4 });
    const was = list([
      fill("card", card(100), GREEN),
      fill("text", text, RED),
      fill("card", edge(100), BLUE),
    ]);
    const now = list([
      fill("card", card(140), GREEN),
      fill("text", text, RED),
      fill("card", edge(140), BLUE),
    ]);
    const grow = createTransition(was, now, {
      ...NO_CHANGE,
      moved: [{ nodeId: "card", from: card(100), to: card(140) }],
      restyled: ["card"],
    });
    const t = testCanvas(VIEW.width, VIEW.height);
    grow.paint(t.ctx, frame(), 0.5);
    // The old fill fades out right over the new one, so the text stays as it is.
    expect(pixelAt(t, 60, 50)).toEqual([255, 0, 0, 255]);
  });

  it("keeps entries with no node that both lists paint alike, and cross-fades the rest", () => {
    const back = { x: 0, y: 0, width: 300, height: 300 };
    const was = list([
      fill("", back, GREEN),
      fill("", { x: 0, y: 320, width: 50, height: 50 }, RED),
    ]);
    const now = list([
      fill("", back, GREEN),
      fill("", { x: 0, y: 320, width: 50, height: 50 }, BLUE),
    ]);
    const fade = createTransition(was, now, NO_CHANGE);
    const at = (p: number) => {
      const t = testCanvas(VIEW.width, VIEW.height);
      fade.paint(t.ctx, frame(), p);
      return t;
    };
    expect(pixelAt(at(0.5), 150, 150)).toEqual([0, 255, 0, 255]);
    // The old one exits before the new one enters.
    const [r = 0, , bl = 0] = pixelAt(at(0.2), 25, 345);
    expect(r).toBeGreaterThan(40);
    expect(bl).toBe(0);
    const [r1 = 0, , bl1 = 0] = pixelAt(at(0.8), 25, 345);
    expect(r1).toBe(0);
    expect(bl1).toBeGreaterThan(40);
  });
});
