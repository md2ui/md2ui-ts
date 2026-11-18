// What moves when a document of cards is replaced: an identical
// node keeps its place across an edit elsewhere (ADR-104's ids tell identical subtrees
// apart only by occurrence, so the view matches them by place), and what a card does
// when a section above it goes or arrives, or its own content changes as it moves.
// First in the view itself, frames read off its canvas; then frame by frame through the
// transition the view builds, on lists the core paints under the fake measurer.
import type { DisplayList, Rect } from "@md2ui/contracts";
import {
  alignNodeIds,
  createFakeMeasurer,
  diffDisplayLists,
  parseTheme,
  RegexKit,
} from "@md2ui/core";
import { createTransition, type Frame } from "@md2ui/painter-canvas";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { defineMd2uiView, type Md2uiViewElement } from "../src/index.ts";
import { groupDocument, prepareDocument } from "../src/pipeline.ts";
import { WARM_TIMEOUT_MS, warmPipelineWorker } from "./warm-worker.ts";

/** One card per product, its stepper reading `count`, as the Burger Shop writes it. */
const card = (name: string, count: number): string => {
  const id = name.toLowerCase().replaceAll(" ", "-");
  return (
    `### \n__${name}__ ... ___$9.50___\nFreshly made to order.\n\n` +
    `___[View details](agent:product?id=${id})___ ... ` +
    `__[➖](agent:cart-remove?id=${id})__ - **${count}** - __[➕](agent:cart-add?id=${id})__`
  );
};

const NAMES = ["Classic Smash", "Double Pickle", "Garden Deluxe", "Hot Honey", "Truffle Melt"];

const OFFERS = `## Offers\n\n${"Two burgers for the price of one, today only, at every shop. ".repeat(3)}\n\n`;

/** A catalog of cards with these counts, under `above`. */
const catalog = (counts: readonly number[], above = "", names = NAMES): string =>
  `${above}## Burgers\n\n${counts.map((n, i) => card(names[i] ?? "", n)).join("\n\n")}\n\n***\n`;

const PAGE = "#000000";
const CARD = "#FFFFFF";

const THEME = `## Text Styles
Text
- Font Name: sans-serif
- Font size: 15

## Styling & Spacing
### Root
Background color: ${PAGE}
Padding: 16
Spacing: 24
Stack sections: yes
### Heading 3
Background color: ${CARD}
Padding: 14
Spacing: 8
`;

// --- in the view ----------------------------------------------------------------------

const mounted: HTMLElement[] = [];

beforeAll(warmPipelineWorker, WARM_TIMEOUT_MS);

afterEach(() => {
  for (const view of mounted.splice(0)) view.remove();
  vi.restoreAllMocks();
});

function mount(markdown: string, theme: string, style: string): Md2uiViewElement {
  defineMd2uiView();
  const view = document.createElement("md2ui-view");
  view.style.cssText = style;
  view.themeText = theme;
  view.markdown = markdown;
  document.body.append(view);
  mounted.push(view);
  return view;
}

const shadow = (view: HTMLElement): ShadowRoot => {
  if (view.shadowRoot === null) throw new Error("no shadow root");
  return view.shadowRoot;
};

/** The accessibility layer's element for the text starting `text`: placed over its ink. */
const item = (view: HTMLElement, text: string): HTMLElement | undefined =>
  [...(shadow(view).querySelector(".layer")?.children ?? [])].find((e) =>
    e.textContent?.startsWith(text),
  ) as HTMLElement | undefined;

async function shown(view: HTMLElement, text: string): Promise<DOMRect> {
  await vi.waitFor(() => expect(item(view, text)).toBeDefined(), { timeout: 10_000 });
  return item(view, text)?.getBoundingClientRect() ?? new DOMRect();
}

const frame = () => new Promise(requestAnimationFrame);

