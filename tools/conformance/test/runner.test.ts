import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import type { DivergenceClass } from "../src/divergence.ts";
import type { Json } from "../src/json.ts";
import { main } from "../src/main.ts";
import type {
  BoxesInput,
  LayoutResult,
  PhaseTrees,
  SplitCriteriaStage,
  Stages,
  ThemeSource,
} from "../src/stages.ts";

const DOC_A = "tests__a";
const DOC_B = "tests__b";
const FACE = "Inter 18pt|Inter18pt-Regular|400|5|0";
/** A face md2ui reached only as a per-glyph system fallback: listed without a file. */
const FALLBACK = "PingFang SC|PingFangSC-Regular|400|5|0";
const HYPHEN: DivergenceClass = "hyphen";

function tree(label: string, flag = true): Json {
  return {
    type: "root",
    content: "",
    node_id: 0,
    glued_content_id: null,
    children: [
      { type: "text", content: label, node_id: 1, glued_content_group: flag, children: [] },
    ],
  };
}

const SPACED = tree("spaced");
const PLAIN = tree("plain");
const FINAL: Readonly<Record<string, Json>> = { "# a": tree("a"), "# b": tree("b") };
const LAYOUT: Json = { type: "column", content_id: 3, children: [{ type: "text", content_id: 4 }] };
const BOXES: Json = { boxes: [{ content_id: 3, x: 0, y: 0 }] };
const TARGETS: Json = [{ node_id: 1, key: "k" }];
const THEME: Json = { background: "#fff", charts: { line: { fill: { bg_colors: [] } } } };
/** THEME as the port resolves it: without the line chart's area fill, which it declines. */
const THEME_PORTED: Json = { background: "#fff", charts: { line: {} } };

const CALLS_SPLIT = [
  { doc: DOC_A, seq: 1, q: "applicable", text: "x", answer: ["KEY_VALUE", "SEPARATOR"] },
  { doc: DOC_A, seq: 2, q: "applicable", text: "x", answer: ["KEY_VALUE", "SEPARATOR"] },
  {
    doc: DOC_A,
    seq: 3,
    q: "rule_applicable",
    text: "y",
    answer: ["ELEMENT"],
    element_has_regular_text: true,
  },
  { doc: DOC_B, seq: 1, q: "applicable", text: "z", answer: [] },
];
const CALLS_DETECT = [
  {
    doc: DOC_A,
    seq: 1,
    q: "detect_pipeline",
    text: "🙂 5%",
    answer: [{ type: "percent", start: 2, end: 4 }],
  },
  { doc: DOC_B, seq: 1, q: "detect_pipeline", text: "plain", answer: [] },
];

let root: string;
let fixtures: string;

function put(base: string, path: string, content: string): void {
  const full = join(base, path);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
}

function putJson(path: string, value: Json | readonly object[]): void {
  put(fixtures, path, JSON.stringify(value));
}

