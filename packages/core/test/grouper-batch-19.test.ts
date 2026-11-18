// Grouper rules at edges the corpus reaches once or not at all: a card missing its picture
// keeps its run, a rating line is its own line kind, and space written around a card's only row
// or as a `:::` cell beside a list item is placed as md2ui places it. Expected values are
// md2ui's own tests; these run without fixtures.
import { expect, test } from "vitest";
import { groupDocument } from "../src/group/grouper.ts";
import { kindSignatures, lineKindHash, treeSimilar } from "../src/group/kinds.ts";
import { GroupNode } from "../src/group/node.ts";
import { RegexKit } from "../src/group/py/re.ts";

const kit = new RegexKit();

function nodes(root: GroupNode): GroupNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

const runSizes = (section: GroupNode): number[] =>
  [...(section.repeated_children?.values() ?? [])].map((r) => r.length);
const section = (doc: string): GroupNode => groupDocument(doc).children[0] as GroupNode;

const ALBUMS = [
  ["Abbey Road", "The Beatles"],
  ["Blue", "Joni Mitchell"],
  ["Kind", "Miles"],
];

// md2ui markdown_kind_line_tolerance_tests: _albums. Three album cards; the middle one's picture line
// replaced by `middle`.
function albums(middle?: string, names = ALBUMS): string {
  const cards = names.map(([title, who], i) => {
    const cover = `![${title}](https://example.com/${i}.jpg?md2ui.aspect_ratio=1:1)\n`;
    const pic = i === 1 && middle !== undefined ? middle : cover;
    return `### \n${pic}**${title}**\n${who}\n`;
  });
  return `## Albums\n\n${cards.join("\n")}`;
}

// md2ui markdown_kind_line_tolerance_tests: _schedule. Three schedule cards; the middle
// one's time line and picture can each be overridden to isolate one difference.
function schedule(middleTime: string | null, middleImg: string): string {
  const image = "![Teacher](https://images.unsplash.com/photo-1500648767791.jpg)\n";
  const cards = [
    ["10:30-12:00", "Technical English", "Beginner", "Kristin Watson"],
    ["13:00-14:00", "English punctuation", "Advanced", "Cody Fisher"],
    ["16:00-17:00", "Technical Spanish", "Beginner", "Jacob Jones"],
  ].map(([time, title, level, who], i) => {
    const mid = i === 1;
    const t = mid && middleTime ? middleTime : time;
    return `${t}\n### **${title}**\n\`${level}\`\n\n${mid ? middleImg : image}**${who}**\nMentor\n`;
  });
  return `## My schedule\n\n${cards.join("\n")}`;
}

// md2ui markdown_kind_line_tolerance_tests: test_missing_image_spends_the_whole_budget
test("a missing picture is one edit, and only one", () => {
  expect(runSizes(section(schedule("13:00-14:00 - Now", "")))).toEqual([3]);
  const noChip = schedule(null, "").replace("`Advanced`\n", "");
  expect(runSizes(section(noChip))).toEqual([]);
});

// md2ui markdown_kind_line_tolerance_tests: test_card_without_its_picture_keeps_the_run
test("a card without its picture stays in its siblings' run", () => {
  const names = [...ALBUMS.slice(0, 2), ["Kind of Blue", "Miles Davis"]];
  expect(runSizes(section(albums("", names)))).toEqual([3]);
});

const isRating = (n: GroupNode | undefined): boolean =>
  n !== undefined && kindSignatures(kit, n, [])[0] === "rating";

// md2ui markdown_kind_line_tolerance_tests: test_rating_line_is_its_own_kind
test("a rating line keeps a review body from twinning its header", () => {
  const root = groupDocument(
    "![Sophia](https://example.com/sophia.jpg)\n**Sophia Rossi**\nClass of 2023\n\n" +
      '⭐⭐⭐⭐⭐\n"This class was an absolute dream!"\n',
  );
  const [header, body] = root.children as [GroupNode, GroupNode];
  expect(isRating(body.children[0])).toBe(true);
  expect(treeSimilar(kit, header, body, new Map())).toBe(false);
});

// md2ui markdown_kind_line_tolerance_tests: test_what_reads_as_a_rating_line
test("rating glyphs alone, half star at most; a lone star stays an emoji", () => {
  const line = (text: string): GroupNode =>
    section(`## R\n\n${text}\nA quote that runs on.\n`).children[1]?.children[0] as GroupNode;
  for (const text of ["⭐⭐⭐⭐⭐", "★★★★½", "★★★☆☆", "**★★★**", "⭐️⭐️⭐️"]) {
    expect(isRating(line(text)), text).toBe(true);
  }
  for (const text of ["⭐", "⭐ 4.8", "⭐⭐⭐⭐⭐ (120)", "Great ⭐⭐⭐", "🌟🌟🌟", "★½★"]) {
    expect(isRating(line(text)), text).toBe(false);
  }
  expect(lineKindHash(line("⭐⭐⭐"), new Map())).toBe(lineKindHash(line("⭐️⭐️⭐️"), new Map()));
});

