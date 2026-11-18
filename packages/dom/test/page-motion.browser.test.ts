// A new page fades whole: when what is on screen shares
// little with what replaces it, or the host says it is a new message (C6 `motion`), the
// old page is copied once and faded out over the new one by the compositor; no node
// moves. Read off the screen itself: the fade is composited, so no canvas holds the blend.
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { page } from "vitest/browser";
import { defineMd2uiView, type Md2uiViewElement } from "../src/index.ts";
import { WARM_TIMEOUT_MS, warmPipelineWorker } from "./warm-worker.ts";

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
### Heading 3
Background color: ${CARD}
Padding: 14
Spacing: 8
`;

/** A minute-long fade, which a test holds where it reads it. */
const SLOW = `${THEME}\n## Motion\nDuration: 60000\nEasing: linear\n`;

/** White cards on the black page, each its count. */
const cards = (counts: readonly number[]): string =>
  `## Burgers\n\n${counts.map((n, i) => `### \n__Burger ${i + 1}__\n\nFreshly made.\n\n**${n}**`).join("\n\n")}\n`;

/** Another document: one short line at the top, and the page black below it. */
const NOTES = "## Notes\n\nShort.\n";

const mounted: HTMLElement[] = [];

beforeAll(warmPipelineWorker, WARM_TIMEOUT_MS);

afterEach(() => {
  for (const view of mounted.splice(0)) view.remove();
  vi.restoreAllMocks();
});

