// `<md2ui-view>` with its pipeline in a Worker the host makes (C6 `defineMd2uiView({
// worker })`): the element's whole suite, the live and memory suites run again here,
// every registration giving the Worker the host's two-line file (pipeline-worker.ts),
// and then what only a Worker has: one Worker per registration, a session per view.
import { parseTheme } from "@md2ui/core";
import { createFontFaces } from "@md2ui/text-pretext";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { defineMd2uiView, type Md2uiViewElement } from "../src/index.ts";
import { pipelineThread } from "../src/sessions.ts";
import { MARKDOWN, PADDING, THEME } from "./document.ts";

/** The registration's Worker, started and warmed before the suites, and how many were asked for. */
const made = vi.hoisted(() => ({ workers: 0, worker: null as Worker | null }));

vi.mock(import("../src/element.ts"), async (original) => {
  const actual = await original();
  const worker = (): Worker => {
    made.workers += 1;
    if (made.worker === null) throw new Error("the Worker is made before the suites");
    return made.worker;
  };
  return { ...actual, defineMd2uiView: () => actual.defineMd2uiView({ worker }) };
});

import "./element.browser.test.ts";
import "./live.browser.test.ts";
import "./memory.browser.test.ts";

// The dev server serves the Worker's module graph file by file, which on a first load
// can take longer than a test waits for a view (a host's bundled Worker is one file):
// the registration's Worker is started, and answers once, before the suites.
beforeAll(async () => {
  const worker = new Worker(new URL("./pipeline-worker.ts", import.meta.url), { type: "module" });
  const session = await pipelineThread(() => worker, createFontFaces()).open();
  await session.setFaces({
    theme: parseTheme(THEME),
    fonts: [],
    loaded: [],
    pageBase: document.baseURI,
  });
  await session.prepare(MARKDOWN, 500);
  session.dispose();
  made.worker = worker;
}, 120_000);

const views: HTMLElement[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.remove();
});

function mount(markdown: string, theme: string): Md2uiViewElement {
  defineMd2uiView();
  const view = document.createElement("md2ui-view");
  view.style.cssText = "width: 400px; height: 200px";
  view.themeText = theme;
  view.markdown = markdown;
  document.body.append(view);
  views.push(view);
  return view;
}

/** The accessibility layer's element for `text`, placed over its ink. */
function item(view: HTMLElement, text: string): HTMLElement | undefined {
  const layer = view.shadowRoot?.querySelector(".layer");
  return [...(layer?.children ?? [])].find((e) => e.textContent === text) as
    | HTMLElement
    | undefined;
}

/** How far `text` sits from the view's left edge, once it is shown. */
async function inset(view: HTMLElement, text: string): Promise<number> {
  await vi.waitFor(() => expect(item(view, text)).toBeDefined(), { timeout: 10_000 });
  const box = item(view, text)?.getBoundingClientRect();
  return (box?.left ?? Number.NaN) - view.getBoundingClientRect().left;
}

test("two views share one Worker and no session state", async () => {
  const a = mount("Only in view A.\n", THEME);
  const b = mount("Only in view B.\n", THEME.replace(`Padding: ${PADDING}`, "Padding: 40"));
  // Each view's own document under its own theme, though one Worker sizes both.
  expect(await inset(a, "Only in view A.")).toBeCloseTo(PADDING, 0);
  expect(await inset(b, "Only in view B.")).toBeCloseTo(40, 0);
  expect(item(a, "Only in view B.")).toBeUndefined();
  expect(item(b, "Only in view A.")).toBeUndefined();
  // One Worker for the registration, whatever ran before in this file.
  expect(made.workers).toBe(1);
  // A view that goes releases its session; the other keeps its own.
  a.remove();
  b.markdown = "View B, again.\n";
  expect(await inset(b, "View B, again.")).toBeCloseTo(40, 0);
});
