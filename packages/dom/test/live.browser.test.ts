// A view across documents: a replacement keeps what the user was reading in place
// (scroll anchoring by node id) and moves into place with a tween the platform times and
// eases as the theme's `## Motion` says, unless the user asked for less motion. Here in the
// element's own Worker; element-main and element-worker run it again on the main thread
// and in a host's Worker.

import { parseTheme } from "@md2ui/core";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { defineMd2uiView, type Md2uiViewElement } from "../src/index.ts";
import { startTween, themeMotion } from "../src/motion.ts";
import { THEME } from "./document.ts";
import { WARM_TIMEOUT_MS, warmPipelineWorker } from "./warm-worker.ts";

const mounted: HTMLElement[] = [];

beforeAll(warmPipelineWorker, WARM_TIMEOUT_MS);

afterEach(() => {
  for (const view of mounted.splice(0)) view.remove();
  vi.restoreAllMocks();
});

/** Paragraphs, each its own block: an insertion above leaves the others' ids alone. */
const paragraphs = (n: number, from = 1): string =>
  Array.from({ length: n }, (_, i) => `Paragraph ${from + i} of the document.`).join("\n\n");

function mount(markdown: string, theme = THEME): Md2uiViewElement {
  defineMd2uiView();
  const view = document.createElement("md2ui-view");
  view.style.cssText = "width: 500px; height: 300px";
  view.themeText = theme;
  view.markdown = markdown;
  document.body.append(view);
  mounted.push(view);
  return view;
}

/** The accessibility layer's element for a text item: placed over its ink. */
function item(view: HTMLElement, text: string): HTMLElement | undefined {
  const layer = view.shadowRoot?.querySelector(".layer");
  return [...(layer?.children ?? [])].find((e) => e.textContent === text) as
    | HTMLElement
    | undefined;
}

const frame = () => new Promise(requestAnimationFrame);

/** Where `text` is on screen, once the view shows it. */
async function screenTop(view: HTMLElement, text: string): Promise<number> {
  await vi.waitFor(() => expect(item(view, text)).toBeDefined(), { timeout: 10_000 });
  return item(view, text)?.getBoundingClientRect().top ?? Number.NaN;
}

function stubReducedMotion(reduce: boolean): void {
  const real = window.matchMedia.bind(window);
  vi.spyOn(window, "matchMedia").mockImplementation((query) =>
    query.includes("prefers-reduced-motion")
      ? ({ ...real(query), matches: reduce, media: query } as MediaQueryList)
      : real(query),
  );
}

test("a replacement keeps the paragraph being read where it was on screen", async () => {
  const view = mount(paragraphs(40));
  const read = "Paragraph 20 of the document.";
  await screenTop(view, read);
  view.scrollTop = 500;
  await frame();
  await frame();
  const before = await screenTop(view, read);
  view.markdown = `${paragraphs(3, 100)}\n\n${paragraphs(40)}`;
  await vi.waitFor(() => expect(item(view, "Paragraph 100 of the document.")).toBeDefined(), {
    timeout: 10_000,
  });
  expect(view.scrollTop).toBeGreaterThan(500);
  expect(await screenTop(view, read)).toBeCloseTo(before, 0);
});

test("at the top of the document, what arrives above is shown, not scrolled past", async () => {
  const view = mount(paragraphs(40));
  await screenTop(view, "Paragraph 1 of the document.");
  view.markdown = `${paragraphs(3, 100)}\n\n${paragraphs(40)}`;
  await vi.waitFor(() => expect(item(view, "Paragraph 100 of the document.")).toBeDefined(), {
    timeout: 10_000,
  });
  expect(view.scrollTop).toBe(0);
});

