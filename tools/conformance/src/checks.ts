// The registered checks, one per kind of fixture (ADR-002). Each check is evaluated per
// unit (a document, a theme, or a document at a layout label) and comes out `pass`,
// `fail` or `not ported`, or, for layout, `diverged`: different from md2ui where the
// stage reports a classified line-break divergence (ADR-403) and nothing differs that
// measurement cannot move (`invariant.ts`). A check reads no fixture until its stage is
// ported.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { compare, type Difference, type Shape } from "./diff.ts";
import type { Divergence } from "./divergence.ts";
import { float32Heights } from "./float32-height.ts";
import { sceneInvariants, treeInvariants } from "./invariant.ts";
import { isObject, type Json, readJson, readJsonLines, render } from "./json.ts";
import type { Document, LayoutLabel, Manifest, Theme } from "./manifest.ts";
import { dataPointsToUtf16, treeToUtf16 } from "./offsets.ts";
import type { LayoutInput, LayoutResult, Stages } from "./stages.ts";
import { assetsBesideTheme, declinedThemeField } from "./theme-form.ts";
import { explaining } from "./unmeasured.ts";

export type Status = "pass" | "fail" | "diverged" | "not ported";

export interface Outcome {
  readonly check: string;
  readonly unit: string;
  readonly status: Status;
  readonly differences: readonly Difference[];
  /** Why a check failed without a comparison: the stage threw, or answered the wrong shape. */
  readonly error?: string;
  /** Layout only: where Pretext breaks lines differently from md2ui, by class. */
  readonly divergences?: readonly Divergence[];
  /** Layout only: the differences no measurer answer can explain (`invariant.ts`). */
  readonly unexplained?: readonly Difference[];
}

export interface Unit {
  /** How the unit is printed. */
  readonly key: string;
  /** What `--doc` matches: the fixture name and the md2ui path. */
  readonly names: readonly string[];
  evaluate(wanted: (check: string) => boolean): Outcome[] | Promise<Outcome[]>;
}

export interface Family {
  readonly checks: readonly string[];
  readonly units: readonly Unit[];
}

export interface Context {
  readonly fixtures: string;
  readonly manifest: Manifest;
  readonly stages: Stages;
}

const GROUPING: Shape = {
  identity: ["type", "content"],
  ids: {
    node_id: "node",
    glued_content_id: "glue",
    source_line_id: "source-line",
    fingerprint_hash: "fingerprint",
  },
};
// md2ui's `Action.hints`: the `md2ui.*` params a link carried, read by `check` alone.
const SERVER_ONLY = ["hints"];
const TARGETS: Shape = { ids: { node_id: "node", key: "target" }, serverOnly: SERVER_ONLY };
export const LAYOUT: Shape = {
  identity: ["type"],
  ids: { content_id: "node", link_node_id: "node", flow_run: "flow-run" },
};
export const BOXES: Shape = {
  ids: { content_id: "node", node_id: "node" },
  serverOnly: SERVER_ONLY,
};
const PLAIN: Shape = { ids: {} };

export function families(context: Context): Family[] {
  const { manifest } = context;
  const grouping = new Grouping(context);
  const questions = new Questions(context);
  return [
    {
      checks: [...manifest.phases.map((p) => `grouper-phase:${p.phase}`), "grouper-final"],
      units: manifest.corpus.map((doc) => documentUnit(doc, (w) => grouping.evaluate(doc, w))),
    },
    {
      checks: ["split-criteria", "detector", "targets"],
      units: manifest.corpus.map((doc) => documentUnit(doc, (w) => questions.evaluate(doc, w))),
    },
    {
      checks: ["theme"],
      units: manifest.themes.map((theme) => themeUnit(context, theme)),
    },
    ...manifest.layouts.map((label) => layoutFamily(context, label)),
  ];
}

function documentUnit(doc: Document, evaluate: Unit["evaluate"]): Unit {
  return { key: doc.doc, names: [doc.doc, doc.path], evaluate };
}

