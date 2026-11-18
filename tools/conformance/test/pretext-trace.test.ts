// The tracing rules of layout conformance under Pretext (stage C): a C3 difference is
// named only when what Pretext measured proves its class, and a closure answer takes the
// classes of the C3 differences behind it.
import type { FontSpec, PreparedText, TextMeasurer, TextSpan } from "@md2ui/contracts";
import {
  createFakeMeasurer,
  type LayoutMeasurer,
  type LayoutNode,
  type LeafInputs,
} from "@md2ui/core";
import type { Measured, ReplayLog } from "@md2ui/text-conformance";
import { createFontFaces } from "@md2ui/text-pretext";
import { describe, expect, test } from "vitest";
import type { RecordedAnswers } from "../src/closure-replay.ts";
import {
  type AnswerDifference,
  closureTrace,
  type TextDifference,
  tracedMeasurer,
} from "../src/pretext-trace.ts";

const font = (weight = 400): FontSpec => ({ families: ["Inter"], size: 10, weight, italic: false });

/** A stand-in for Pretext: each answer is fixed, and each logs the canvas calls given. */
function pretextStub(
  log: ReplayLog,
  answers: { advance?: number; lineWidth?: number },
  calls: readonly Measured[],
): TextMeasurer {
  const measuring = <T>(value: T): T => {
    log.calls.push(...calls);
    return value;
  };
  const reference = createFakeMeasurer(() => 1);
  return {
    ...reference,
    advance: () => measuring(answers.advance ?? 0),
    prepare: (spans: readonly TextSpan[]): PreparedText => {
      const prepared = measuring(reference.prepare(spans));
      return { ...prepared, lineWidth: () => answers.lineWidth ?? prepared.lineWidth() };
    },
  };
}

const call = (text: string, width: number, gap: boolean): Measured => ({
  font: "400 10px Inter",
  text,
  width,
  gap,
});

function trace(
  pretext: TextMeasurer,
  md2ui: TextMeasurer,
  log: ReplayLog,
  monospaced = false,
): { measurer: TextMeasurer; found: TextDifference[] } {
  const found: TextDifference[] = [];
  const measurer = tracedMeasurer(
    pretext,
    createFontFaces(),
    { measurer: md2ui, monospaced: () => monospaced },
    log,
    0.005,
    (d) => found.push(d),
  );
  return { measurer, found };
}

const newLog = (): ReplayLog => ({ answered: 0, gaps: [], calls: [] });

describe("an advance difference is named by the pieces that sum to Pretext's answer", () => {
  // md2ui measured the label whole (25); Pretext measured each word, which md2ui never
  // did, and the space, which it did. The graphemes of each word add up the same as the
  // word here, so the cut in fewer pieces must win.
  const pieces = [
    call("See", 9, true),
    call("S", 3, true),
    call("e", 3, true),
    call(" ", 2, false),
    call("all", 7, true),
    call("a", 3, true),
    call("l", 2, true),
  ];
  const md2ui = createFakeMeasurer(() => 25);

  test("a whole word md2ui never measured on its own is unmeasured-word", () => {
    const log = newLog();
    const { measurer, found } = trace(pretextStub(log, { advance: 18 }, pieces), md2ui, log);
    expect(measurer.advance("See all", font())).toBe(18);
    expect(found.map((d) => d.class)).toEqual(["unmeasured-word"]);
    // The words it is about, for the check to find where they are written.
    expect(found.map((d) => d.words)).toEqual([["See", "all"]]);
  });

  test("an unmeasured space is no word it is about", () => {
    const log = newLog();
    const spaced = pieces.map((p) => (p.text === " " ? { ...p, gap: true } : p));
    const { measurer, found } = trace(pretextStub(log, { advance: 18 }, spaced), md2ui, log);
    measurer.advance("See all", font());
    expect(found.map((d) => d.class)).toEqual(["unmeasured-word"]);
    expect(found.map((d) => d.words)).toEqual([["See", "all"]]);
  });

  test("an answer no cut of the text reproduces is unclassified", () => {
    const log = newLog();
    const { measurer, found } = trace(pretextStub(log, { advance: 17 }, pieces), md2ui, log);
    measurer.advance("See all", font());
    expect(found.map((d) => d.class)).toEqual(["unclassified"]);
  });

  test("md2ui's own pieces in a monospaced face are a code line cut into other runs", () => {
    const line = [call("a", 6, false), call(" ", 6, false), call("b", 6, false)];
    for (const [monospaced, expected] of [
      [true, "code-line-runs"],
      [false, "unclassified"],
    ] as const) {
      const log = newLog();
      const { measurer, found } = trace(
        pretextStub(log, { advance: 18 }, line),
        createFakeMeasurer(() => 18.000001),
        log,
        monospaced,
      );
      measurer.advance("a b", font());
      expect(found.map((d) => d.class)).toEqual([expected]);
    }
  });
});

describe("a label md2ui measured whole is whole-run-sum, proved from its float32 rounding", () => {
  // Google Sans 14 in spotify-artist: md2ui measured `Pink Floyd` as one
  // run; Pretext sums md2ui's own answers for its words and the space.
  const pieces = [
    call("Pink", 25.8439998626709, false),
    call(" ", 3.247999906539917, false),
    call("Floyd", 34.15999984741211, false),
  ];
  const sum = 63.251999616622925;
  const classOf = (md2ui: number, calls: readonly Measured[] = pieces) => {
    const log = newLog();
    const { measurer, found } = trace(
      pretextStub(log, { advance: sum }, calls),
      createFakeMeasurer(() => md2ui),
      log,
    );
    measurer.advance("Pink Floyd", font());
    return found.map((d) => d.class);
  };

  test("md2ui's answer is the sum rounded to float32, down or up", () => {
    expect(classOf(63.25199890136719)).toEqual(["whole-run-sum"]);
    expect(classOf(63.25200271606445)).toEqual(["whole-run-sum"]);
  });

  test("a float32 one further from the sum is unclassified", () => {
    expect(classOf(63.25199508666992)).toEqual(["unclassified"]);
  });

  test("an answer no float32 is unclassified", () => {
    expect(classOf(63.252)).toEqual(["unclassified"]);
  });

  test("a piece md2ui never measured names its own class instead", () => {
    const unmeasured = pieces.map((p) => (p.text === "Floyd" ? { ...p, gap: true } : p));
    expect(classOf(63.25199890136719, unmeasured)).toEqual(["unmeasured-word"]);
  });
});

