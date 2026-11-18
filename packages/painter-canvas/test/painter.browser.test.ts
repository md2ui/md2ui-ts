import type { DisplayList, HitTarget, Rect, ShadowEntry } from "@md2ui/contracts";
import { describe, expect, test } from "vitest";
import { drawShadow } from "../src/draw/shadow.ts";
import { createPainter, type Frame, type View } from "../src/index.ts";
import { everyEntry, list } from "./lists.ts";
import { inkInside, inkOutside, pixelAt, testCanvas, testEnv } from "./pixels.ts";

const RATIOS = [1, 2] as const;

function frame(width: number, height: number, pixelRatio: number, scroll = { x: 0, y: 0 }): Frame {
  return {
    width,
    height,
    scrollX: scroll.x,
    scrollY: scroll.y,
    pixelRatio,
    images: () => undefined,
    loading: () => undefined,
    offsets: new Map(),
  };
}

describe("every entry type paints, inside its bounds", () => {
  for (const dpr of RATIOS) {
    for (const entry of everyEntry()) {
      test(`${entry.type} at pixel ratio ${dpr}`, () => {
        const t = testCanvas(300, 240, dpr);
        createPainter(list([entry])).paint(t.ctx, frame(300, 240, dpr));
        expect(inkInside(t, entry.bounds)).toBeGreaterThan(0);
        expect(inkOutside(t, entry.bounds)).toBe(0);
      });
    }
  }
});

test("pixel ratio 2 paints a rect onto twice the device pixels", () => {
  const rect: Rect = { x: 10, y: 10, width: 20, height: 20 };
  const fill = list([
    {
      type: "fill",
      nodeId: "a",
      bounds: rect,
      shape: { kind: "rect", ...rect },
      paint: { kind: "color", color: "#ff0000ff" },
    },
  ]);
  const t = testCanvas(50, 50, 2);
  createPainter(fill).paint(t.ctx, frame(50, 50, 2));
  const data = t.ctx.getImageData(0, 0, 100, 100).data;
  const alpha = (x: number, y: number) => data[(y * 100 + x) * 4 + 3];
  expect(alpha(20, 20)).toBe(255);
  expect(alpha(59, 59)).toBe(255);
  expect(alpha(60, 60)).toBe(0);
  expect(alpha(19, 19)).toBe(0);
});

describe("scrolling, padding and centring", () => {
  const rect: Rect = { x: 0, y: 500, width: 40, height: 40 };
  const doc: DisplayList = {
    ...list(
      [
        {
          type: "fill",
          nodeId: "a",
          bounds: rect,
          shape: { kind: "rect", ...rect },
          paint: { kind: "color", color: "#00ff00ff" },
        },
      ],
      [],
      { width: 100, height: 1000 },
    ),
    padding: { top: 20, right: 10, bottom: 20, left: 10 },
    centered: true,
  };

  test("content lands at padding + centring slack − scroll", () => {
    // Viewport 300 wide: layout width 300 − 20 = 280, slack 180, so x = 10 + 90 = 100.
    const t = testCanvas(300, 200, 1);
    createPainter(doc).paint(t.ctx, frame(300, 200, 1, { x: 0, y: 450 }));
    // y = 20 (top pad) + 500 − 450 = 70.
    expect(pixelAt(t, 120, 90)).toEqual([0, 255, 0, 255]);
    expect(pixelAt(t, 95, 90)[3]).toBe(0);
    expect(pixelAt(t, 120, 65)[3]).toBe(0);
  });

  test("an entry scrolled out of the viewport is not drawn (culled)", () => {
    const t = testCanvas(300, 200, 1);
    createPainter(doc).paint(t.ctx, frame(300, 200, 1, { x: 0, y: 0 }));
    expect(inkInside(t, { x: 0, y: 0, width: 300, height: 200 })).toBe(0);
  });

  test("not centred: the content sits at the left padding", () => {
    const t = testCanvas(300, 200, 1);
    createPainter({ ...doc, centered: false }).paint(t.ctx, frame(300, 200, 1, { x: 0, y: 450 }));
    expect(pixelAt(t, 15, 90)).toEqual([0, 255, 0, 255]);
  });
});

