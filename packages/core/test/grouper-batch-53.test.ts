// In the grouper, a dot is text, a pair exists only while a display reads it (ADR-205), and a
// one-line colon column never joins a row's run. Expected values are md2ui's own tests
// (markdown_separator_split_tests, grouper_pairs_tests, markdown_kind_line_tolerance_tests);
// these run without fixtures.
import { expect, test } from "vitest";
import { groupDocument } from "../src/group/grouper.ts";
import type { GroupNode } from "../src/group/node.ts";
import { unpairUnread } from "../src/group/pairs.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { splitSeparators } from "../src/group/separator-splits.ts";

const kit = new RegexKit();

function nodes(root: GroupNode): GroupNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

const leaves = (doc: string): string[] =>
  nodes(groupDocument(doc))
    .filter((n) => n.children.length === 0)
    .map((n) => n.content);

const split = (line: string) => splitSeparators(kit, line, []);

// --- a dot is text -------------------------------------------------

// md2ui: test_a_dot_never_splits
test("a dot never splits a line, alone or wrapped", () => {
  for (const dot of "•·∙‧") {
    expect(split(`Apples ${dot} Pears ${dot} Plums`), dot).toBeNull();
    expect(split(`${dot} Apples ${dot} Pears`), dot).toBeNull();
    expect(split(`**A** ${dot} **B** ${dot} **C**`), dot).toBeNull();
  }
});

// md2ui: test_a_dot_stays_in_the_piece_a_separator_makes
test("a dot stays inside the piece a ` | ` or ` - ` makes", () => {
  expect(split("A • B | C")).toEqual([
    ["segment", "A • B"],
    ["segment", "C"],
  ]);
  expect(split("A · B - C")).toEqual([
    ["segment", "A · B"],
    ["segment", "C"],
  ]);
  expect(split("A • B | C - D")).toEqual([
    ["segment", "A • B"],
    ["segment", "C"],
    ["segment", "D"],
  ]);
});

// md2ui: test_a_dot_line_is_one_text. A dot is no Markdown escape, so a backslash
// before one stays, as it does in any Markdown renderer.
test("a dot line is one text; a backslash before a dot stays", () => {
  for (const dot of "•·∙‧") {
    expect(leaves(`Alpha beta ${dot} Gamma delta\n`), dot).toEqual([
      `Alpha beta ${dot} Gamma delta`,
    ]);
    expect(leaves(`Alpha beta \\${dot} Gamma delta\n`), dot).toEqual([
      `Alpha beta \\${dot} Gamma delta`,
    ]);
  }
  expect(leaves("**Concha y Toro · Vino tinto**\n")).toEqual(["**Concha y Toro · Vino tinto**"]);
});

// --- a pair exists only while a display reads it -----------------------------

/** md2ui `_shape`: type, content (an escaped colon read as a colon), tier and children. */
type Shape = [string, string, string | null, Shape[]];
function shape(node: GroupNode): Shape {
  return [
    node.type,
    (node.content ?? "").replace("\\:", ":"),
    node.text_style,
    node.children.map(shape),
  ];
}

const group = (text: string): GroupNode => groupDocument(`${text}\n`);
const pairs = (node: GroupNode): GroupNode[] => nodes(node).filter((n) => n.type === "key-value");

// md2ui: test_a_line_no_display_reads_is_its_escaped_twin
test("a line no display reads is the tree of its escaped twin", () => {
  for (const line of [
    "Day one: the old town",
    "**Day one:** the old town",
    "## Day one: the old town",
    "- Day one: the old town",
    "_Day one: the old town_",
    "Panelists:",
    "Cover:\n![x](https://example.com/one.jpg)",
    // md2ui: a picture on the pair's own line is a picture, as in its twin.
    "Cover: ![x](https://example.com/one.jpg)",
    "**Cover:** ![Album](https://example.com/one.jpg)",
    "- **Cover:** ![Album](https://example.com/one.jpg)",
  ]) {
    const twin = line.replace(":", "\\:");
    expect(shape(group(line)), line).toEqual(shape(group(twin)));
    expect(pairs(group(line)), line).toEqual([]);
  }
});

// md2ui: test_a_separator_outranks_the_colon
test("a separator divides first; each piece is its escaped twin", () => {
  for (const line of [
    "Status: open - Owner: Ana",
    "Price: $12 | Size: M",
    "v1.0: alpha | beta",
    "**Key:** v1 | v2 | v3",
    "K: 1,293 - `x` : vs last month",
  ]) {
    expect(shape(group(line)), line).toEqual(shape(group(line.replace(":", "\\:"))));
  }
});

// md2ui: test_a_pair_a_display_reads_stays_a_pair
test("bars, rings, lines, sliders and chart rows keep their pairs", () => {
  for (const [line, display] of [
    ["Progress: 60%", "kv_percent_bar"],
    ["Minutes: 7/8", "unit_ratio"],
    ["Price: $710 → $713 → $720", "line_chart"],
  ] as const) {
    const found = pairs(group(line));
    expect(
      found.map((p) => p.datapoint_display),
      line,
    ).toEqual([display]);
  }
  const [slider] = pairs(group("Volume: [[62%]]"));
  expect(slider && nodes(slider).some((n) => n.type === "drawing_element")).toBe(true);
  const chart = nodes(group("- Revenue: 40%\n- Costs: 25%\n- Profit: 35%")).find(
    (n) => n.chart_group,
  );
  expect(chart && pairs(chart).length).toBe(3);
});

// md2ui: test_the_pass_leaves_a_finished_tree_as_it_is
test("the pass on a finished tree changes nothing", () => {
  const root = group(
    "Day one: old town\n\nProgress: 60%\n\n- Revenue: 40%\n- Costs: 25%\n- Profit: 35%",
  );
  const before = shape(root);
  unpairUnread(kit, root);
  expect(shape(root)).toEqual(before);
});

// md2ui: test_a_glued_colon_is_text (its ADR-205 half): spaced is text too, styled or not.
test("a colon is text, glued or spaced", () => {
  for (const line of ["key: value 1, key:value 2", "**Key:** value", "**Key: value**"]) {
    expect(leaves(line), line).toEqual([line]);
    expect(shape(group(line)), line).toEqual(shape(group(line.replace(":", "\\:"))));
  }
});

// --- a one-line colon column is never the row a split line is -----------------

// md2ui: test_a_row_never_joins_a_run_of_column_lines (findings/spring-row-joins-pair-run).
test("a spring row before or after four pairs stays out of their run", () => {
  const PAIRS = "_RealFeel_ : 19°\n\n_Wind_ : NNE 6 km/h\n\n_Humidity_ : 49%\n\n_UV_ : 1.4 low\n";
  const SPRING = "Mostly cloudy ... Air quality poor\n";
  for (const doc of [`## Tokyo\n\n${SPRING}\n${PAIRS}`, `## Tokyo\n\n${PAIRS}\n${SPRING}`]) {
    const section = groupDocument(doc).children[0] as GroupNode;
    const runs = [...(section.repeated_children?.values() ?? [])].map((run) => run.length);
    expect(runs, doc).toEqual([4]);
  }
});