/** The content canvas's pixels the view shows, those under `masked` (screen) blanked. */
function ink(view: HTMLElement, masked: DOMRect): Uint8ClampedArray {
  const canvas = shadow(view).querySelector("canvas");
  const ctx = canvas?.getContext("2d");
  if (canvas == null || ctx == null) throw new Error("no canvas");
  const box = canvas.getBoundingClientRect();
  const ratio = canvas.width / box.width;
  const shown = view.getBoundingClientRect();
  const top = Math.max(0, Math.floor((shown.top - box.top) * ratio));
  const height = Math.floor((shown.bottom - box.top) * ratio) - top;
  const data = ctx.getImageData(0, top, canvas.width, height).data;
  const x0 = Math.floor((masked.left - box.left) * ratio);
  const x1 = Math.ceil((masked.right - box.left) * ratio);
  const y0 = Math.floor((masked.top - box.top) * ratio) - top;
  const y1 = Math.ceil((masked.bottom - box.top) * ratio) - top;
  for (let y = Math.max(0, y0); y < Math.min(height, y1); y++) {
    data.fill(0, (y * canvas.width + Math.max(0, x0)) * 4, (y * canvas.width + x1) * 4);
  }
  return data;
}

const differing = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n + Math.abs(a.length - b.length);
};

/** A minute-long tween, which the test holds at its middle and ends. */
const HELD = `${THEME}\n## Motion\nDuration: 60000\nEasing: linear\n`;

/** Each stage's animation of the view's tween, held at the whole's middle. */
function holdMiddle(tweens: { mock: { results: { value: unknown }[] } }): Animation[] {
  const stages = tweens.mock.results.map((r) => r.value as Animation);
  for (const stage of stages) {
    stage.pause();
    stage.currentTime = 30_000;
  }
  return stages;
}

/** A rect grown by `by` on every side. */
const grown = (r: DOMRect, by: number): DOMRect =>
  new DOMRect(r.x - by, r.y - by, r.width + 2 * by, r.height + 2 * by);

test("a stepper's 1 that becomes 0 cross-fades alone: every other 0 stays still", async () => {
  const tweens = vi.spyOn(window, "Animation");
  const view = mount(catalog([1, 0, 0, 0]), HELD, "width: 400px; height: 800px");
  await shown(view, "Hot Honey");
  const count = grown(await shown(view, "1"), 4);
  const none = new DOMRect();
  view.markdown = catalog([0, 0, 0, 0]);
  // One animation per stage: exit, move, enter.
  await vi.waitFor(() => expect(tweens).toHaveBeenCalledTimes(3), { timeout: 10_000 });
  const stages = holdMiddle(tweens);
  await frame();
  await frame();
  const middle = { masked: ink(view, count), whole: ink(view, none) };
  expect(stages[1]?.effect?.getComputedTiming().progress).toBe(0.5);
  // Nothing faded whole: the page is the same page.
  expect(shadow(view).querySelector(".fade")).toBeNull();
  for (const stage of stages) stage.finish();
  await frame();
  await frame();
  // Mid-tween, all but the first card's count paints as it ends: no 0 moved or changed.
  expect(differing(middle.masked, ink(view, count))).toBe(0);
  // The count itself is mid-way through its cross-fade.
  expect(differing(middle.whole, ink(view, none))).toBeGreaterThan(0);
});

test("a replacement keeps a repeated line being read where it was on screen", async () => {
  // Every count but the first reads 0, so a 0's id is its occurrence: when the first
  // turns 0 too, each later 0's id names the 0 one entry up (ADR-104).
  const entries = (first: number) =>
    Array.from(
      { length: 40 },
      (_, i) => `Entry ${i + 1} of the list.\n\n${i === 0 ? first : 0}`,
    ).join("\n\n");
  const view = mount(entries(1), THEME, "width: 400px; height: 300px");
  await shown(view, "Entry 40 of the list.");
  // Scrolled so that the first node shown is a 0, the anchor the replacement keeps still.
  const zero = [...(shadow(view).querySelector(".layer")?.children ?? [])].filter(
    (e) => e.textContent === "0",
  )[10];
  const top = view.getBoundingClientRect().top;
  view.scrollTop = (zero?.getBoundingClientRect().top ?? 0) - top - 1;
  await frame();
  await frame();
  const read = "Entry 13 of the list.";
  const before = (await shown(view, read)).top;
  view.markdown = entries(0);
  await vi.waitFor(() => expect(item(view, "1")).toBeUndefined(), { timeout: 10_000 });
  await frame();
  await frame();
  expect((await shown(view, read)).top).toBeCloseTo(before, 0);
});