test("culling keeps paint order and keeps an off-screen shadow cast into view", () => {
  const card: Rect = { x: 0, y: 210, width: 100, height: 40 };
  const shape = { kind: "rect" as const, ...card };
  const doc = list(
    [
      {
        type: "shadow",
        nodeId: "card",
        // The card starts below the viewport; its shadow reaches 20px up into it.
        bounds: { x: -20, y: 170, width: 140, height: 100 },
        shape,
        inner: false,
        offsetX: 0,
        offsetY: -20,
        color: "#000000ff",
        radius: 40,
      },
      {
        type: "fill",
        nodeId: "under",
        bounds: card,
        shape,
        paint: { kind: "color", color: "#ff0000ff" },
      },
      {
        type: "fill",
        nodeId: "over",
        bounds: card,
        shape,
        paint: { kind: "color", color: "#0000ffff" },
      },
    ],
    [],
    { width: 200, height: 400 },
  );
  const t = testCanvas(200, 200, 1);
  createPainter(doc).paint(t.ctx, frame(200, 200, 1));
  expect(inkInside(t, { x: 0, y: 180, width: 120, height: 20 })).toBeGreaterThan(0);
  const below = testCanvas(200, 200, 1);
  createPainter(doc).paint(below.ctx, frame(200, 200, 1, { x: 0, y: 100 }));
  expect(pixelAt(below, 50, 130)).toEqual([0, 0, 255, 255]);
});

test("the page background fills the viewport, fixed under the scroll", () => {
  const doc: DisplayList = {
    ...list([], [], { width: 100, height: 1000 }),
    background: { paints: [{ kind: "color", color: "#123456ff" }], shadows: [] },
  };
  for (const y of [0, 600]) {
    const t = testCanvas(120, 80, 2);
    createPainter(doc).paint(t.ctx, frame(120, 80, 2, { x: 0, y }));
    expect(pixelAt(t, 1, 1)).toEqual([0x12, 0x34, 0x56, 255]);
    expect(pixelAt(t, 119, 79)).toEqual([0x12, 0x34, 0x56, 255]);
  }
});

test("a host may paint the background on a canvas of its own, under the content", () => {
  const rect: Rect = { x: 0, y: 0, width: 20, height: 20 };
  const doc: DisplayList = {
    ...list([
      {
        type: "fill",
        nodeId: "a",
        bounds: rect,
        shape: { kind: "rect", ...rect },
        paint: { kind: "color", color: "#ff0000ff" },
      },
    ]),
    background: { paints: [{ kind: "color", color: "#123456ff" }], shadows: [] },
  };
  const painter = createPainter(doc);
  const content = testCanvas(120, 80, 2);
  painter.paint(content.ctx, { ...frame(120, 80, 2), background: false });
  expect(pixelAt(content, 119, 79)).toEqual([0, 0, 0, 0]);
  expect(inkInside(content, { x: 0, y: 0, width: 120, height: 80 })).toBeGreaterThan(0);
  const back = testCanvas(120, 80, 2);
  painter.paintBackground(back.ctx, frame(120, 80, 2));
  expect(pixelAt(back, 1, 1)).toEqual([0x12, 0x34, 0x56, 255]);
  expect(pixelAt(back, 119, 79)).toEqual([0x12, 0x34, 0x56, 255]);
});

