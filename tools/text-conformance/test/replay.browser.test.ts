// ADR-403 under replay: the Pretext measurer that ships runs on md2ui's recorded font
// answers, on the corpus texts md2ui measured. It reports
//   1. what share of Pretext's `measureText` calls the recordings answer, and every gap
//      by class;
//   2. where Pretext's lines differ from md2ui's greedy wrap (the fake measurer fed the
//      same recorded advances), by class and document.
// Both fail on anything unclassified. Runs only when MD2UI_FIXTURES names the fixtures.
import { clearCache } from "@chenglou/pretext";
import type { FontSpec, TextMeasurer } from "@md2ui/contracts";
import { createFakeMeasurer } from "@md2ui/core";
import { createPretextMeasurer } from "@md2ui/text-pretext";
import { expect, inject, test } from "vitest";
import { commands, server } from "vitest/browser";
import {
  type CorpusText,
  causeOf,
  classifyDivergence,
  classifyGap,
  corpusTexts,
  faceKeyOf,
  indexRecords,
  installReplayCanvas,
  plainAdvance,
  type Records,
  type ReplayLog,
  recordsSource,
} from "../src/index.ts";

const fixtures = inject("md2uiFixtures");
/** Pretext's line-fit epsilon in this engine (its `getEngineProfile`). */
const fitEpsilon = server.browser === "webkit" ? 1 / 64 : 0.005;
/** A space or md2ui's hard break (U+2028). */
const BREAKS = new RegExp(`[ ${String.fromCodePoint(0x2028)}]`, "u");

interface Manifest {
  readonly md2ui_commit: string;
  readonly widths: readonly number[];
  readonly corpus: readonly { doc: string }[];
}

async function readRecords(): Promise<{ manifest: Manifest; records: Records }> {
  const manifest = JSON.parse(await commands.readFile(`${fixtures}/manifest.json`)) as Manifest;
  const docs = new Map<string, string>();
  for (const width of manifest.widths) {
    for (const { doc } of manifest.corpus) {
      const text = await commands
        .readFile(`${fixtures}/measure/${width}/${doc}.jsonl`)
        .catch(() => "");
      docs.set(doc, `${docs.get(doc) ?? ""}${text}\n`);
    }
  }
  return { manifest, records: indexRecords(docs) };
}

/** md2ui's recorded advance, which every word of a corpus text has by construction. */
function recordedAdvance(records: Records): (text: string, font: FontSpec) => number {
  return (text, font) => {
    const face = faceKeyOf(records, font);
    const a = face === undefined ? undefined : plainAdvance(records, face, font.size, text);
    // md2ui's wrap reads a space width only between two words; a one-word text in a
    // face md2ui never spaced (an emoji face) has none, and never adds it.
    if (a === undefined && text === " ") return Number.NaN;
    if (a === undefined) throw new Error(`no recorded advance for "${text}" in ${face}`);
    return a;
  };
}

/**
 * Widths at which md2ui's wrap changes its first line, and below each: by 0.001 (inside
 * Pretext's fit epsilon) and by 0.01 (outside it).
 */
function widthsFor(reference: TextMeasurer, item: CorpusText): number[] {
  const words = item.text.split(BREAKS).filter((w) => w !== "");
  const widths = new Set<number>();
  for (let n = 1; n <= words.length; n++) {
    const w = reference
      .prepare([{ text: words.slice(0, n).join(" "), font: item.font }])
      .lineWidth();
    widths.add(w);
    widths.add(w - 0.001);
    widths.add(w - 0.01);
  }
  const all = [...widths].filter((w) => w > 0).sort((a, b) => a - b);
  const step = Math.max(1, Math.ceil(all.length / 36));
  return all.filter((_, i) => i % step === 0);
}

type Tally = Map<string, { count: number; docs: Set<string>; sample: string }>;

interface Phase {
  answered: number;
  missed: number;
  compared: number;
  readonly gaps: Tally;
  readonly divergences: Tally;
}

function newPhase(): Phase {
  return { answered: 0, missed: 0, compared: 0, gaps: new Map(), divergences: new Map() };
}

/** Adds the calls since `mark` to `phase`; returns the gap classes they hit. */
function record(
  phase: Phase,
  log: ReplayLog,
  mark: { answered: number; gaps: number },
  doc: string,
  words: readonly string[],
): Set<string> {
  const classes = new Set<string>();
  phase.answered += log.answered - mark.answered;
  for (const gap of log.gaps.slice(mark.gaps)) {
    phase.missed += 1;
    const found = classifyGap(gap, words);
    classes.add(found);
    add(phase.gaps, found, doc, `${gap.face}: "${gap.text}"`);
  }
  return classes;
}