function mount(
  markdown: string,
  theme = SLOW,
  style = "width: 400px; height: 600px",
): Md2uiViewElement {
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

const item = (view: HTMLElement, text: string): HTMLElement | undefined =>
  [...(shadow(view).querySelector(".layer")?.children ?? [])].find((e) =>
    e.textContent?.startsWith(text),
  ) as HTMLElement | undefined;

async function shown(view: HTMLElement, text: string): Promise<DOMRect> {
  await vi.waitFor(() => expect(item(view, text)).toBeDefined(), { timeout: 10_000 });
  return item(view, text)?.getBoundingClientRect() ?? new DOMRect();
}

const frame = () => new Promise(requestAnimationFrame);
const fadeOf = (view: HTMLElement) => shadow(view).querySelector<HTMLCanvasElement>(".fade");

/** The view as the screen shows it, its content box only: RGBA rows, CSS px at ratio 1. */
async function screen(view: HTMLElement): Promise<ImageData> {
  await frame();
  await frame();
  const png = await page.screenshot({ element: view, save: false });
  const bitmap = await createImageBitmap(
    await (await fetch(`data:image/png;base64,${png}`)).blob(),
  );
  const ctx = new OffscreenCanvas(view.clientWidth, view.clientHeight).getContext("2d");
  if (ctx === null) throw new Error("no 2d context");
  const scale = bitmap.width / view.getBoundingClientRect().width;
  ctx.drawImage(
    bitmap,
    0,
    0,
    view.clientWidth * scale,
    view.clientHeight * scale,
    0,
    0,
    view.clientWidth,
    view.clientHeight,
  );
  return ctx.getImageData(0, 0, view.clientWidth, view.clientHeight);
}

/** The red channel at the view's point (x, y). */
const red = (image: ImageData, x: number, y: number): number =>
  image.data[(Math.round(y) * image.width + Math.round(x)) * 4] ?? -1;

/** A point inside the first card, right of its title, where the notes paint nothing. */
async function cardPoint(view: HTMLElement): Promise<[number, number]> {
  const title = await shown(view, "Burger 1");
  const box = view.getBoundingClientRect();
  return [title.right - box.left + 24, title.top - box.top + title.height / 2];
}

/** Holds the fade at `at` of its way (linear: opacity 1 - at). */
function holdFade(view: HTMLElement, at: number): Animation {
  const animation = fadeOf(view)?.getAnimations()[0];
  if (animation === undefined) throw new Error("no fade");
  animation.pause();
  animation.currentTime = 60_000 * at;
  return animation;
}

test("a different document fades whole: no node moves, and half way the screen is half each", async () => {
  const tweens = vi.spyOn(window, "Animation");
  const view = mount(cards([0, 0, 0]));
  const [x, y] = await cardPoint(view);
  expect(red(await screen(view), x, y)).toBe(255);
  view.markdown = NOTES;
  await vi.waitFor(() => expect(fadeOf(view)).not.toBeNull(), { timeout: 10_000 });
  const fade = holdFade(view, 0.5);
  // Half the white card over the black the notes leave there.
  const half = red(await screen(view), x, y);
  expect(half).toBeGreaterThan(100);
  expect(half).toBeLessThan(155);
  // No tween: nothing is painted node by node.
  expect(tweens).not.toHaveBeenCalled();
  // At its end the copy is given back, and the new page alone shows.
  const layer = fadeOf(view);
  fade.finish();
  await vi.waitFor(() => expect(fadeOf(view)).toBeNull());
  expect(layer?.width).toBe(0);
  expect(red(await screen(view), x, y)).toBe(0);
});

test("scrolled, the fade starts from exactly what was on screen", async () => {
  const view = mount(cards([0, 0, 0, 0, 0, 0, 0, 0]), SLOW, "width: 400px; height: 300px");
  await shown(view, "Burger 8");
  view.scrollTop = 260;
  const scrolled = view.scrollTop;
  expect(scrolled).toBeGreaterThan(200);
  const before = await screen(view);
  view.markdown = `${NOTES}\n\n${"A line of notes.\n\n".repeat(40)}`;
  await vi.waitFor(() => expect(fadeOf(view)).not.toBeNull(), { timeout: 10_000 });
  holdFade(view, 0);
  const start = await screen(view);
  let differing = 0;
  for (let i = 0; i < before.data.length; i++) {
    if (Math.abs((before.data[i] ?? 0) - (start.data[i] ?? 0)) > 2) differing++;
  }
  expect(differing).toBe(0);
  // A new page keeps the scroll: nothing on it is what was being read.
  expect(view.scrollTop).toBe(scrolled);
});

test('"page": a near-identical document still fades whole', async () => {
  const tweens = vi.spyOn(window, "Animation");
  const view = mount(cards([0, 0, 0]));
  await shown(view, "Burger 3");
  view.motion = "page";
  view.markdown = cards([1, 0, 0]);
  await vi.waitFor(() => expect(fadeOf(view)).not.toBeNull(), { timeout: 10_000 });
  expect(tweens).not.toHaveBeenCalled();
});

test('"edit": a different document never fades whole, and its nodes move in stages', async () => {
  const tweens = vi.spyOn(window, "Animation");
  const view = mount(cards([0, 0, 0]));
  const [x, y] = await cardPoint(view);
  view.motion = "edit";
  view.markdown = NOTES;
  await vi.waitFor(() => expect(tweens).toHaveBeenCalledTimes(3), { timeout: 10_000 });
  for (const r of tweens.mock.results) {
    const stage = r.value as Animation;
    stage.pause();
    stage.currentTime = 30_000;
  }
  expect(fadeOf(view)).toBeNull();
  // Half way, what went has finished its exit: the card is gone, not half there.
  expect(red(await screen(view), x, y)).toBe(0);
});

test.each([
  ["the reader asks for less motion", SLOW, true],
  ["the theme's Duration is 0", `${THEME}\n## Motion\nDuration: 0\n`, false],
])("a new page shows at once when %s", async (_, theme, reduce) => {
  if (reduce) {
    const real = window.matchMedia.bind(window);
    vi.spyOn(window, "matchMedia").mockImplementation((query) =>
      query.includes("prefers-reduced-motion")
        ? ({ ...real(query), matches: true, media: query } as MediaQueryList)
        : real(query),
    );
  }
  const tweens = vi.spyOn(window, "Animation");
  const view = mount(cards([0, 0, 0]), theme);
  const [x, y] = await cardPoint(view);
  view.markdown = NOTES;
  await shown(view, "Short.");
  expect(fadeOf(view)).toBeNull();
  expect(tweens).not.toHaveBeenCalled();
  expect(red(await screen(view), x, y)).toBe(0);
});

test('"auto": the same page with new values everywhere moves in place, not whole', async () => {
  // A board of figures, every one of which changes: little content is kept, the shape is.
  const board = (base: number) =>
    `## Today\n\n${[0, 1, 2, 3].map((i) => `### \n___${base + i * 11}___\n\n**${base * 2 + i}**`).join("\n\n")}\n`;
  const tweens = vi.spyOn(window, "Animation");
  const view = mount(board(120));
  await shown(view, "153");
  view.markdown = board(470);
  await vi.waitFor(() => expect(tweens).toHaveBeenCalledTimes(3), { timeout: 10_000 });
  expect(fadeOf(view)).toBeNull();
});