describe("hit-testing", () => {
  const rect = (x: number, y: number, width: number, height: number): Rect => ({
    x,
    y,
    width,
    height,
  });
  const targets: readonly HitTarget[] = [
    { kind: "link", nodeId: "card", rect: rect(0, 0, 300, 200), ordinal: 0, card: true },
    { kind: "agent", nodeId: "button", rect: rect(310, 20, 80, 30), ordinal: 1, card: false },
    { kind: "checkbox", nodeId: "box", rect: rect(20, 300, 20, 20), ordinal: 2, card: false },
    {
      kind: "slider",
      nodeId: "slider",
      rect: rect(60, 300, 200, 20),
      ordinal: 3,
      axis: "horizontal",
    },
    { kind: "link", nodeId: "text", rect: rect(20, 400, 60, 22), ordinal: 4, card: false },
    { kind: "anchor", nodeId: "text", rect: rect(120, 400, 60, 22), ordinal: 5, card: false },
    { kind: "copy", nodeId: "code", rect: rect(260, 500, 24, 24), text: "print(1)" },
  ];
  const doc: DisplayList = {
    ...list(
      [
        {
          type: "fill",
          nodeId: "under",
          bounds: rect(0, 280, 400, 80),
          shape: { kind: "rect", ...rect(0, 280, 400, 80) },
          paint: { kind: "color", color: "#eeeeeeff" },
        },
        {
          type: "fill",
          nodeId: "on-top",
          bounds: rect(10, 290, 100, 40),
          shape: { kind: "rect", ...rect(10, 290, 100, 40) },
          paint: { kind: "color", color: "#ddddddff" },
        },
      ],
      targets,
      { width: 400, height: 800 },
    ),
    padding: { top: 10, right: 0, bottom: 10, left: 0 },
  };
  const painter = createPainter(doc);
  const view: View = { width: 400, height: 300, scrollX: 0, scrollY: 0 };

  test("a tap at the centre of each target returns it", () => {
    for (const target of targets) {
      const cx = target.rect.x + target.rect.width / 2;
      const cy = target.rect.y + target.rect.height / 2;
      const hit = painter.hitTest({ ...view, scrollY: cy - 100 }, cx, 100 + doc.padding.top);
      expect(hit.target).toBe(target);
    }
  });

  test("the innermost target wins; among overlapping ones, the last painted", () => {
    // md2ui `test_innermost_target_wins_then_last_painted`.
    const at = (x: number, y: number, rects: readonly HitTarget[]) =>
      createPainter(list([], rects)).hitTest(view, x, y).target;
    const card: HitTarget = {
      kind: "agent",
      nodeId: "c",
      rect: rect(0, 0, 100, 100),
      ordinal: 0,
      card: true,
    };
    const innerCard: HitTarget = {
      kind: "agent",
      nodeId: "i",
      rect: rect(10, 10, 50, 50),
      ordinal: 1,
      card: true,
    };
    const button: HitTarget = {
      kind: "link",
      nodeId: "b",
      rect: rect(20, 20, 10, 10),
      ordinal: 2,
      card: false,
    };
    const later: HitTarget = {
      kind: "link",
      nodeId: "l",
      rect: rect(20, 20, 10, 10),
      ordinal: 3,
      card: false,
    };
    const nested = [card, innerCard, button];
    expect(at(25, 25, nested)).toBe(button);
    expect(at(15, 15, nested)).toBe(innerCard);
    expect(at(5, 5, nested)).toBe(card);
    expect(at(15, 15, [innerCard, card])).toBe(innerCard);
    expect(at(25, 25, [button, later])).toBe(later);
    expect(at(150, 150, nested)).toBeNull();
  });

  test("nothing there: no target; the topmost entry's node", () => {
    const hit = painter.hitTest({ ...view, scrollY: 200 }, 300, 100 + 10);
    expect(hit.target).toBeNull();
    expect(hit.nodeId).toBe("under");
    expect(painter.hitTest({ ...view, scrollY: 200 }, 50, 110 + 10).nodeId).toBe("on-top");
    expect(painter.hitTest(view, 390, 280).nodeId).toBeNull();
  });

  test("edges are half-open, as md2ui's", () => {
    const box = targets[2];
    if (box === undefined) throw new Error("fixture");
    const at = (x: number, y: number) =>
      painter.hitTest({ ...view, scrollY: 250 }, x, y - 250 + 10);
    expect(at(20, 300).target).toBe(box);
    expect(at(40, 300).target).toBeNull();
  });
});

