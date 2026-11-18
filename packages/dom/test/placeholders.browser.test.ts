// md2ui's two placeholders, painted (md2ui `layout_image_card_tests`,
// `theme_image_fallback_tests`): real documents through the real core, the view's image
// store and the painter. A photo card still loading paints its theme fallback, or the
// loading placeholder when that fallback failed; one that failed paints the broken
// placeholder; a theme's background image that failed paints the broken placeholder
// where it would have painted; a content image paints the loading placeholder until it
// arrives or fails, contained when it is known to be an SVG. An image with no picture,
// `![alt]()` (md2ui ADR-406, `image_no_picture_tests`), is neither: a quiet box in the
// picture background. Each is a paint state only: every box stays where the loaded
// document has it.
import type { DisplayList, FillEntry, GroupingNode, ImageEntry, Shape } from "@md2ui/contracts";
import {
  bakeLayout,
  documentSizer,
  effectiveWidth,
  generate,
  groupMarkdown,
  layoutInput,
  paintScene,
  parseTheme,
  placeScene,
  RegexKit,
  sizingMeasurer,
} from "@md2ui/core";
import { createPainter } from "@md2ui/painter-canvas";
import { createPretextMeasurer } from "@md2ui/text-pretext";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { createImageStore, type ImageStore } from "../src/images.ts";
import { createPictures } from "../src/pictures.ts";
import { BROKEN_SVG, LOADING_SVG, rasterise } from "../src/placeholders.ts";
import { decodeOnPage } from "./document.ts";

/** The view's visible part, which a page background fills. */
const SCREEN = { width: 1280, height: 800 };
/**
 * The pixel ratio images are asked for at: high enough that none here is decoded below
 * its own size, since these tests are about where a picture paints, not how sharply.
 */
const RATIO = 8;

afterEach(() => vi.restoreAllMocks());

const THEME = `## Text Styles
Text
- Font Name: sans-serif
- Font size: 15
Heading3
- Font Name: sans-serif
- Font size: 17

## Styling & Spacing
### Root
Background color: #FFFFFF
Padding: 16
Spacing: 16

### Image Cards
Background image: x/theme.png
Padding: 12
Spacing: 8
Draw element style: no
`;

/** The theme's fallback: a colour neither placeholder has. */
const MAGENTA = [255, 0, 255] as const;
/** The placeholders' two greys (md2ui's assets). */
const DARK = [208, 208, 208] as const;
const LIGHT = [240, 240, 240] as const;

const WIDTH = 440;

async function listOf(markdown: string, themeText = THEME): Promise<DisplayList> {
  const kit = new RegexKit();
  const theme = parseTheme(themeText);
  const text = await createPretextMeasurer([]);
  const grouping = groupMarkdown(markdown, kit);
  const input = layoutInput(kit, grouping);
  const emojiFamily = () => "sans-serif";
  const measurer = sizingMeasurer(input, theme, text, { emojiFamily });
  const at = effectiveWidth(input, theme, measurer, WIDTH);
  const layout = generate(input, at, theme, measurer);
  bakeLayout(layout, theme);
  const sizer = documentSizer(input, theme, text, { emojiFamily });
  const scene = placeScene(sizer, layout, grouping, at);
  return paintScene(sizer, scene, grouping, null).list;
}

/** A PNG of `rgb`, or of `bitmap` when one is given. */
async function png(fill: readonly number[] | ImageBitmap): Promise<Blob> {
  const w = fill instanceof ImageBitmap ? fill.width : 4;
  const h = fill instanceof ImageBitmap ? fill.height : 4;
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2d context");
  if (fill instanceof ImageBitmap) ctx.drawImage(fill, 0, 0);
  else {
    ctx.fillStyle = `rgb(${fill.join(",")})`;
    ctx.fillRect(0, 0, w, h);
  }
  return canvas.convertToBlob({ type: "image/png" });
}

/** A photo that paints exactly as the broken placeholder does: its own pixels. */
let photo: Blob;
let fallback: Blob;

/**
 * `fetch` by URL: `fail` a 404, `pending` never, `svg-pending` SVG headers and a body
 * that never ends, `theme` the magenta fallback, `ok` the broken placeholder's twin.
 */