function lines(records: readonly object[]): string {
  return `${records.map((r) => JSON.stringify(r)).join("\n")}\n`;
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "conformance-"));
  fixtures = join(root, "fixtures");
  putJson("manifest.json", {
    format_version: 4,
    string_offsets: "code points",
    md2ui_commit: "abc1234",
    md2ui_dirty: false,
    date: "2026-10-04",
    corpus: [
      {
        doc: DOC_A,
        path: "data/markdown/tests/a.md",
        input: "input/tests/a.md",
        theme: "_defaults",
      },
      { doc: DOC_B, path: "data/markdown/tests/b.md", input: "input/tests/b.md", theme: "THEME" },
    ],
    phases: [
      { phase: "1", dir: "01-phase-1" },
      { phase: "2", dir: "02-phase-2" },
    ],
    widths: [767],
    variants: [],
    themes: [
      { theme: "_defaults", theme_path: null, theme_input: null },
      { theme: "THEME", theme_path: "THEME.md", theme_input: "input/THEME.md" },
    ],
    fonts: {
      faces: { [FACE]: "fonts/Face.ttf", [FALLBACK]: null },
      files: { "fonts/Face.ttf": { face: FACE, sha256: "f00", source: "assets/fonts/Face.ttf" } },
      themes: { _defaults: [FACE], THEME: [FACE, FALLBACK] },
      families: { _defaults: {}, THEME: {} },
    },
  });
  put(fixtures, "input/tests/a.md", "# a");
  put(fixtures, "input/tests/b.md", "# b");
  put(fixtures, "input/THEME.md", "# theme");
  for (const dir of ["01-phase-1", "02-phase-2"]) {
    putJson(`grouper/phases/${dir}/${DOC_A}.json`, PLAIN);
    putJson(`grouper/phases/${dir}/${DOC_B}.json`, PLAIN);
    putJson(`grouper/phases-spaced/${dir}/${DOC_A}.json`, SPACED);
  }
  for (const [doc, markdown] of [
    [DOC_A, "# a"],
    [DOC_B, "# b"],
  ] as const) {
    putJson(`grouper/final/${doc}.json`, FINAL[markdown] ?? null);
    putJson(`targets/${doc}.json`, TARGETS);
    putJson(`layout-generated/767/${doc}.json`, LAYOUT);
    putJson(`layout/767/${doc}.json`, LAYOUT);
    putJson(`boxes/767/${doc}.json`, BOXES);
    put(fixtures, `measure/767/${doc}.jsonl`, lines([{ text: "x", width: 1 }]));
    put(fixtures, `measure-layout/767/${doc}.jsonl`, lines([{ q: "layout_height", a: 2 }]));
  }
  putJson("theme/_defaults.json", THEME);
  putJson("theme/THEME.json", THEME);
  put(fixtures, "split_criteria/calls.jsonl", lines(CALLS_SPLIT));
  put(fixtures, "detector/calls.jsonl", lines(CALLS_DETECT));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

interface Run {
  readonly code: number;
  readonly out: string;
}

async function run(args: readonly string[], stages: Stages): Promise<Run> {
  let out = "";
  const code = await main(["--fixtures", fixtures, ...args], stages, (text) => {
    out += text;
  });
  return { code, out };
}

const asLayout = (output: Json): Promise<LayoutResult> =>
  Promise.resolve({ output, divergences: [] });

interface Calls {
  applicable: string[];
}

function identityStages(calls: Calls = { applicable: [] }): Stages {
  const splitCriteria: SplitCriteriaStage = {
    applicable: (text) => {
      calls.applicable.push(text);
      return text === "x" ? ["SEPARATOR", "KEY_VALUE"] : [];
    },
    ruleApplicable: () => ["ELEMENT"],
  };
  return {
    groupPhases: (markdown): readonly PhaseTrees[] =>
      markdown === "# a"
        ? [
            new Map([
              ["1", SPACED],
              ["2", SPACED],
            ]),
            new Map([
              ["1", PLAIN],
              ["2", PLAIN],
            ]),
          ]
        : [
            new Map([
              ["1", PLAIN],
              ["2", PLAIN],
            ]),
          ],
    group: (markdown) => FINAL[markdown] ?? null,
    splitCriteria,
    detect: (text) => (text === "plain" ? [] : [{ type: "percent", start: 3, end: 5 }]),
    targets: () => TARGETS as readonly Json[],
    theme: () => THEME,
    layoutGenerated: () => asLayout(LAYOUT),
    layout: () => asLayout(LAYOUT),
    boxes: () => asLayout(BOXES),
  };
}

describe("with no stage ported", () => {
  test("every check is not ported and the run passes", async () => {
    const { code, out } = await run([], {});
    expect(code).toBe(0);
    expect(out.split("\n")[0]).toMatch(/^md2ui abc1234 /);
    for (const check of [
      "grouper-phase:1",
      "grouper-phase:2",
      "grouper-final",
      "split-criteria",
      "detector",
      "targets",
      "theme",
      "layout-generated:767",
      "layout:767",
      "boxes:767",
    ]) {
      expect(out).toMatch(new RegExp(`^${check}\\s+0\\s+0\\s+0\\s+2$`, "m"));
    }
    expect(out).toMatch(/^total\s+0\s+0\s+0\s+20$/m);
    expect(out).toContain("conformance: OK");
  });
});

