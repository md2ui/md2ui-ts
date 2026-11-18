// Expected values measured on md2ui (`parse_theme` + the function named in each test).
import { expect, test } from "vitest";
import { parseTheme } from "../src/index.ts";
import { type LayoutNode, layoutNode } from "../src/layout/node.ts";
import {
  BENTO_EST_GAP,
  BENTO_EST_LINE_H,
  BENTO_EST_LINE_PX,
  BENTO_MIN_CELLS,
  bentoCol,
  fillContainerLevels,
  groupSpacing,
  IMAGE_MIN_WIDTH,
  LEAF_WIDTH,
  tableCellPaddingX,
  tableColGap,
} from "../src/layout/units.ts";

const THEME_A =
  "## Background styles and Spacing\n### Root\nSpacing: 0\nSpacer small: 5\nSpacer large col: 77\nSpacer medium row: 0\n### Elements\nRow spacing: 0\nCol spacing: 0\nGroup spacing: 0\nImage distance: 0\n### Image Cards\nSpacer small: 3\nSpacer medium col: 9\n### Heading 1\nRotate colors: no\nSpacing: 0\nSpacer small row: 11\n### Heading 2\nRotate link colors: yes\nRotate chip colors: no\nRotate colors: sync\nGroup spacing: 6\nCol spacing: 13\n### Heading 3\nRotate emoji colors: no\nSpacer medium: 21\nRow spacing: 4\n### Heading 4\nRotate card colors: no\nRotate heading colors: no\nRotate colors: sync\n### Fixed styles\n#### Card one\nMode: override\nRotate colors: sync\nSpacing: 9\nSpacer large: 99\nPadding: 4\n#### Card two\nRotate background colors: no\nSpacer small: 2\n### Unordered Lists\n#### Marker\nShape: Circle\nSize: 6\nSpace: 4\nColor:\n- #112233\n- #445566\n- #778899\n### Task Lists\n#### Marker\nEmoji: 🔥\nAside: no\nAlignment: center\n### Numbered Lists\n#### Marker\nFont size: 20\nFont color:\n- #112233\n- #445566\nNumber format: (1)\nAside: yes\n### Quotes\n#### Marker\nBar width: 5\nBar color:\n- #112233\n- #445566\n- #778899\nSpace: 3\n";
const THEME_B =
  "## Background styles and Spacing\n### Root\nSpacing: 3\n### Elements\nRow spacing: 7\nCol spacing: 9\n### Heading 1\nRotate colors: sync\nBackground color:\n- #112233\n- #445566\n#### Marker\nFont size: 11\nNumber format: 1)\n### Heading 2\nRotate colors: no\n#### Marker\nFont size: 13\nNumber format: [1]\n### Heading 3\n#### Marker\nShape: square\n### Unordered Lists\n#### Marker\nEmoji: x\nAside: no\n### Task Lists\n#### Marker\nShape: circle\nColor: #123456\n### Numbered Lists\n#### Marker\nFont size: 15\nNumber format: {1}\nAside: no\n### Quotes\n#### Marker\nQuote char: >\nFont size: 22\nSpace: 2\nAside: yes\n";
const THEME_C =
  '## Background styles and Spacing\n### Elements\nGroup spacing: 0\nRow spacing: 0\n### Numbered Lists\n#### Marker\nFont size: 18\nNumber format: 1.\n### Quotes\n#### Marker\nQuote char: "\nAside: no\n### Heading 1\n#### Marker\nBar width: 3\nBar color: #FF0000\n';
const THEME_T =
  "## Tables\n### Table\nRow spacing: 12\n### Header\nPadding: 10\n### Cells\nPadding: 4\n";
const THEME_T2 = "## Tables\n### Header\nPadding: 7\n### Elements\nRow spacing: 5\n";
const themes = {
  a: parseTheme(THEME_A),
  b: parseTheme(THEME_B),
  c: parseTheme(THEME_C),
  t: parseTheme(THEME_T),
  t2: parseTheme(THEME_T2),
  d: parseTheme(""),
};

test("the unit constants", () => {
  expect(LEAF_WIDTH).toEqual({
    one_word: 80.0,
    very_short: 100.0,
    short: 200.0,
    medium: 320.0,
    paragraph: 580.0,
  });
  expect(BENTO_EST_LINE_PX).toEqual({
    one_word: 70.0,
    very_short: 120.0,
    short: 260.0,
    medium: 480.0,
    paragraph: 900.0,
    long_paragraph: 1800.0,
  });
  expect([IMAGE_MIN_WIDTH, BENTO_MIN_CELLS, BENTO_EST_LINE_H, BENTO_EST_GAP]).toEqual([
    96.0, 3, 22.0, 8.0,
  ]);
  expect(Object.isFrozen(LEAF_WIDTH) && Object.isFrozen(BENTO_EST_LINE_PX)).toBe(true);
});

