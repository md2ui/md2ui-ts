// The view's image store: it fetches and decodes what a list names, tells SVG from
// raster, reports a failure instead of throwing, answers md2ui's two placeholders
// (loading, broken), cancels and frees with the view, and loads a picture from a host
// that sends no CORS header as an `<img>`. Those two, an SVG and an `<img>`, are decoded on
// the page, never by the registration's `decode`, which may run in a Worker.
import type { DisplayList } from "@md2ui/contracts";
import { afterEach, expect, inject, test, vi } from "vitest";
import { createImageStore } from "../src/images.ts";
import { createPictures } from "../src/pictures.ts";
import { decodeOnPage } from "./document.ts";

/** The view's visible part, which a page background fills. */
const SCREEN = { width: 8, height: 4 };

afterEach(() => vi.restoreAllMocks());

const SVG = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="4"><rect width="8" height="4"/></svg>',
)}`;

function withImages(...srcs: string[]): DisplayList {
  return {
    version: 1,
    width: 8,
    height: 4,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    centered: false,
    background: { paints: [], shadows: [] },
    targets: [],
    anchors: [],
    entries: srcs.map((src) => ({
      type: "image" as const,
      nodeId: src,
      bounds: { x: 0, y: 0, width: 8, height: 4 },
      src,
      shape: { kind: "rect" as const, x: 0, y: 0, width: 8, height: 4 },
      fit: "auto" as const,
      placeholder: { color: "#000000ff", label: null },
    })),
  };
}

test("an SVG decodes as a vector image, and the view is told to repaint", async () => {
  const onLoad = vi.fn();
  const fetched = vi.spyOn(globalThis, "fetch");
  const decode = vi.fn(decodeOnPage);
  const store = createImageStore(createPictures(decode), document.baseURI, onLoad, () => {});
  store.request(withImages(SVG), 1, SCREEN);
  expect(store.lookup(SVG)).toBeUndefined();
  await vi.waitFor(() => expect(store.lookup(SVG)).toBeDefined());
  expect(onLoad).toHaveBeenCalled();
  expect(store.lookup(SVG)).toMatchObject({ width: 8, height: 4, vector: true });
  store.request(withImages(SVG), 1, SCREEN);
  expect(fetched).toHaveBeenCalledTimes(1);
  expect(decode).not.toHaveBeenCalled();
  store.dispose();
});

test("an image that cannot load is reported with its resolved URL", async () => {
  const onError = vi.fn();
  const store = createImageStore(createPictures(decodeOnPage), document.baseURI, () => {}, onError);
  store.request(withImages("no/such/image.png"), 1, SCREEN);
  await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1));
  expect(onError.mock.calls[0]?.[0]).toBe(new URL("no/such/image.png", document.baseURI).href);
});

// md2ui ADR-406: an image source is a URL; md2ui names no pictures. A `logo:`, `avatar:`
// or `og:` source is a URL of a scheme `fetch` refuses, so it fails without a request.
test("a source of md2ui's retired names fails like any picture that cannot load", async () => {
  const sources = ["logo:example.com", "avatar:ana@example.com", "og:https://example.com"];
  const onError = vi.fn();
  const store = createImageStore(createPictures(decodeOnPage), document.baseURI, () => {}, onError);
  store.request(withImages("no/such/image.png", ...sources), 1, SCREEN);
  await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(1 + sources.length), {
    timeout: 5000,
  });
  for (const src of sources) expect(onError).toHaveBeenCalledWith(src, expect.any(String));
  await vi.waitFor(() => expect(store.lookup("no/such/image.png")).toBeDefined());
  for (const src of sources) expect(store.lookup(src)).toBe(store.lookup("no/such/image.png"));
  store.dispose();
});

/** A 6 × 3 PNG, drawn on a canvas. */
async function png(): Promise<string> {
  const canvas = document.createElement("canvas");
  canvas.width = 6;
  canvas.height = 3;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2d context");
  ctx.fillRect(0, 0, 6, 3);
  return canvas.toDataURL("image/png");
}

test("a raster decodes to an ImageBitmap through fetch", async () => {
  const src = await png();
  const fetched = vi.spyOn(globalThis, "fetch");
  const store = createImageStore(
    createPictures(decodeOnPage),
    document.baseURI,
    () => {},
    () => {},
  );
  store.request(withImages(src), 1, SCREEN);
  await vi.waitFor(() => expect(store.lookup(src)).toBeDefined());
  expect(store.lookup(src)).toMatchObject({ width: 6, height: 3, vector: false });
  expect(store.lookup(src)?.source).toBeInstanceOf(ImageBitmap);
  expect(fetched).toHaveBeenCalledTimes(1);
});

test("dispose cancels what is loading, reports nothing, and frees what was decoded", async () => {
  const src = await png();
  const onError = vi.fn();
  const store = createImageStore(createPictures(decodeOnPage), document.baseURI, () => {}, onError);
  store.request(withImages(src), 1, SCREEN);
  await vi.waitFor(() => expect(store.lookup(src)).toBeDefined());
  const bitmap = store.lookup(src)?.source as ImageBitmap;
  store.request(withImages(SVG), 1, SCREEN);
  store.dispose();
  expect(bitmap.width).toBe(0);
  expect(store.lookup(src)).toBeUndefined();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(onError).not.toHaveBeenCalled();
  expect(store.lookup(SVG)).toBeUndefined();
});

test("dispose empties the <img> an SVG was decoded in, so its picture goes with it", async () => {
  const store = createImageStore(
    createPictures(decodeOnPage),
    document.baseURI,
    () => {},
    () => {},
  );
  store.request(withImages(SVG), 1, SCREEN);
  await vi.waitFor(() => expect(store.lookup(SVG)).toBeDefined());
  const img = store.lookup(SVG)?.source as HTMLImageElement;
  expect(img.getAttribute("src")).not.toBeNull();
  store.dispose();
  expect(img.getAttribute("src")).toBeNull();
});

// --- md2ui's placeholders (`render_placeholders`) --------------------------------------

/** A list holding one photo card: an image paint with the theme's fallback. */
function withCard(src: string, fallbackSrc: string | null): DisplayList {
  const shape = { kind: "rect" as const, x: 0, y: 0, width: 8, height: 4 };
  return {
    ...withImages(),
    entries: [
      {
        type: "fill",
        nodeId: "card",
        bounds: { x: 0, y: 0, width: 8, height: 4 },
        shape,
        paint: { kind: "image", src, fallbackSrc },
      },
    ],
  };
}

/**
 * `fetch` answering by URL: `fail` with a 404, `pending` never, `svg-pending` with SVG
 * headers and a body that never ends; anything else from the network.
 */
function stubFetch(): void {
  const real = globalThis.fetch.bind(globalThis);
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = String(input);
    if (url.includes("fail")) return Promise.resolve(new Response(null, { status: 404 }));
    if (url.includes("svg-pending")) {
      const body = new ReadableStream({ start() {} });
      return Promise.resolve(new Response(body, { headers: { "content-type": "image/svg+xml" } }));
    }
    if (url.includes("pending")) return new Promise(() => {});
    return real(input, init);
  });
}

/** The store once both placeholders are decoded. */
async function ready(store: ReturnType<typeof createImageStore>): Promise<void> {
  await vi.waitFor(() => expect(store.loading("x/pending.png")).toBeDefined());
  store.request(withImages("x/fail.png"), 1, SCREEN);
  await vi.waitFor(() => expect(store.lookup("x/fail.png")).toBeDefined());
}

test("a failed picture answers the broken placeholder, a loading one nothing", async () => {
  stubFetch();
  const onLoad = vi.fn();
  const store = createImageStore(createPictures(decodeOnPage), document.baseURI, onLoad, () => {});
  store.request(withImages("x/pending.png", "x/fail.png"), 1, SCREEN);
  await vi.waitFor(() => expect(store.lookup("x/fail.png")).toBeDefined());
  const broken = store.lookup("x/fail.png");
  expect(broken).toMatchObject({ width: 512, height: 398, vector: false });
  expect(broken?.source).toBeInstanceOf(ImageBitmap);
  // Still loading: nothing, so a photo card keeps painting its fallback.
  expect(store.lookup("x/pending.png")).toBeUndefined();
  // The broken placeholder is md2ui's: its two greys, the sun where md2ui draws it.
  const pixel = (x: number, y: number) => {
    const canvas = new OffscreenCanvas(512, 398);
    const ctx = canvas.getContext("2d");
    if (ctx === null || broken === undefined) throw new Error("no 2d context");
    ctx.drawImage(broken.source, 0, 0);
    return [...ctx.getImageData(x, y, 1, 1).data];
  };
  expect(pixel(4, 4)).toEqual([208, 208, 208, 255]);
  expect(pixel(127, 119)).toEqual([240, 240, 240, 255]); // the sun, at 317,298 of 1280
  expect(pixel(480, 60)).toEqual([208, 208, 208, 255]);
  expect(pixel(500, 100)).toEqual([240, 240, 240, 255]); // the slash, top right
  store.dispose();
});

test("a theme's background image that fails answers the broken placeholder too", async () => {
  stubFetch();
  const store = createImageStore(
    createPictures(decodeOnPage),
    document.baseURI,
    () => {},
    () => {},
  );
  // A list holding nothing but the theme's image: the failure itself asks for the
  // placeholder (md2ui `theme_picture`).
  store.request(withCard("x/fail-theme.png", null), 1, SCREEN);
  await vi.waitFor(() => expect(store.lookup("x/fail-theme.png")).toBeDefined());
  expect(store.lookup("x/fail-theme.png")).toMatchObject({ width: 512, height: 398 });
  store.dispose();
});

test("a photo loading over a failed fallback answers the loading placeholder, broken once it fails", async () => {
  stubFetch();
  const store = createImageStore(
    createPictures(decodeOnPage),
    document.baseURI,
    () => {},
    () => {},
  );
  store.request(withCard("x/pending-photo.png", "x/fail-theme.png"), 1, SCREEN);
  store.request(withCard("x/fail-photo.png", "x/fail-theme.png"), 1, SCREEN);
  store.request(withCard("x/pending-other.png", "x/pending-theme.png"), 1, SCREEN);
  await ready(store);
  const loading = store.loading("x/pending.png");
  const broken = store.lookup("x/fail-theme.png");
  // Nothing of the card's own has failed yet (md2ui `card_photo`).
  expect(store.lookup("x/pending-photo.png")).toBe(loading);
  expect(store.lookup("x/fail-photo.png")).toBe(broken);
  // A fallback still loading is not a failure: the card waits on it, as before.
  expect(store.lookup("x/pending-other.png")).toBeUndefined();
  store.dispose();
});

// md2ui ADR-406: a failed image's `loading` is the broken placeholder its `lookup` is, so
// the painter paints the theme's placeholder for a failed picture in its place; and a
// theme placeholder's own `Image:` is fetched with the list that names it.
test("a failed image answers its broken placeholder to `loading` too, and a stand-in's image is fetched", async () => {
  stubFetch();
  const fetched = vi.spyOn(globalThis, "fetch");
  const store = createImageStore(
    createPictures(decodeOnPage),
    document.baseURI,
    () => {},
    () => {},
  );
  store.request(withImages("x/pending.png"), 1, SCREEN);
  await ready(store);
  expect(store.loading("x/fail.png")).toBe(store.lookup("x/fail.png"));
  expect(store.loading("x/pending.png")).not.toBe(store.lookup("x/fail.png"));
  const list = withImages("x/pending-avatar.png");
  const [image] = list.entries;
  if (image?.type !== "image") throw new Error("no image entry");
  const standIn = {
    paints: [{ kind: "image" as const, src: "x/pending-pattern.svg", fallbackSrc: null }],
    label: null,
  };
  store.request(
    { ...list, entries: [{ ...image, standIn: { loading: standIn, broken: null } }] },
    1,
    SCREEN,
  );
  expect(fetched.mock.calls.some(([url]) => String(url).endsWith("x/pending-pattern.svg"))).toBe(
    true,
  );
  store.dispose();
});

test("a loading image answers the loading placeholder, contained once known to be an SVG", async () => {
  stubFetch();
  const store = createImageStore(
    createPictures(decodeOnPage),
    document.baseURI,
    () => {},
    () => {},
  );
  store.request(withImages("x/pending.png", "x/svg-pending"), 1, SCREEN);
  await vi.waitFor(() => expect(store.loading("x/svg-pending")?.vector).toBe(true));
  const raster = store.loading("x/pending.png");
  const vector = store.loading("x/svg-pending");
  expect(raster).toMatchObject({ width: 512, height: 398, vector: false });
  // One bitmap, read two ways.
  expect(vector?.source).toBe(raster?.source);
  expect(store.lookup("x/svg-pending")).toBeUndefined();
  store.dispose();
});

test("the placeholders decode once per view, with the first content image, and go with it", async () => {
  stubFetch();
  const decodes = vi.spyOn(globalThis, "createImageBitmap");
  const onLoad = vi.fn();
  const store = createImageStore(createPictures(decodeOnPage), document.baseURI, onLoad, () => {});
  // An image paint still loading, with nothing failed, asks for no placeholder.
  store.request(withCard("x/pending-theme.png", null), 1, SCREEN);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(decodes).not.toHaveBeenCalled();
  expect(store.loading("x/pending.png")).toBeUndefined();
  store.request(withImages("x/pending.png"), 1, SCREEN);
  await ready(store);
  // A failure after the placeholders are in asks for a repaint of its own.
  const repaints = onLoad.mock.calls.length;
  store.request(withImages("x/fail-2.png", "x/fail-3.png"), 1, SCREEN);
  await vi.waitFor(() => expect(onLoad.mock.calls.length).toBe(repaints + 2));
  expect(store.lookup("x/fail-3.png")).toBeDefined();
  expect(decodes).toHaveBeenCalledTimes(2);
  const loading = store.loading("x/pending.png")?.source as ImageBitmap;
  const broken = store.lookup("x/fail.png")?.source as ImageBitmap;
  store.dispose();
  expect(loading.width).toBe(0);
  expect(broken.width).toBe(0);
  expect(store.loading("x/pending.png")).toBeUndefined();
  expect(store.lookup("x/fail.png")).toBeUndefined();
});

test("placeholders still decoding when the view goes are freed, not kept", async () => {
  stubFetch();
  const made: ImageBitmap[] = [];
  const real = globalThis.createImageBitmap.bind(globalThis);
  vi.spyOn(globalThis, "createImageBitmap").mockImplementation(async (...args: unknown[]) => {
    const bitmap = await (real as (...a: unknown[]) => Promise<ImageBitmap>)(...args);
    made.push(bitmap);
    return bitmap;
  });
  const onLoad = vi.fn();
  const store = createImageStore(createPictures(decodeOnPage), document.baseURI, onLoad, () => {});
  store.request(withImages("x/pending.png"), 1, SCREEN);
  store.dispose();
  await vi.waitFor(() => expect(made).toHaveLength(2));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(made.every((bitmap) => bitmap.width === 0)).toBe(true);
  expect(onLoad).not.toHaveBeenCalled();
});

// --- a host that sends no CORS header (test/cross-origin.ts) ---------------------------

/** Two requests to another origin and a decode: more than `waitFor`'s default second. */
const LOAD = { timeout: 5000 };

/** `path` on the second origin, under a query no other test asks for. */
const crossOrigin = (path: string): string =>
  new URL(`${path}?t=${crypto.randomUUID()}`, inject("crossOrigin")).href;

/** Whether the second origin was asked for `url` with no origin named: as an `<img>`. */
async function askedAsImage(url: string): Promise<boolean> {
  const response = await fetch(new URL("requests", inject("crossOrigin")));
  const asked = (await response.json()) as { url: string; origin: boolean }[];
  const { pathname, search } = new URL(url);
  return asked.some((r) => r.url === pathname + search && !r.origin);
}

test("a picture from a host without CORS headers loads as an <img>, and is drawn", async () => {
  const raster = crossOrigin("picture.png");
  const vector = crossOrigin("picture.svg");
  const onError = vi.fn();
  const decode = vi.fn(decodeOnPage);
  const store = createImageStore(createPictures(decode), document.baseURI, () => {}, onError);
  store.request(withImages(raster, vector), 1, SCREEN);
  await vi.waitFor(() => {
    expect(store.lookup(raster)).toBeDefined();
    expect(store.lookup(vector)).toBeDefined();
  }, LOAD);
  expect(onError).not.toHaveBeenCalled();
  expect(await askedAsImage(raster)).toBe(true);
  expect(store.lookup(raster)).toMatchObject({ width: 6, height: 3, vector: false });
  expect(store.lookup(raster)?.source).toBeInstanceOf(ImageBitmap);
  // Told a vector by its URL alone: the `<img>` gives no content type.
  expect(store.lookup(vector)).toMatchObject({ width: 6, height: 3, vector: true });
  expect(store.lookup(vector)?.source).toBeInstanceOf(HTMLImageElement);
  // Neither could be fetched as a blob: both were decoded on the page.
  expect(decode).not.toHaveBeenCalled();
  // Drawn, and the canvas it is drawn on can no longer be read.
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  const image = store.lookup(raster);
  if (ctx === null || image === undefined) throw new Error("no 2d context");
  ctx.drawImage(image.source, 0, 0);
  expect(() => canvas.toDataURL()).toThrow();
  store.dispose();
});

test("a missing picture from a host without CORS headers is reported once, and broken", async () => {
  const missing = crossOrigin("missing.png");
  const onError = vi.fn();
  const store = createImageStore(createPictures(decodeOnPage), document.baseURI, () => {}, onError);
  store.request(withImages(missing), 1, SCREEN);
  await vi.waitFor(() => expect(store.lookup(missing)).toBeDefined(), LOAD);
  expect(store.lookup(missing)).toMatchObject({ width: 512, height: 398, vector: false });
  expect(await askedAsImage(missing)).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledWith(missing, expect.any(String));
  store.dispose();
});

test("a view gone while its <img> loads keeps nothing it answers", async () => {
  const slow = crossOrigin("slow.png");
  const made: ImageBitmap[] = [];
  const real = globalThis.createImageBitmap.bind(globalThis);
  vi.spyOn(globalThis, "createImageBitmap").mockImplementation(async (...args: unknown[]) => {
    const bitmap = await (real as (...a: unknown[]) => Promise<ImageBitmap>)(...args);
    made.push(bitmap);
    return bitmap;
  });
  const onLoad = vi.fn();
  const onError = vi.fn();
  // A list of image paints, which asks for no placeholder.
  const store = createImageStore(createPictures(decodeOnPage), document.baseURI, onLoad, onError);
  store.request(withCard(slow, null), 1, SCREEN);
  await vi.waitFor(async () => expect(await askedAsImage(slow)).toBe(true), LOAD);
  store.dispose();
  // The second origin holds the `<img>`'s answer back for 400 ms.
  await new Promise((resolve) => setTimeout(resolve, 800));
  expect(store.lookup(slow)).toBeUndefined();
  expect(onLoad).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(made.every((bitmap) => bitmap.width === 0)).toBe(true);
});

test("a picture painted in a layer (a muted count button's) is fetched", () => {
  stubFetch();
  const fetched = vi.spyOn(globalThis, "fetch");
  const store = createImageStore(
    createPictures(decodeOnPage),
    document.baseURI,
    () => {},
    () => {},
  );
  const [fill] = withCard("x/pending-button.png", null).entries;
  if (fill === undefined) throw new Error("no fill");
  const layer = { type: "layer" as const, nodeId: "count", bounds: fill.bounds, opacity: 0.4 };
  store.request({ ...withImages(), entries: [{ ...layer, entries: [fill] }] }, 1, SCREEN);
  expect(fetched.mock.calls.some(([url]) => String(url).endsWith("x/pending-button.png"))).toBe(
    true,
  );
  store.dispose();
});