function notPorted(check: string, unit: string): Outcome {
  return { check, unit, status: "not ported", differences: [] };
}

function judged(check: string, unit: string, differences: readonly Difference[]): Outcome {
  return { check, unit, status: differences.length === 0 ? "pass" : "fail", differences };
}

function failed(check: string, unit: string, error: string): Outcome {
  return { check, unit, status: "fail", differences: [], error };
}

/** Runs a stage; what it throws becomes the check's error instead of stopping the run. */
function attempt<T>(stage: () => T): { readonly value: T } | { readonly error: string } {
  try {
    return { value: stage() };
  } catch (error) {
    return { error: thrown(error) };
  }
}

function thrown(error: unknown): string {
  return `the stage threw: ${error instanceof Error ? error.message : String(error)}`;
}

/** The differences of one pass of a two-pass grouping, marked with the pass. */
function inPass(pass: string, differences: readonly Difference[]): Difference[] {
  return differences.map((d) => ({ ...d, path: `[${pass} pass] ${d.path}` }));
}

/** An input md2ui grouped or parsed, as the fixtures copied it, byte for byte. */
function readInput(fixtures: string, input: string): string {
  return readFileSync(join(fixtures, input), "utf8");
}

function readTree(path: string): Json {
  return treeToUtf16(readJson(path));
}

class Grouping {
  private readonly context: Context;

  constructor(context: Context) {
    this.context = context;
  }

  evaluate(doc: Document, wanted: (check: string) => boolean): Outcome[] {
    const phases = this.context.manifest.phases.filter((p) => wanted(`grouper-phase:${p.phase}`));
    const outcomes = phases.length > 0 ? this.phases(doc, phases) : [];
    if (wanted("grouper-final")) outcomes.push(this.final(doc));
    return outcomes;
  }

  private phases(doc: Document, phases: Manifest["phases"]): Outcome[] {
    const { fixtures, stages } = this.context;
    const groupPhases = stages.groupPhases;
    const names = phases.map((p) => `grouper-phase:${p.phase}`);
    if (groupPhases === undefined) return names.map((check) => notPorted(check, doc.doc));
    const markdown = readInput(fixtures, doc.input);
    const run = attempt(() => groupPhases(markdown));
    if ("error" in run) return names.map((check) => failed(check, doc.doc, run.error));
    return phases.map((phase) => {
      const check = `grouper-phase:${phase.phase}`;
      const file = (folder: string): string =>
        join(fixtures, "grouper", folder, phase.dir, `${doc.doc}.json`);
      const spaced = file("phases-spaced");
      const expected = existsSync(spaced) ? [spaced, file("phases")] : [file("phases")];
      const actual = run.value.map((pass) => pass.get(phase.phase));
      if (actual.every((tree) => tree === undefined)) return notPorted(check, doc.doc);
      if (actual.length !== expected.length) {
        return failed(
          check,
          doc.doc,
          `grouped in ${actual.length} pass(es); md2ui groups it in ${expected.length}`,
        );
      }
      const differences = expected.flatMap((path, i) => {
        const tree = actual[i];
        const pass = i === 0 ? "spaced" : "plain";
        if (tree === undefined) {
          const missing: Difference = {
            class: "tree",
            path: "root",
            field: "",
            expected: "a tree",
            actual: "absent",
          };
          return expected.length === 1 ? [missing] : inPass(pass, [missing]);
        }
        const found = compare(readTree(path), tree, GROUPING);
        if (expected.length === 1) return found;
        return inPass(pass, found);
      });
      return judged(check, doc.doc, differences);
    });
  }

  private final(doc: Document): Outcome {
    const { fixtures, stages } = this.context;
    const group = stages.group;
    if (group === undefined) return notPorted("grouper-final", doc.doc);
    const markdown = readInput(fixtures, doc.input);
    const run = attempt(() => group(markdown));
    if ("error" in run) return failed("grouper-final", doc.doc, run.error);
    const expected = readTree(join(fixtures, "grouper", "final", `${doc.doc}.json`));
    return judged("grouper-final", doc.doc, compare(expected, run.value, GROUPING));
  }
}