function stubFetch(): void {
  vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const url = String(input);
    const image = (blob: Blob) => Promise.resolve(new Response(blob));
    if (url.includes("fail")) return Promise.resolve(new Response(null, { status: 404 }));
    if (url.includes("svg-pending")) {
      const body = new ReadableStream({ start() {} });
      return Promise.resolve(new Response(body, { headers: { "content-type": "image/svg+xml" } }));
    }
    if (url.includes("pending")) return new Promise(() => {});
    if (url.includes("theme")) return image(fallback);
    if (url.includes("ok")) return image(photo);
    return Promise.reject(new Error(`unexpected fetch ${url}`));
  });
}

beforeAll(async () => {
  fallback = await png(MAGENTA);
  const bitmap = await rasterise(BROKEN_SVG);
  photo = await png(bitmap);
  bitmap.close();
}, 60_000);

/**
 * A store that has requested `list` and settled: every image that will arrive or fail
 * has, and the placeholders are decoded once something asks for them (a content image,
 * or a failure).
 */
async function settled(list: DisplayList, srcs: readonly string[]): Promise<ImageStore> {
  stubFetch();
  const store = createImageStore(
    createPictures(decodeOnPage),
    document.baseURI,
    () => {},
    () => {},
  );
  store.request(list, RATIO, SCREEN);
  const asked = images(list).length > 0 || srcs.some((src) => src.includes("fail"));
  await vi.waitFor(() => {
    if (asked) expect(store.loading("any")).toBeDefined();
    for (const src of srcs) expect(store.lookup(src)).toBeDefined();
  });
  return store;
}

/** `list` painted whole at ratio 1 with `store`'s answers; reads pixels in list space. */
function paint(list: DisplayList, store: ImageStore) {
  const { padding } = list;
  const width = padding.left + list.width + padding.right;
  const height = padding.top + list.height + padding.bottom;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx === null) throw new Error("no 2d context");
  createPainter(list).paint(ctx, {
    width,
    height,
    scrollX: 0,
    scrollY: 0,
    pixelRatio: 1,
    images: store.lookup,
    loading: store.loading,
    offsets: new Map(),
  });
  const data = ctx.getImageData(0, 0, width, height).data;
  const at = (x: number, y: number): number[] => {
    const i = (Math.floor(y + padding.top) * width + Math.floor(x + padding.left)) * 4;
    return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
  };
  /** Pixels inside `shape`'s rect within 3 levels of `rgb`. */
  const count = (shape: Shape, rgb: readonly number[]): number => {
    let n = 0;
    for (let y = Math.ceil(shape.y); y < shape.y + shape.height - 1; y++) {
      for (let x = Math.ceil(shape.x); x < shape.x + shape.width - 1; x++) {
        if (near(at(x, y), rgb)) n++;
      }
    }
    return n;
  };
  return { data, at, count };
}

const near = (pixel: readonly number[], rgb: readonly number[], tolerance = 3): boolean =>
  rgb.every((c, i) => Math.abs((pixel[i] ?? 0) - c) <= tolerance);

/** The photo cards: image fills over the theme's `### Image Cards` fallback. */
const cards = (list: DisplayList): FillEntry[] =>
  list.entries.filter(
    (e): e is FillEntry =>
      e.type === "fill" && e.paint.kind === "image" && e.paint.fallbackSrc !== null,
  );

const images = (list: DisplayList): ImageEntry[] =>
  list.entries.filter((e): e is ImageEntry => e.type === "image");

/**
 * Where a point of a 1280 × 994 placeholder lands in `shape`, the placeholder fitted
 * as md2ui fits it: covered, or contained for a vector.
 */
function placeholderPoint(shape: Shape, px: number, py: number, contain = false) {
  const fit = contain ? Math.min : Math.max;
  const scale = fit(shape.width / 1280, shape.height / 994);
  return {
    x: shape.x + shape.width / 2 + (px - 640) * scale,
    y: shape.y + shape.height / 2 + (py - 497) * scale,
  };
}