test("a line that is every piece in its own span's font is span-space", () => {
  // md2ui's wrap measures the space before "55" in bold (3); Pretext in its own span (4).
  const width = (text: string, f: FontSpec): number =>
    text === " " ? (f.weight === 700 ? 3 : 4) : text === "55" ? 20 : 10;
  const spans: TextSpan[] = [
    { text: "x", font: font(400) },
    { text: " ", font: font(400) },
    { text: "55", font: font(700) },
  ];
  const log = newLog();
  const { measurer, found } = trace(
    pretextStub(log, { lineWidth: 34 }, []),
    createFakeMeasurer(width),
    log,
  );
  expect(measurer.prepare(spans).lineWidth()).toBe(34);
  expect(found.map((d) => [d.question, d.md2ui, d.class])).toEqual([
    ["lineWidth", "33", "span-space"],
  ]);
});

describe("a width over md2ui's own pieces names the cut inside a word md2ui keeps whole", () => {
  // JetBrains Mono 11 in burtalism-1: md2ui measured `Focus-ring` whole,
  // a float32 running sum; Pretext summed its segments, each md2ui's monospaced answer.
  const lineClass = (text: string, calls: readonly Measured[]) => {
    const log = newLog();
    const { measurer, found } = trace(
      pretextStub(log, { lineWidth: 65.99999809265137 }, calls),
      createFakeMeasurer(() => 65.99999237060547),
      log,
    );
    measurer.prepare([{ text, font: font() }]).lineWidth();
    return found.map((d) => d.class);
  };

  test("a segment of a hyphenated word is hyphen, of a path url", () => {
    const focus = [
      call("Focus-", 39.599998474121094, false),
      call("ring", 26.39999961853027, false),
    ];
    expect(lineClass("Focus-ring", focus)).toEqual(["hyphen"]);
    const path = [call("assets/", 39.6, false), call("fonts", 26.4, false)];
    expect(lineClass("assets/fonts", path)).toEqual(["url"]);
  });

  test("whole words alone are no cut", () => {
    expect(lineClass("Focus ring", [call("Focus", 33, false), call("ring", 26.4, false)])).toEqual([
      "unclassified",
    ]);
  });
});

describe("closure answers", () => {
  const leaf = { node_id: "0.1", type: "text", content: "x" } as LeafInputs;
  const recorded = (answer: number | undefined): RecordedAnswers => ({
    leafMinWidth: () => answer,
    leafLineWidth: () => answer,
    markerWidth: () => answer,
    blockWidth: () => answer,
    layoutHeight: () => answer,
  });
  const composed = (answer: number, during?: () => void): LayoutMeasurer => ({
    leafMinWidth: () => {
      during?.();
      return answer;
    },
    leafLineWidth: () => answer,
    markerWidth: () => answer,
    blockWidth: () => answer,
    layoutHeight: () => answer,
  });
  const textDifference: TextDifference = {
    question: "minWidth",
    text: "x",
    pretext: "3",
    md2ui: "2",
    class: "hyphen",
    gaps: [],
    words: [],
  };
  const classes = (d: readonly AnswerDifference[]) => d.map((x) => x.classes);
  const built = { type: "col", children: [], content_id: null } as unknown as LayoutNode;

  test("a difference takes the classes of the C3 differences met while computing it", () => {
    const t = closureTrace(recorded(2), () => null);
    t.measurer(composed(3, () => t.text(textDifference))).leafMinWidth(leaf, null);
    expect(classes(t.differences)).toEqual([["hyphen"]]);
  });

  test("with none behind it, the stage-B cause proved from the recording, else unclassified", () => {
    const proved = closureTrace(recorded(2), () => "code-line-runs");
    proved.measurer(composed(3)).leafMinWidth(leaf, null);
    expect(classes(proved.differences)).toEqual([["code-line-runs"]]);
    const unproved = closureTrace(recorded(2), () => null);
    unproved.measurer(composed(3)).leafMinWidth(leaf, null);
    expect(classes(unproved.differences)).toEqual([["unclassified"]]);
  });

  test("an equal answer with a C3 difference behind it is no difference", () => {
    const t = closureTrace(recorded(2), () => null);
    t.measurer(composed(2, () => t.text(textDifference))).leafMinWidth(leaf, null);
    expect(t.differences).toEqual([]);
  });

  test("a question md2ui never asked is unclassified until an answer has differed", () => {
    const first = closureTrace(recorded(undefined), () => null);
    first.measurer(composed(3)).layoutHeight(built, 100);
    expect(classes(first.differences)).toEqual([["unclassified"]]);

    let answer: number | undefined = 2;
    const later = closureTrace(
      { ...recorded(2), layoutHeight: () => answer },
      () => "code-line-runs",
    );
    const measurer = later.measurer(composed(3));
    measurer.leafMinWidth(leaf, null);
    answer = undefined;
    measurer.layoutHeight(built, 100);
    expect(classes(later.differences)).toEqual([["code-line-runs"]]);
  });
});