test("a scroll entry under the point is reported, for sideways scrolling", () => {
  const [, , , , , , , scroll] = everyEntry();
  if (scroll?.type !== "scroll") throw new Error("fixture");
  const painter = createPainter(list([scroll]));
  const view: View = { width: 300, height: 300, scrollX: 0, scrollY: 0 };
  expect(painter.hitTest(view, 100, 80).scroll).toBe(scroll);
  expect(painter.hitTest(view, 10, 10).scroll).toBeNull();
});

test("an unsupported version is refused with a typed error", () => {
  const bad = { ...list([]), version: 2 } as unknown as DisplayList;
  expect(() => createPainter(bad)).toThrow(RangeError);
});

test("a blurred shadow drawn from its cached sprite matches drawing it directly", () => {
  const shadow = everyEntry().find((entry) => entry.type === "shadow");
  if (shadow?.type !== "shadow") throw new Error("fixture");
  for (const dpr of RATIOS) {
    const cached = testCanvas(300, 240, dpr);
    const painter = createPainter(list([shadow]));
    painter.paint(cached.ctx, frame(300, 240, dpr));
    painter.paint(cached.ctx, frame(300, 240, dpr));
    const direct = testCanvas(300, 240, dpr);
    drawShadow(direct.ctx, shadow, testEnv(dpr));
    const a = cached.ctx.getImageData(0, 0, 300 * dpr, 240 * dpr).data;
    const b = direct.ctx.getImageData(0, 0, 300 * dpr, 240 * dpr).data;
    let worst = 0;
    for (let i = 3; i < a.length; i += 4)
      worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
    // At most the half-pixel snap of a soft edge.
    expect(worst).toBeLessThan(40);
  }
});

test("a frame draws only the entries whose bounds meet the viewport", () => {
  // Images look themselves up only when drawn, so the lookups name the entries painted.
  const rows = Array.from(
    { length: 50 },
    (_, i): Rect => ({ x: 0, y: i * 100, width: 80, height: 80 }),
  );
  const doc = list(
    rows.map((r, i) => ({
      type: "image" as const,
      nodeId: `image-${i}`,
      bounds: r,
      src: `image-${i}`,
      shape: { kind: "rect" as const, ...r },
      fit: "cover" as const,
      placeholder: { color: "#999999ff", label: null },
    })),
    [],
    { width: 100, height: 5000 },
  );
  const painter = createPainter(doc);
  const painted = (scrollY: number) => {
    const asked: string[] = [];
    const t = testCanvas(100, 250, 1);
    painter.paint(t.ctx, {
      ...frame(100, 250, 1, { x: 0, y: scrollY }),
      images: (src) => {
        asked.push(src);
        return undefined;
      },
    });
    return asked;
  };
  // The query is inclusive: at 1050 the viewport ends at 1300, where row 13 begins.
  expect(painted(0)).toEqual(["image-0", "image-1", "image-2"]);
  expect(painted(1010)).toEqual(["image-10", "image-11", "image-12"]);
  expect(painted(1050)).toEqual(["image-10", "image-11", "image-12", "image-13"]);
});