/** Points that tell the placeholders apart: the slash is light only in the broken one. */
const SLASH = [1250, 250] as const;
/** The sun, light in both. */
const SUN = [317, 298] as const;

const card = (src: string) => `![\n### Payday\nGet paid early.\n](${src})\n`;

test("a failed photo card paints the broken placeholder, never its fallback", async () => {
  const list = await listOf(card("x/fail.png"));
  const [entry] = cards(list);
  if (entry === undefined) throw new Error("no photo card");
  const store = await settled(list, ["x/fail.png"]);
  const { count } = paint(list, store);
  expect(count(entry.shape, MAGENTA)).toBe(0);
  expect(count(entry.shape, DARK)).toBeGreaterThan(2000);
  expect(count(entry.shape, LIGHT)).toBeGreaterThan(500);
  store.dispose();
});

test("a photo card still loading paints its fallback and no placeholder", async () => {
  const list = await listOf(card("x/pending.png"));
  const [entry] = cards(list);
  if (entry === undefined) throw new Error("no photo card");
  const store = await settled(list, ["x/theme.png"]);
  const { count } = paint(list, store);
  expect(count(entry.shape, MAGENTA)).toBeGreaterThan(2000);
  expect(count(entry.shape, DARK)).toBe(0);
  expect(count(entry.shape, LIGHT)).toBe(0);
  store.dispose();
});

test("a content image paints the loading placeholder, then the broken one once it fails", async () => {
  const loadingList = await listOf("![Photo](x/pending.png)\n");
  const failedList = await listOf("![Photo](x/fail.png)\n");
  const [loadingEntry] = images(loadingList);
  const [failedEntry] = images(failedList);
  if (loadingEntry === undefined || failedEntry === undefined) throw new Error("no image");
  expect(failedEntry.shape).toEqual(loadingEntry.shape);
  const store = await settled(failedList, ["x/fail.png"]);
  store.request(loadingList, RATIO, SCREEN);
  const loading = paint(loadingList, store);
  const failed = paint(failedList, store);
  const { shape } = loadingEntry;
  const slash = placeholderPoint(shape, ...SLASH);
  const sun = placeholderPoint(shape, ...SUN);
  expect(near(loading.at(slash.x, slash.y), DARK)).toBe(true);
  expect(near(failed.at(slash.x, slash.y), LIGHT)).toBe(true);
  expect(near(loading.at(sun.x, sun.y), LIGHT)).toBe(true);
  expect(near(failed.at(sun.x, sun.y), LIGHT)).toBe(true);
  // A picture, never md2ui's no-asset cross: the centre is a placeholder grey.
  const centre = placeholderPoint(shape, 640, 497);
  expect(
    near(loading.at(centre.x, centre.y), DARK) || near(loading.at(centre.x, centre.y), LIGHT),
  ).toBe(true);
  store.dispose();
});

test("a content image known to be an SVG while loading paints the placeholder contained", async () => {
  const list = await listOf("![Logo](x/svg-pending.svg)\n");
  const [entry] = images(list);
  if (entry === undefined) throw new Error("no image");
  const store = await settled(list, []);
  await vi.waitFor(() => expect(store.loading("x/svg-pending.svg")?.vector).toBe(true));
  const { at } = paint(list, store);
  const { shape } = entry;
  // The box is wider than the placeholder, so containing it leaves side margins.
  expect(shape.width / shape.height).toBeGreaterThan(1280 / 994 + 0.05);
  const drawnWidth = 1280 * (shape.height / 994);
  const margin = { x: shape.x + (shape.width - drawnWidth) / 4, y: shape.y + shape.height / 2 };
  // The whole placeholder, letterboxed: the sun where a contained picture has it, and
  // the root's white in the margin a cover fit would have filled.
  const sun = placeholderPoint(shape, ...SUN, true);
  expect(near(at(sun.x, sun.y), LIGHT)).toBe(true);
  expect(near(at(margin.x, margin.y), [255, 255, 255])).toBe(true);
  store.dispose();
});