test("a replacement is tweened, unless the user asked for less motion", async () => {
  const tweens = vi.spyOn(window, "Animation");
  const view = mount(paragraphs(5));
  await screenTop(view, "Paragraph 1 of the document.");
  expect(tweens).not.toHaveBeenCalled();
  view.markdown = paragraphs(6);
  await screenTop(view, "Paragraph 6 of the document.");
  // One animation per stage: exit, move, enter.
  expect(tweens).toHaveBeenCalledTimes(3);
  stubReducedMotion(true);
  view.markdown = paragraphs(7);
  await screenTop(view, "Paragraph 7 of the document.");
  expect(tweens).toHaveBeenCalledTimes(3);
});

test("a stream's deltas, a frame apart, show at once: only the first is tweened", async () => {
  const tweens = vi.spyOn(window, "Animation");
  const view = mount(paragraphs(3));
  await screenTop(view, "Paragraph 1 of the document.");
  // Each delta a frame after the last, however long the pipeline takes to answer it.
  for (let n = 4; n <= 8; n++) {
    view.markdown = paragraphs(n);
    await frame();
  }
  await screenTop(view, "Paragraph 8 of the document.");
  expect(tweens).toHaveBeenCalledTimes(3);
});

test("a tween's progress is eased by the platform, each stage on its own", () => {
  const ease = (easing: string) => startTween({ duration: 60_000, easing });
  // A one-step easing that jumps at its start shows the stage's end as soon as it starts;
  // one that jumps at its end shows its start: the progress read is the eased one. At
  // the start, only the exit stage has started.
  expect(ease("steps(1, start)")?.progress()).toEqual({ exit: 1, move: 0, enter: 0 });
  expect(ease("steps(1, end)")?.progress()).toEqual({ exit: 0, move: 0, enter: 0 });
  expect(ease("linear")?.done()).toBe(false);
  expect(startTween({ duration: 0, easing: "linear" })).toBeNull();
});

test("reduced motion always wins, over any theme", () => {
  stubReducedMotion(true);
  expect(startTween({ duration: 60_000, easing: "linear" })).toBeNull();
});

test("the theme's easing runs as Web Animations reads it; one it rejects is the default", () => {
  const motion = (text: string) => themeMotion(parseTheme(`## Motion\n${text}`));
  const fallback = parseTheme("").motion.easing;
  expect(motion("Duration: 90\nEasing: linear(0, 0.3 40%, 1)")).toEqual({
    duration: 90,
    easing: "linear(0, 0.3 40%, 1)",
  });
  expect(motion("Easing: steps(4, jump-none)").easing).toBe("steps(4, jump-none)");
  // A list is a CSS property's syntax, not an easing; x outside 0..1 is out of range.
  for (const bad of ["ease, linear", "cubic-bezier(2, 0, 0, 1)", "bouncy", "220ms"]) {
    expect(motion(`Duration: 90\nEasing: ${bad}`)).toEqual({ duration: 90, easing: fallback });
  }
});

test("a view tweens with its theme's duration and easing", async () => {
  const tweens = vi.spyOn(window, "Animation");
  const view = mount(paragraphs(2), `${THEME}\n## Motion\nDuration: 640\nEasing: ease-in\n`);
  await screenTop(view, "Paragraph 1 of the document.");
  view.markdown = paragraphs(3);
  await screenTop(view, "Paragraph 3 of the document.");
  // Each stage over its part of the duration, eased as the theme says: in all, 640 ms.
  expect(tweens.mock.calls.map(([effect]) => effect?.getTiming())).toMatchObject([
    { delay: 0, duration: 256, easing: "ease-in" },
    { delay: 96, duration: 448, easing: "ease-in" },
    { delay: 352, duration: 288, easing: "ease-in" },
  ]);
});

test("a theme with Duration: 0 never tweens", async () => {
  const tweens = vi.spyOn(window, "Animation");
  const view = mount(paragraphs(2), `${THEME}\n## Motion\nDuration: 0\n`);
  await screenTop(view, "Paragraph 1 of the document.");
  view.markdown = paragraphs(3);
  await screenTop(view, "Paragraph 3 of the document.");
  expect(tweens).not.toHaveBeenCalled();
});
