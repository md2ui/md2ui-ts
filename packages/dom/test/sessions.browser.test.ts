// Where a view's session runs and what it loads there: a session that loads fonts into
// its own thread (a Worker's, `exposePipeline`) loads only those the theme draws in, as
// each face it loads holds a copy of its data; and a Worker that cannot be made, or does
// not start, leaves every view of its registration on the main thread. A session in a
// Worker is called on the Worker itself: WebKit holds back a message to a MessagePort in
// a Worker by a second at a time (`PipelineHost`). A registration's raster pictures are
// decoded where its sessions run, and on the page when they run there. A host's font URL
// is written against the page, so a Worker loads it from there, not beside its own file.
// A Worker measures a font from another origin in its own face, as the page paints it
// (WebKit's Workers load one only by its bytes), fetching each file once; a font it cannot
// load is reported, never measured in a fallback face in silence.
import type { DisplayList } from "@md2ui/contracts";
import { parseTheme, RegexKit } from "@md2ui/core";
import { createFontFaces, type FontFaceSource, loadFonts } from "@md2ui/text-pretext";
import { afterEach, beforeAll, expect, inject, test, vi } from "vitest";
import { createSession, type PipelineSession } from "../src/session.ts";
import { type OpenSession, pipelineThread } from "../src/sessions.ts";
import { MARKDOWN, THEME } from "./document.ts";
import { WARM_TIMEOUT_MS, warmPipelineWorker } from "./warm-worker.ts";

test("a session loading its own fonts loads the theme's families and the emoji instances, no other", async () => {
  const loaded: FontFaceSource[][] = [];
  const session = createSession({
    loadFonts: async (fonts) => {
      loaded.push([...fonts]);
      return [];
    },
    kit: new RegexKit(),
    faces: createFontFaces(),
  });
  const theme = parseTheme(
    [
      "## Styling & Spacing",
      "### Root",
      "#### Text",
      "- Font name: Inter",
      "## Emoji styles",
      "Font: /fonts/Icons.ttf",
      "### Primary",
      "Emoji fill: 1",
      "",
    ].join("\n"),
  );
  const inter = { family: "Inter", url: "/fonts/Inter.woff2" };
  const icons = { family: "Icons", url: "/fonts/Icons.ttf" };
  const others = [
    { family: "Lora", url: "/fonts/Lora.woff2" },
    { family: "Roboto Mono", url: "/fonts/RobotoMono.woff2" },
  ];
  const fonts = [inter, ...others, icons];
  const pageBase = document.baseURI;
  const { instances } = await session.setFaces({ theme, fonts, loaded: fonts, pageBase });
  expect(instances.map((i) => i.family)).toEqual(["Icons (FILL 1)"]);
  const atPage = (font: FontFaceSource) => ({ ...font, url: new URL(font.url, pageBase).href });
  expect(loaded).toEqual([[inter, icons, ...instances].map(atPage)]);
  session.dispose();
});

test("a session loading its own fonts resolves a relative font URL against the page, not its own file", async () => {
  const loaded: FontFaceSource[] = [];
  const session = createSession({
    loadFonts: async (fonts) => {
      loaded.push(...fonts);
      return [];
    },
    kit: new RegexKit(),
    faces: createFontFaces(),
  });
  const theme = parseTheme(
    ["## Styling & Spacing", "### Root", "#### Text", "- Font name: Inter", ""].join("\n"),
  );
  const fonts = [{ family: "Inter", url: "assets/Inter.woff2" }];
  const pageBase = "https://host.example/app/index.html";
  await session.setFaces({ theme, fonts, loaded: fonts, pageBase });
  expect(loaded.map((font) => font.url)).toEqual(["https://host.example/app/assets/Inter.woff2"]);
  session.dispose();
});

/** Whether a session opened by `open` shows `MARKDOWN`. */
async function shows(open: OpenSession): Promise<boolean> {
  const session = await open();
  await session.setFaces({
    theme: parseTheme(THEME),
    fonts: [],
    loaded: [],
    pageBase: document.baseURI,
  });
  const prepared = await session.prepare(MARKDOWN, 500);
  session.dispose();
  return (prepared?.scene.list.entries.length ?? 0) > 0;
}