test("a run of photo cards paints every card in the same box loaded, failed or loading", async () => {
  const run = (srcs: readonly string[]) =>
    srcs.map((src, i) => `- ![\n  ### Card ${i}\n  Body ${i}.\n  ](${src})\n`).join("");
  const loadedSrcs = ["x/ok-0.png", "x/ok-1.png", "x/ok-2.png", "x/ok-3.png"];
  const mixedSrcs = ["x/ok-0.png", "x/fail-1.png", "x/ok-2.png", "x/fail-3.png"];
  const loadingSrcs = ["x/ok-0.png", "x/pending-1.png", "x/ok-2.png", "x/pending-3.png"];
  const loaded = await listOf(run(loadedSrcs));
  const mixed = await listOf(run(mixedSrcs));
  const loadingList = await listOf(run(loadingSrcs));
  // The lists differ in their photos' names and nothing else.
  const unnamed = (list: DisplayList) =>
    JSON.stringify(list).replace(/x\/(ok|fail|pending)-\d\.png/g, "photo");
  expect(unnamed(mixed)).toBe(unnamed(loaded));
  expect(unnamed(loadingList)).toBe(unnamed(loaded));
  expect(cards(loaded)).toHaveLength(4);

  const store = await settled(loaded, loadedSrcs);
  store.request(mixed, RATIO, SCREEN);
  store.request(loadingList, RATIO, SCREEN);
  await vi.waitFor(() => {
    for (const src of mixedSrcs) expect(store.lookup(src)).toBeDefined();
  });
  const a = paint(loaded, store);
  const b = paint(mixed, store);
  const c = paint(loadingList, store);
  // A failed card paints exactly what a loaded one does, where it does.
  let apart = 0;
  for (let i = 0; i < a.data.length; i++)
    apart = Math.max(apart, Math.abs((a.data[i] ?? 0) - (b.data[i] ?? 0)));
  expect(apart).toBeLessThanOrEqual(2);
  expect(cards(loaded).reduce((n, e) => n + a.count(e.shape, DARK), 0)).toBeGreaterThan(4000);
  // A card still loading paints its fallback in that same box, and nothing else moves.
  for (const [i, entry] of cards(loadingList).entries()) {
    const fill = i % 2 === 1 ? MAGENTA : DARK;
    expect(c.count(entry.shape, fill)).toBeGreaterThan(1000);
  }
  const inCard = (x: number, y: number) =>
    cards(loaded).some(
      (e) =>
        x >= e.shape.x - 1 &&
        x <= e.shape.x + e.shape.width + 1 &&
        y >= e.shape.y - 1 &&
        y <= e.shape.y + e.shape.height + 1,
    );
  let moved = 0;
  for (let y = 0; y < loaded.height; y++) {
    for (let x = 0; x < loaded.width; x++) {
      if (!inCard(x, y) && !near(c.at(x, y), a.at(x, y), 2)) moved++;
    }
  }
  expect(moved).toBe(0);
  store.dispose();
});

// --- md2ui `theme_picture`: a THEME.md image that fails ------------------------------------

/** THEME with an `### Image Cards` fallback that never loads. */
const FAILED_FALLBACK = THEME.replace("x/theme.png", "x/fail-theme.png");

/** A placeholder's own pixels, at the 512-wide size the store decodes it to. */
interface Reference {
  readonly width: number;
  readonly height: number;
  at(x: number, y: number): number[];
}

async function reference(svg: string): Promise<Reference> {
  const bitmap = await rasterise(svg);
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2d context");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const data = ctx.getImageData(0, 0, width, height).data;
  return {
    width,
    height,
    at: (x, y) => {
      const i =
        (Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) * 4;
      return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0];
    },
  };
}

/**
 * The share of a grid of points inside `shape` that paint as `ref` does cover-fitted
 * and centred in it; the text over it accounts for most of what does not.
 */
