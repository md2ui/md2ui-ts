// The blurred-shadow bitmaps a host keeps from one list to the next (`createShadowSprites`)
// and what `Painter.settle` leaves in them: once a new document has settled on screen,
// only its own shadows, so a re-sent document blurs nothing again and a replaced one's
// bitmaps go.
import type { LayerEntry, Rect, ShadowEntry } from "@md2ui/contracts";
import { expect, test } from "vitest";
import {
  createPainter,
  createShadowSprites,
  type Frame,
  type ShadowSprites,
} from "../src/index.ts";
import { list } from "./lists.ts";
import { testCanvas } from "./pixels.ts";

const FRAME: Frame = {
  width: 400,
  height: 400,
  scrollX: 0,
  scrollY: 0,
  pixelRatio: 2,
  images: () => undefined,
  loading: () => undefined,
  offsets: new Map(),
};

/**
 * A blurred card shadow at `y`, `width` wide, blurred by `radius`: its look, not its
 * place, picks its bitmap; and as it is long enough to be sliced, not its length either.
 */
function shadow(y: number, width: number, radius: number): ShadowEntry {
  const box: Rect = { x: 20, y, width, height: 60 };
  return {
    type: "shadow",
    nodeId: `card-${y}`,
    bounds: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 },
    shape: { kind: "rect", ...box },
    inner: false,
    offsetX: 0,
    offsetY: 0,
    color: "#00000080",
    radius,
  };
}

/** The store, counting the bitmaps blurred into it. */
function counted(): { readonly sprites: ShadowSprites; readonly made: () => number } {
  const sprites = createShadowSprites();
  let made = 0;
  return {
    sprites: {
      ...sprites,
      set(key, sprite) {
        made += 1;
        sprites.set(key, sprite);
      },
    },
    made: () => made,
  };
}

/** Paints `entries` as a new list on screen, as a host does, and settles it when told. */
function show(sprites: ShadowSprites, entries: readonly ShadowEntry[], settle: boolean): void {
  const painter = createPainter(list(entries), sprites);
  painter.paint(testCanvas(FRAME.width, FRAME.height, FRAME.pixelRatio).ctx, FRAME);
  if (settle) painter.settle(FRAME);
}

// Two cards on screen; a third far below it, painted only once scrolled to.
const DOCUMENT = [shadow(20, 200, 16), shadow(120, 300, 12), shadow(2000, 250, 8)];
const OTHER = [shadow(20, 300, 12), shadow(120, 340, 10)];

test("cards that differ only in length share one bitmap", () => {
  const { sprites, made } = counted();
  show(sprites, [shadow(20, 200, 16), shadow(120, 300, 16), shadow(220, 357, 16)], true);
  expect(made()).toBe(1);
});

test("a re-sent document, settled, blurs none of its shadows again", () => {
  const { sprites, made } = counted();
  show(sprites, DOCUMENT, true);
  expect(made()).toBe(2);
  show(sprites, DOCUMENT, true);
  expect(made()).toBe(2);
});

test("a new document, settled, keeps the shadows it shares and drops the rest", () => {
  const { sprites, made } = counted();
  show(sprites, DOCUMENT, true);
  // OTHER shares the card blurred by 12 with DOCUMENT.
  show(sprites, OTHER, true);
  expect(made()).toBe(3);
  // DOCUMENT's card blurred by 16 went with it; the one by 12 stayed, as OTHER casts it.
  show(sprites, DOCUMENT, false);
  expect(made()).toBe(4);
});

test("a settled list keeps its shadows not painted yet, which it casts", () => {
  const { sprites, made } = counted();
  const tall = { ...FRAME, height: 2200 };
  const painter = createPainter(list(DOCUMENT, [], { width: 400, height: 2200 }), sprites);
  painter.paint(testCanvas(400, 2200, 2).ctx, tall);
  expect(made()).toBe(3);
  // Settled while only its top shows, the list keeps the card far below too.
  show(sprites, DOCUMENT, true);
  const scrolled = createPainter(list(DOCUMENT, [], { width: 400, height: 2200 }), sprites);
  scrolled.paint(testCanvas(400, 400, 2).ctx, { ...FRAME, scrollY: 1900 });
  expect(made()).toBe(3);
});

test("a settled list keeps the shadows its layers cast (a muted control's)", () => {
  const { sprites, made } = counted();
  const muted = (entries: readonly ShadowEntry[]): LayerEntry => ({
    type: "layer",
    nodeId: "muted",
    bounds: { x: 0, y: 0, width: 400, height: 400 },
    opacity: 0.4,
    entries,
  });
  const showLayer = (settle: boolean) => {
    const painter = createPainter(list([muted(OTHER)]), sprites);
    painter.paint(testCanvas(FRAME.width, FRAME.height, FRAME.pixelRatio).ctx, FRAME);
    if (settle) painter.settle(FRAME);
  };
  showLayer(true);
  expect(made()).toBe(2);
  showLayer(true);
  expect(made()).toBe(2);
});

/** A slider bar cut inside its rounded end (C4 `PathShape`): a slice of the cap, at `y`. */
function cutBar(y: number, d: string): ShadowEntry {
  const box: Rect = { x: 20, y, width: 3, height: 16 };
  return {
    type: "shadow",
    nodeId: `bar-${y}`,
    bounds: { x: box.x - 8, y: box.y - 8, width: box.width + 16, height: box.height + 16 },
    shape: { kind: "path", ...box, d },
    inner: false,
    offsetX: 0,
    offsetY: 0,
    color: "#00000080",
    radius: 16,
  };
}

const SLICE = "M3 2.2L3 13.8A8 8 0 0 1 0 8L0 8A8 8 0 0 1 3 2.2Z";

test("a path's shadow is its own bitmap, shared wherever the same path is cast", () => {
  const { sprites, made } = counted();
  // The same data in an equal frame, at two places: one bitmap. Other data in an equal
  // frame paints other pixels: a second.
  show(sprites, [cutBar(20, SLICE), cutBar(120, SLICE), cutBar(220, "M0 0L3 0L3 16L0 16Z")], true);
  expect(made()).toBe(2);
});
