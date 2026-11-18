// The pictures a registration's views share: a raster decoded at about twice
// the size it is drawn, in device pixels, never above its own; decoded again, larger,
// when a view draws it larger, the held decode drawn until then; one decode per URL
// however many views show it, freed when the last of them goes. The views here run in
// the element's own Worker, where their rasters are decoded.

import type { DecodedImage } from "@md2ui/painter-canvas";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { createImageStore } from "../src/images.ts";
import { defineMd2uiView, type Md2uiViewElement } from "../src/index.ts";
import { createPictures } from "../src/pictures.ts";
import { decodeOnPage, THEME } from "./document.ts";
import { WARM_TIMEOUT_MS, warmPipelineWorker } from "./warm-worker.ts";

const mounted: HTMLElement[] = [];

beforeAll(warmPipelineWorker, WARM_TIMEOUT_MS);

afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
  vi.restoreAllMocks();
});

/** The picture: 2,000 × 1,000, so a view a few hundred pixels wide draws it reduced. */
const WIDTH = 2000;
const HEIGHT = 1000;

/** A `WIDTH` × `HEIGHT` PNG as a data URL, `tag` making each test's URL its own. */
function png(tag: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2d context");
  ctx.fillStyle = `rgb(${tag % 256}, 80, 160)`;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  return canvas.toDataURL("image/png");
}

/**
 * Every bitmap the page draws from now on that keeps the picture's 2:1 shape (not a
 * placeholder), once each: a decode, wherever it was made.
 */
function decodes(): ImageBitmap[] {
  const made: ImageBitmap[] = [];
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage").mockImplementation(function (
    this: CanvasRenderingContext2D,
    ...args: unknown[]
  ) {
    const [source] = args;
    const shaped = source instanceof ImageBitmap && Math.abs(source.width - 2 * source.height) <= 1;
    if (shaped && !made.includes(source)) made.push(source);
    (draw as (...a: unknown[]) => void).apply(this, args);
  });
  return made;
}

/** How often `src` was fetched. */
function fetches(src: string): () => number {
  const fetched = vi.spyOn(globalThis, "fetch");
  return () => fetched.mock.calls.filter(([input]) => String(input) === src).length;
}

function mount(src: string, width: number): Md2uiViewElement {
  defineMd2uiView();
  const view = document.createElement("md2ui-view");
  view.style.cssText = `width: ${width}px; height: 300px`;
  view.themeText = THEME;
  view.markdown = `![photo](${src})\n\nA caption.`;
  document.body.append(view);
  mounted.push(view);
  return view;
}

const LOAD = { timeout: 10_000 };

test("a raster is decoded at most twice the device pixels it is drawn in, never above its own", async () => {
  const made = decodes();
  const draws = vi.mocked(CanvasRenderingContext2D.prototype.drawImage);
  mount(png(1), 300);
  const drawn = () => draws.mock.calls.filter(([source]) => made.includes(source as ImageBitmap));
  await vi.waitFor(() => expect(drawn().length).toBeGreaterThan(0), LOAD);
  expect(made[0]?.width).toBeLessThan(WIDTH);
  // Source pixels per device pixel, across: at most two (the decode rounds up by one).
  for (const [, , , sw, , , , dw] of drawn()) {
    expect((sw as number) / ((dw as number) * devicePixelRatio)).toBeLessThanOrEqual(2.01);
  }
  // A picture drawn larger than half its own size is decoded whole: never enlarged.
  const store = createImageStore(createPictures(decodeOnPage), document.baseURI, vi.fn(), vi.fn());
  const small = png(2);
  store.request(listOf(small, 1500, 750), 2, { width: 1500, height: 750 });
  await vi.waitFor(() => expect(store.lookup(small)).toBeDefined(), LOAD);
  expect(store.lookup(small)).toMatchObject({ width: WIDTH, height: HEIGHT });
  store.dispose();
});

