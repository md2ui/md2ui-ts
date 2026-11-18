// Traces every layout difference under Pretext to the measurer answer that caused it
// (stage C). Two measurers answer every C3 question side by side: Pretext under
// md2ui's recorded font answers (the code that ships), and md2ui's own wrap over the
// same answers (`fontReplay`). Where they differ, the difference is named by its class
// (ADR-403), from what Pretext measured: text-conformance's wrap classes for lines, and for widths the
// pieces Pretext measured that md2ui never did (replay gaps). One level up, every closure
// answer the generator gets is set against md2ui's recorded one; a difference takes the
// classes of the C3 differences met while computing it, or, where there were none, the
// stage-B cause proved from the recording. Placement asks its own questions, which
// md2ui never recorded, so each C3 difference met while placing is one of its own class.
// Anything else is `unclassified`. Runs in the browser.
import { clearCache } from "@chenglou/pretext";
import type { FontSpec, PreparedText, TextLine, TextMeasurer, TextSpan } from "@md2ui/contracts";
import type { KvRole, LayoutMeasurer, LayoutNode, LeafInputs } from "@md2ui/core";
import {
  classifyDivergence,
  classifyGap,
  type Measured,
  type ReplayLog,
} from "@md2ui/text-conformance";
import type { FontFaces } from "@md2ui/text-pretext";
import type { RecordedAnswers } from "./closure-replay.ts";
import type { DivergenceClass } from "./divergence.ts";
import {
  describeLeaf,
  describeTree,
  type SizingCause,
  type SizingQuestion,
} from "./sizing-classes.ts";

/** One C3 answer where Pretext differs from md2ui's wrap over the same font answers. */
export interface TextDifference {
  /** The C3 question: `lineWidth`, `minWidth`, `lines@<width>`, `advance`, … */
  readonly question: string;
  readonly text: string;
  readonly pretext: string;
  readonly md2ui: string;
  readonly class: DivergenceClass;
  /** The pieces Pretext measured that md2ui never did (replay gaps) and a width reads. */
  readonly gaps: readonly string[];
  /** Of those, the whole words (not spaces): what an `unmeasured-word` difference is about. */
  readonly words: readonly string[];
}

/** One closure answer the generator got that differs from md2ui's recorded one. */
export interface AnswerDifference {
  readonly kind: string;
  readonly what: string;
  readonly port: number | null;
  /** md2ui's answer; `null` where md2ui answered null or never asked. */
  readonly md2ui: number | null;
  readonly classes: readonly DivergenceClass[];
  /** The C3 differences met while computing it. */
  readonly texts: readonly TextDifference[];
}

const HARD_BREAK = String.fromCodePoint(0x2028);

/** The names of `tools/text-conformance` as the stage's classes. */
const D5_CLASSES: readonly (readonly [string, DivergenceClass])[] = [
  ["fit epsilon", "fit-epsilon"],
  ["break after a hyphen", "hyphen"],
  ["segment of a hyphenated word", "hyphen"],
  ["break inside a URL", "url"],
  ["segment of a URL", "url"],
  ["overlong word", "long-word"],
  ["punctuation attachment", "punctuation-break"],
  ["segment split at punctuation", "punctuation-break"],
  ["CJK", "no-spaces"],
];

function classOf(d5: string): DivergenceClass {
  const name = d5.replace(/^after a replay gap: /u, "");
  return D5_CLASSES.find(([prefix]) => name.startsWith(prefix))?.[1] ?? "unclassified";
}

function wordsOf(text: string): string[] {
  return text.split(new RegExp(`[ ${HARD_BREAK}]`, "u")).filter((word) => word !== "");
}

/**
 * What a piece md2ui never measured is: a whole word or a space of the text (md2ui
 * measured it only inside a longer run), a piece of a word (text-conformance's segment classes), or
 * something a width never reads (a probe, a grapheme kept for breaking an overflowing
 * word), which is `null`.
 */
function pieceClass(piece: Measured, words: readonly string[]): DivergenceClass | null {
  if (piece.text.trim() === "" || words.includes(piece.text)) return "unmeasured-word";
  const d5 = classifyGap({ font: piece.font, face: "", text: piece.text }, words);
  if (d5.startsWith("probe:") || d5.startsWith("grapheme of a word")) return null;
  return classOf(d5);
}

