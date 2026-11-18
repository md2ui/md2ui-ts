// End-to-end timings, Markdown to painted frame: what one update costs a view,
// stage by stage, through the functions the view runs (`groupDocument`,
// `prepareDocument`, `render`, `createPainter`, `paint`), under Pretext with md2ui's
// fonts, with what a view keeps across updates (its kit and its shadow bitmaps). A
// frame ends when a one-pixel read returns, which waits for the canvas to rasterize it.
// Each figure is the best of several runs, against the 16 ms frame budget.
//
// A timing budget, so it runs in `pnpm perf` only (ADR-004), and only with fixtures.
// The machine's load changes every figure: record `uptime` with them.
import type { DisplayList, TextMeasurer } from "@md2ui/contracts";
import { alignNodeIds, diffDisplayLists, RegexKit } from "@md2ui/core";
import {
  createPainter,
  createShadowSprites,
  createTransition,
  type Frame,
  type ShadowSprites,
} from "@md2ui/painter-canvas";
import { beforeAll, expect, inject, test } from "vitest";
import { server } from "vitest/browser";
import { groupDocument, prepareDocument } from "../src/pipeline.ts";
import {
  type CorpusDocument,
  corpusDocument,
  corpusMeasurer,
  facesOf,
  removeSection,
  streamed,
  tickFirstTask,
} from "./live-corpus.ts";

const fixtures = inject("md2uiFixtures");
const VIEW = { width: 1280, height: 800 };
const BUDGET = 16;
const BENTO = "tests-render__home-dashboards__kawsar-ahmed-macos-custom-widget__content";
const DAYLIGHT = "tests-render__home-dashboards__daylight-theme__content";
const SLIDER = "tests__tests-sliders";
const SEQUENCE_RUNS = 3;
const REPLACE_RUNS = 7;

const STAGES = ["group", "prepare", "render", "painter", "paint"] as const;
type Stage = (typeof STAGES)[number];
type Timing = Record<Stage | "total", number>;

let text: TextMeasurer;
let ctx: CanvasRenderingContext2D;

beforeAll(async () => {
  if (fixtures === "") return;
  text = await corpusMeasurer(fixtures);
  const canvas = document.createElement("canvas");
  canvas.width = VIEW.width;
  canvas.height = VIEW.height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2d context");
  ctx = context;
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

/** What a view keeps from one document to the next. */
interface Kept {
  readonly kit: RegexKit;
  readonly sprites: ShadowSprites;
}

const kept = (): Kept => ({ kit: new RegexKit(), sprites: createShadowSprites() });

/** Stage times from the marks taken before, between and after the stages. */
function timing(marks: readonly number[]): Timing {
  const out = { total: (marks.at(-1) ?? 0) - (marks[0] ?? 0) } as Timing;
  STAGES.forEach((stage, i) => {
    out[stage] = (marks[i + 1] ?? Number.NaN) - (marks[i] ?? Number.NaN);
  });
  return out;
}

/** Makes `list`'s painter and paints its first screen: the marks after each. */
function paintList(list: DisplayList, sprites: ShadowSprites): number[] {
  const painter = createPainter(list, sprites);
  const made = performance.now();
  painter.paint(ctx, FRAME);
  ctx.getImageData(0, 0, 1, 1);
  return [made, performance.now()];
}

/** One new document, Markdown to painted frame, by a view keeping `view`. */
function update(doc: CorpusDocument, markdown: string, view: Kept): Timing {
  const marks: number[] = [performance.now()];
  const grouped = groupDocument(markdown, view.kit);
  marks.push(performance.now());
  const prepared = prepareDocument(grouped, facesOf(doc, text));
  marks.push(performance.now());
  const { list } = prepared.render(VIEW.width);
  marks.push(performance.now());
  marks.push(...paintList(list, view.sprites));
  return timing(marks);
}

/** The best of `runs` for each step of a sequence, by total. */
function bestOf(runs: number, run: () => Timing[]): Timing[] {
  let best: Timing[] = [];
  for (let r = 0; r < runs; r++) {
    const times = run();
    best = best.length === 0 ? times : best.map((b, i) => better(b, times[i]));
  }
  return best;
}

const better = (a: Timing, b: Timing | undefined): Timing =>
  b !== undefined && b.total < a.total ? b : a;

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] ?? Number.NaN;
}

/** Logs a sequence's figures; returns its median and worst. */
function summary(name: string, times: readonly Timing[]): { median: number; max: number } {
  const totals = times.map((t) => t.total).sort((a, b) => a - b);
  const worst = times.reduce((a, b) => (b.total > a.total ? b : a));
  const median = percentile(totals, 0.5);
  const max = totals.at(-1) ?? Number.NaN;
  const stages = STAGES.map((s) => `${s} ${worst[s].toFixed(1)}`).join(", ");
  const over = totals.filter((t) => t > BUDGET).length;
  console.log(
    `live | ${server.browser} | ${name} | n ${times.length} | median ${median.toFixed(1)} | p95 ${percentile(totals, 0.95).toFixed(1)} | max ${max.toFixed(1)} | over ${BUDGET} ms ${over} | worst: ${stages}`,
  );
  return { median, max };
}

