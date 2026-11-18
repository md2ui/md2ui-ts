// Escaped and muted controls in grouping and targets (md2ui findings
// `an-escaped-slider-still-draws`, `an-escaped-pipe-splits-a-table-cell`,
// `a-muted-slider-stays-live`): every escaped slider or box spelling is text drawn as
// written; an escaped pipe stays in its table cell; a control written `~~` is disabled,
// keeps its ordinal and takes no tildes. Expected values are md2ui's own tests
// (`slider_tests`, `task_control_tests`, `markdown_table_tests`, `choices_tests`).
import type { GroupingNode } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { actionTargets } from "../src/actions/targets.ts";
import { rowCells } from "../src/group/escapes.ts";
import { groupDocument } from "../src/group/grouper.ts";
import { RegexKit } from "../src/group/py/re.ts";

const grouped = (markdown: string): GroupingNode => groupDocument(markdown).toDict();

function nodes(nd: GroupingNode): GroupingNode[] {
  return [nd, ...nd.children.flatMap(nodes)];
}
const leaves = (nd: GroupingNode): GroupingNode[] =>
  nodes(nd).filter((n) => n.children.length === 0);
const payloads = (nd: GroupingNode) =>
  nodes(nd).flatMap((n) => (n.drawing_element === undefined ? [] : [n.drawing_element]));
const silent = (nd: GroupingNode) => actionTargets(nd).map((t) => [t.action === null, t.disabled]);

// md2ui: test_every_escaped_slider_spelling_is_text_drawn_as_written,
// test_an_escaped_box_is_text_whatever_its_spelling
test("every escaped slider or box spelling is text, its bracket drawn as written", () => {
  for (const [markdown, drawn] of [
    [String.raw`Volume: \[65%]`, "Volume: [65%]"],
    [String.raw`Volume: \[65%\]`, "Volume: [65%]"],
    [String.raw`Quantity: \[2/9]`, "Quantity: [2/9]"],
    [String.raw`Quantity: \[2/9\]`, "Quantity: [2/9]"],
    [String.raw`Set it \[65%\] now.`, "Set it [65%] now."],
    [String.raw`WiFi: \[x]`, "WiFi: [x]"],
    [String.raw`WiFi: \[x\]`, "WiFi: [x]"],
    [String.raw`- \[x\] Escaped box`, "[x] Escaped box"],
  ] as const) {
    const tree = grouped(markdown);
    expect(payloads(tree), markdown).toEqual([]);
    expect(actionTargets(tree), markdown).toEqual([]);
    expect(
      leaves(tree).map((n) => n.content),
      markdown,
    ).toEqual([drawn]);
  }
});

// md2ui: test_parse_row_cells_keeps_an_escaped_pipe_in_its_cell
test("an escaped pipe stays in its table cell, the pipe alone in a code span", () => {
  const kit = new RegexKit();
  expect(rowCells(kit, String.raw`| a \| b | c |`)).toEqual([String.raw`a \| b`, "c"]);
  expect(rowCells(kit, String.raw`| ${"`"}a \| b${"`"} | c |`)).toEqual(["`a | b`", "c"]);
  expect(rowCells(kit, String.raw`| [S](/s) \| [M](/m) |`)).toEqual([
    String.raw`[S](/s) \| [M](/m)`,
  ]);
  expect(rowCells(kit, String.raw`| ends in \|`)).toEqual([String.raw`ends in \|`]);
});

// md2ui: test_a_muted_slider_is_disabled_and_keeps_its_ordinal
test("a muted slider reports nothing, keeps its ordinal and takes no tildes", () => {
  const tree = grouped(
    "Volume: ~~[65%]~~\n\nEffects: ~~[[35%]](agent:set-effects)~~\n\n" +
      "Bass: [30%]\n\n~~Treble: [40%]~~",
  );
  const found = payloads(tree);
  expect(found.map((p) => p["disabled"] ?? false)).toEqual([true, true, false, true]);
  expect(found.map((p) => p.label)).toEqual(["Volume", "Effects", "Bass", "Treble"]);
  expect(found.map((p) => p.index)).toEqual([0, 1, 2, 3]);
  expect(leaves(tree).map((n) => n.content)).not.toContain("~~");
  expect(silent(tree)).toEqual([
    [true, true],
    [true, true],
    [false, false],
    [true, true],
  ]);
  expect(actionTargets(tree)[2]?.action?.index).toBe(2);
});

// md2ui: test_a_muted_task_box_is_disabled_and_keeps_its_ordinal
test("a muted task box reports nothing, keeps its ordinal and takes no tildes", () => {
  const tree = grouped("- ~~[ ]~~ Send the report\n- [ ] Call Ana\n\nWiFi ... ~~[x]~~");
  const boxes = payloads(tree);
  expect(boxes.map((b) => b["disabled"] ?? false)).toEqual([true, false, true]);
  expect(boxes.map((b) => b.label)).toEqual(["Send the report", "Call Ana", ""]);
  expect(leaves(tree).filter((n) => (n.content ?? "").includes("~~"))).toEqual([]);
  expect(silent(tree)).toEqual([
    [true, true],
    [false, false],
    [true, true],
  ]);
  expect(actionTargets(tree)[1]?.action?.index).toBe(1);
});

// md2ui: test_a_muted_count_is_disabled_and_keeps_its_ordinal
test("a muted count is disabled at its ordinal, its tildes taken with it", () => {
  for (const markdown of [
    "Quantity: ➖ ~~[2/9]~~ ➕\n\nSize: ➖ [3/9] ➕",
    "Quantity: ~~➖ [2/9] ➕~~\n\nSize: ➖ [3/9] ➕",
    "~~Quantity: ➖ [2/9] ➕~~\n\nSize: ➖ [3/9] ➕",
  ]) {
    const tree = grouped(markdown);
    const found = payloads(tree);
    expect(
      found.map((p) => [p["count"], p["disabled"] ?? false]),
      markdown,
    ).toEqual([
      [true, true],
      [true, false],
    ]);
    expect(
      found.map((p) => p.label),
      markdown,
    ).toEqual(["Quantity", "Size"]);
    const texts = leaves(tree)
      .filter((n) => n.drawing_element === undefined)
      .map((n) => (n.content ?? "").replace("~~Quantity~~", ""));
    expect(
      texts.filter((t) => t.includes("~~")),
      markdown,
    ).toEqual([]);
    const [muted, live] = actionTargets(tree);
    expect(muted?.action === null && muted.disabled, markdown).toBe(true);
    expect(live?.action?.count && live.action.index, markdown).toBe(1);
  }
});