test("a card that grows above the line being read keeps that line where it was", async () => {
  // One tall card, its top scrolled out of view: an edit inside it, above the view,
  // gives the card a new id and moves its box nowhere, while what is read in it moves
  // down. The line read is kept, not the box's top.
  const menu = (intro: string) =>
    `### \n__Menu__\n\n${intro}\n\n${Array.from({ length: 30 }, (_, i) => `Dish ${i + 1} of the day.`).join("\n\n")}\n`;
  const view = mount(menu("Fresh today."), THEME, "width: 400px; height: 300px");
  await shown(view, "Dish 30 of the day.");
  const top = view.getBoundingClientRect().top;
  view.scrollTop = (await shown(view, "Dish 12 of the day.")).top - top - 4;
  await frame();
  await frame();
  const read = "Dish 14 of the day.";
  const before = (await shown(view, read)).top;
  view.markdown = menu(
    `Fresh today.\n\n${"Our cooks start at dawn, so every bun is warm. ".repeat(4)}`,
  );
  await vi.waitFor(() => expect(item(view, "Our cooks")).toBeDefined(), { timeout: 10_000 });
  await frame();
  await frame();
  expect((await shown(view, read)).top).toBeCloseTo(before, 0);
});

// --- frame by frame -------------------------------------------------------------------

const WIDTH = 420;
const HEIGHT = 2400;

const listOf = (markdown: string): DisplayList =>
  prepareDocument(groupDocument(markdown, new RegexKit()), {
    theme: parseTheme(THEME),
    text: createFakeMeasurer(),
    emojiFamily: () => "emoji",
    highlight: null,
  }).render(WIDTH).list;

const FRAME: Frame = {
  width: WIDTH,
  height: HEIGHT,
  scrollX: 0,
  scrollY: 0,
  pixelRatio: 1,
  images: () => undefined,
  loading: () => undefined,
  offsets: new Map(),
};

/** Where `list`'s content starts across the frame (the painter's `contentOriginX`). */
function originX(list: DisplayList): number {
  const { left, right } = list.padding;
  const slack = Math.max(0, WIDTH - left - right - list.width);
  return left + (list.centered ? slack / 2 : 0);
}

/** `before` replaced by `after` as the view replaces it, scrolled to the top. */
function replacement(before: DisplayList, after: DisplayList) {
  const from = alignNodeIds(before, after);
  const diff = diffDisplayLists(from, after);
  const shift = {
    x: originX(before) - originX(after),
    y: before.padding.top - after.padding.top,
  };
  const transition = createTransition(from, after, diff, { shift });
  const canvas = new OffscreenCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2d context");
  /** The colour at `after`'s content point (x, y), `progress` of the way. */
  const at = (progress: number, x: number, y: number): readonly number[] => {
    transition.paint(ctx, FRAME, progress);
    const px = Math.round(x + originX(after));
    const py = Math.round(y + after.padding.top);
    return [...ctx.getImageData(px, py, 1, 1).data];
  };
  /** The red channel of every pixel of `after`'s content rect `r`, `progress` of the way. */
  const reds = (progress: number, r: Rect): number[] => {
    transition.paint(ctx, FRAME, progress);
    const px = Math.round(r.x + originX(after));
    const py = Math.round(r.y + after.padding.top);
    const data = ctx.getImageData(px, py, Math.ceil(r.width), Math.ceil(r.height)).data;
    return [...data].filter((_, i) => i % 4 === 0);
  };
  return { from, diff, at, reds, shift };
}

/** The cards' boxes: their white fills, in paint order. */
const cardBoxes = (list: DisplayList): Rect[] =>
  list.entries.flatMap((e) =>
    e.type === "fill" && e.paint.kind === "color" && e.paint.color.startsWith(CARD.toLowerCase())
      ? [e.bounds]
      : [],
  );

