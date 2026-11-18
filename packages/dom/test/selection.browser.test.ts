// The painted words, selectable: the accessibility layer holds every painted
// word once, as a transparent span on its glyphs, so the browser selects, copies and
// finds them, while a tap, a link and a code block's scroll work as before and the
// screen shows only the canvas. Input is real (Playwright's clicks and drags), so each
// engine's own selection is what is checked. The pipeline runs in the element's Worker.
import type { Md2uiAction } from "@md2ui/contracts";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { defineMd2uiView, type Md2uiViewElement } from "../src/index.ts";
import { CODE, MARKDOWN, THEME } from "./document.ts";
import { WARM_TIMEOUT_MS, warmPipelineWorker } from "./warm-worker.ts";

const mounted: Md2uiViewElement[] = [];

beforeAll(warmPipelineWorker, WARM_TIMEOUT_MS);

afterEach(() => {
  for (const view of mounted.splice(0)) view.remove();
  getSelection()?.removeAllRanges();
  vi.restoreAllMocks();
});

async function mount(
  markdown = MARKDOWN,
  theme = THEME,
): Promise<{ view: Md2uiViewElement; actions: Md2uiAction[] }> {
  defineMd2uiView();
  const view = document.createElement("md2ui-view");
  view.style.cssText = "width: 500px; height: 400px";
  view.themeText = theme;
  view.markdown = markdown;
  const actions: Md2uiAction[] = [];
  view.addEventListener("md2ui-action", (e) => {
    e.preventDefault();
    actions.push(e.detail);
  });
  document.body.append(view);
  mounted.push(view);
  await vi.waitFor(() => expect(spans(view).length).toBeGreaterThan(0), { timeout: 10_000 });
  return { view, actions };
}

const layerOf = (view: HTMLElement): HTMLElement => {
  const layer = view.shadowRoot?.querySelector<HTMLElement>(".layer");
  if (layer === null || layer === undefined) throw new Error("no layer");
  return layer;
};
const spans = (view: HTMLElement): HTMLElement[] => [
  ...layerOf(view).querySelectorAll<HTMLElement>(".words > span"),
];
/** The span whose text starts with `text`. */
function span(view: HTMLElement, text: string): HTMLElement {
  const found = spans(view).find((s) => s.textContent?.startsWith(text));
  if (found === undefined) throw new Error(`no span "${text}"`);
  return found;
}
/** How far a span's drawn width is from the advance a canvas paints its text at. */
function misfit(el: HTMLElement): number {
  const ctx = new OffscreenCanvas(1, 1).getContext("2d");
  if (ctx === null) throw new Error("no 2d context");
  ctx.font = el.style.font;
  return Math.abs(el.getBoundingClientRect().width - ctx.measureText(el.textContent ?? "").width);
}
const selected = (): string => (getSelection()?.toString() ?? "").replace(/\n+/g, "\n");

test("every painted word is in the layer once, on its glyphs", async () => {
  const { view } = await mount();
  const words = layerOf(view).textContent ?? "";
  // A link's label is painted once: the link's control is named by it, holding no text.
  expect(words.split("Docs")).toHaveLength(2);
  expect(words.split("Paragraph 3 keeps")).toHaveLength(2);
  expect(words).not.toContain("Copy code");
  const paragraph = span(view, "Paragraph 3 keeps");
  expect(paragraph.parentElement?.localName).toBe("p");
  expect(paragraph.parentElement?.textContent).toBe(
    "Paragraph 3 keeps the end of the document below the first screen.",
  );
  expect(misfit(paragraph)).toBeLessThan(0.5);
  expect(getComputedStyle(paragraph).color).toBe("rgba(0, 0, 0, 0)");
});

test("a span is scaled to the canvas's advance where the browser lays its text out otherwise", async () => {
  // Chromium kerns this heading 1 px narrower than its canvas does, and WebKit lays this
  // monospace 2 px wider; Firefox lays both out as its canvas draws them.
  const kerned = "AVAWAy Ta Te fi fl ffi office kerning: To, Ty, LT, 7.5%";
  const mono = "The quick brown fox jumps over the lazy dog, 1,234.";
  const { view } = await mount(
    `# ${kerned}\n\n${mono}`,
    "## Text Styles\nText\n- Font Name: monospace\n- Font size: 13\nHeading1\n- Font Name: sans-serif\n- Font size: 15\n",
  );
  expect(misfit(span(view, kerned))).toBeLessThan(0.25);
  expect(misfit(span(view, mono))).toBeLessThan(0.25);
});

