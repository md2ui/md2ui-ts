// What a view holds and gives back: each font face once in the page however often fonts
// and themes are set, canvases emptied while the view is far off screen and painted
// again before it shows, and emptied when it is removed; a
// hidden page's canvases and images given back, which a back-forward cache would
// otherwise keep beside the next page. Here in
// the element's own Worker; element-main and element-worker run it again on the main
// thread and in a host's Worker.
import inter from "@fontsource/inter/files/inter-latin-400-normal.woff2?url";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { defineMd2uiView, type Md2uiViewElement } from "../src/index.ts";
import { MARKDOWN, THEME } from "./document.ts";
import { WARM_TIMEOUT_MS, warmPipelineWorker } from "./warm-worker.ts";

const FAMILY = "md2ui-test-once";
/** The theme, its text in the font the views are given. */
const FONT_THEME = THEME.replaceAll("Font Name: sans-serif", `Font Name: ${FAMILY}`);

const mounted: HTMLElement[] = [];

beforeAll(warmPipelineWorker, WARM_TIMEOUT_MS);

afterEach(() => {
  for (const el of mounted.splice(0)) el.remove();
  vi.restoreAllMocks();
});

function mount(style = "width: 400px; height: 300px", before?: HTMLElement): Md2uiViewElement {
  defineMd2uiView();
  const view = document.createElement("md2ui-view");
  view.style.cssText = style;
  view.themeText = THEME;
  view.markdown = MARKDOWN;
  if (before === undefined) document.body.append(view);
  else before.after(view);
  mounted.push(view);
  return view;
}

/** A block `height` tall, first on the page. */
function spacer(height: number): HTMLElement {
  const el = document.createElement("div");
  el.style.height = `${height}px`;
  document.body.prepend(el);
  mounted.push(el);
  return el;
}

const canvases = (view: HTMLElement): HTMLCanvasElement[] => [
  ...(view.shadowRoot?.querySelectorAll("canvas") ?? []),
];
const sizes = (view: HTMLElement): string[] => canvases(view).map((c) => `${c.width}x${c.height}`);

/** Painted: both canvases sized, and the layer filled. */
async function painted(view: HTMLElement): Promise<void> {
  await vi.waitFor(
    () => {
      expect(view.shadowRoot?.querySelector(".layer")?.children.length ?? 0).toBeGreaterThan(0);
      for (const c of canvases(view)) expect(c.width * c.height).toBeGreaterThan(0);
    },
    { timeout: 10_000 },
  );
}

const frames = async (n: number): Promise<void> => {
  for (let i = 0; i < n; i++) await new Promise(requestAnimationFrame);
};

