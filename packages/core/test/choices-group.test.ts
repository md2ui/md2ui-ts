// Choices and counts in grouping and targets (md2ui ADR-405): a ` | ` run
// of one choice's options is stamped `segmented_run`; a ratio slider between ➖ and ➕ is a
// count, named by the words before ➖ (else a caption or the row's first cell), with its
// signs cut from the words beside it; an `agent:` button with `md2ui.choice` is an option
// with a checked state. Expected values are md2ui's own (`tests/choices_tests.py`).
import { expect, test } from "vitest";
import { targetTable } from "../src/actions/targets.ts";
import { groupDocument } from "../src/group/grouper.ts";
import type { GroupNode } from "../src/group/node.ts";

function nodes(root: GroupNode): GroupNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

const sliders = (root: GroupNode) =>
  nodes(root).flatMap((n) => (n.drawing_element?.kind === "slider" ? [n.drawing_element] : []));

const leafTexts = (root: GroupNode): string[] =>
  nodes(root)
    .filter((n) => n.children.length === 0)
    .map((n) => n.content);

const OPTIONS =
  "[S](agent:size?v=s&md2ui.choice=size) | *[M](agent:size?v=m&md2ui.choice=size)* | *[L](agent:size?v=l&md2ui.choice=size)*";

test("a ` | ` run of one choice's options is one segmented run, and no other run is", () => {
  const root = groupDocument(`_Size_\n${OPTIONS}\n`);
  expect(nodes(root).filter((n) => n.segmented_run)).toHaveLength(1);
  for (const md of [
    "[S](agent:size?md2ui.choice=size) | *[M](agent:size?md2ui.choice=fit)*",
    "[S](agent:size?md2ui.choice=size) *[M](agent:size?md2ui.choice=size)*",
    "[S](agent:size?md2ui.choice=size) | *[M](/m?md2ui.choice=size)*",
    "[S](agent:size) | *[M](agent:size)*",
  ]) {
    expect(
      nodes(groupDocument(`${md}\n`)).filter((n) => n.segmented_run),
      md,
    ).toHaveLength(0);
  }
});

test("a count is named by the words before ➖, and its signs leave the words", () => {
  const root = groupDocument("Quantity: ➖ [2/9] ➕\n");
  const [count] = sliders(root);
  expect(count).toMatchObject({ kind: "slider", count: true, label: "Quantity", max: 9 });
  expect(leafTexts(root).some((t) => t.includes("➖") || t.includes("➕"))).toBe(false);
  // An ASCII dash divides the line first, and a percentage is a slider, not a count.
  for (const md of ["Quantity - [2/9] +\n", "Volume: ➖ [40%] ➕\n"]) {
    expect(sliders(groupDocument(md))[0]?.count, md).toBeUndefined();
  }
});

test("a count alone on its line takes its caption; in a table, its row's first cell", () => {
  const caption = sliders(groupDocument("_Adults_\n➖ [2/9] ➕\n"));
  expect(caption[0]).toMatchObject({ count: true, label: "Adults" });
  const table = sliders(groupDocument("| Item | Qty |\n|---|---|\n| Socks | ➖ [2/9] ➕ |\n"));
  expect(table[0]).toMatchObject({ count: true, label: "Socks" });
});

test("an option is a target with a checked state, chosen when written as the main button", () => {
  const table = targetTable(
    groupDocument(`${OPTIONS}\n\n[Read](agent:read?md2ui.choice=size) more.\n`).toDict(),
  );
  expect(table.map((t) => [t?.label, t?.checked, t?.choice])).toEqual([
    ["S", true, "size"],
    ["M", false, "size"],
    ["L", false, "size"],
    // A link inside a sentence is never an option.
    ["Read", undefined, undefined],
  ]);
});

test("a count's target is a slider flagged count", () => {
  const [target] = targetTable(groupDocument("Quantity: ➖ [2/9] ➕\n").toDict());
  expect(target).toMatchObject({
    kind: "slider",
    label: "Quantity",
    slider: { value: 2, max: 9, count: true },
  });
});