test("a Worker that cannot be made leaves the views on the main thread, and is not asked again", async () => {
  let asked = 0;
  const open = pipelineThread(() => {
    asked += 1;
    throw new DOMException("Workers are not allowed here", "SecurityError");
  }, createFontFaces()).open;
  expect(await shows(open)).toBe(true);
  expect(await shows(open)).toBe(true);
  expect(asked).toBe(1);
});

test("a Worker whose file does not load leaves every view waiting for it on the main thread", async () => {
  const made: Worker[] = [];
  const open = pipelineThread(() => {
    const worker = new Worker(new URL("./no-such-worker.js", import.meta.url), {
      type: "module",
    });
    made.push(worker);
    return worker;
  }, createFontFaces()).open;
  // Two views open before the Worker has failed; a third after.
  expect(await Promise.all([shows(open), shows(open)])).toEqual([true, true]);
  expect(await shows(open)).toBe(true);
  expect(made).toHaveLength(1);
});

test(
  "a session in a Worker is called on the Worker itself, never through a MessagePort",
  async () => {
    const worker = new Worker(new URL("./pipeline-worker.ts", import.meta.url), {
      type: "module",
    });
    const toPorts = MessagePort.prototype.postMessage;
    const toWorker = worker.postMessage;
    let onPorts = 0;
    let onWorker = 0;
    MessagePort.prototype.postMessage = function (this: MessagePort, ...args: [unknown]) {
      onPorts += 1;
      toPorts.apply(this, args);
    };
    worker.postMessage = (...args: [unknown]) => {
      onWorker += 1;
      toWorker.apply(worker, args);
    };
    try {
      expect(await shows(pipelineThread(() => worker, createFontFaces()).open)).toBe(true);
    } finally {
      MessagePort.prototype.postMessage = toPorts;
      worker.terminate();
    }
    expect(onPorts).toBe(0);
    // open, setFaces, prepare and close.
    expect(onWorker).toBe(4);
  },
  WARM_TIMEOUT_MS,
);

// A Worker whose module graph the dev server is still serving can fail to load under a
// loaded gate, and its decode then falls back to the page, as it should: load it first.
beforeAll(warmPipelineWorker, WARM_TIMEOUT_MS);

afterEach(() => {
  vi.restoreAllMocks();
});

/** A 400 × 200 PNG. */
async function picture(): Promise<Blob> {
  const canvas = new OffscreenCanvas(400, 200);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2d context");
  ctx.fillStyle = "rgb(200, 80, 40)";
  ctx.fillRect(0, 0, 400, 200);
  return canvas.convertToBlob({ type: "image/png" });
}

const REDUCED: ImageBitmapOptions = { resizeWidth: 100, resizeQuality: "medium" };

test(
  "a Worker decodes a raster and hands the bitmap back: the page decodes nothing",
  async () => {
    const blob = await picture();
    const worker = new Worker(new URL("./pipeline-worker.ts", import.meta.url), {
      type: "module",
    });
    const onPage = vi.spyOn(globalThis, "createImageBitmap");
    try {
      const bitmap = await pipelineThread(() => worker, createFontFaces()).decode(blob, REDUCED);
      expect(bitmap).toBeInstanceOf(ImageBitmap);
      expect([bitmap.width, bitmap.height]).toEqual([100, 50]);
      bitmap.close();
    } finally {
      worker.terminate();
    }
    expect(onPage).not.toHaveBeenCalled();
  },
  WARM_TIMEOUT_MS,
);

test("with no Worker, or one that does not start, pictures are decoded on the page", async () => {
  const blob = await picture();
  const onPage = vi.spyOn(globalThis, "createImageBitmap");
  const none = pipelineThread(false, createFontFaces());
  const unmade = pipelineThread(() => {
    throw new DOMException("Workers are not allowed here", "SecurityError");
  }, createFontFaces());
  const unloaded = pipelineThread(
    () => new Worker(new URL("./no-such-worker.js", import.meta.url), { type: "module" }),
    createFontFaces(),
  );
  for (const thread of [none, unmade, unloaded]) {
    const bitmap = await thread.decode(blob, REDUCED);
    expect([bitmap.width, bitmap.height]).toEqual([100, 50]);
    bitmap.close();
  }
  expect(onPage).toHaveBeenCalledTimes(3);
});