function report(phase: Phase) {
  return {
    measureText: {
      answered: phase.answered,
      missed: phase.missed,
      share: phase.answered / (phase.answered + phase.missed),
    },
    comparedWidths: phase.compared,
    gaps: tally(phase.gaps),
    divergences: tally(phase.divergences),
  };
}

function tally(map: Tally) {
  return Object.fromEntries(
    [...map].map(([k, v]) => [k, { count: v.count, docs: [...v.docs].sort(), sample: v.sample }]),
  );
}

function add(map: Tally, key: string, doc: string, sample: string): void {
  const entry = map.get(key) ?? { count: 0, docs: new Set<string>(), sample };
  entry.count += 1;
  entry.docs.add(doc);
  map.set(key, entry);
}

test.skipIf(fixtures === "")(
  "Pretext under md2ui's recorded answers",
  async () => {
    const { manifest, records } = await readRecords();
    const corpus = corpusTexts(records);
    const log = installReplayCanvas(recordsSource(records));
    const pretext = await createPretextMeasurer([]);
    const reference = createFakeMeasurer(recordedAdvance(records));

    const above = newPhase();
    const below = newPhase();
    const lineWidth = { exact: 0, differ: new Map() as Tally };
    const minWidth = { exact: 0, unasked: 0, differ: new Map() as Tally };
    for (const item of corpus.texts) {
      // Each text measures its own segments, so its gaps are its own.
      clearCache();
      const spans = [{ text: item.text, font: item.font }];
      const words = item.text.split(BREAKS);
      const ref = reference.prepare(spans);
      const widths = widthsFor(reference, item);
      const floor = ref.minWidth();

      let mark = { answered: log.answered, gaps: log.gaps.length };
      const prepared = pretext.prepare(spans);
      const gotLine = prepared.lineWidth();
      const gotMin = prepared.minWidth();
      const atOrAbove = widths.filter((w) => w >= floor);
      const pretextLines = atOrAbove.map((w) => prepared.lines(w));
      const textGaps = record(above, log, mark, item.doc, words);
      const cause = causeOf(textGaps);
      const sample = (got: number, want: number) => `${got} vs ${want}: ${item.text}`;
      // An exact width is md2ui's own sum; a different one is named, never tolerated.
      if (gotLine === item.width) lineWidth.exact += 1;
      else
        add(
          lineWidth.differ,
          cause === undefined ? "unclassified" : `after a replay gap: ${cause}`,
          item.doc,
          sample(gotLine, item.width),
        );
      if (item.minWidth === undefined) minWidth.unasked += 1;
      else if (gotMin === item.minWidth) minWidth.exact += 1;
      else {
        const why =
          item.minWidth > item.width
            ? "md2ui's floor is not a text answer (wider than its own one-line width)"
            : cause === undefined
              ? "unclassified"
              : `after a replay gap: ${cause}`;
        add(minWidth.differ, why, item.doc, sample(gotMin, item.minWidth));
      }
      for (const [i, width] of atOrAbove.entries()) {
        above.compared += 1;
        const found = classifyDivergence(
          pretextLines[i] ?? [],
          ref.lines(width),
          width,
          fitEpsilon,
        );
        if (found === undefined) continue;
        // A named wrap rule explains it first. Otherwise Pretext measured a piece md2ui
        // never did, answered by the real canvas: the difference belongs to that gap.
        const named =
          found !== "unclassified" || cause === undefined ? found : `after a replay gap: ${cause}`;
        add(above.divergences, named, item.doc, `${width}: ${item.text}`);
      }

      mark = { answered: log.answered, gaps: log.gaps.length };
      for (const width of widths.filter((w) => w < floor)) {
        below.compared += 1;
        const found = classifyDivergence(
          prepared.lines(width),
          ref.lines(width),
          width,
          fitEpsilon,
        );
        if (found === undefined) continue;
        const named =
          found !== "unclassified" || cause === undefined ? found : `after a replay gap: ${cause}`;
        add(below.divergences, named, item.doc, `${width}: ${item.text}`);
      }
      record(below, log, mark, item.doc, words);
    }
    const summary = {
      md2ui: manifest.md2ui_commit,
      texts: corpus.texts.length,
      skipped: Object.fromEntries(corpus.skipped),
      lineWidth: { exact: lineWidth.exact, differ: tally(lineWidth.differ) },
      minWidth: {
        exact: minWidth.exact,
        unasked: minWidth.unasked,
        differ: tally(minWidth.differ),
      },
      atOrAboveMinWidth: report(above),
      belowMinWidth: report(below),
    };
    console.log(`REPLAY ${JSON.stringify(summary)}`);
    expect([...lineWidth.differ.keys(), ...minWidth.differ.keys()]).not.toContain("unclassified");
    for (const phase of [above, below]) {
      expect([...phase.gaps.keys()]).not.toContain("unclassified");
      expect([...phase.divergences.keys()]).not.toContain("unclassified");
    }
  },
  600_000,
);
