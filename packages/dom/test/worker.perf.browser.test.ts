// The Worker against the main thread (C6 `worker`), on the live tests' cases: a stream, a
// replacement (a section removed; a task ticked), a resize, and a slider drag. Both run
// the view's own pipeline session (session.ts), one called directly, one through Comlink
// in the host's Worker file (pipeline-worker.ts), with md2ui's fonts loaded in the page
// for paint and in the session for measuring.
//
// Two figures per case:
// - latency: from asking the session to the new list painted (a one-pixel read waits for
//   the canvas), what the user waits for;
// - frame gaps: the time between animation frames while the case runs, what the user
//   sees stall. On the main thread a frame waits for the whole pipeline; with a Worker,
//   only for the list's arrival (a structured clone), its painter and its paint.
//
// A timing budget, so it runs in `pnpm perf` only (ADR-004), and only with fixtures.
// The machine's load changes every figure: record `uptime` with them.
import type { DisplayList, FontSource } from "@md2ui/contracts";
import { closedPrefix, RegexKit } from "@md2ui/core";
import { createPainter, createShadowSprites, type Frame } from "@md2ui/painter-canvas";
import { createFontFaces, loadFonts } from "@md2ui/text-pretext";
import { afterAll, beforeAll, expect, inject, test } from "vitest";
import { server } from "vitest/browser";
import { createSession, type PipelineSession } from "../src/session.ts";
import { pipelineThread } from "../src/sessions.ts";
import {
  type CorpusDocument,
  corpusDocument,
  corpusFonts,
  removeSection,
  streamed,
  tickFirstTask,
} from "./live-corpus.ts";

const fixtures = inject("md2uiFixtures");
const VIEW = { width: 1280, height: 800 };
const BENTO = "tests-render__home-dashboards__kawsar-ahmed-macos-custom-widget__content";
const DAYLIGHT = "tests-render__home-dashboards__daylight-theme__content";
const SLIDER = "tests__tests-sliders";
/** Runs per case: a long sequence settles in fewer. */
const RUNS = { sequence: 2, replace: 7, drag: 5 } as const;
/** A frame on a 60 Hz display, with a millisecond of slack. */
const FRAME_MS = 17.7;

const MODES = ["main", "worker"] as const;
type Mode = (typeof MODES)[number];

let fonts: FontSource[] = [];
/** Those the page loaded, as a view hands them to its session. */
let loaded: FontSource[] = [];
let ctx: CanvasRenderingContext2D;
const workers: Worker[] = [];
/** The faces of this thread, as a registration keeps them. */
const faces = createFontFaces();

beforeAll(async () => {
  if (fixtures === "") return;
  fonts = await corpusFonts(fixtures);
  const failed = new Set<FontSource>();
  await loadFonts(fonts, { faces, onFontError: (source) => failed.add(source) });
  loaded = fonts.filter((font) => !failed.has(font));
  if (failed.size > 0)
    console.log(`worker | fonts that did not load: ${[...failed].map((f) => f.family).join(", ")}`);
  const canvas = document.createElement("canvas");
  canvas.width = VIEW.width;
  canvas.height = VIEW.height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2d context");
  ctx = context;
});

afterAll(() => {
  for (const worker of workers.splice(0)) worker.terminate();
});

const FRAME: Frame = {
  ...VIEW,
  scrollX: 0,
  scrollY: 0,
  pixelRatio: 1,
  images: () => undefined,
  loading: () => undefined,
  offsets: new Map(),
};

const openWorker = pipelineThread(() => {
  const worker = new Worker(new URL("./pipeline-worker.ts", import.meta.url), { type: "module" });
  workers.push(worker);
  return worker;
}, faces).open;

/** A session in `mode` that measures `doc` under its theme with the corpus fonts. */
async function sessionFor(mode: Mode, doc: CorpusDocument): Promise<PipelineSession> {
  const session =
    mode === "main"
      ? createSession({ loadFonts: null, kit: new RegexKit(), faces })
      : await openWorker();
  await session.setFaces({ theme: doc.theme, fonts, loaded, pageBase: document.baseURI });
  return session;
}

const nextFrame = (): Promise<number> => new Promise(requestAnimationFrame);

/** Paints `list`'s first screen, as a view does when a list arrives. */
function paint(list: DisplayList, sprites: ReturnType<typeof createShadowSprites>): void {
  createPainter(list, sprites).paint(ctx, FRAME);
  ctx.getImageData(0, 0, 1, 1);
}

interface Figures {
  readonly latency: number[];
  readonly gaps: number[];
}

/**
 * Runs `steps`, one a frame, each asking the session for a list (null: nothing new) and
 * painting it; the latency of each, and every frame gap meanwhile.
 */