/** A URL on the second origin no other test asks for (test/cross-origin.ts). */
const crossOrigin = (path: string): string =>
  new URL(`${path}?t=${crypto.randomUUID()}`, inject("crossOrigin")).href;

/** The test theme with its text drawn in `family`. */
const themeIn = (family: string) =>
  parseTheme(THEME.replaceAll("Font Name: sans-serif", `Font Name: ${family}`));

/** Where each line of text sits and how wide it was measured. */
const lines = (list: DisplayList | undefined) =>
  list?.entries.flatMap((entry) =>
    entry.type === "text" ? [{ bounds: entry.bounds, x: entry.runs.map((run) => run.x) }] : [],
  );

/** A session in a Worker that runs the host's two-line file. */
async function workerSession(): Promise<{ session: PipelineSession; worker: Worker }> {
  const worker = new Worker(new URL("./pipeline-worker.ts", import.meta.url), { type: "module" });
  return { session: await pipelineThread(() => worker, createFontFaces()).open(), worker };
}

test(
  "a session in a Worker measures a font from another origin in its face, as the page does",
  async () => {
    const family = "md2ui-test-cross-origin";
    const fonts = [{ family, url: crossOrigin("inter.woff2") }];
    const faces = { theme: themeIn(family), fonts, loaded: fonts, pageBase: document.baseURI };
    const pageFaces = createFontFaces();
    await loadFonts(fonts, { faces: pageFaces });
    const onPage = createSession({ loadFonts: null, kit: new RegexKit(), faces: pageFaces });
    await onPage.setFaces(faces);
    const page = await onPage.prepare(MARKDOWN, 500);
    onPage.dispose();
    const { session, worker } = await workerSession();
    try {
      expect((await session.setFaces(faces)).failed).toEqual([]);
      const inWorker = await session.prepare(MARKDOWN, 500);
      expect(lines(inWorker?.scene.list)).toEqual(lines(page?.scene.list));
    } finally {
      worker.terminate();
    }
  },
  WARM_TIMEOUT_MS,
);

test(
  "a Worker fetches a font file once for every face made of it",
  async () => {
    const url = crossOrigin("inter.woff2");
    const family = "md2ui-test-cross-origin-icons";
    // The emoji font and its filled instance: two faces of one file.
    const theme = parseTheme(
      `${THEME}\n## Emoji styles\nFont: ${url}\n### Primary\nEmoji fill: 1\n`,
    );
    const fonts = [{ family, url }];
    const { session, worker } = await workerSession();
    try {
      const set = await session.setFaces({
        theme,
        fonts,
        loaded: fonts,
        pageBase: document.baseURI,
      });
      expect(set.instances).toHaveLength(1);
      expect(set.failed).toEqual([]);
    } finally {
      worker.terminate();
    }
    const asked: { url: string }[] = await (
      await fetch(new URL("requests", inject("crossOrigin")))
    ).json();
    expect(asked.filter((request) => url.endsWith(request.url))).toHaveLength(1);
  },
  WARM_TIMEOUT_MS,
);

test(
  "a font a Worker cannot load is reported by family and URL, not measured in silence",
  async () => {
    const family = "md2ui-test-cross-origin-missing";
    const fonts = [{ family, url: crossOrigin("missing-font.woff2") }];
    const { session, worker } = await workerSession();
    try {
      const { failed } = await session.setFaces({
        theme: themeIn(family),
        fonts,
        loaded: fonts,
        pageBase: document.baseURI,
      });
      expect(failed).toEqual([
        {
          resource: "font",
          url: fonts[0]?.url,
          family,
          message: expect.stringContaining("fallback face"),
        },
      ]);
    } finally {
      worker.terminate();
    }
  },
  WARM_TIMEOUT_MS,
);
