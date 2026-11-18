// A code block cut at `Max lines` scrolls natively: a transparent scroller lies
// over it in the accessibility layer, the browser scrolls that, and the block is painted
// at its offsets. Input here is real wherever the engine allows it (Playwright's wheel,
// click and keys; a CDP touch in Chromium), so each test sees the browser's own scrolling,
// chaining included, and the block's pixels are read back from the canvas.
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { cdp, server, userEvent } from "vitest/browser";
import { defineMd2uiView, type Md2uiViewElement } from "../src/index.ts";
import { WARM_TIMEOUT_MS, warmPipelineWorker } from "./warm-worker.ts";

const LINES = Array.from({ length: 12 }, (_, i) => `value_${i} = ${i * 7}`);
const FILLER = Array.from({ length: 12 }, (_, i) => `Paragraph ${i} after the code.`);
const MARKDOWN = `# Cut code\n\n\`\`\`\n${LINES.join("\n")}\n\`\`\`\n\n${FILLER.join("\n\n")}\n`;
const THEME = `## Code Blocks
Background color: #101010
Padding: 10
Line spacing: 4
Max lines: 3
`;

const mounted: Md2uiViewElement[] = [];

beforeAll(warmPipelineWorker, WARM_TIMEOUT_MS);

afterEach(() => {
  for (const view of mounted.splice(0)) view.remove();
  vi.restoreAllMocks();
});

function mount(): Md2uiViewElement {
  defineMd2uiView();
  const view = document.createElement("md2ui-view");
  view.style.cssText = "width: 500px; height: 300px";
  view.themeText = THEME;
  view.markdown = MARKDOWN;
  document.body.append(view);
  mounted.push(view);
  return view;
}

const shadow = (view: HTMLElement): ShadowRoot => {
  if (view.shadowRoot === null) throw new Error("no shadow root");
  return view.shadowRoot;
};
const canvasOf = (view: HTMLElement): HTMLCanvasElement => {
  const canvas = shadow(view).querySelector("canvas");
  if (canvas === null) throw new Error("no canvas");
  return canvas;
};
const layerOf = (view: HTMLElement): HTMLElement[] =>
  [...(shadow(view).querySelector(".layer")?.children ?? [])] as HTMLElement[];

/** The code block's scroller, once the view has painted. */
async function scrollerOf(view: HTMLElement): Promise<HTMLElement> {
  let found: HTMLElement | undefined;
  await vi.waitFor(
    () => {
      found = layerOf(view).find((e) => e.textContent === LINES.join("\n"));
      expect(found?.getAttribute("role")).toBe("region");
      expect(canvasOf(view).style.width).not.toBe("");
    },
    { timeout: 10_000 },
  );
  return found as HTMLElement;
}

/** The canvas pixels over `el`, after the next paint. */
async function pixels(view: HTMLElement, el: HTMLElement): Promise<string> {
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const box = el.getBoundingClientRect();
  const canvas = canvasOf(view);
  const at = canvas.getBoundingClientRect();
  const scale = canvas.width / at.width;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no context");
  const data = ctx.getImageData(
    Math.round((box.left - at.left) * scale),
    Math.round((box.top - at.top) * scale),
    Math.round(box.width * scale),
    Math.round(box.height * scale),
  ).data;
  let hash = 0;
  for (let i = 0; i < data.length; i++) hash = (hash * 31 + (data[i] ?? 0)) | 0;
  return `${data.length}:${hash}`;
}

const range = (el: HTMLElement): number => el.scrollHeight - el.clientHeight;

test("a wheel over a cut block scrolls the block, not the view; at its end the next gesture scrolls the view", async () => {
  const view = mount();
  const block = await scrollerOf(view);
  const before = await pixels(view, block);
  expect(range(block)).toBeGreaterThan(0);
  await userEvent.wheel(block, { delta: { y: 30 } });
  await vi.waitFor(() => expect(block.scrollTop).toBeGreaterThan(0));
  expect(view.scrollTop).toBe(0);
  expect(await pixels(view, block)).not.toBe(before);
  // To its end, then a pause long enough to end the gesture (Firefox's wheel transaction
  // lasts 1.5 s): the next one is the view's.
  await userEvent.wheel(block, { delta: { y: 200 }, times: 4 });
  await vi.waitFor(() => expect(block.scrollTop).toBeGreaterThanOrEqual(range(block) - 1));
  await new Promise((r) => setTimeout(r, 2000));
  await userEvent.wheel(block, { delta: { y: 60 } });
  await vi.waitFor(() => expect(view.scrollTop).toBeGreaterThan(0));
});

