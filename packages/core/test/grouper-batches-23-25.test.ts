// In the grouper, a picture that was not authored is never invented, a spaced dash
// divides a sentence like any separator, blank lines inside a `:::` side never add
// columns, a picture counts no words, and a spacer cell's side counts in its node's own
// kind. Expected values are md2ui's own tests; these run without fixtures.
import { expect, test } from "vitest";
import { groupDocument } from "../src/group/grouper.ts";
import type { GroupNode } from "../src/group/node.ts";
import { rowSeparatorChars } from "../src/group/node-reads.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { splitSeparators } from "../src/group/separator-splits.ts";

const kit = new RegexKit();

function nodes(root: GroupNode): GroupNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

const leafContents = (doc: string): string[] =>
  nodes(groupDocument(doc))
    .filter((n) => n.children.length === 0)
    .map((n) => n.content);

// --- no picture slot ---------------------------------------------------------

// md2ui markdown_kind_line_tolerance_tests: test_card_without_its_picture_gets_none
test("a card without its picture gets no picture", () => {
  const albums =
    "## Albums\n\n" +
    "### \n![Abbey Road](https://example.com/a.jpg?md2ui.aspect_ratio=1:1)\n**Abbey Road**\nThe Beatles\n\n" +
    "### \n**Blue**\nJoni Mitchell\n\n" +
    "### \n![Kind](https://example.com/k.jpg?md2ui.aspect_ratio=1:1)\n**Kind**\nMiles\n";
  const cards =
    "## Reading list\n\n" +
    "### Streets\n![A street](https://example.com/s.jpg)\nBack to walkers.\n\n" +
    "### Markets\n![A market](https://example.com/m.jpg)\nA short walk away.\n\n" +
    "### Parking\nFree parking costs more than anyone pays for it.\n";
  for (const doc of [albums, cards]) {
    const section = groupDocument(doc).children[0] as GroupNode;
    const pictures = nodes(section)
      .filter((n) => n.type === "image")
      .map((n) => n.content);
    expect(pictures, doc).toHaveLength(2);
    expect(pictures.every((p) => p.includes("example.com"))).toBe(true);
    // The card without one still runs with its pictured siblings.
    expect([...(section.repeated_children?.values() ?? [])].map((r) => r.length)).toEqual([3]);
  }
});

// --- the sentence-dash exception is gone -------------------------------------

const split = (line: string) => splitSeparators(kit, line, []);

// md2ui markdown_separator_split_tests: test_a_spaced_dash_divides_a_sentence
test("a spaced dash divides a sentence; an escape or an em dash does not", () => {
  for (const line of [
    "Delivery takes 3 days - order before 5 PM.",
    "The lamp is fantastic - bright and sleek.",
  ]) {
    expect(split(line), line).toHaveLength(2);
  }
  expect(leafContents("Alpha | Beta - Gamma.")).toEqual(["Alpha", "Beta", "Gamma."]);
  expect(split(String.raw`The lamp is fantastic \- bright and sleek.`)).toBeNull();
  expect(split("The lamp is fantastic — bright and sleek.")).toBeNull();
});

// md2ui markdown_separator_split_tests: test_a_separator_outranks_a_tight_colon
// (ADR-205): the colon makes no pair, so the separator divides the line and the colon
// stays in the piece it was written in.
test("a separator divides a colon line; the colon stays in its piece", () => {
  for (const [line, pieces] of [
    ["Note: it crashed - really.", ["Note: it crashed", "really."]],
    ["Key: A | B", ["Key: A", "B"]],
  ] as const) {
    expect(leafContents(line), line).toEqual(pieces);
    expect(
      nodes(groupDocument(line)).filter((n) => n.type === "key-value"),
      line,
    ).toEqual([]);
  }
});

// md2ui markdown_separator_split_tests: test_rows_ending_in_a_stop_split
test("attribution, element lead, ellipsis and unpunctuated rows split", () => {
  for (const line of [
    '"Love the quality and fast shipping!" - Sarah M.',
    "**Beagle** - Merry, friendly, and curious hound.",
    "🚶 - A little further.",
    "🚶 - __A little further.__",
    "⚡ - Charging...",
    "Wait 10 minutes - it is slow",
    "**Labrador Retriever** - Friendly, outgoing companion",
  ]) {
    expect(split(line), line).toHaveLength(2);
  }
});

// md2ui markdown_separator_split_tests: test_separator_scans_never_ask_the_criteria.
// The two scans agree: the split and the recorded separator chars.
test("the split and separator_chars both read the dash", () => {
  expect(split("Alpha | Beta - Gamma.")).not.toBeNull();
  expect(rowSeparatorChars("Alpha | Beta - Gamma.", [])).toEqual(["|", "-"]);
});

// --- one column per side -----------------------------------------------------

const theRow = (root: GroupNode): GroupNode => {
  const found = nodes(root).filter((n) => n.column_row_group);
  expect(found).toHaveLength(1);
  return found[0] as GroupNode;
};