/** The faces of `family` in the page's font set. */
function facesOf(family: string): number {
  let n = 0;
  document.fonts.forEach((face) => {
    if (face.family.replace(/"/g, "") === family) n += 1;
  });
  return n;
}

/** Whether `canvas`'s box covers the part of `view` the window shows, to the pixel. */
function covers(view: HTMLElement, canvas: HTMLCanvasElement): boolean {
  const box = view.getBoundingClientRect();
  const ink = canvas.getBoundingClientRect();
  const top = Math.max(box.top, 0);
  const bottom = Math.min(box.bottom, window.innerHeight);
  return ink.top <= top + 1 && ink.bottom >= bottom - 1 && canvas.width > 0;
}

test("a font the theme does not draw in is never loaded into the page", async () => {
  const unused = "md2ui-test-unused";
  const a = mount();
  a.fonts = [
    { family: FAMILY, url: inter, weight: 400 },
    { family: unused, url: inter, weight: 400 },
  ];
  a.themeText = FONT_THEME;
  await painted(a);
  await vi.waitFor(() => expect(facesOf(FAMILY)).toBe(1));
  expect(facesOf(unused)).toBe(0);
});

test("a font named again, by a theme set again, its fonts set again or another view, is one face", async () => {
  const fonts = () => [{ family: FAMILY, url: inter, weight: 400 }];
  const a = mount();
  a.fonts = fonts();
  a.themeText = FONT_THEME;
  await painted(a);
  await vi.waitFor(() => expect(facesOf(FAMILY)).toBe(1));
  const size = document.fonts.size;
  for (let i = 0; i < 3; i++) {
    a.fonts = fonts();
    a.themeText = `${FONT_THEME}${"\n".repeat(i + 1)}`;
  }
  const b = mount();
  b.fonts = fonts();
  b.themeText = FONT_THEME;
  await painted(b);
  // Long enough for a face made again to load and join the set.
  await frames(4);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(facesOf(FAMILY)).toBe(1);
  expect(document.fonts.size).toBe(size);
});

test("far off screen a view empties its canvases, and paints them again when it comes back", async () => {
  const view = mount();
  await painted(view);
  const room = spacer(4 * window.innerHeight);
  await vi.waitFor(() => expect(sizes(view)).toEqual(["0x0", "0x0"]));
  room.remove();
  await painted(view);
  for (const c of canvases(view)) expect(covers(view, c)).toBe(true);
});

test("within a screen of the window a view keeps its canvases, painted where it will show first", async () => {
  const above = spacer(window.innerHeight + 40);
  const view = mount("width: 400px", above);
  const below = document.createElement("div");
  below.style.height = `${2 * window.innerHeight}px`;
  view.after(below);
  mounted.push(below);
  // Just below the window: its top is painted before it shows.
  await painted(view);
  // Nothing runs between the scroll and the check but layout: what the compositor shows.
  window.scrollTo(0, 300);
  for (const c of canvases(view)) expect(covers(view, c)).toBe(true);
  // Just above the window: its bottom is painted before it shows.
  const end = view.getBoundingClientRect().bottom + window.scrollY;
  window.scrollTo(0, end + 40);
  await frames(3);
  window.scrollTo(0, end - 200);
  for (const c of canvases(view)) expect(covers(view, c)).toBe(true);
  window.scrollTo(0, 0);
});

test("a view removed empties its canvases at once", async () => {
  const view = mount();
  await painted(view);
  const held = canvases(view);
  view.remove();
  expect(held.map((c) => `${c.width}x${c.height}`)).toEqual(["0x0", "0x0"]);
});

/** A 6 × 3 PNG, as a data URL. */
function png(): string {
  const canvas = document.createElement("canvas");
  canvas.width = 6;
  canvas.height = 3;
  canvas.getContext("2d")?.fillRect(0, 0, 6, 3);
  return canvas.toDataURL("image/png");
}

test("a page hidden gives back its canvases and images, and paints them again when shown from the cache", async () => {
  const src = png();
  // The bitmaps the view draws: the picture's is decoded in the Worker.
  const bitmaps: ImageBitmap[] = [];
  const draw = CanvasRenderingContext2D.prototype.drawImage;
  vi.spyOn(CanvasRenderingContext2D.prototype, "drawImage").mockImplementation(function (
    this: CanvasRenderingContext2D,
    ...args: unknown[]
  ) {
    if (args[0] instanceof ImageBitmap) bitmaps.push(args[0]);
    (draw as (...a: unknown[]) => void).apply(this, args);
  });
  const fetched = vi.spyOn(globalThis, "fetch");
  const asked = (): number => fetched.mock.calls.filter(([input]) => String(input) === src).length;
  const view = mount();
  view.markdown = `![photo](${src})\n\n${MARKDOWN}`;
  await painted(view);
  await vi.waitFor(() => expect(asked()).toBe(1));
  await vi.waitFor(() => expect(bitmaps.some((b) => b.width === 6)).toBe(true));

  window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: true }));
  expect(sizes(view)).toEqual(["0x0", "0x0"]);
  // A closed bitmap reports no size.
  for (const bitmap of bitmaps) expect(bitmap.width).toBe(0);

  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  await painted(view);
  await vi.waitFor(() => expect(asked()).toBe(2));
});
