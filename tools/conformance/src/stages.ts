// What a ported stage registers against. A stage plugs in by being added to
// `portedStages()` below, and nothing else in the runner changes; a stage left out
// reports `not ported`, which is not a failure.
//
// A stage is checked in isolation: its input is md2ui's, from the fixtures or the
// md2ui checkout, never the output of an earlier port. So layout is checked against
// md2ui's grouping and theme, and a grouper difference never shows up as a layout one.
//
// Everything crosses in md2ui's JSON form (the fixtures' form), with two conventions:
// string offsets are UTF-16 units (the runner converts md2ui's code points), and an
// integer outside the safe range is a `bigint`.

import {
  actionTargets,
  applicable,
  type DetectedPoint,
  detectDataPoints,
  groupMarkdown,
  groupPhases,
  parseTheme,
  ruleApplicable,
} from "@md2ui/core";
import type { Divergence } from "./divergence.ts";
import { isObject, type Json, parseJson, stringifyJson } from "./json.ts";
import type { FontFile } from "./manifest.ts";
import { openPretextBrowser, type PretextBrowser } from "./pretext-browser.ts";
import type { PagePayload, PageResult, PlaceResult } from "./pretext-page.ts";
import type { AnswerDifference } from "./pretext-trace.ts";
import { themeFixtureForm } from "./theme-form.ts";

/** A grouping pass: the tree after each phase, keyed by md2ui's phase name (`2.1`). */
export type PhaseTrees = ReadonlyMap<string, Json>;

export interface LayoutInput {
  /** The fixture name of the document (`tests__tests-key-value`). */
  readonly doc: string;
  /** `767`, `1280`, `1280-overlays`. */
  readonly label: string;
  readonly width: number;
  /** md2ui render flags of a variant (`--wireframe`, …); empty for a plain width. */
  readonly flags: readonly string[];
  /** md2ui's final grouping tree (C1). */
  readonly grouping: Json;
  /**
   * The THEME file the document renders with; `null` is no THEME file. A stage parses
   * it with the theme stage's own parser, which the `theme` check holds to md2ui's
   * resolved theme, so there is one theme path.
   */
  readonly theme: ThemeSource | null;
  /** Every text question md2ui asked, with its answer: the replay ledger (`measure/`). */
  readonly measurements: readonly Json[];
  /** md2ui's answers about the subtrees it built: block widths and heights (`measure-layout/`). */
  readonly layoutMeasurements: readonly Json[];
  /** The font files of the faces md2ui measured the theme's documents in; paths absolute. */
  readonly fonts: readonly FontFile[];
  /** Family names md2ui resolved to another family's face (the manifest's `families`). */
  readonly families: Readonly<Record<string, string>>;
}

/**
 * A layout stage's answer. Pretext measures only in a browser (ADR-403), so a layout
 * stage may answer asynchronously, from a browser it drives.
 */
export interface LayoutResult {
  readonly output: Json;
  /** Every measurer answer that differed from md2ui's in this document; empty when none. */
  readonly divergences: readonly Divergence[];
}

export interface BoxesInput extends LayoutInput {
  /** md2ui's LayoutNode tree after the bakes (`layout/`). */
  readonly layout: Json;
}

export interface ThemeSource {
  /** The THEME file, relative to the md2ui checkout: asset paths resolve against it. */
  readonly path: string;
  readonly text: string;
}

export interface SplitCriteriaStage {
  /** `SplitCriteria.applicable`: criterion names (`KEY_VALUE`, …), in any order. */
  applicable(text: string): readonly string[];
  /** `_rule_applicable`, as the separator and element splitters ask it. */
  ruleApplicable(text: string, elementHasRegularText: boolean | null): readonly string[];
}

export interface Stages {
  /**
   * The tree after each phase the port has, one map per grouping pass: a document
   * with `+++` spacers is grouped twice, spaced first. A phase absent from every map
   * is not ported.
   */
  readonly groupPhases?: (markdown: string) => readonly PhaseTrees[];
  /** The final grouping tree (`MarkdownGroupNode.to_dict`). */
  readonly group?: (markdown: string) => Json;
  readonly splitCriteria?: SplitCriteriaStage;
  /** `DataPointDetector.detect_pipeline`, in the tree's data-point form. */
  readonly detect?: (text: string) => readonly Json[];
  /** The action targets of a final grouping tree, in ordinal order. */
  readonly targets?: (grouping: Json) => readonly Json[];
  /** The resolved theme; `null` is no THEME file (the parser's defaults). */
  readonly theme?: (source: ThemeSource | null) => Json;
  /** The LayoutNode tree before the bakes (`layout-generated/`). */
  readonly layoutGenerated?: (input: LayoutInput) => Promise<LayoutResult>;
  /** The LayoutNode tree after the bakes (`layout/`). */
  readonly layout?: (input: LayoutInput) => Promise<LayoutResult>;
  /** The placed boxes, sections, regions and anchors (`boxes/`). */
  readonly boxes?: (input: BoxesInput) => Promise<LayoutResult>;
  /** Ends what the stages started (the layout stages' browser); the runner calls it last. */
  readonly close?: () => Promise<void>;
}