test("a picture drawn larger is decoded again, the held decode drawn until it lands", async () => {
  const src = png(3);
  const onLoad = vi.fn();
  const store = createImageStore(createPictures(decodeOnPage), document.baseURI, onLoad, vi.fn());
  store.request(listOf(src, 100, 50), 1, { width: 100, height: 50 });
  await vi.waitFor(() => expect(store.lookup(src)).toBeDefined(), LOAD);
  const first = store.lookup(src);
  expect(first).toMatchObject({ width: 200, height: 100 });
  // Within what the held decode serves: no new decode.
  store.request(listOf(src, 200, 100), 1, { width: 200, height: 100 });
  expect(store.lookup(src)).toBe(first);
  // Beyond it: the held one still answers, then the larger one replaces it.
  store.request(listOf(src, 300, 150), 2, { width: 300, height: 150 });
  expect(store.lookup(src)).toBe(first);
  await vi.waitFor(() => expect(store.lookup(src)?.width).toBe(1200), LOAD);
  expect(store.lookup(src)?.height).toBe(600);
  // The smaller decode is given back once replaced.
  expect((first as DecodedImage).source).toHaveProperty("width", 0);
  store.dispose();
});

test("two views showing one URL share one fetch and one decode", async () => {
  const src = png(4);
  const made = decodes();
  const asked = fetches(src);
  mount(src, 300);
  mount(src, 300);
  await vi.waitFor(() => expect(made.length).toBe(1), LOAD);
  // Long enough for a second view's own load to have shown.
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(asked()).toBe(1);
  expect(made).toHaveLength(1);
});

test("in a Worker, a raster is decoded there: the page never decodes it", async () => {
  const src = png(6);
  const made = decodes();
  const onPage = vi.spyOn(globalThis, "createImageBitmap");
  mount(src, 300);
  await vi.waitFor(() => expect(made.length).toBe(1), LOAD);
  expect(made[0]?.width).toBeLessThan(WIDTH);
  // The placeholders are SVGs, rasterised on the page from an `<img>`; no blob is decoded here.
  expect(onPage.mock.calls.filter(([source]) => source instanceof Blob)).toEqual([]);
});

test("a shared picture is freed when the last view showing it goes, not before", async () => {
  const src = png(5);
  const made = decodes();
  const draws = vi.mocked(CanvasRenderingContext2D.prototype.drawImage);
  const a = mount(src, 300);
  const b = mount(src, 300);
  await vi.waitFor(() => expect(made.length).toBe(1), LOAD);
  const [bitmap] = made;
  // Both views hold it once both have drawn it.
  const drawnBy = () =>
    new Set(draws.mock.contexts.filter((_, i) => draws.mock.calls[i]?.[0] === bitmap)).size;
  await vi.waitFor(() => expect(drawnBy()).toBe(2), LOAD);
  a.remove();
  expect(bitmap?.width).toBeGreaterThan(0);
  b.remove();
  expect(bitmap?.width).toBe(0);
});

test("a decode that lands after the last view let go is given back, not kept", async () => {
  const src = png(7);
  let land = (): void => {};
  const landing = new Promise<void>((resolve) => {
    land = resolve;
  });
  const asked: ImageBitmapOptions[] = [];
  const landed: ImageBitmap[] = [];
  // A decode still on its way, as one in the Worker is when the page is hidden.
  const decode = async (blob: Blob, options: ImageBitmapOptions): Promise<ImageBitmap> => {
    asked.push(options);
    await landing;
    const bitmap = await createImageBitmap(blob, options);
    landed.push(bitmap);
    return bitmap;
  };
  const store = createImageStore(createPictures(decode), document.baseURI, vi.fn(), vi.fn());
  store.request(listOf(src, 100, 50), 1, { width: 100, height: 50 });
  await vi.waitFor(() => expect(asked).toHaveLength(1), LOAD);
  store.dispose();
  land();
  await vi.waitFor(() => expect(landed).toHaveLength(1), LOAD);
  await vi.waitFor(() => expect(landed[0]?.width).toBe(0), LOAD);
});

/** A list naming `src` once, drawn `width` × `height`, cropped to fill. */
function listOf(src: string, width: number, height: number) {
  const shape = { kind: "rect" as const, x: 0, y: 0, width, height };
  return {
    version: 1 as const,
    width,
    height,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    centered: false,
    background: { paints: [], shadows: [] },
    targets: [],
    anchors: [],
    entries: [
      {
        type: "image" as const,
        nodeId: "photo",
        bounds: shape,
        src,
        shape,
        fit: "auto" as const,
        placeholder: { color: "#000000ff", label: null },
      },
    ],
  };
}