/** The text entries that paint `text`: their node ids and bounds. */
const texts = (list: DisplayList, text: string): { id: string; box: Rect }[] =>
  list.entries.flatMap((e) =>
    e.type === "text" && e.runs.map((r) => r.text).join("") === text
      ? [{ id: e.nodeId, box: e.bounds }]
      : [],
  );

const WHITE = [255, 255, 255, 255];
const BLACK = [0, 0, 0, 255];

/** `r` moved by (dx, dy). */
const by = (r: Rect, dx: number, dy: number): Rect => ({ ...r, x: r.x + dx, y: r.y + dy });

/**
 * A point of `old` (a box of `before`, at its place in `after`'s frame) that nothing
 * paints half way when everything in `after` slides by `dy`, and no text of `before`
 * covers: where a box that slides has left, and one that cross-fades has not.
 */
function leftBy(old: Rect, before: DisplayList, after: DisplayList, dy: number): [number, number] {
  const halfway = [
    ...cardBoxes(after),
    ...after.entries.filter((e) => e.type === "text").map((e) => e.bounds),
  ].map((r) => by(r, 0, -dy / 2));
  const others = [
    ...halfway,
    ...before.entries.filter((e) => e.type === "text").map((e) => e.bounds),
  ];
  const near = (r: Rect, x: number, y: number) =>
    x >= r.x - 2 && x <= r.x + r.width + 2 && y >= r.y - 2 && y <= r.y + r.height + 2;
  for (let y = old.y + old.height - 3; y > old.y + 3; y -= 1) {
    for (let x = old.x + 8; x < old.x + old.width - 8; x += 4) {
      if (!others.some((r) => near(r, x, y))) return [x, y];
    }
  }
  throw new Error("no point left");
}

test.each([
  ["removed above", catalog([0, 0, 0, 0, 0], OFFERS), catalog([0, 0, 0, 0, 0])],
  ["added above", catalog([0, 0, 0, 0, 0]), catalog([0, 0, 0, 0, 0], OFFERS)],
])("a section %s: each card slides whole, its box with it", (_, was, now) => {
  const before = listOf(was);
  const after = listOf(now);
  const { diff, at, shift } = replacement(before, after);
  // The section's own nodes fade: out when it goes, in when it arrives.
  const offers = texts(was.includes("Offers") ? before : after, "Offers")[0]?.id;
  expect(was.includes("Offers") ? diff.removed : diff.added).toContain(offers);
  // Every card's nodes, its box and its 0 among them, slide as far as the section is tall.
  const title = texts(after, "Truffle Melt")[0];
  const slide = diff.moved.find((m) => m.nodeId === title?.id);
  const dy = (slide?.to.y ?? 0) - (slide?.from.y ?? 0);
  expect(Math.abs(dy)).toBeGreaterThan(40);
  const zeros = new Set(texts(after, "0").map((t) => t.id));
  expect(diff.moved.filter((m) => zeros.has(m.nodeId))).toHaveLength(5);
  // Each card's box and its three buttons, grey pills while the theme leaves the Links
  // family unstyled (md2ui 950989575).
  const boxes = new Set(after.entries.filter((e) => e.type === "fill").map((e) => e.nodeId));
  expect(diff.moved.filter((m) => boxes.has(m.nodeId))).toHaveLength(5 * 4);
  for (const m of diff.moved) expect(m.to.y - m.from.y).toBeCloseTo(dy, 5);
  expect(diff.restyled).toEqual([]);
  // Half way, a point the old box covered and the box half way does not is page black:
  // the box slid off it (a box that cross-faded would leave it half white).
  const old = cardBoxes(before).at(-1);
  if (old === undefined) throw new Error("no card");
  const [x, y] = leftBy(by(old, -shift.x, -shift.y), before, after, dy);
  expect(at(0, x, y)).toEqual(WHITE);
  expect(at(0.5, x, y)).toEqual(BLACK);
});

test("one of identical cards removed: the others keep their ids, the last one fades", () => {
  const same = NAMES.map(() => "Classic Smash");
  const before = listOf(catalog([0, 0, 0, 0, 0], "", same));
  const after = listOf(catalog([0, 0, 0, 0], "", same));
  const { from, diff } = replacement(before, after);
  expect(from).toBe(before);
  expect(diff.added).toEqual([]);
  expect(diff.removed.length).toBeGreaterThan(0);
  for (const id of diff.removed) expect(id).toMatch(/-4$/u);
});