// md2ui markdown_kind_line_tolerance_tests: test_pair_still_never_twins_a_three_line_block
test("a pair never matches a three-line block", () => {
  const days = section("## Days\n\n### \n_FRI_\n___20___\n\n### \nStandup\nReview\nRetro\n");
  const [a, b] = days.children.slice(1) as [GroupNode, GroupNode];
  expect(kindSignatures(kit, a, [])[0]).toMatch(/^pair\(/);
  expect(treeSimilar(kit, a, b, new Map())).toBe(false);
});

// md2ui markdown_kind_line_tolerance_tests: test_gallery_one_picture_short_is_another_kind
test("a gallery one picture short is a different gallery", () => {
  const pics = ["1:1", "16:9", "1:1"].map(
    (r, i) => `![p${i}](https://example.com/${i}.jpg?md2ui.aspect_ratio=${r})`,
  );
  const full = new GroupNode("", "group");
  const short = new GroupNode("", "group");
  full.children = pics.map((p) => new GroupNode(p, "image"));
  short.children = pics.slice(0, 2).map((p) => new GroupNode(p, "image"));
  // The two 1:1 pictures share a kind; the 16:9 one between them does not.
  [...full.children, ...short.children].forEach((n, i) => {
    n.kind_hash = [0n, 1n, 0n, 0n, 1n][i] as bigint;
  });
  full.kind_hash = 10n;
  short.kind_hash = 11n;
  expect(treeSimilar(kit, full, short, new Map())).toBe(false);
});

// md2ui spacer_tests: _down_around_the_row. The merged node of a card holding only a row.
const onlyRow = (doc: string): GroupNode =>
  nodes(groupDocument(doc)).find((n) => n.line_split_group || n.column_row_group) as GroupNode;

// md2ui spacer_tests: test_spacers_beside_a_cards_only_line_are_above_and_below_it
test("spacers beside a card's only line are above and below it", () => {
  const row = onlyRow("#### \n\n+++++\n\nAlpha - Bravo\n\n+++++\n");
  expect([row.spacer_above, row.spacer_below]).toEqual(["+++++", "+++++"]);
  expect(nodes(row).some((n) => n.type === "spacer")).toBe(false);
  const d = row.toDict(kit);
  expect([d.spacer_above, d.spacer_below]).toEqual(["+++++", "+++++"]);
});

// md2ui spacer_tests: test_spacers_beside_a_cards_only_column_row_are_above_and_below_it
test("spacers beside a card's only column row are above and below it", () => {
  const row = onlyRow("#### \n\n+++++\n\n;;;\n\nAlpha\n\n:::\n\nBravo\n\n;;;\n\n+++++\n");
  expect(row.column_row_group).toBe(true);
  expect([row.spacer_above, row.spacer_below]).toEqual(["+++++", "+++++"]);
  expect(row.children.map((c) => c.content)).toEqual(["Alpha", "Bravo"]);
});

const items = (doc: string): GroupNode[] =>
  nodes(groupDocument(doc)).filter((n) => n.type === "list_item");

// md2ui spacer_tests: test_a_spacer_cell_beside_a_list_item_is_outside_its_box
test("a spacer cell beside a list item is beside it", () => {
  const cells = "+++++ +++++";
  const doc = `#### T\n\n;;;\n\n${cells}\n\n:::\n\n- Item\n\n;;;\n\n- Item\n\n:::\n\n${cells}\n\n;;;\n`;
  const found = items(doc);
  expect(found.map((n) => [n.spacer_lead, n.spacer_trail])).toEqual([
    [cells, null],
    [null, cells],
  ]);
  expect(found.every((n) => n.spacer_beside)).toBe(true);
  expect(found.every((n) => n.toDict(kit).spacer_beside === true)).toBe(true);
});

// md2ui spacer_tests: test_a_spacer_inside_a_list_items_line_is_inside_its_box
test("a spacer inside a list item's line is not beside it", () => {
  const found = items("#### T\n\n- +++++ Item\n- Item +++++\n");
  expect(found).toHaveLength(2);
  expect(found.some((n) => n.spacer_beside)).toBe(false);
});