interface Question {
  readonly seq: number;
  readonly q: string;
  readonly text: string;
  readonly answer: Json;
  /** `rule_applicable` only: `null` when the caller did not pass it. */
  readonly elementHasRegularText: boolean | null;
}

/**
 * The questions the grouper asked its split criteria and its detector, and the action
 * targets of the final tree. The question logs are read once, when first needed.
 */
class Questions {
  private readonly context: Context;
  private readonly logs = new Map<string, ReadonlyMap<string, readonly Question[]>>();

  constructor(context: Context) {
    this.context = context;
  }

  evaluate(doc: Document, wanted: (check: string) => boolean): Outcome[] {
    const outcomes: Outcome[] = [];
    if (wanted("split-criteria")) outcomes.push(this.splitCriteria(doc));
    if (wanted("detector")) outcomes.push(this.detector(doc));
    if (wanted("targets")) outcomes.push(this.targets(doc));
    return outcomes;
  }

  private log(dir: string, doc: Document): readonly Question[] {
    let byDoc = this.logs.get(dir);
    if (byDoc === undefined) {
      const grouped = new Map<string, Question[]>();
      for (const record of readJsonLines(join(this.context.fixtures, dir, "calls.jsonl"))) {
        const question = toQuestion(record);
        const docQuestions = grouped.get(question.doc) ?? [];
        docQuestions.push(question.question);
        grouped.set(question.doc, docQuestions);
      }
      byDoc = grouped;
      this.logs.set(dir, byDoc);
    }
    return distinct(byDoc.get(doc.doc) ?? []);
  }

  private splitCriteria(doc: Document): Outcome {
    const criteria = this.context.stages.splitCriteria;
    if (criteria === undefined) return notPorted("split-criteria", doc.doc);
    const differences = this.log("split_criteria", doc).flatMap((question) => {
      const { q, text, elementHasRegularText } = question;
      const run = attempt(() =>
        q === "applicable"
          ? criteria.applicable(text)
          : criteria.ruleApplicable(text, elementHasRegularText),
      );
      const expected = Array.isArray(question.answer) ? [...question.answer].sort() : [];
      if ("error" in run) return [questionDifference(question, render(expected), run.error)];
      const actual = [...run.value].sort();
      return JSON.stringify(actual) === JSON.stringify(expected)
        ? []
        : [questionDifference(question, render(expected), render(actual))];
    });
    return judged("split-criteria", doc.doc, differences);
  }

  private detector(doc: Document): Outcome {
    const detect = this.context.stages.detect;
    if (detect === undefined) return notPorted("detector", doc.doc);
    const differences = this.log("detector", doc).flatMap((question) => {
      const run = attempt(() => detect(question.text));
      if ("error" in run) return [questionDifference(question, render(question.answer), run.error)];
      const expected = dataPointsToUtf16(question.answer, question.text);
      const where = `seq ${question.seq} ${question.q}(${render(question.text)})`;
      return compare(expected, run.value, PLAIN).map((d) => ({
        ...d,
        path: d.path === "(document)" ? where : `${where} ${d.path}`,
      }));
    });
    return judged("detector", doc.doc, differences);
  }

  private targets(doc: Document): Outcome {
    const { fixtures, stages } = this.context;
    const targets = stages.targets;
    if (targets === undefined) return notPorted("targets", doc.doc);
    const grouping = readTree(join(fixtures, "grouper", "final", `${doc.doc}.json`));
    const run = attempt(() => targets(grouping));
    if ("error" in run) return failed("targets", doc.doc, run.error);
    const expected = readJson(join(fixtures, "targets", `${doc.doc}.json`));
    return judged("targets", doc.doc, compare(expected, run.value, TARGETS));
  }
}