test("a stepper's 1 that turns 0 as its card moves: the count cross-fades on the card", () => {
  // The section above goes and the first card's count turns 1 to 0 in the same update.
  const before = listOf(catalog([1, 0, 0, 0, 0], OFFERS));
  const after = listOf(catalog([0, 0, 0, 0, 0]));
  const { diff, at, reds, shift } = replacement(before, after);
  const [zero, ...rest] = texts(after, "0");
  // Every 0, the new one included, slides with its card, as far as the card's title.
  const moves = new Map(diff.moved.map((m) => [m.nodeId, m.to.y - m.from.y]));
  const dy = moves.get(texts(after, "Classic Smash")[0]?.id ?? "") ?? 0;
  expect(dy).toBeLessThan(-40);
  for (const { id } of rest) expect(moves.get(id)).toBeCloseTo(dy, 5);
  expect(moves.get(zero?.id ?? "")).toBeCloseTo(dy, 5);
  // The 1 and the 0 are one node, restyled: it cross-fades as it rides.
  expect(diff.restyled).toContain(zero?.id);
  expect(diff.removed).toEqual(expect.not.arrayContaining([texts(before, "1")[0]?.id]));
  // The card's box rides too: half way, a point only its old box covered is page black.
  const [box] = cardBoxes(before);
  if (box === undefined || zero === undefined) throw new Error("no card");
  const [x, y] = leftBy(by(box, -shift.x, -shift.y), before, after, dy);
  expect(at(0, x, y)).toEqual(WHITE);
  expect(at(0.5, x, y)).toEqual(BLACK);
  // Half way, the count is on the card, half way there: its ink on the card's white.
  const shade = reds(0.5, by(zero.box, 0, -dy / 2));
  const white = shade.filter((r) => r === 255).length;
  const inked = shade.filter((r) => r < 160).length;
  expect(white).toBeGreaterThan(0);
  expect(inked).toBeGreaterThan(0);
});

test.each([
  ["removed", catalog([0, 0, 0, 0, 0], OFFERS), catalog([0, 0, 0, 0, 0])],
  ["added", catalog([0, 0, 0, 0, 0]), catalog([0, 0, 0, 0, 0], OFFERS)],
])("a section %s: what goes fades out first, what comes fades in last", (kind, was, now) => {
  const before = listOf(was);
  const after = listOf(now);
  const { diff, shift } = replacement(before, after);
  const transition = createTransition(alignNodeIds(before, after), after, diff, { shift });
  const ctx = new OffscreenCanvas(WIDTH, HEIGHT).getContext("2d");
  if (ctx === null) throw new Error("no 2d context");
  const removed = kind === "removed";
  const heading = texts(removed ? before : after, "Offers")[0]?.box;
  if (heading === undefined) throw new Error("no section");
  // Where the heading is drawn: a removed one where it was, as the old list was placed.
  const box = removed ? by(heading, shift.x, shift.y) : heading;
  /** The heading's most opaque pixel, `progress` of the way, on no page background. */
  const alpha = (progress: number): number => {
    transition.paint(ctx, { ...FRAME, background: false }, progress);
    const x = Math.round(box.x + originX(after));
    const y = Math.round(box.y + after.padding.top);
    const data = ctx.getImageData(x, y, Math.ceil(box.width), Math.ceil(box.height)).data;
    return Math.max(...data.filter((_, i) => i % 4 === 3));
  };
  // The cards are half way at the middle either way: a removed section has gone before
  // they get there, and an added one starts only after.
  const title = texts(after, "Truffle Melt")[0];
  expect(diff.moved.some((m) => m.nodeId === title?.id)).toBe(true);
  if (removed) {
    expect(alpha(0)).toBe(255);
    expect(alpha(0.2)).toBeGreaterThan(0);
    expect(alpha(0.45)).toBe(0);
  } else {
    expect(alpha(0.5)).toBe(0);
    expect(alpha(0.8)).toBeGreaterThan(0);
    expect(alpha(1)).toBe(255);
  }
});