describe("with every stage answering as md2ui did", () => {
  test("all checks pass", async () => {
    const { code, out } = await run([], identityStages());
    expect(out).not.toMatch(/FAIL|DIVERGED/);
    expect(code).toBe(0);
    expect(out).toMatch(/^total\s+20\s+0\s+0\s+0$/m);
  });

  test("split-criteria answers are compared as sets and repeated questions are asked once", async () => {
    const calls: Calls = { applicable: [] };
    const { code } = await run(["--only", "split-criteria"], identityStages(calls));
    expect(code).toBe(0);
    expect(calls.applicable.filter((text) => text === "x")).toHaveLength(1);
  });

  test("detector offsets are compared in UTF-16 units", async () => {
    const stages: Stages = { ...identityStages(), detect: () => [] };
    const wrong = await run(["--only", "detector", "--doc", DOC_A], stages);
    expect(wrong.code).toBe(1);
    const right = await run(["--only", "detector", "--doc", DOC_A], identityStages());
    expect(right.code).toBe(0);
    const codePoints: Stages = {
      ...identityStages(),
      detect: () => [{ type: "percent", start: 2, end: 4 }],
    };
    expect((await run(["--only", "detector", "--doc", DOC_A], codePoints)).code).toBe(1);
  });
});

describe("a theme field the port declines", () => {
  test("is diverged under its class when it is the only difference", async () => {
    const { code, out } = await run(["--only", "theme"], { theme: () => THEME_PORTED });
    expect(code).toBe(0);
    expect(out).toContain("DIVERGED (line-chart-unported) theme · THEME");
    expect(out).toMatch(/^theme\s+0\s+0\s+2\s+0$/m);
  });

  test("fails with any other difference beside it", async () => {
    const { code, out } = await run(["--only", "theme"], {
      theme: () => ({ background: "#000", charts: { line: {} } }),
    });
    expect(code).toBe(1);
    expect(out).toMatch(/^theme\s+0\s+2\s+0\s+0$/m);
  });
});

describe("stage inputs", () => {
  test("the theme stage gets the THEME source, or null for the defaults", async () => {
    const seen: (ThemeSource | null)[] = [];
    const stages: Stages = {
      theme: (source) => {
        seen.push(source);
        return THEME;
      },
    };
    const { code } = await run(["--only", "theme"], stages);
    expect(code).toBe(0);
    expect(seen).toContainEqual(null);
    expect(seen).toContainEqual({ path: "THEME.md", text: "# theme" });
  });

  test("the boxes stage gets md2ui's baked layout with the replay ledgers", async () => {
    const seen: BoxesInput[] = [];
    const stages: Stages = {
      boxes: (input) => {
        seen.push(input);
        return asLayout(BOXES);
      },
    };
    const { code } = await run(["--only", "boxes", "--doc", DOC_A], stages);
    expect(code).toBe(0);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      doc: DOC_A,
      label: "767",
      width: 767,
      layout: LAYOUT,
      theme: null,
      measurements: [{ text: "x", width: 1 }],
      layoutMeasurements: [{ q: "layout_height", a: 2 }],
      fonts: [
        {
          face: FACE,
          path: join(fixtures, "fonts/Face.ttf"),
          sha256: "f00",
          source: "assets/fonts/Face.ttf",
        },
      ],
    });
  });

  test("a layout stage gets the font files of its theme's faces, system fallbacks left out", async () => {
    const seen: string[][] = [];
    const stages: Stages = {
      layoutGenerated: (input) => {
        seen.push(input.fonts.map((font) => font.face));
        return asLayout(LAYOUT);
      },
    };
    const { code } = await run(["--only", "layout-generated"], stages);
    expect(code).toBe(0);
    expect(seen).toEqual([[FACE], [FACE]]);
  });

  test("a layout stage gets the THEME file the document renders with", async () => {
    const seen: (ThemeSource | null)[] = [];
    const stages: Stages = {
      layoutGenerated: (input) => {
        seen.push(input.theme);
        return asLayout(LAYOUT);
      },
    };
    const { code } = await run(["--only", "layout-generated"], stages);
    expect(code).toBe(0);
    expect(seen).toEqual([null, { path: "THEME.md", text: "# theme" }]);
  });

  test("the stages are closed once, after the last check", async () => {
    const events: string[] = [];
    const stages: Stages = {
      layoutGenerated: () => {
        events.push("layout");
        return asLayout(LAYOUT);
      },
      close: () => {
        events.push("close");
        return Promise.resolve();
      },
    };
    await run(["--only", "layout-generated"], stages);
    expect(events).toEqual(["layout", "layout", "close"]);
  });
});