// md2ui column_divider_tests: test_blank_lines_inside_a_side_never_add_columns
test("blank lines inside a side never add columns", () => {
  const row = theRow(groupDocument("A\n\n:::\n\nB\n\nC\n\nD\n"));
  expect(row.children).toHaveLength(2);
  expect(row.children[0]?.content).toBe("A");
  expect(row.children[1]?.children.map((c) => c.content)).toEqual(["B", "C", "D"]);
});

// md2ui column_divider_tests: test_blank_separated_groups_stay_in_the_first_side
test("blank-separated groups stay in the first side", () => {
  const row = theRow(
    groupDocument(
      "_Contributor_\n**Haqqi**\n\n_Reading time_\n2 minutes\n::: 1 >\n" +
        "First paragraph.\n\nSecond paragraph.\n:::3\n",
    ),
  );
  expect(row.column_weights).toEqual([1, 3]);
  expect(row.children).toHaveLength(2);
  expect(row.children[0]?.children).toHaveLength(2);
  expect(row.children[1]?.children).toHaveLength(2);
});

// --- a picture counts no words -----------------------------------------------

// md2ui image_word_count_tests: _cards
const LONG_ALT = "{} interface showing a coding task and agent progress inside the app.";
function photoCards(alt: string): string {
  return ["app", "editor", "terminal"]
    .map(
      (name, i) =>
        `### \n![${alt.replace("{}", name)}](https://example.com/photo.jpg?md2ui.aspect_ratio=4:3)\n` +
        `__Codex ${name}__\n*[Try it](/t${i})*\n\n`,
    )
    .join("");
}

// md2ui image_word_count_tests: test_an_image_counts_no_words
test("an image counts no words", () => {
  for (const alt of [LONG_ALT, "{} app", ""]) {
    const images = nodes(groupDocument(photoCards(alt))).filter((n) => n.type === "image");
    expect(images).toHaveLength(3);
    for (const image of images) {
      expect(image.content_length_category, alt).toBe("one_word");
      expect(image.avg_word_count, alt).toBe(0);
    }
  }
});

// md2ui image_word_count_tests: test_a_card_reads_the_same_length_whatever_its_alt
test("a card reads the same length whatever its alt", () => {
  const cards = (alt: string) =>
    nodes(groupDocument(photoCards(alt)))
      .filter((n) => n.children.some((c) => c.type === "image"))
      .map((n) => [n.content_length_category, n.text_length_category, n.avg_word_count]);
  const long = cards(LONG_ALT);
  expect(long).toHaveLength(3);
  expect(long).toEqual(cards(""));
});

// md2ui image_word_count_tests: test_a_photo_cards_alt_slot_keeps_counting
test("a photo card's alt slot keeps counting", () => {
  const body = Array(20).fill("word").join(" ");
  const root = groupDocument(`![\n## A title\n${body}\n](https://example.com/p.jpg)\n`);
  const card = nodes(root).find((n) => n.type === "image_card");
  expect(card?.content_length_category).toBe("medium");
});

// --- a spacer cell's side is part of its node's kind -------------------------

// md2ui spacer_tests: _spaced_items. Two `:::` rows, each a spacer cell beside a list
// item that splits on ` - `; `first` / `second` say which side each row's spacer is on.
function spacedItems(first: "lead" | "trail", second: "lead" | "trail"): string {
  const cell = "+++++ +++++";
  const item = "- List item - [Link](/x)";
  const row = (side: "lead" | "trail") =>
    (side === "lead" ? [cell, item] : [item, cell]).join("\n\n:::\n\n");
  return `#### T\n\n;;;\n\n${row(first)}\n\n;;;\n\n${row(second)}\n\n;;;\n`;
}

// md2ui spacer_tests: test_spacer_cells_run_as_the_leaf_cells_they_stand_for
test("spacer cells run as the leaf cells they stand for", () => {
  const beside = (doc: string) => nodes(groupDocument(doc)).filter((n) => n.spacer_beside);
  const apart = beside(spacedItems("lead", "trail"));
  expect(apart.map((n) => n.run_key)).toEqual([null, null]);
  const together = beside(spacedItems("lead", "lead"));
  expect(together).toHaveLength(2);
  expect(together[0]?.run_key).not.toBeNull();
  expect(together[0]?.run_key).toBe(together[1]?.run_key);
});

// md2ui spacer_tests: test_a_spacer_cell_beside_a_split_list_item_is_outside_its_box
// (its grouper half: the item splits into a line and keeps its spacer beside it).
test("a list item that splits into a line keeps its spacer cell beside it", () => {
  const items = nodes(groupDocument(spacedItems("lead", "trail"))).filter(
    (n) => n.type === "list_item",
  );
  expect(items).toHaveLength(2);
  expect(items.every((n) => n.line_split_group && n.spacer_beside)).toBe(true);
});