/** The stages ported so far. */
export function portedStages(): Stages {
  // Layout and placement run in a browser, started at the first check that needs it. Both
  // layout checks of a document share one run: the runner hands them the same input
  // object. Placement is a run of its own, on md2ui's baked tree.
  let browser: Promise<PretextBrowser> | undefined;
  const runs = new WeakMap<LayoutInput, Promise<PageResult>>();
  /** The browser, with the font files of the document's theme loaded. */
  const opened = async (input: LayoutInput): Promise<PretextBrowser> => {
    browser ??= openPretextBrowser();
    const page = await browser;
    await page.loadFonts(input.fonts);
    return page;
  };
  const underPretext = (input: LayoutInput): Promise<PageResult> => {
    let run = runs.get(input);
    if (run === undefined) {
      run = opened(input).then((page) => page.layout(payloadOf(input)));
      runs.set(input, run);
    }
    return run;
  };
  return {
    // No asset resolution: the host resolves against the theme's URL; the check takes
    // what md2ui resolved beside the theme as its own class (`asset-beside-theme`).
    theme: (source) => themeFixtureForm(parseTheme(source?.text ?? "")),
    // C1's open-ended fields (`labels`, the payloads' extra keys) are typed `unknown`;
    // what the grouper writes into them is JSON.
    groupPhases: (markdown) => groupPhases(markdown) as unknown as readonly PhaseTrees[],
    group: (markdown) => groupMarkdown(markdown) as unknown as Json,
    detect: (text) => detectDataPoints(text).map(detectorForm),
    // The grouping crosses as md2ui's JSON; it is C1 by the contract the fixtures keep.
    targets: (grouping) =>
      actionTargets(
        grouping as unknown as Parameters<typeof actionTargets>[0],
      ) as unknown as readonly Json[],
    splitCriteria: {
      applicable: (text) => [...applicable(text)],
      ruleApplicable: (_text, elementHasRegularText) => [...ruleApplicable(elementHasRegularText)],
    },
    layoutGenerated: async (input) => layoutResult(await underPretext(input), "generated"),
    layout: async (input) => layoutResult(await underPretext(input), "baked"),
    // Placement places md2ui's own baked tree, so it is checked apart from layout.
    boxes: async (input) => {
      const page = await opened(input);
      const placed = await page.place({
        ...payloadOf(input),
        layout: stringifyJson(input.layout),
      });
      return placeResult(placed, input.width);
    },
    close: async () => {
      if (browser !== undefined) await (await browser).close();
    },
  };
}

function payloadOf(input: LayoutInput): PagePayload {
  const jsonLines = (records: readonly Json[]): string => records.map(stringifyJson).join("\n");
  return {
    grouping: stringifyJson(input.grouping),
    theme: input.theme?.text ?? null,
    measure: jsonLines(input.measurements),
    measureLayout: jsonLines(input.layoutMeasurements),
    width: input.width,
    fonts: input.fonts.map(({ face, source, instance }) => ({
      face,
      source,
      ...(instance === undefined ? {} : { instance }),
    })),
    families: input.families,
  };
}

/** Every differing answer, once per class. */
function divergencesOf(differences: readonly AnswerDifference[]): Divergence[] {
  return differences.flatMap((difference) => {
    const words = [...new Set(difference.texts.flatMap((t) => t.words))];
    return difference.classes.map((cls) => ({
      class: cls,
      text: describeAnswer(difference),
      words,
    }));
  });
}

function layoutResult(result: PageResult, tree: "generated" | "baked"): LayoutResult {
  return { output: parseJson(result[tree]), divergences: divergencesOf(result.differences) };
}

/** The scene in `boxes/`' form: md2ui records the width it was asked for beside it. */
function placeResult(result: PlaceResult, askedWidth: number): LayoutResult {
  const scene = parseJson(result.scene);
  return {
    output: isObject(scene) ? { asked_width: askedWidth, ...scene } : scene,
    divergences: divergencesOf(result.differences),
  };
}

/**
 * A differing answer in a line: the question, both answers, and the first C3 difference
 * behind it with the pieces Pretext measured that md2ui never did.
 */
function describeAnswer(d: AnswerDifference): string {
  const head = `${d.kind} ${d.what}: md2ui ${d.md2ui}, port ${d.port}`;
  const first = d.texts[0];
  if (first === undefined) return head;
  const gaps = first.gaps.length > 0 ? `; unmeasured ${first.gaps.join(" ")}` : "";
  const more = d.texts.length > 1 ? ` (+${d.texts.length - 1} more)` : "";
  return `${head} <- ${first.question} ${JSON.stringify(first.text)}: md2ui ${first.md2ui}, Pretext ${first.pretext}${gaps}${more}`;
}

/** A data point as md2ui's detector log records it: the AST's form plus `type` and `is_approximate`. */
function detectorForm(point: DetectedPoint): Json {
  return {
    label: `dp_${point.type}`,
    type: point.type,
    matched: point.matched,
    value: point.value as Json,
    start: point.start,
    end: point.end,
    is_approximate: point.is_approximate,
  };
}