describe("failures", () => {
  test("a changed flag in the grouping fails with a flag section", async () => {
    const stages: Stages = {
      ...identityStages(),
      group: (markdown) => (markdown === "# b" ? tree("b", false) : tree("a")),
    };
    const { code, out } = await run([], stages);
    expect(code).toBe(1);
    expect(out).toContain(`FAIL grouper-final · ${DOC_B}`);
    expect(out).toMatch(/^ {2}flag$/m);
    expect(out).not.toContain(`FAIL grouper-final · ${DOC_A}`);
  });

  test("a stage that throws fails the check and names the error", async () => {
    const stages: Stages = {
      ...identityStages(),
      group: () => {
        throw new Error("boom");
      },
    };
    const { code, out } = await run([], stages);
    expect(code).toBe(1);
    expect(out).toContain("the stage threw: boom");
  });

  test("a layout difference with a classified divergence is diverged, not failed", async () => {
    const differing: Json = { ...(LAYOUT as object), ratios: [2] };
    const stages: Stages = {
      ...identityStages(),
      layoutGenerated: () =>
        Promise.resolve({
          output: differing,
          divergences: [{ class: HYPHEN, text: "x", words: [] }],
        }),
    };
    const { code, out } = await run(["--only", "layout-generated"], stages);
    expect(code).toBe(0);
    expect(out).toContain("DIVERGED (hyphen)");
    expect(out).toContain('measurer divergence "hyphen"');
  });

  test("a classified divergence does not cover a difference measurement cannot make", async () => {
    // A section's background stack hidden behind a line-break class.
    const expected = { boxes: [{ content_id: 3, x: 0, y: 0, bg_stack: [1, 2] }] };
    putJson(`boxes/767/${DOC_A}.json`, expected);
    const stages: Stages = {
      ...identityStages(),
      boxes: () =>
        Promise.resolve({
          output: { boxes: [{ content_id: 3, x: 5, y: 0, bg_stack: [2] }] },
          divergences: [{ class: HYPHEN, text: "x", words: [] }],
        }),
    };
    try {
      const { code, out } = await run(["--only", "boxes", "--doc", DOC_A], stages);
      expect(code).toBe(1);
      expect(out).toContain(`FAIL boxes:767 · ${DOC_A}`);
      expect(out).toContain("not explained by the measurer divergences: 2");
      expect(out).toContain("boxes of content 3 · bg_stack[0]: expected 1, actual 2");
    } finally {
      putJson(`boxes/767/${DOC_A}.json`, BOXES);
    }
  });

  test("an unmeasured word the differing entry does not write explains nothing", async () => {
    // The class needs its word written where the layout differs.
    const differing: Json = { type: "column", content_id: 3, extra: 1, children: [] };
    const stages: Stages = {
      ...identityStages(),
      layoutGenerated: () =>
        Promise.resolve({
          output: differing,
          divergences: [{ class: "unmeasured-word", text: "x", words: ["member…"] }],
        }),
    };
    const { code, out } = await run(["--only", "layout-generated"], stages);
    expect(code).toBe(1);
    expect(out).toContain("FAIL layout-generated");
  });

  test("an unclassified measurer answer fails even when the layout matches", async () => {
    const stages: Stages = {
      ...identityStages(),
      layoutGenerated: () =>
        Promise.resolve({
          output: LAYOUT,
          divergences: [
            { class: "unclassified", text: "leaf_min_width 0.1: md2ui 2, port 3", words: [] },
          ],
        }),
    };
    const { code, out } = await run(["--only", "layout-generated"], stages);
    expect(code).toBe(1);
    expect(out).toContain("unclassified measurer answers: 1");
    expect(out).toContain("leaf_min_width 0.1: md2ui 2, port 3");
  });

  test("the same layout difference without divergences fails", async () => {
    const differing: Json = { type: "column", content_id: 3, extra: 1, children: [] };
    const stages: Stages = { ...identityStages(), layoutGenerated: () => asLayout(differing) };
    const { code, out } = await run(["--only", "layout-generated"], stages);
    expect(code).toBe(1);
    expect(out).toContain("FAIL layout-generated:767");
  });
});