/** The most specific class first: a word cut in pieces outranks a whole word unmeasured. */
const PRIORITY: readonly DivergenceClass[] = [
  "no-spaces",
  "url",
  "hyphen",
  "punctuation-break",
  "unmeasured-word",
  "unclassified",
];

function strongest(classes: Iterable<DivergenceClass>): DivergenceClass | undefined {
  const found = new Set(classes);
  return PRIORITY.find((c) => found.has(c));
}

/** The classes of a piece cut out of a word md2ui keeps whole. */
const SEGMENT_CLASSES: readonly DivergenceClass[] = ["url", "hyphen", "punctuation-break"];

/**
 * The class of the replay gaps behind a width that is no plain sum (`lineWidth`, `minWidth`).
 * With no gap, every piece Pretext measured is md2ui's own answer (recorded, or derived by
 * md2ui's rule, as a monospaced face's running sum), so the width can differ only in how
 * the text was cut: a segment of a word md2ui measured whole, summed with the rest of the
 * word, names its segment class.
 */
function gapClass(calls: readonly Measured[], text: string): DivergenceClass {
  const words = wordsOf(text);
  const gaps = calls.filter((c) => c.gap);
  const pieces = gaps.length > 0 ? gaps : calls.filter((c) => !words.includes(c.text));
  const classes = pieces.map((c) => pieceClass(c, words));
  if (gaps.length > 0) return strongest(classes.filter((c) => c !== null)) ?? "unclassified";
  const cuts = classes.filter(
    (c): c is DivergenceClass => c !== null && SEGMENT_CLASSES.includes(c),
  );
  return strongest(cuts) ?? "unclassified";
}

/**
 * The cut of `text` into measured pieces, in order, whose left-to-right sum is exactly
 * `width`: Pretext's `advance` is the sum of its segments. Returns the pieces, or
 * undefined when no cut reproduces `width`.
 */
function pieceSum(
  text: string,
  width: number,
  calls: readonly Measured[],
): readonly Measured[] | undefined {
  const pieces = [...new Map(calls.map((c) => [c.text, c])).values()];
  const states: Map<number, readonly Measured[]>[] = Array.from(
    { length: text.length + 1 },
    () => new Map(),
  );
  states[0]?.set(0, []);
  for (let at = 0; at < text.length; at++) {
    const here = states[at] as Map<number, readonly Measured[]>;
    for (const piece of pieces) {
      if (piece.text === "" || !text.startsWith(piece.text, at)) continue;
      const next = states[at + piece.text.length] as Map<number, readonly Measured[]>;
      for (const [sum, used] of here) {
        // Of two cuts to the same sum, the one in fewer pieces: a word Pretext measured
        // whole, not its graphemes, which add up the same in a face without kerning.
        const total = sum + piece.width;
        const known = next.get(total);
        if (known === undefined ? next.size < 256 : known.length > used.length + 1) {
          next.set(total, [...used, piece]);
        }
      }
    }
  }
  return states[text.length]?.get(width);
}

/**
 * Whether `md2ui` is the sum rounded to float32, either way: a positive float32 with no
 * float32 between it and the sum. md2ui's Skia measured the run whole, as a float32
 * running sum of its glyphs, where Pretext sums md2ui's float32 answers for its words.
 */
function float32RoundingOf(sum: number, md2ui: number): boolean {
  if (!(md2ui > 0) || Math.fround(md2ui) !== md2ui || md2ui === sum) return false;
  const next = new Float32Array([md2ui]);
  const bits = new Int32Array(next.buffer);
  // The float32 after md2ui's, toward the sum.
  bits[0] = (bits[0] as number) + (md2ui < sum ? 1 : -1);
  const toward = next[0] as number;
  return md2ui < sum ? sum < toward : toward < sum;
}

/**
 * The class of an `advance` difference, proved: Pretext's answer must be a sum over
 * pieces that spell the text. Pieces md2ui never measured name it. With none, every
 * piece is md2ui's own answer: in a monospaced face that is a code line cut into other
 * runs than md2ui's; in any other, a label md2ui measured whole, whose answer must be
 * that sum rounded to float32.
 */