function coverMatch(at: (x: number, y: number) => number[], shape: Shape, ref: Reference): number {
  const scale = Math.max(shape.width / ref.width, shape.height / ref.height);
  const cx = shape.x + shape.width / 2;
  const cy = shape.y + shape.height / 2;
  let hits = 0;
  let points = 0;
  for (let y = Math.ceil(shape.y) + 6; y < shape.y + shape.height - 6; y += 3) {
    for (let x = Math.ceil(shape.x) + 6; x < shape.x + shape.width - 6; x += 3) {
      const sx = Math.floor((x + 0.5 - cx) / scale + ref.width / 2);
      const sy = Math.floor((y + 0.5 - cy) / scale + ref.height / 2);
      points++;
      if (near(at(x, y), ref.at(sx, sy), 12)) hits++;
    }
  }
  return hits / points;
}

let brokenRef: Reference;
let loadingRef: Reference;
beforeAll(async () => {
  brokenRef = await reference(BROKEN_SVG);
  loadingRef = await reference(LOADING_SVG);
}, 60_000);

// md2ui theme_image_fallback_tests: test_a_failed_section_image_paints_the_broken_placeholder.
test("a section's theme image that failed paints the broken placeholder, cover-fitted and clipped", async () => {
  const theme = `${THEME}\n### Heading 2\nBackground image: x/fail-section.png\nPadding: 16\nCorner radius: 20\n`;
  const list = await listOf(
    "## Trip notes\n\nThis section's background image fails to load.\n",
    theme,
  );
  const section = list.entries.find(
    (e): e is FillEntry =>
      e.type === "fill" && e.paint.kind === "image" && e.paint.src === "x/fail-section.png",
  );
  if (section === undefined) throw new Error("no section image");
  const store = await settled(list, ["x/fail-section.png"]);
  const { at, count } = paint(list, store);
  const { shape } = section;
  expect(coverMatch(at, shape, brokenRef)).toBeGreaterThan(0.9);
  expect(count(shape, DARK)).toBeGreaterThan(2000);
  // Clipped to the section's corners: the root's white shows past the curve.
  expect(near(at(shape.x + 1, shape.y + 1), [255, 255, 255])).toBe(true);
  store.dispose();
});

// md2ui theme_image_fallback_tests: test_a_card_over_a_failed_fallback_loads_then_breaks.
test("a photo card over a failed fallback paints the loading placeholder, the broken one once its photo fails", async () => {
  const loadingList = await listOf(card("x/pending.png"), FAILED_FALLBACK);
  const failedList = await listOf(card("x/fail.png"), FAILED_FALLBACK);
  const [loadingCard] = cards(loadingList);
  const [failedCard] = cards(failedList);
  if (loadingCard === undefined || failedCard === undefined) throw new Error("no photo card");
  expect(failedCard.shape).toEqual(loadingCard.shape);
  const store = await settled(failedList, ["x/fail.png", "x/fail-theme.png"]);
  store.request(loadingList, RATIO, SCREEN);
  const loading = paint(loadingList, store);
  const failed = paint(failedList, store);
  const { shape } = loadingCard;
  const loadingMatch = coverMatch(loading.at, shape, loadingRef);
  const failedMatch = coverMatch(failed.at, shape, brokenRef);
  expect(loadingMatch).toBeGreaterThan(0.9);
  expect(failedMatch).toBeGreaterThan(0.9);
  // Each is the one it claims to be, not the other.
  expect(coverMatch(loading.at, shape, brokenRef)).toBeLessThan(loadingMatch - 0.05);
  expect(coverMatch(failed.at, shape, loadingRef)).toBeLessThan(failedMatch - 0.05);
  store.dispose();
});

