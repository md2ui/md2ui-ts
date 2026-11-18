// Grouper rules at edges the corpus reaches once or not at all: an escaped `\#`, the
// pair kind, a `:::` cell holding only a spacer and `---` that paints but never cuts.
// Expected values are md2ui's own tests; these run without fixtures.
import { expect, test } from "vitest";
import { gluedRules } from "../src/group/block-splits.ts";
import { groupDocument } from "../src/group/grouper.ts";
import type { GroupNode } from "../src/group/node.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { stripSpacerLines } from "../src/group/spacers.ts";

function nodes(root: GroupNode): GroupNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

const leaves = (root: GroupNode): GroupNode[] =>
  nodes(root).filter((n) => n.children.length === 0 && n !== root);

const glued = (root: GroupNode): GroupNode[] => nodes(root).filter((n) => n.glued_content_group);

const theRow = (root: GroupNode): GroupNode => {
  const rows = nodes(root).filter((n) => n.column_row_group);
  expect(rows).toHaveLength(1);
  return rows[0] as GroupNode;
};

// md2ui markdown_preprocessing_tests: test_an_escaped_hash_is_text_not_a_heading
test("an escaped hash is text that starts with a hash, never a heading", () => {
  for (const [text, kind] of [
    ["\\# Not a heading", "text"],
    ["- \\# Not a heading\n- A plain item", "list_item"],
  ] as const) {
    const first = leaves(groupDocument(text))[0];
    expect([first?.type, first?.content, first?.atx_level]).toEqual([kind, "# Not a heading", 0]);
  }
});

test("an authored heading inside a list item keeps its level", () => {
  const first = leaves(groupDocument("- # Title\n- A plain item"))[0];
  expect([first?.content, first?.atx_level]).toEqual(["Title", 1]);
});

// md2ui grouper_kind_tokens_tests: the pair kind.
const DATE_AND_AGENDA =
  "## \n\n_FRI_\n___20___\n\n" +
  "4:00 PM ... Finish packing\n6:00 PM ... Drop off keys\n" +
  "6:30 PM ... Leave for airport\n";

test("a two-line glued block never twins with a three-line one", () => {
  const [date, agenda] = glued(groupDocument(DATE_AND_AGENDA));
  expect(date?.kind_hash).not.toBe(agenda?.kind_hash);
  expect([date?.run_key, agenda?.run_key]).toEqual([null, null]);
});

test("two pairs still twin", () => {
  const [a, b] = glued(groupDocument("## \n\nAccuracy\n**94%**\n\nRecall\n**81%**\n"));
  expect(a?.kind_hash).toBe(b?.kind_hash);
  expect(a?.run_key).not.toBeNull();
  expect(a?.run_key).toBe(b?.run_key);
});

// md2ui spacer_tests: a `:::` cell holding only a spacer.
test("a spacer that is a whole cell at a row's edge stays for the row build", () => {
  const kit = new RegexKit();
  const doc = "## \n\nText\n\n:::\n\n++++\n\n## \n\nNext\n";
  expect(stripSpacerLines(kit, doc)).toBeNull();
  // A comment is not a neighbour: the grouping never sees it.
  const commented = doc.replace("## \n\nNext", "<!-- the next one\n-->\n## \n\nNext");
  expect(stripSpacerLines(kit, commented)).toBeNull();
  expect(stripSpacerLines(kit, "Text\n\n++++\n\n:::\n\nB\n")).toBe("Text\n\n\n:::\n\nB\n");
});

test("a trailing spacer cell is space after its cell, not a closed section", () => {
  const root = groupDocument("## \n\nText\n\n:::\n\n++++\n\n## \n\nNext section\n");
  expect(nodes(root).some((n) => n.column_row_group)).toBe(false);
  const text = nodes(root).find((n) => n.content === "Text");
  expect([text?.spacer_lead, text?.spacer_trail]).toEqual([null, "++++"]);
  expect(nodes(root).some((n) => n.type === "spacer")).toBe(false);
});

test("a leading spacer cell is space before its cell", () => {
  const root = groupDocument("## \n\n++++\n\n:::\n\nText\n");
  const text = nodes(root).find((n) => n.content === "Text");
  expect([text?.spacer_lead, text?.spacer_trail]).toEqual(["++++", null]);
  expect(nodes(root).some((n) => n.type === "spacer")).toBe(false);
});

test("spacer cells on both sides hold the cell between them", () => {
  const pairs = "Key: ... value\nKey: ... value\nKey: ... value\n";
  const root = groupDocument(`## \n\n++++\n\n:::\n\n${pairs}\n:::\n\n++++\n`);
  const held = nodes(root).filter((n) => n.spacer_lead || n.spacer_trail);
  expect(held.map((n) => [n.spacer_lead, n.spacer_trail, n.children.length])).toEqual([
    ["++++", "++++", 3],
  ]);
  expect(nodes(root).some((n) => n.type === "spacer")).toBe(false);
});

test("spacer cells at a row's ends are the row's own edges", () => {
  const row = theRow(groupDocument("++++\n\n:::\n\nAlpha\n\n:::\n\nBravo\n\n:::\n\n+++\n"));
  expect(row.children.map((c) => c.content)).toEqual(["Alpha", "Bravo"]);
  expect([row.spacer_lead, row.spacer_trail]).toEqual(["++++", "+++"]);
});

// md2ui horizontal_rule_tests and column_divider_tests: `---` paints, never cuts.
test("a tight rule divides one glued block", () => {
  const root = groupDocument("Alpha one\n---\nBeta two\n---\nGamma three\n");
  expect(root.children.map((c) => [c.type, c.glued_content_group])).toEqual([["group", true]]);
  expect(root.children[0]?.children.map((c) => c.type)).toEqual([
    "text",
    "horizontal_rule",
    "text",
    "horizontal_rule",
    "text",
  ]);
});

test("a rule beside a heading, a list or a blank line still cuts", () => {
  const kit = new RegexKit();
  const cuts = (text: string): number[] => {
    const lines = text.split("\n");
    const breaks = new Set([1]);
    return [...gluedRules(kit, lines, breaks, new Set())];
  };
  expect(cuts("Alpha\n---\nBeta")).toEqual([1]);
  expect(cuts("Alpha\n---\n")).toEqual([]);
  expect(cuts("- item\n---\nBeta")).toEqual([]);
  expect(cuts("> quote\n---\nBeta")).toEqual([]);
  expect(cuts("Alpha\n---\n| a |")).toEqual([]);
  expect([...gluedRules(kit, ["## A", "---", "Text"], new Set([1]), new Set([0]))]).toEqual([]);
});

test("a rule does not end a row", () => {
  const row = theRow(groupDocument("A\n:::\nB\n\n---\n\nC\n"));
  expect(row.children).toHaveLength(2);
  expect(row.children[1]?.children.map((c) => c.type)).toEqual(["text", "horizontal_rule", "text"]);
});

test("rules alone after the last divider paint under the row", () => {
  const root = groupDocument("A\n:::\nB\n:::\n\n---\n___\n");
  const row = theRow(root);
  expect(row.children).toHaveLength(2);
  expect(root.children[root.children.indexOf(row) + 1]?.type).toBe("horizontal_rule");
});