function advanceClass(
  text: string,
  width: number,
  calls: readonly Measured[],
  monospaced: boolean,
  md2ui: number,
): DivergenceClass {
  const used = pieceSum(text, width, calls);
  if (used === undefined) return "unclassified";
  const words = wordsOf(text);
  const gaps = used.filter((piece) => piece.gap).map((piece) => pieceClass(piece, words));
  if (gaps.length === 0) {
    if (monospaced) return "code-line-runs";
    return float32RoundingOf(width, md2ui) ? "whole-run-sum" : "unclassified";
  }
  // A cut that needs a piece no width reads (a grapheme) proves nothing.
  if (gaps.some((c) => c === null)) return "unclassified";
  return strongest(gaps.filter((c) => c !== null)) ?? "unclassified";
}

/**
 * Whether `width` is every word and space measured in the font of the span that holds
 * it, left to right, from md2ui's own answers: Pretext measures a space in its own span,
 * where md2ui's wrap measures the space before a word in that word's style (`⚡ **55**`:
 * md2ui's space is bold). A text with a hard break has no single line to compare, and
 * is not proved.
 */
function spansSum(spans: readonly TextSpan[], width: number, md2ui: TextMeasurer): boolean {
  if (spans.some((span) => span.text.includes(HARD_BREAK))) return false;
  const pieces = spans.flatMap((span) =>
    span.text
      .split(/( )/u)
      .filter((piece) => piece !== "")
      .map((piece) => ({ piece, font: span.font })),
  );
  const sum = reference(() =>
    pieces.reduce((total, { piece, font }) => total + md2ui.advance(piece, font), 0),
  );
  return "value" in sum && sum.value === width;
}

const sameLines = (a: readonly TextLine[], b: readonly TextLine[]): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

const shown = (lines: readonly TextLine[]): string =>
  JSON.stringify(lines.map((line) => line.fragments.map((f) => f.text).join("")));

type Reference<T> = { readonly value: T } | { readonly error: string };