test("a run of photo cards over a failed fallback keeps every box, loading or failed", async () => {
  const run = (srcs: readonly string[]) =>
    srcs.map((src, i) => `- ![\n  ### Card ${i}\n  Body ${i}.\n  ](${src})\n`).join("");
  const loadedSrcs = ["x/ok-0.png", "x/ok-1.png", "x/ok-2.png", "x/ok-3.png"];
  const mixedSrcs = ["x/ok-0.png", "x/fail-1.png", "x/ok-2.png", "x/pending-3.png"];
  const loaded = await listOf(run(loadedSrcs), FAILED_FALLBACK);
  const mixed = await listOf(run(mixedSrcs), FAILED_FALLBACK);
  const unnamed = (list: DisplayList) =>
    JSON.stringify(list).replace(/x\/(ok|fail|pending)-\d\.png/g, "photo");
  expect(unnamed(mixed)).toBe(unnamed(loaded));
  expect(cards(loaded)).toHaveLength(4);

  const store = await settled(loaded, [...loadedSrcs, "x/fail-theme.png"]);
  store.request(mixed, RATIO, SCREEN);
  // Until it fails, the photo over a failed fallback answers the loading placeholder:
  // wait for the broken one, which the failed fallback already answers.
  await vi.waitFor(() =>
    expect(store.lookup("x/fail-1.png")).toBe(store.lookup("x/fail-theme.png")),
  );
  const a = paint(loaded, store);
  const b = paint(mixed, store);
  const [, failedCard, , loadingCard] = cards(mixed);
  if (failedCard === undefined || loadingCard === undefined) throw new Error("no cards");
  expect(coverMatch(b.at, failedCard.shape, brokenRef)).toBeGreaterThan(0.9);
  expect(coverMatch(b.at, loadingCard.shape, loadingRef)).toBeGreaterThan(0.9);
  const inCard = (x: number, y: number) =>
    cards(loaded).some(
      (e) =>
        x >= e.shape.x - 1 &&
        x <= e.shape.x + e.shape.width + 1 &&
        y >= e.shape.y - 1 &&
        y <= e.shape.y + e.shape.height + 1,
    );
  let moved = 0;
  for (let y = 0; y < loaded.height; y++) {
    for (let x = 0; x < loaded.width; x++) {
      if (!inCard(x, y) && !near(b.at(x, y), a.at(x, y), 2)) moved++;
    }
  }
  expect(moved).toBe(0);
  store.dispose();
});

// --- md2ui ADR-406: an image with no picture -----------------------------------------------

/** The ids of `markdown`'s image nodes, in document order. */
function imageIds(markdown: string): string[] {
  const ids: string[] = [];
  const walk = (n: GroupingNode): void => {
    if (n.type === "image") ids.push(n.node_id);
    for (const c of n.children) walk(c);
  };
  walk(groupMarkdown(markdown, new RegexKit()));
  return ids;
}

/** `list`'s one entry for the node `nodeId`: its kind and its shape. */
function pictureOf(list: DisplayList, nodeId: string): { type: string; shape: Shape } {
  const own = list.entries.filter((e) => e.nodeId === nodeId);
  expect(own).toHaveLength(1);
  const [entry] = own;
  if (entry === undefined || (entry.type !== "image" && entry.type !== "fill")) {
    throw new Error(`no picture for ${nodeId}`);
  }
  return { type: entry.type, shape: entry.shape };
}

/** Whether (`x`, `y`) lies inside `shape`, `margin` px clear of its edge. */
function inside(shape: Shape, x: number, y: number, margin: number): boolean {
  if (shape.kind === "oval") {
    const rx = shape.width / 2 - margin;
    const ry = shape.height / 2 - margin;
    const dx = (x - (shape.x + shape.width / 2)) / rx;
    const dy = (y - (shape.y + shape.height / 2)) / ry;
    return dx * dx + dy * dy <= 1;
  }
  return (
    x >= shape.x + margin &&
    x <= shape.x + shape.width - margin &&
    y >= shape.y + margin &&
    y <= shape.y + shape.height - margin
  );
}