test.skipIf(fixtures === "")(
  "streaming bento-cards, a delta a frame",
  async () => {
    const doc = await corpusDocument(fixtures, BENTO);
    const frames = streamed(doc.markdown);
    const times = bestOf(SEQUENCE_RUNS, () => {
      const view = kept();
      return frames.map((md) => update(doc, md, view));
    });
    expect(summary("stream bento-cards", times).median).toBeLessThan(BUDGET);
  },
  900_000,
);

/** `doc` shown, then `next` in the same view: the replacement's timing. */
function replacement(doc: CorpusDocument, next: string): Timing[] {
  const view = kept();
  update(doc, doc.markdown, view);
  return [update(doc, next, view)];
}

for (const name of [BENTO, DAYLIGHT]) {
  test.skipIf(fixtures === "")(`replacing ${name} with one section removed`, async () => {
    const doc = await corpusDocument(fixtures, name);
    const next = removeSection(doc.markdown, 2, 1);
    const times = bestOf(REPLACE_RUNS, () => replacement(doc, next));
    expect(summary(`remove a section, ${name}`, times).max).toBeLessThan(BUDGET);
  });
}

test.skipIf(fixtures === "")("replacing daylight-theme with one task ticked", async () => {
  const doc = await corpusDocument(fixtures, DAYLIGHT);
  const times = bestOf(REPLACE_RUNS, () => replacement(doc, tickFirstTask(doc.markdown)));
  expect(summary(`tick a task, ${DAYLIGHT}`, times).max).toBeLessThan(BUDGET);
});

test.skipIf(fixtures === "")(
  "a replacement's animation: the match and the diff once, then each frame",
  async () => {
    const doc = await corpusDocument(fixtures, DAYLIGHT);
    const listOf = (md: string) =>
      prepareDocument(groupDocument(md, new RegexKit()), facesOf(doc, text)).render(VIEW.width)
        .list;
    const before = listOf(doc.markdown);
    const after = listOf(removeSection(doc.markdown, 2, 0));
    const sprites = createShadowSprites();
    let setup = Number.POSITIVE_INFINITY;
    let frame = Number.POSITIVE_INFINITY;
    for (let run = 0; run < REPLACE_RUNS; run++) {
      const start = performance.now();
      const from = alignNodeIds(before, after);
      const transition = createTransition(from, after, diffDisplayLists(from, after), {
        sprites,
      });
      setup = Math.min(setup, performance.now() - start);
      for (const p of [0.25, 0.5, 0.75]) {
        const t = performance.now();
        transition.paint(ctx, FRAME, p);
        ctx.getImageData(0, 0, 1, 1);
        frame = Math.min(frame, performance.now() - t);
      }
    }
    console.log(
      `live | ${server.browser} | animation, ${DAYLIGHT} | match, diff and transition ${setup.toFixed(1)} | best frame ${frame.toFixed(1)}`,
    );
    expect(frame).toBeLessThan(BUDGET);
  },
);

for (const name of [BENTO, DAYLIGHT]) {
  test.skipIf(fixtures === "")(
    `resizing ${name} continuously`,
    async () => {
      const doc = await corpusDocument(fixtures, name);
      const grouped = groupDocument(doc.markdown, new RegexKit());
      const prepared = prepareDocument(grouped, facesOf(doc, text));
      // A drag from 1280 to 767 px, a CSS px a frame, as the view's ResizeObserver sees
      // it: the view relayouts only when the effective width moves.
      const widths = Array.from({ length: 1280 - 767 + 1 }, (_, i) => 1280 - i);
      const times = bestOf(SEQUENCE_RUNS, () => {
        const sprites = createShadowSprites();
        let shown: DisplayList | null = null;
        return widths.map((width) => {
          const marks = [performance.now(), performance.now(), performance.now()];
          const { list } = prepared.render(width);
          marks.push(performance.now());
          if (list === shown) marks.push(performance.now(), performance.now());
          else marks.push(...paintList(list, sprites));
          shown = list;
          return timing(marks);
        });
      });
      expect(summary(`resize 1280 to 767, ${name}`, times).median).toBeLessThan(BUDGET);
    },
    900_000,
  );
}

test.skipIf(fixtures === "")("dragging a slider", async () => {
  const doc = await corpusDocument(fixtures, SLIDER);
  const grouped = groupDocument(doc.markdown, new RegexKit());
  const scene = prepareDocument(grouped, facesOf(doc, text)).render(VIEW.width);
  const slider = scene.list.targets.find((t) => t.kind === "slider");
  if (slider === undefined) throw new Error(`${SLIDER} has no slider`);
  // Each pointer move is one `withStates`, one painter and one frame.
  const times = bestOf(REPLACE_RUNS, () => {
    const sprites = createShadowSprites();
    return Array.from({ length: 60 }, (_, i) => {
      const marks = [performance.now(), performance.now(), performance.now()];
      const list = scene.withStates(new Map([[slider.ordinal, { kind: "value", value: i }]]));
      marks.push(performance.now());
      marks.push(...paintList(list, sprites));
      return timing(marks);
    });
  });
  expect(summary(`slider drag, ${SLIDER}`, times).max).toBeLessThan(BUDGET);
});