test("the block is painted at its scroller's offset, as a whole paint paints it", async () => {
  const view = mount();
  const block = await scrollerOf(view);
  const rest = await pixels(view, block);
  block.scrollTop = 25;
  const scrolled = await pixels(view, block);
  expect(scrolled).not.toBe(rest);
  // A new height paints the whole canvas again: the block's own repaint matched it.
  const ctx = canvasOf(view).getContext("2d");
  if (ctx === null) throw new Error("no context");
  const clear = vi.spyOn(ctx, "clearRect");
  view.style.height = "301px";
  await vi.waitFor(() =>
    expect(clear.mock.calls.some(([x, y, w]) => x === 0 && y === 0 && w === view.clientWidth)).toBe(
      true,
    ),
  );
  expect(await pixels(view, block)).toBe(scrolled);
  block.scrollTop = 0;
  expect(await pixels(view, block)).toBe(rest);
});

test("a block keeps its scroller and its offset when a new document replaces the list", async () => {
  const view = mount();
  const block = await scrollerOf(view);
  block.scrollTop = 25;
  const scrolled = await pixels(view, block);
  view.markdown = `${MARKDOWN}\nOne more paragraph.\n`;
  await vi.waitFor(() =>
    expect(layerOf(view).some((e) => e.textContent === "One more paragraph.")).toBe(true),
  );
  expect(await scrollerOf(view)).toBe(block);
  expect(block.scrollTop).toBe(25);
  expect(await pixels(view, block)).toBe(scrolled);
});

test("a tap on the copy button over the block still copies", async () => {
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const view = mount();
  const block = await scrollerOf(view);
  const copy = layerOf(view).find((e) => e.getAttribute("aria-label") === "Copy code");
  if (copy === undefined) throw new Error("no copy button");
  const at = block.getBoundingClientRect();
  const button = copy.getBoundingClientRect();
  await userEvent.click(block, {
    position: {
      x: button.left - at.left + button.width / 2,
      y: button.top - at.top + button.height / 2,
    },
  });
  await vi.waitFor(() => expect(write).toHaveBeenCalledWith(LINES.join("\n")));
  expect(block.scrollTop).toBe(0);
});

test("a focused block is a code region, with no native scrollbar beside the painted thumbs", async () => {
  const view = mount();
  const block = await scrollerOf(view);
  expect(block.offsetWidth - block.clientWidth).toBe(0);
  expect(block.offsetHeight - block.clientHeight).toBe(0);
  expect(block.getAttribute("aria-label")).toBe("Code");
  expect(block.tabIndex).toBe(0);
  block.focus();
  expect(shadow(view).activeElement).toBe(block);
});

// Playwright's WebKit scrolls no focused scroller with the arrow keys, not even a plain
// `overflow: auto` div outside any shadow root, so this runs in the others.
test.skipIf(server.browser === "webkit")("the arrow keys scroll a focused block", async () => {
  const view = mount();
  const block = await scrollerOf(view);
  const before = await pixels(view, block);
  block.focus();
  await userEvent.keyboard("{ArrowDown}{ArrowDown}");
  await vi.waitFor(() => expect(block.scrollTop).toBeGreaterThan(0), { timeout: 5000 });
  expect(view.scrollTop).toBe(0);
  expect(await pixels(view, block)).not.toBe(before);
});

// A real touch, from the browser's input pipeline: CDP, so Chromium only.
test.skipIf(server.browser !== "chromium")("a touch drag scrolls the block", async () => {
  const view = mount();
  const block = await scrollerOf(view);
  const before = await pixels(view, block);
  const frame = window.frameElement?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const box = block.getBoundingClientRect();
  const session = cdp() as unknown as {
    send(method: string, params: object): Promise<unknown>;
  };
  await session.send("Input.synthesizeScrollGesture", {
    x: Math.round(frame.left + box.left + box.width / 2),
    y: Math.round(frame.top + box.top + box.height / 2),
    yDistance: -40,
    gestureSourceType: "touch",
    speed: 400,
  });
  await vi.waitFor(() => expect(block.scrollTop).toBeGreaterThan(0));
  expect(view.scrollTop).toBe(0);
  expect(await pixels(view, block)).not.toBe(before);
});