// md2ui image_no_picture_tests: test_it_paints_a_quiet_empty_box and
// test_nothing_is_fetched_and_nothing_loads. The document also holds a picture still
// loading, so the loading placeholder is decoded and would show if the empty one asked.
test("an empty-source image paints a quiet box in its exact shape, and nothing else", async () => {
  for (const params of ["", "?md2ui.shape=circle&md2ui.max_width=120"]) {
    const doc = (src: string) =>
      `## Bay\n\n![Bay](${src}${params})\nSecluded.\n\n![Other](x/pending.png)\n`;
    const empty = await listOf(doc(""));
    const loaded = await listOf(doc("x/ok.png"));
    const [loadedEntry] = images(loaded);
    const [emptyId] = imageIds(doc(""));
    if (loadedEntry === undefined || emptyId === undefined) throw new Error("no image");
    const quiet = pictureOf(empty, emptyId);
    expect(quiet.type).toBe("fill");
    expect(quiet.shape).toEqual(loadedEntry.shape);
    const store = await settled(loaded, ["x/ok.png"]);
    store.request(empty, RATIO, SCREEN);
    const fetched = vi.mocked(fetch).mock.calls.map(([input]) => String(input));
    expect(
      fetched.every((url) => url.includes("x/")),
      fetched.join(),
    ).toBe(true);
    const a = paint(empty, store);
    const b = paint(loaded, store);
    const { shape } = quiet;
    const rect = { x: shape.x - 1, y: shape.y - 1, w: shape.width + 2, h: shape.height + 2 };
    let filled = 0;
    let wrongInside = 0;
    let wrongOutside = 0;
    for (let y = 0; y < empty.height; y++) {
      for (let x = 0; x < empty.width; x++) {
        const px = a.at(x, y);
        const inRect = x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
        if (inside(shape, x + 0.5, y + 0.5, 1)) {
          if (near(px, DARK)) filled++;
          else wrongInside++;
        } else if (!inside(shape, x + 0.5, y + 0.5, -1)) {
          // Outside the shape (its anti-aliased edge aside): exactly the loaded
          // document's pixels beyond the picture, and the root's white in its corners.
          const want = inRect ? [255, 255, 255] : b.at(x, y);
          if (!near(px, want, 2)) wrongOutside++;
        }
      }
    }
    expect(wrongInside, params).toBe(0);
    expect(wrongOutside, params).toBe(0);
    expect(filled, params).toBeGreaterThan(0.9 * shape.width * shape.height * (params ? 0.75 : 1));
    store.dispose();
  }
});

// md2ui image_no_picture_tests: test_an_item_with_no_picture_keeps_its_run, painted.
test("a run with one empty-source image paints every box where a loaded run does", async () => {
  const item = (picture: string, name: string) =>
    `- ${picture}\n  :::1\n  **${name}**\n  A line about ${name}.\n  :::2\n\n`;
  const run = (middle: string) =>
    `## Bays\n\n${item("![A](x/ok-a.png?md2ui.aspect_ratio=4:3)", "A")}${item(middle, "B")}${item("![C](x/ok-c.png)", "C")}`;
  const loaded = await listOf(run("![B](x/ok-b.png)"));
  const mixed = await listOf(run("![B]()"));
  const loadedImages = images(loaded);
  expect(loadedImages).toHaveLength(3);
  const [, middle] = loadedImages;
  const [, emptyId] = imageIds(run("![B]()"));
  if (middle === undefined || emptyId === undefined) throw new Error("no middle image");
  // The quiet box stands exactly where the loaded picture is; every other entry is the
  // same, but for the ids that hash the middle item's content (ADR-104).
  const quiet = pictureOf(mixed, emptyId);
  expect(quiet).toEqual({ type: "fill", shape: middle.shape });
  const others = (list: DisplayList, id: string) =>
    list.entries.filter((e) => e.nodeId !== id).map((e) => ({ ...e, nodeId: "" }));
  expect(others(mixed, emptyId)).toEqual(others(loaded, middle.nodeId));
  expect(mixed.height).toBe(loaded.height);

  const store = await settled(loaded, ["x/ok-a.png", "x/ok-b.png", "x/ok-c.png"]);
  store.request(mixed, RATIO, SCREEN);
  const a = paint(loaded, store);
  const b = paint(mixed, store);
  const { shape } = middle;
  let moved = 0;
  for (let y = 0; y < loaded.height; y++) {
    for (let x = 0; x < loaded.width; x++) {
      const inMiddle =
        x >= shape.x - 1 &&
        x <= shape.x + shape.width + 1 &&
        y >= shape.y - 1 &&
        y <= shape.y + shape.height + 1;
      if (inMiddle) continue;
      if (!near(b.at(x, y), a.at(x, y), 2)) moved++;
    }
  }
  expect(moved).toBe(0);
  expect(b.count(shape, DARK)).toBeGreaterThan(0.95 * (shape.width - 2) * (shape.height - 2));
  store.dispose();
});
