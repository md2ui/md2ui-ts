// A view whose width changes: the document is laid out at the exact width and painted as
// soon as that layout is back, but only the visible part of it; the room around it (one
// screen) is painted again once the width has rested for 100 ms, or at once when the user
// scrolls meanwhile. On the main thread the layout is back in the frame the
// width changed in (resize.browser.test.ts); from a Worker, at its answer, a frame or two
// later (resize-worker.browser.test.ts).
import { afterEach, expect, test, vi } from "vitest";
import { defineMd2uiView, type Md2uiViewElement, type Md2uiViewOptions } from "../src/index.ts";
import { MARKDOWN, THEME } from "./document.ts";

const HEIGHT = 300;

export const frame = (): Promise<number> => new Promise(requestAnimationFrame);

function ink(view: HTMLElement): HTMLCanvasElement {
  const canvas = view.shadowRoot?.querySelector<HTMLCanvasElement>("canvas.ink");
  if (canvas == null) throw new Error("no content canvas");
  return canvas;
}

/** How much of the document the content canvas holds, in CSS px. */
const held = (view: HTMLElement): { width: number; height: number } => ({
  width: Number.parseFloat(ink(view).style.width),
  height: Number.parseFloat(ink(view).style.height),
});

/** Whether the document shown is laid out at the view's width (as it is, at these widths). */
export function laidOutAtWidth(view: HTMLElement): boolean {
  const content = view.shadowRoot?.querySelector<HTMLElement>(".content");
  return content?.style.width === `${view.clientWidth}px`;
}

/**
 * The resize cases, for views registered with `options`; `settled` resolves once a width
 * just set is laid out and painted.
 */
export function resizeCases(
  options: Md2uiViewOptions,
  settled: (view: HTMLElement) => Promise<void>,
): void {
  const mounted: HTMLElement[] = [];

  afterEach(() => {
    for (const el of mounted.splice(0)) el.remove();
  });

  const resized = async (view: HTMLElement, width: number): Promise<void> => {
    view.style.width = `${width}px`;
    await settled(view);
  };

  /** A view taller in content than on screen, painted with the room around what shows. */
  async function mount(): Promise<Md2uiViewElement> {
    defineMd2uiView(options);
    const view = document.createElement("md2ui-view");
    view.style.cssText = `display: block; width: 400px; height: ${HEIGHT}px`;
    view.themeText = THEME;
    view.markdown = MARKDOWN;
    document.body.append(view);
    mounted.push(view);
    await vi.waitFor(() => expect(held(view).height).toBeGreaterThan(HEIGHT), {
      timeout: 10_000,
    });
    return view;
  }

  test("a width change is painted at that width, only where it shows", async () => {
    const view = await mount();
    for (const width of [390, 377, 364]) {
      await resized(view, width);
      expect(laidOutAtWidth(view)).toBe(true);
      expect(held(view)).toEqual({ width: view.clientWidth, height: HEIGHT });
    }
  });

  test("once the width rests, the room around what shows is painted again", async () => {
    const view = await mount();
    await resized(view, 380);
    expect(held(view).height).toBe(HEIGHT);
    await vi.waitFor(() => expect(held(view).height).toBeGreaterThan(HEIGHT), {
      timeout: 2_000,
    });
    expect(held(view).width).toBe(view.clientWidth);
  });

  test("a scroll while the width changes paints the room at once", async () => {
    const view = await mount();
    await resized(view, 380);
    expect(held(view).height).toBe(HEIGHT);
    view.scrollTop += 40;
    // The scroll event, then the paint: two frames, well within the 100 ms rest.
    await frame();
    await frame();
    expect(held(view).height).toBeGreaterThan(HEIGHT);
  });
}