describe("grouper phases", () => {
  test("a phase absent from every pass is not ported", async () => {
    const stages: Stages = {
      groupPhases: (markdown) =>
        markdown === "# a"
          ? [new Map([["1", SPACED]]), new Map([["1", PLAIN]])]
          : [new Map([["1", PLAIN]])],
    };
    const { code, out } = await run(["--only", "grouper-phase"], stages);
    expect(code).toBe(0);
    expect(out).toMatch(/^grouper-phase:1\s+2\s+0\s+0\s+0$/m);
    expect(out).toMatch(/^grouper-phase:2\s+0\s+0\s+0\s+2$/m);
  });

  test("a phase present in only some passes fails on the missing pass", async () => {
    const stages: Stages = {
      groupPhases: (markdown) =>
        markdown === "# a"
          ? [new Map<string, Json>(), new Map([["1", PLAIN]])]
          : [new Map([["1", PLAIN]])],
    };
    const { code, out } = await run(["--only", "grouper-phase:1"], stages);
    expect(code).toBe(1);
    expect(out).toContain(`FAIL grouper-phase:1 · ${DOC_A}`);
    expect(out).toContain("[spaced pass] root: expected a tree, actual absent");
    expect(out).not.toContain(`FAIL grouper-phase:1 · ${DOC_B}`);
  });
});

describe("selection and setup errors", () => {
  test("--only grouper-phase selects only the phase checks", async () => {
    const { code, out } = await run(["--only", "grouper-phase"], identityStages());
    expect(code).toBe(0);
    expect(out).toMatch(/^grouper-phase:1\s/m);
    expect(out).toMatch(/^grouper-phase:2\s/m);
    expect(out).not.toContain("grouper-final");
    expect(out).not.toMatch(/^theme\s/m);
  });

  test("--doc filters the units", async () => {
    const { code, out } = await run(["--doc", DOC_A], identityStages());
    expect(code).toBe(0);
    expect(out).toMatch(/^total\s+9\s+0\s+0\s+0$/m);
  });

  test("--only with an unknown check exits 2", async () => {
    const { code, out } = await run(["--only", "nonsense"], {});
    expect(code).toBe(2);
    expect(out).toContain("nonsense");
  });

  test("--doc with an unknown document exits 2", async () => {
    expect((await run(["--doc", "nope"], {})).code).toBe(2);
  });

  test("a missing --fixtures exits 2", async () => {
    let out = "";
    const code = await main([], {}, (text) => {
      out += text;
    });
    expect(code).toBe(2);
    expect(out).toContain("--fixtures");
  });

  test("an unknown flag exits 2", async () => {
    expect((await run(["--bogus"], {})).code).toBe(2);
  });

  test("the grouper reads its Markdown from the fixtures' own input copy", async () => {
    const seen: string[] = [];
    const stages: Stages = {
      group: (markdown) => {
        seen.push(markdown);
        return FINAL[markdown] ?? null;
      },
    };
    const { code } = await run(["--only", "grouper-final"], stages);
    expect(code).toBe(0);
    expect(seen).toEqual(["# a", "# b"]);
  });
});