test("groupSpacing: group gap, else element gap, else 0", () => {
  const cases: [string, string, number][] = [
    ["a", "row", 0.0],
    ["a", "col", 0.0],
    ["b", "row", 7.0],
    ["b", "col", 9.0],
    ["c", "row", 0.0],
    ["c", "col", 0.0],
    ["d", "row", 8.0],
    ["d", "col", 8.0],
  ];
  for (const [name, axis, want] of cases) {
    expect(
      groupSpacing(axis === "row", themes[name as keyof typeof themes]),
      `${name} ${axis}`,
    ).toBe(want);
  }
});

test("table cell padding and column gap", () => {
  const cells: [string, string | null, number, number][] = [
    ["t", "header", 20.0, 0.0],
    ["t", "cell", 8.0, 0.0],
    ["t", null, 8.0, 0.0],
    ["t2", "header", 14.0, 0.0],
    ["t2", "cell", 0.0, 0.0],
    ["t2", null, 0.0, 0.0],
    ["d", "header", 0.0, 0.0],
    ["d", "cell", 0.0, 0.0],
    ["d", null, 0.0, 0.0],
  ];
  for (const [name, role, want, noTheme] of cells) {
    expect(tableCellPaddingX(role, themes[name as keyof typeof themes]), `${name} ${role}`).toBe(
      want,
    );
    expect(tableCellPaddingX(role, null)).toBe(noTheme);
  }
  const gaps: [string, number][] = [
    ["t", 12.0],
    ["t2", 8.0],
    ["d", 8.0],
    ["a", 0.0],
  ];
  for (const [name, want] of gaps)
    expect(tableColGap(themes[name as keyof typeof themes]), name).toBe(want);
  expect(tableColGap(null)).toBe(0);
});

const leaf = (id: string): LayoutNode => layoutNode("-", [], [], { content_id: id });
const lv = (n: LayoutNode, level: number, key: string | null = null): LayoutNode => {
  n.section_level = level;
  n.section_style_key = key;
  return n;
};
const row = (...kids: LayoutNode[]): LayoutNode =>
  layoutNode(
    "row",
    kids.map(() => 1),
    kids,
  );
const col = (...kids: LayoutNode[]): LayoutNode =>
  layoutNode(
    "col",
    kids.map(() => 1),
    kids,
  );
const shape = (n: LayoutNode): unknown =>
  n.type === "-"
    ? [n.content_id, n.section_level, n.section_style_key]
    : [n.type, n.section_level, n.section_style_key, ...n.children.map(shape)];

test("bentoCol is a column of the parts, marked bento", () => {
  const band = bentoCol([leaf("a"), leaf("b")]);
  expect([band.type, band.ratios, band.bento, band.children.map((c) => c.content_id)]).toEqual([
    "col",
    [1.0, 1.0],
    true,
    ["a", "b"],
  ]);
});

test("fillContainerLevels gives a container of same-level sections the level, bottom-up", () => {
  const cases: [string, LayoutNode, unknown][] = [
    [
      "two sections at one level",
      row(lv(leaf("a"), 2), lv(leaf("b"), 2)),
      ["row", 2, null, ["a", 2, null], ["b", 2, null]],
    ],
    [
      "a shared style key is kept, differing ones dropped",
      row(lv(leaf("a"), 2, "x"), lv(leaf("b"), 2, "x")),
      ["row", 2, "x", ["a", 2, "x"], ["b", 2, "x"]],
    ],
    [
      "differing keys",
      row(lv(leaf("a"), 2, "x"), lv(leaf("b"), 2, "y")),
      ["row", 2, null, ["a", 2, "x"], ["b", 2, "y"]],
    ],
    [
      "the smallest level with two or more wins",
      row(lv(leaf("a"), 3), lv(leaf("b"), 3), lv(leaf("c"), 2), lv(leaf("d"), 1), lv(leaf("e"), 3)),
      [
        "row",
        3,
        null,
        ["a", 3, null],
        ["b", 3, null],
        ["c", 2, null],
        ["d", 1, null],
        ["e", 3, null],
      ],
    ],
    [
      "a wrapper around a single section stays transparent",
      col(lv(leaf("a"), 2), leaf("b")),
      ["col", null, null, ["a", 2, null], ["b", null, null]],
    ],
    [
      "a container that already has a level is left alone",
      lv(row(lv(leaf("a"), 2), lv(leaf("b"), 2)), 1, "k"),
      ["row", 1, "k", ["a", 2, null], ["b", 2, null]],
    ],
    [
      "nested: inner fills first, then the outer sees one level-2 child per inner",
      col(row(lv(leaf("a"), 2), lv(leaf("b"), 2)), row(lv(leaf("c"), 2), lv(leaf("d"), 2))),
      [
        "col",
        2,
        null,
        ["row", 2, null, ["a", 2, null], ["b", 2, null]],
        ["row", 2, null, ["c", 2, null], ["d", 2, null]],
      ],
    ],
    ["a leaf is never filled", leaf("a"), ["a", null, null]],
  ];
  for (const [label, tree, want] of cases) {
    fillContainerLevels(tree);
    expect(shape(tree), label).toEqual(want);
  }
});