// A host repaints a code block alone when only its offset changed: the result
// must be the whole paint's, to the device pixel, at any scroll and ratio, with what lies
// under a block in a document (a card's shadow, fill and border round it, the block's own
// fill) painted with it.
describe("repainting a block's area gives the pixels of a whole paint", () => {
  for (const dpr of [1, 2, 3]) {
    test(`at pixel ratio ${dpr}`, () => {
      const every = everyEntry();
      const block = every.find((e) => e.type === "scroll");
      const fill = every.find((e) => e.type === "fill");
      if (block?.type !== "scroll" || fill?.type !== "fill") throw new Error("fixture");
      const card: Rect = { x: 40, y: 40, width: 160, height: 100 };
      const cardShape = { kind: "roundRect", radii: [12, 12, 12, 12], ...card } as const;
      const doc = list([
        {
          type: "shadow",
          nodeId: "card",
          bounds: { x: 32, y: 36, width: 176, height: 116 },
          shape: cardShape,
          inner: false,
          offsetX: 0,
          offsetY: 4,
          color: "#00000066",
          radius: 16,
        },
        { ...fill, nodeId: "card", bounds: card, shape: cardShape },
        {
          type: "stroke",
          nodeId: "card",
          bounds: { x: 39, y: 39, width: 162, height: 102 },
          shape: cardShape,
          width: 2,
          color: "#000000ff",
        },
        { ...fill, paint: { kind: "color", color: "#101010ff" } },
        block,
      ]);
      const painter = createPainter(doc);
      const at = (offset: number): Frame => ({
        ...frame(300, 240, dpr, { x: 0.3, y: 7.7 }),
        offsets: new Map([[block.nodeId, { x: offset, y: 0 }]]),
      });
      const pixels = (t: ReturnType<typeof testCanvas>) =>
        t.ctx.getImageData(0, 0, 300 * dpr, 240 * dpr).data.join(",");
      const repainted = testCanvas(300, 240, dpr);
      painter.paint(repainted.ctx, at(0));
      const rest = pixels(repainted);
      painter.repaint(repainted.ctx, at(60), block.bounds);
      const whole = testCanvas(300, 240, dpr);
      painter.paint(whole.ctx, at(60));
      expect(pixels(repainted)).not.toBe(rest);
      expect(pixels(repainted)).toBe(pixels(whole));
    });
  }
});

test("a path's shadows, from their sprite, match them drawn directly, inside their bounds", () => {
  // A slider bar cut inside its far end (C4 `PathShape`), casting an outer and an inner shadow.
  const shape = {
    kind: "path" as const,
    x: 40,
    y: 60,
    width: 198,
    height: 16,
    d: "M8 0L192 0A8 8 0 0 1 198 2.7085L198 13.2915A8 8 0 0 1 192 16L8 16A8 8 0 0 1 0 8L0 8A8 8 0 0 1 8 0Z",
  };
  const outer: ShadowEntry = {
    type: "shadow",
    nodeId: "bar",
    bounds: { x: 32, y: 56, width: 214, height: 32 },
    shape,
    inner: false,
    offsetX: 0,
    offsetY: 4,
    color: "#00000066",
    radius: 16,
  };
  const inner: ShadowEntry = {
    ...outer,
    bounds: shape,
    inner: true,
    offsetX: 2,
    offsetY: 2,
    radius: 6,
  };
  for (const shadow of [outer, inner]) {
    for (const dpr of RATIOS) {
      const cached = testCanvas(300, 240, dpr);
      const painter = createPainter(list([shadow]));
      painter.paint(cached.ctx, frame(300, 240, dpr));
      painter.paint(cached.ctx, frame(300, 240, dpr));
      expect(inkInside(cached, shadow.bounds)).toBeGreaterThan(0);
      expect(inkOutside(cached, shadow.bounds)).toBe(0);
      const direct = testCanvas(300, 240, dpr);
      drawShadow(direct.ctx, shadow, testEnv(dpr));
      const a = cached.ctx.getImageData(0, 0, 300 * dpr, 240 * dpr).data;
      const b = direct.ctx.getImageData(0, 0, 300 * dpr, 240 * dpr).data;
      let worst = 0;
      for (let i = 3; i < a.length; i += 4)
        worst = Math.max(worst, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
      expect(worst).toBeLessThan(40);
      // The rounded end's corner lies outside the path, so the outer shadow shows there
      // (a box's would be cut out); the inner one stays inside the path.
      const corner = pixelAt(direct, 40.5, 60.5)[3] ?? 0;
      expect(shadow.inner ? corner === 0 : corner > 0).toBe(true);
    }
  }
});