function reference<T>(run: () => T): Reference<T> {
  try {
    return { value: run() };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

/** What a measuring call did: its answer and the `measureText` calls it made. */
interface Measuring<T> {
  readonly value: T;
  readonly calls: readonly Measured[];
}

/** md2ui's side of the comparison. */
export interface Md2uiText {
  /** md2ui's wrap over md2ui's font answers. */
  readonly measurer: TextMeasurer;
  /** Whether md2ui's face for the font is monospaced. */
  readonly monospaced: (font: FontSpec) => boolean;
}

/**
 * Pretext, with every answer checked against md2ui's wrap. Pretext's caches are cleared
 * before each measuring call, so the calls a measuring call logs are its own; the log
 * keeps only the call being measured. `faces` are those `pretext` was made with: the
 * clearing is counted in them, so the measurer drops the advances it keeps too.
 */
export function tracedMeasurer(
  pretext: TextMeasurer,
  faces: FontFaces,
  md2ui: Md2uiText,
  log: ReplayLog,
  /** Pretext's line-fit epsilon in this engine. */
  fitEpsilon: number,
  found: (difference: TextDifference) => void,
): TextMeasurer {
  const measured = <T>(run: () => T): Measuring<T> => {
    clearCache();
    faces.cleared += 1;
    log.calls.length = 0;
    log.gaps.length = 0;
    const value = run();
    return { value, calls: [...log.calls] };
  };
  const report = <T>(
    question: string,
    text: string,
    actual: T,
    expected: Reference<T>,
    same: (a: T, b: T) => boolean,
    show: (value: T) => string,
    cls: () => DivergenceClass,
    calls: readonly Measured[],
  ): void => {
    if ("value" in expected && same(actual, expected.value)) return;
    const words = wordsOf(text);
    found({
      question,
      text,
      pretext: show(actual),
      md2ui: "value" in expected ? show(expected.value) : `no answer: ${expected.error}`,
      class: "value" in expected ? cls() : "unclassified",
      gaps: calls
        .filter((c) => c.gap && pieceClass(c, words) !== null)
        .map((c) => JSON.stringify(c.text)),
      words: [
        ...new Set(
          calls
            .filter(
              (c) => c.gap && c.text.trim() !== "" && pieceClass(c, words) === "unmeasured-word",
            )
            .map((c) => c.text),
        ),
      ],
    });
  };
  const number = (a: number, b: number): boolean => a === b;

  const prepare = (spans: readonly TextSpan[]): PreparedText => {
    const text = spans.map((span) => span.text).join("");
    const p = measured(() => pretext.prepare(spans));
    const f = reference(() => md2ui.measurer.prepare(spans));
    // Pretext keeps the narrowest width in the prepared text: only the first call measures.
    let min: Measuring<number> | undefined;
    const ask = <T>(run: (prepared: PreparedText) => T): Reference<T> =>
      "value" in f ? reference(() => run(f.value)) : f;
    /** A width with no text-conformance class: the replay gaps behind it, else the spaces between spans. */
    const widthClass = (calls: readonly Measured[]): DivergenceClass => {
      const gaps = gapClass(calls, text);
      if (gaps !== "unclassified") return gaps;
      return spansSum(spans, p.value.lineWidth(), md2ui.measurer) ? "span-space" : gaps;
    };
    /** Lines at a width: text-conformance's wrap classes, else what made the widths differ. */
    const lineClass = (width: number): DivergenceClass => {
      if (!("value" in f)) return "unclassified";
      const d5 = classifyDivergence(p.value.lines(width), f.value.lines(width), width, fitEpsilon);
      if (d5 !== undefined && classOf(d5) !== "unclassified") return classOf(d5);
      return widthClass(p.calls);
    };
    return {
      lineWidth() {
        const actual = p.value.lineWidth();
        const cls = () => widthClass(p.calls);
        report(
          "lineWidth",
          text,
          actual,
          ask((r) => r.lineWidth()),
          number,
          String,
          cls,
          p.calls,
        );
        return actual;
      },
      minWidth() {
        min ??= measured(() => p.value.minWidth());
        const { value, calls } = min;
        const cls = () => gapClass(calls, text);
        report(
          "minWidth",
          text,
          value,
          ask((r) => r.minWidth()),
          number,
          String,
          cls,
          calls,
        );
        return value;
      },
      lineCount(maxWidth) {
        const actual = p.value.lineCount(maxWidth);
        const expected = ask((r) => r.lineCount(maxWidth));
        const cls = () => lineClass(maxWidth);
        report(`lineCount@${maxWidth}`, text, actual, expected, number, String, cls, p.calls);
        return actual;
      },
      lines(maxWidth) {
        const actual = p.value.lines(maxWidth);
        const expected = ask((r) => r.lines(maxWidth));
        const cls = () => lineClass(maxWidth);
        report(`lines@${maxWidth}`, text, actual, expected, sameLines, shown, cls, p.calls);
        return actual;
      },
    };
  };

  return {
    prepare,
    advance(text, font) {
      const m = measured(() => pretext.advance(text, font));
      const expected = reference(() => md2ui.measurer.advance(text, font));
      const cls = (): DivergenceClass => {
        if (!("value" in expected)) return "unclassified";
        return advanceClass(text, m.value, m.calls, md2ui.monospaced(font), expected.value);
      };
      report("advance", text, m.value, expected, number, String, cls, m.calls);
      return m.value;
    },
    fontMetrics(font) {
      const actual = pretext.fontMetrics(font);
      const expected = reference(() => md2ui.measurer.fontMetrics(font));
      const same = (a: typeof actual, b: typeof actual): boolean =>
        a.ascent === b.ascent && a.descent === b.descent;
      report("fontMetrics", "", actual, expected, same, JSON.stringify, () => "unclassified", []);
      return actual;
    },
    inkBounds(text, font) {
      const actual = pretext.inkBounds(text, font);
      const expected = reference(() => md2ui.measurer.inkBounds(text, font));
      const same = (a: typeof actual, b: typeof actual): boolean =>
        a.top === b.top && a.height === b.height && a.left === b.left && a.width === b.width;
      report("inkBounds", text, actual, expected, same, JSON.stringify, () => "unclassified", []);
      return actual;
    },
  };
}

/** What `closureTrace` records about one document. */
export interface ClosureTrace {
  /** Where the traced text measurer reports a C3 difference. */
  readonly text: (difference: TextDifference) => void;
  /** The generator's measurer: `composed`, every answer set against md2ui's. */
  measurer(composed: LayoutMeasurer): LayoutMeasurer;
  /**
   * Runs a stage past the generator (placement), whose own questions md2ui never
   * recorded: every C3 difference met inside it is a difference of its own class.
   */
  past<T>(run: () => T): T;
  readonly differences: readonly AnswerDifference[];
}

export function closureTrace(
  recorded: RecordedAnswers,
  /** The stage-B cause of a difference with no C3 difference behind it, proved from the recording. */
  sizing: (
    question: SizingQuestion,
    md2ui: number | null,
    port: number | null,
  ) => SizingCause | null,
): ClosureTrace {
  const differences: AnswerDifference[] = [];
  let frame: TextDifference[] | null = null;

  const ask = <T extends number | null>(
    question: SizingQuestion,
    run: () => T,
    md2ui: () => T | undefined,
  ): T => {
    const outer = frame;
    const texts: TextDifference[] = [];
    frame = texts;
    let port: T;
    try {
      port = run();
    } finally {
      frame = outer;
    }
    const expected = md2ui();
    if (expected === undefined) {
      // After a difference the generator may go where md2ui never went. Before one, it
      // is still on md2ui's path, where md2ui asked every question it asks.
      if (differences.length > 0) return port;
      const { kind, what } = question;
      differences.push({ kind, what, port, md2ui: null, classes: ["unclassified"], texts });
      return port;
    }
    if (port === expected) return port;
    const classes: DivergenceClass[] =
      texts.length > 0
        ? [...new Set(texts.map((t) => t.class))]
        : [sizing(question, expected, port) ?? "unclassified"];
    const { kind, what } = question;
    differences.push({ kind, what, port, md2ui: expected, classes, texts });
    return port;
  };

  const leaf = (kind: string, node: LeafInputs, role: KvRole | null): SizingQuestion => ({
    kind,
    node,
    role,
    field: null,
    what: `${describeLeaf(node)} kv=${role}`,
  });
  const built = (kind: string, tree: LayoutNode, width: number): SizingQuestion => ({
    kind,
    node: null,
    role: null,
    field: null,
    what: `${describeTree(tree)} at ${width}`,
  });
  const marker = (props: Readonly<Record<string, unknown>>): SizingQuestion => ({
    kind: "marker_width",
    node: null,
    role: null,
    field: null,
    what: JSON.stringify(props),
  });

  return {
    measurer: (composed) => ({
      leafMinWidth: (node, role) =>
        ask(
          leaf("leaf_min_width", node, role),
          () => composed.leafMinWidth(node, role),
          () => recorded.leafMinWidth(node, role),
        ),
      leafLineWidth: (node, role) =>
        ask(
          leaf("leaf_line_width", node, role),
          () => composed.leafLineWidth(node, role),
          () => recorded.leafLineWidth(node, role),
        ),
      markerWidth: (props) =>
        ask(
          marker(props),
          () => composed.markerWidth(props),
          () => recorded.markerWidth(props) ?? undefined,
        ),
      blockWidth: (tree, available) =>
        ask(
          built("block_width", tree, available),
          () => composed.blockWidth(tree, available),
          () => recorded.blockWidth(tree, available),
        ),
      layoutHeight: (tree, width) =>
        ask(
          built("layout_height", tree, width),
          () => composed.layoutHeight(tree, width),
          () => recorded.layoutHeight(tree, width),
        ),
    }),
    text: (difference) => {
      // Every C3 question is asked inside a closure question; one asked outside is a
      // difference no closure answer accounts for.
      if (frame !== null) {
        frame.push(difference);
        return;
      }
      differences.push({
        kind: "text",
        what: difference.question,
        port: null,
        md2ui: null,
        classes: ["unclassified"],
        texts: [difference],
      });
    },
    past: (run) => {
      const outer = frame;
      const texts: TextDifference[] = [];
      frame = texts;
      try {
        return run();
      } finally {
        frame = outer;
        for (const t of texts) {
          differences.push({
            kind: "text",
            what: t.question,
            port: null,
            md2ui: null,
            classes: [t.class],
            texts: [t],
          });
        }
      }
    },
    differences,
  };
}