test("the layer paints nothing: the view looks the same without it", async () => {
  const { view } = await mount("# Words 👋\n\nPlain text with **bold**, `code` and 🎉 an emoji.");
  const shot = async () => {
    for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
    return page.screenshot({ element: view, save: false });
  };
  const withLayer = await shot();
  layerOf(view).style.visibility = "hidden";
  expect(await shot()).toBe(withLayer);
});

test("a double click selects a word, and a drag selects across paragraphs as lines of text", async () => {
  const { view, actions } = await mount();
  const third = span(view, "Paragraph 3 keeps");
  // Both paragraphs in sight, so the drag between them scrolls nothing.
  third.scrollIntoView({ block: "center" });
  await userEvent.dblClick(third, { position: { x: 30, y: third.offsetHeight / 2 } });
  expect(selected().trim()).toBe("Paragraph");
  // A press on the selection would drag it: the next selection starts from none.
  getSelection()?.removeAllRanges();
  const fourth = span(view, "Paragraph 4 keeps");
  // To a point inside the test page's viewport, which is narrower than the line.
  await userEvent.dragAndDrop(third, fourth, {
    sourcePosition: { x: 1, y: third.offsetHeight / 2 },
    targetPosition: { x: 100, y: fourth.offsetHeight / 2 },
  });
  expect(selected()).toMatch(
    /^Paragraph 3 keeps the end of the document below the first screen\.\nParagraph 4 \S/,
  );
  expect(actions).toHaveLength(0);
});

test("a click on a link's words follows it; a press there selects nothing", async () => {
  const { view, actions } = await mount();
  const docs = span(view, "Docs");
  await userEvent.click(docs);
  expect(actions).toMatchObject([{ kind: "link", href: "https://other.example/docs" }]);
  await userEvent.dblClick(docs);
  expect(selected()).toBe("");
});

test("a drag that ends on a link in a sentence selects text and follows nothing", async () => {
  const { view, actions } = await mount("Read the [guide](https://example.com/guide) today.");
  const read = span(view, "Read");
  const guide = span(view, "guide");
  await userEvent.dragAndDrop(read, guide, {
    sourcePosition: { x: 1, y: read.offsetHeight / 2 },
    targetPosition: { x: guide.offsetWidth / 2, y: guide.offsetHeight / 2 },
  });
  expect(selected()).toMatch(/^Read the gu/);
  expect(actions).toHaveLength(0);
});

test("after a resize, the words follow the lines at the new width", async () => {
  const sentence = "Words that wrap onto a second line as the view narrows to a phone.";
  const { view } = await mount(sentence);
  const lines = () => spans(view).map((s) => s.textContent);
  expect(lines()).toEqual([sentence]);
  view.style.width = "360px";
  await vi.waitFor(() => expect(lines().length).toBeGreaterThan(1), { timeout: 10_000 });
  expect(spans(view)[0]?.parentElement?.textContent).toBe(sentence);
});

test("a code block's words lie in its scroller and move with its scroll", async () => {
  const { view } = await mount();
  const code = span(view, CODE.split(" ")[0] as string);
  const scroller = code.closest<HTMLElement>(".scroll");
  if (scroller === null) throw new Error("the code is not in its scroller");
  expect(scroller.textContent).toBe(CODE);
  const before = code.getBoundingClientRect().left;
  scroller.scrollLeft = 40;
  expect(code.getBoundingClientRect().left).toBeCloseTo(before - 40, 0);
});

test("an emoji's glyph is hidden, as the transparent text around it is", async () => {
  const { view } = await mount("Waving 👋 hello");
  const glyph = [...layerOf(view).querySelectorAll(".words > span > span")].find(
    (s) => s.textContent === "👋",
  );
  expect(glyph === undefined ? null : getComputedStyle(glyph).opacity).toBe("0");
  expect(span(view, "Waving").parentElement?.textContent).toBe("Waving 👋 hello");
});