async function run(steps: readonly Step[]): Promise<Figures> {
  const sprites = createShadowSprites();
  const gaps: number[] = [];
  let last = await nextFrame();
  let ticking = true;
  const tick = (now: number): void => {
    gaps.push(now - last);
    last = now;
    if (ticking) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  const latency: number[] = [];
  for (const step of steps) {
    await nextFrame();
    const start = performance.now();
    const list = await step();
    if (list !== null) paint(list, sprites);
    latency.push(performance.now() - start);
  }
  ticking = false;
  await nextFrame();
  return { latency, gaps };
}

const sorted = (values: readonly number[]): number[] => [...values].sort((a, b) => a - b);
const at = (values: readonly number[], p: number): number =>
  sorted(values)[Math.min(values.length - 1, Math.floor(p * values.length))] ?? Number.NaN;

/** The run whose worst latency is lowest: best of several, as live.perf reports. */
function best(runs: readonly Figures[]): Figures {
  return runs.reduce((a, b) => (Math.max(...b.latency) < Math.max(...a.latency) ? b : a));
}

/** Logs a case's figures; returns the median frame gap. */
function report(mode: Mode, name: string, figures: Figures): number {
  const { latency, gaps } = figures;
  const f = (n: number) => n.toFixed(1);
  const stalled = gaps.filter((g) => g > FRAME_MS).length;
  console.log(
    `worker | ${server.browser} | ${mode} | ${name} | n ${latency.length} | latency median ${f(at(latency, 0.5))} p95 ${f(at(latency, 0.95))} max ${f(Math.max(...latency))} | frame gaps median ${f(at(gaps, 0.5))} p95 ${f(at(gaps, 0.95))} max ${f(Math.max(...gaps))}, over ${FRAME_MS} ms ${stalled} of ${gaps.length}`,
  );
  return at(gaps, 0.5);
}

type Step = () => Promise<DisplayList | null>;

/** The best of `count` runs, each in a fresh session for `doc`, set up by `prepare`. */
async function bestOf(
  mode: Mode,
  doc: CorpusDocument,
  count: number,
  prepare: (session: PipelineSession) => Promise<Step[]>,
): Promise<Figures> {
  const runs: Figures[] = [];
  for (let r = 0; r < count; r++) {
    const session = await sessionFor(mode, doc);
    runs.push(await run(await prepare(session)));
    session.dispose();
  }
  return best(runs);
}

for (const mode of MODES) {
  test.skipIf(fixtures === "")(
    `${mode}: streaming bento-cards, a delta a frame, every delta and closed blocks only`,
    async () => {
      const doc = await corpusDocument(fixtures, BENTO);
      const frames = streamed(doc.markdown);
      const kit = new RegexKit();
      const prefixes = frames.map((md) => closedPrefix(kit, md).prefix);
      const stream = (closedOnly: boolean) => async (session: PipelineSession) => {
        let asked: string | null = null;
        return frames.map((md, i) => async () => {
          const markdown = closedOnly ? (prefixes[i] ?? "") : md;
          if (markdown === asked) return null;
          asked = markdown;
          return (await session.prepare(markdown, VIEW.width))?.scene.list ?? null;
        });
      };
      report(
        mode,
        "stream bento-cards, every delta",
        await bestOf(mode, doc, RUNS.sequence, stream(false)),
      );
      const gap = report(
        mode,
        `stream bento-cards, closed blocks (${new Set(prefixes).size} documents)`,
        await bestOf(mode, doc, RUNS.sequence, stream(true)),
      );
      if (mode === "worker") expect(gap).toBeLessThan(FRAME_MS);
    },
    900_000,
  );

  const replacements = [
    [BENTO, "remove a section", (md: string) => removeSection(md, 2, 1)],
    [DAYLIGHT, "remove a section", (md: string) => removeSection(md, 2, 1)],
    [DAYLIGHT, "tick a task", tickFirstTask],
  ] as const;
  for (const [name, edit, change] of replacements) {
    test.skipIf(fixtures === "")(
      `${mode}: replacing ${name}, ${edit}`,
      async () => {
        const doc = await corpusDocument(fixtures, name);
        const next = change(doc.markdown);
        const figures = await bestOf(mode, doc, RUNS.replace, async (session) => {
          await session.prepare(doc.markdown, VIEW.width);
          return [async () => (await session.prepare(next, VIEW.width))?.scene.list ?? null];
        });
        report(mode, `${edit}, ${name}`, figures);
      },
      300_000,
    );
  }

  for (const name of [BENTO, DAYLIGHT]) {
    test.skipIf(fixtures === "")(
      `${mode}: resizing ${name} continuously`,
      async () => {
        const doc = await corpusDocument(fixtures, name);
        // A drag from 1280 to 767 px, a CSS px a frame, as the view's ResizeObserver sees it.
        const widths = Array.from({ length: 1280 - 767 + 1 }, (_, i) => 1280 - i);
        const figures = await bestOf(mode, doc, RUNS.sequence, async (session) => {
          await session.prepare(doc.markdown, VIEW.width);
          return widths.map((width) => async () => (await session.render(width))?.list ?? null);
        });
        const gap = report(mode, `resize 1280 to 767, ${name}`, figures);
        if (mode === "worker") expect(gap).toBeLessThan(FRAME_MS);
      },
      900_000,
    );
  }

  test.skipIf(fixtures === "")(
    `${mode}: dragging a slider`,
    async () => {
      const doc = await corpusDocument(fixtures, SLIDER);
      const figures = await bestOf(mode, doc, RUNS.drag, async (session) => {
        const prepared = await session.prepare(doc.markdown, VIEW.width);
        const slider = prepared?.scene.list.targets.find((t) => t.kind === "slider");
        if (slider === undefined) throw new Error(`${SLIDER} has no slider`);
        // Each pointer move is one `withStates`, one painter and one paint.
        return Array.from(
          { length: 60 },
          (_, i) => () =>
            session.withStates(new Map([[slider.ordinal, { kind: "value", value: i }]])),
        );
      });
      report(mode, `slider drag, ${SLIDER}`, figures);
      expect(at(figures.latency, 0.5)).toBeLessThan(FRAME_MS);
    },
    300_000,
  );
}