function toQuestion(record: Json): { readonly doc: string; readonly question: Question } {
  if (
    !isObject(record) ||
    typeof record["doc"] !== "string" ||
    typeof record["seq"] !== "number" ||
    typeof record["q"] !== "string" ||
    typeof record["text"] !== "string" ||
    record["answer"] === undefined
  ) {
    throw new Error(`calls.jsonl: not a recorded question: ${render(record)}`);
  }
  const has = record["element_has_regular_text"];
  return {
    doc: record["doc"],
    question: {
      seq: record["seq"],
      q: record["q"],
      text: record["text"],
      answer: record["answer"],
      elementHasRegularText: typeof has === "boolean" ? has : null,
    },
  };
}

/** Each question once: md2ui's memo answers repeats, and the answer is a function of the question. */
function distinct(questions: readonly Question[]): Question[] {
  const seen = new Set<string>();
  return questions.filter((question) => {
    const key = JSON.stringify([question.q, question.text, question.elementHasRegularText]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function questionDifference(question: Question, expected: string, actual: string): Difference {
  return {
    class: "value",
    path: `seq ${question.seq} ${question.q}(${render(question.text)})`,
    field: "answer",
    expected,
    actual,
  };
}

function themeUnit(context: Context, theme: Theme): Unit {
  const key = theme.theme;
  const { file } = theme;
  return {
    key,
    names: file === null ? [key] : [key, file.path],
    evaluate: (wanted) => {
      if (!wanted("theme")) return [];
      const resolve = context.stages.theme;
      if (resolve === undefined) return [notPorted("theme", key)];
      const source =
        file === null ? null : { path: file.path, text: readInput(context.fixtures, file.input) };
      const run = attempt(() => resolve(source));
      if ("error" in run) return [failed("theme", key, run.error)];
      const recorded = readJson(join(context.fixtures, "theme", `${key}.json`));
      const { expected, fields } =
        file === null
          ? { expected: recorded, fields: [] }
          : assetsBesideTheme(recorded, run.value, dirname(file.path));
      return [themeOutcome(key, compare(expected, run.value, PLAIN), fields)];
    },
  };
}

/**
 * A theme passes when nothing differs, and is `diverged` when every difference is a field
 * the port declines (absent from its output), each listed under its class, or an asset
 * reference md2ui resolved beside the theme (`besideTheme`, already taken out of
 * `differences`).
 */
function themeOutcome(
  key: string,
  differences: readonly Difference[],
  besideTheme: readonly string[],
): Outcome {
  const divergences: Divergence[] = besideTheme.map((where) => ({
    class: "asset-beside-theme",
    text: where,
    words: [],
  }));
  for (const d of differences) {
    const declined = declinedThemeField(d);
    if (declined === null) return judged("theme", key, differences);
    divergences.push({ class: declined, text: `${d.path} · ${d.field}`, words: [] });
  }
  if (divergences.length === 0) return judged("theme", key, differences);
  return { check: "theme", unit: key, status: "diverged", differences, divergences };
}

/**
 * Layout under replay at one label: the LayoutNode tree before and after the bakes,
 * and the placed boxes. The input is md2ui's grouping and THEME file, with md2ui's
 * answers to every font-level text question and to every question about a subtree it
 * built. A difference is a failure unless the stage traces it to measurer answers that
 * differ from md2ui's, every one of a named class, and those answers can account for
 * every difference: nothing differs in what measurement cannot move (`invariant.ts`).
 * Then it is `diverged`, printed with its classes, and listed by class in the summary
 * (ADR-403). An `unclassified` answer fails the check whatever the layout. A scene box
 * whose only difference is md2ui's float32 marker height is `float32-height`, proved from
 * the recording (`float32-height.ts`).
 */
function layoutFamily(context: Context, label: LayoutLabel): Family {
  const generated = `layout-generated:${label.label}`;
  const baked = `layout:${label.label}`;
  const boxes = `boxes:${label.label}`;
  const fixture = (dir: string, doc: Document, ext = "json"): string =>
    join(context.fixtures, dir, label.label, `${doc.doc}.${ext}`);
  const themes = new Map(context.manifest.themes.map((theme) => [theme.theme, theme.file]));
  const fontsOf = (doc: Document) => {
    const fonts = context.manifest.fonts.get(doc.theme);
    if (fonts === undefined) throw new Error(`the manifest lists no fonts for ${doc.theme}`);
    return fonts;
  };
  const input = (doc: Document): LayoutInput => {
    const file = themes.get(doc.theme) ?? null;
    return {
      doc: doc.doc,
      label: label.label,
      width: label.width,
      flags: label.flags,
      grouping: readTree(join(context.fixtures, "grouper", "final", `${doc.doc}.json`)),
      theme:
        file === null ? null : { path: file.path, text: readInput(context.fixtures, file.input) },
      measurements: readJsonLines(fixture("measure", doc, "jsonl")),
      layoutMeasurements: readJsonLines(fixture("measure-layout", doc, "jsonl")),
      fonts: fontsOf(doc).map((font) => ({ ...font, path: join(context.fixtures, font.path) })),
      families: context.manifest.families.get(doc.theme) ?? {},
    };
  };
  const evaluate = async (
    doc: Document,
    wanted: (check: string) => boolean,
  ): Promise<Outcome[]> => {
    const { stages } = context;
    const outcomes: Outcome[] = [];
    let shared: LayoutInput | undefined;
    const once = (): LayoutInput => {
      shared ??= input(doc);
      return shared;
    };
    const check = async (
      name: string,
      stage: ((input: LayoutInput) => Promise<LayoutResult>) | undefined,
      dir: string,
      shape: Shape,
      invariants: (expected: Json, actual: Json) => Difference[],
    ): Promise<void> => {
      if (!wanted(name)) return;
      if (stage === undefined) {
        outcomes.push(notPorted(name, doc.doc));
        return;
      }
      let result: LayoutResult;
      try {
        result = await stage(once());
      } catch (error) {
        outcomes.push(failed(name, doc.doc, thrown(error)));
        return;
      }
      const expected = readJson(fixture(dir, doc));
      const differences = compare(expected, result.output, shape);
      // md2ui's float32 marker heights, proved from its recording: no measurer answer of
      // the port's differs behind them, so they explain only themselves.
      const heights = float32Heights(expected, result.output, once().measurements, differences);
      const rest = differences.filter((d) => !heights.has(d));
      const divergences = [...result.divergences, ...heights.values()];
      // An answer no class explains fails even where the layout absorbed it.
      const unclassified = divergences.some((d) => d.class === "unclassified");
      if (unclassified || rest.length === 0) {
        const status = unclassified ? "fail" : heights.size > 0 ? "diverged" : "pass";
        outcomes.push({ check: name, unit: doc.doc, status, differences, divergences });
        return;
      }
      if (explaining(result.divergences, rest, expected, once().grouping).length === 0) {
        outcomes.push({ check: name, unit: doc.doc, status: "fail", differences, divergences });
        return;
      }
      // Measurement moves geometry and arrangement; what differs beyond them fails.
      const unexplained = invariants(expected, result.output);
      const status = unexplained.length === 0 ? "diverged" : "fail";
      outcomes.push({ check: name, unit: doc.doc, status, differences, divergences, unexplained });
    };
    await check(generated, stages.layoutGenerated, "layout-generated", LAYOUT, treeInvariants);
    await check(baked, stages.layout, "layout", LAYOUT, treeInvariants);
    const place = stages.boxes;
    await check(
      boxes,
      place === undefined
        ? undefined
        : (base) => place({ ...base, layout: readJson(fixture("layout", doc)) }),
      "boxes",
      BOXES,
      sceneInvariants,
    );
    return outcomes;
  };
  return {
    checks: [generated, baked, boxes],
    units: label.docs.map((doc) => documentUnit(doc, (wanted) => evaluate(doc, wanted))),
  };
}
