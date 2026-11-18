// Expected values measured on md2ui (`parse_theme` + the function named in each test).
import { expect, test } from "vitest";
import { parseTheme } from "../src/index.ts";
import { newQuote } from "../src/theme/model.ts";
import {
  bulletedListIsActive,
  numberedListIsActive,
  paddingX,
  paddingY,
  quoteIsActive,
  quoteIsBar,
  resolveElementSpacing,
  resolveGroupSpacing,
  resolveImageSpacing,
  resolveSectionSpacing,
  rotateColor,
  rotationEnabled,
  syncedSlot,
} from "../src/theme/query.ts";

// Heading levels gate and sync rotation; two fixed styles, one overriding per level.
const THEME_A =
  "## Background styles and Spacing\n### Root\nSpacing: 0\nSpacer small: 5\nSpacer large col: 77\nSpacer medium row: 0\n### Elements\nRow spacing: 0\nCol spacing: 0\nGroup spacing: 0\nImage distance: 0\n### Image Cards\nSpacer small: 3\nSpacer medium col: 9\n### Heading 1\nRotate colors: no\nSpacing: 0\nSpacer small row: 11\n### Heading 2\nRotate link colors: yes\nRotate chip colors: no\nRotate colors: sync\nGroup spacing: 6\nCol spacing: 13\n### Heading 3\nRotate emoji colors: no\nSpacer medium: 21\nRow spacing: 4\n### Heading 4\nRotate card colors: no\nRotate heading colors: no\nRotate colors: sync\n### Fixed styles\n#### Card one\nMode: override\nRotate colors: sync\nSpacing: 9\nSpacer large: 99\nPadding: 4\n#### Card two\nRotate background colors: no\nSpacer small: 2\n### Unordered Lists\n#### Marker\nShape: Circle\nSize: 6\nSpace: 4\nColor:\n- #112233\n- #445566\n- #778899\n### Task Lists\n#### Marker\nEmoji: 🔥\nAside: no\nAlignment: center\n### Numbered Lists\n#### Marker\nFont size: 20\nFont color:\n- #112233\n- #445566\nNumber format: (1)\nAside: yes\n### Quotes\n#### Marker\nBar width: 5\nBar color:\n- #112233\n- #445566\n- #778899\nSpace: 3\n";
const THEME_B =
  "## Background styles and Spacing\n### Root\nSpacing: 3\n### Elements\nRow spacing: 7\nCol spacing: 9\n### Heading 1\nRotate colors: sync\nBackground color:\n- #112233\n- #445566\n#### Marker\nFont size: 11\nNumber format: 1)\n### Heading 2\nRotate colors: no\n#### Marker\nFont size: 13\nNumber format: [1]\n### Heading 3\n#### Marker\nShape: square\n### Unordered Lists\n#### Marker\nEmoji: x\nAside: no\n### Task Lists\n#### Marker\nShape: circle\nColor: #123456\n### Numbered Lists\n#### Marker\nFont size: 15\nNumber format: {1}\nAside: no\n### Quotes\n#### Marker\nQuote char: >\nFont size: 22\nSpace: 2\nAside: yes\n";
const THEME_C =
  '## Background styles and Spacing\n### Elements\nGroup spacing: 0\nRow spacing: 0\n### Numbered Lists\n#### Marker\nFont size: 18\nNumber format: 1.\n### Quotes\n#### Marker\nQuote char: "\nAside: no\n### Heading 1\n#### Marker\nBar width: 3\nBar color: #FF0000\n';
const themeA = parseTheme(THEME_A);
const themeB = parseTheme(THEME_B);
const themeC = parseTheme(THEME_C);
const defaults = parseTheme("");
const themes = { a: themeA, b: themeB, c: themeC, d: defaults };
const axes = { row: "row", col: "col" } as const;

test("rotationEnabled: the innermost level that states a channel wins, silence defers outward", () => {
  const cases: [(number | string)[], string, boolean][] = [
    [[], "background", true],
    [[], "card", true],
    [[], "emoji", true],
    [[], "link", true],
    [[], "chip", true],
    [[], "heading", true],
    [[1], "background", false],
    [[1], "card", false],
    [[1], "emoji", false],
    [[1], "link", false],
    [[1], "chip", false],
    [[1], "heading", false],
    [[1, 2], "background", false],
    [[1, 2], "card", false],
    [[1, 2], "emoji", false],
    [[1, 2], "link", true],
    [[1, 2], "chip", false],
    [[1, 2], "heading", false],
    [[1, 2, 3], "background", false],
    [[1, 2, 3], "card", false],
    [[1, 2, 3], "emoji", false],
    [[1, 2, 3], "link", true],
    [[1, 2, 3], "chip", false],
    [[1, 2, 3], "heading", false],
    [[1, 2, 3, 4], "background", false],
    [[1, 2, 3, 4], "card", false],
    [[1, 2, 3, 4], "emoji", false],
    [[1, 2, 3, 4], "link", true],
    [[1, 2, 3, 4], "chip", false],
    [[1, 2, 3, 4], "heading", false],
    [[3, 2], "background", true],
    [[3, 2], "card", true],
    [[3, 2], "emoji", false],
    [[3, 2], "link", true],
    [[3, 2], "chip", false],
    [[3, 2], "heading", true],
    [["fixed:card-one|2|1"], "background", true],
    [["fixed:card-one|2|1"], "card", true],
    [["fixed:card-one|2|1"], "emoji", true],
    [["fixed:card-one|2|1"], "link", true],
    [["fixed:card-one|2|1"], "chip", false],
    [["fixed:card-one|2|1"], "heading", true],
    [[1, "fixed:card-two|1"], "background", false],
    [[1, "fixed:card-two|1"], "card", false],
    [[1, "fixed:card-two|1"], "emoji", false],
    [[1, "fixed:card-two|1"], "link", false],
    [[1, "fixed:card-two|1"], "chip", false],
    [[1, "fixed:card-two|1"], "heading", false],
    [["fixed:card-two"], "background", false],
    [["fixed:card-two"], "card", true],
    [["fixed:card-two"], "emoji", true],
    [["fixed:card-two"], "link", true],
    [["fixed:card-two"], "chip", true],
    [["fixed:card-two"], "heading", true],
    [["fixed:nope|3"], "background", true],
    [["fixed:nope|3"], "card", true],
    [["fixed:nope|3"], "emoji", false],
    [["fixed:nope|3"], "link", true],
    [["fixed:nope|3"], "chip", true],
    [["fixed:nope|3"], "heading", true],
    [["fixed:nope|x"], "background", true],
    [["fixed:nope|x"], "card", true],
    [["fixed:nope|x"], "emoji", true],
    [["fixed:nope|x"], "link", true],
    [["fixed:nope|x"], "chip", true],
    [["fixed:nope|x"], "heading", true],
    [["fixed:nope"], "background", true],
    [["fixed:nope"], "card", true],
    [["fixed:nope"], "emoji", true],
    [["fixed:nope"], "link", true],
    [["fixed:nope"], "chip", true],
    [["fixed:nope"], "heading", true],
    [[0], "background", true],
    [[0], "card", true],
    [[0], "emoji", true],
    [[0], "link", true],
    [[0], "chip", true],
    [[0], "heading", true],
    [[7], "background", true],
    [[7], "card", true],
    [[7], "emoji", true],
    [[7], "link", true],
    [[7], "chip", true],
    [[7], "heading", true],
  ];
  for (const [chain, channel, want] of cases) {
    expect(
      rotationEnabled(themeA, channel as never, chain),
      `${JSON.stringify(chain)} ${channel}`,
    ).toBe(want);
  }
});

test("rotationEnabled: a theme that states nothing cycles everywhere", () => {
  const cases: [(number | string)[], string, boolean][] = [
    [[], "background", true],
    [[], "card", true],
    [[1], "background", true],
    [[1], "card", true],
    [[1, 2], "background", true],
    [[1, 2], "card", true],
  ];
  for (const [chain, channel, want] of cases) {
    expect(rotationEnabled(defaults, channel as never, chain)).toBe(want);
  }
});

test("syncedSlot: the nearest sharing ancestor lends its slot; a fixed token carries its own", () => {
  const cases: [number, (number | string)[], number[], number][] = [
    [0, [], [], 0],
    [7, [], [], 7],
    [0, [1, 2], [3, 4], 4],
    [0, [2, 1], [3, 4], 3],
    [0, [1, 2, 3], [5, 6, 7], 6],
    [9, [1], [5], 9],
    [0, [4], [8], 8],
    [0, [1, 4, 2], [1, 2, 3], 3],
    [0, ["fixed:card-one|2|1"], [6], 1],
    [0, ["fixed:card-one|2|x"], [6], 6],
    [0, ["fixed:card-one|2"], [6], 6],
    [0, ["fixed:card-one|2|-3"], [6], -3],
    [0, ["fixed:card-two|1|4"], [6], 0],
    [0, [1, "fixed:card-one|3|0", 2], [1, 2, 3], 3],
    [5, [3], [1, 2], 5],
  ];
  for (const [index, chain, path, want] of cases) {
    expect(syncedSlot(index, chain, path, themeA), JSON.stringify([index, chain, path])).toBe(want);
  }
});

test("rotateColor: empty keeps the scalar, one colour or a closed gate pins the first, else index modulo", () => {
  const cases: [number[], number | null, number, string, (number | string)[], number | null][] = [
    [[], 42, 3, "background", [], 42],
    [[], null, 3, "link", [1], null],
    [[9], 42, 3, "link", [1], 9],
    [[1, 2, 3], 42, 0, "background", [], 1],
    [[1, 2, 3], 42, 4, "background", [], 2],
    [[1, 2, 3], 42, 4, "background", [1], 1],
    [[1, 2, 3], 42, 4, "link", [1, 2], 2],
    [[1, 2, 3], 42, 4, "chip", [1, 2], 1],
    [[1, 2, 3], 42, 4, "card", [1, 2, 3], 1],
    [[1, 2, 3], 42, -1, "background", [], 3],
    [[1, 2], null, 3, "background", ["fixed:card-two|1"], 1],
    [[1, 2], null, 3, "link", ["fixed:card-two|1"], 2],
  ];
  for (const [colors, fallback, index, channel, chain, want] of cases) {
    expect(
      rotateColor(colors, fallback, index, themeA, channel as never, chain),
      JSON.stringify([colors, index, channel, chain]),
    ).toBe(want);
  }
  expect(rotateColor([1, 2, 3], null, 4, themeA, "background")).toBe(2);
});

test("section spacing: a level that states one wins, 0 included; the rest take the group gap", () => {
  const cases: [string, number, string, string | null, number][] = [
    ["a", 0, "row", null, 0.0],
    ["a", 0, "col", null, 0.0],
    ["a", 0, "row", "card-one", 0.0],
    ["a", 0, "col", "card-one", 0.0],
    ["a", 0, "row", "card-two", 0.0],
    ["a", 0, "col", "card-two", 0.0],
    ["a", 0, "row", "nope", 0.0],
    ["a", 0, "col", "nope", 0.0],
    ["a", 1, "row", null, 0.0],
    ["a", 1, "col", null, 0.0],
    ["a", 1, "row", "card-one", 9.0],
    ["a", 1, "col", "card-one", 9.0],
    ["a", 1, "row", "card-two", 0.0],
    ["a", 1, "col", "card-two", 0.0],
    ["a", 1, "row", "nope", 0.0],
    ["a", 1, "col", "nope", 0.0],
    ["a", 2, "row", null, 0.0],
    ["a", 2, "col", null, 13.0],
    ["a", 2, "row", "card-one", 9.0],
    ["a", 2, "col", "card-one", 9.0],
    ["a", 2, "row", "card-two", 0.0],
    ["a", 2, "col", "card-two", 0.0],
    ["a", 2, "row", "nope", 0.0],
    ["a", 2, "col", "nope", 13.0],
    ["a", 3, "row", null, 4.0],
    ["a", 3, "col", null, 0.0],
    ["a", 3, "row", "card-one", 9.0],
    ["a", 3, "col", "card-one", 9.0],
    ["a", 3, "row", "card-two", 0.0],
    ["a", 3, "col", "card-two", 0.0],
    ["a", 3, "row", "nope", 4.0],
    ["a", 3, "col", "nope", 0.0],
    ["a", 4, "row", null, 0.0],
    ["a", 4, "col", null, 0.0],
    ["a", 4, "row", "card-one", 9.0],
    ["a", 4, "col", "card-one", 9.0],
    ["a", 4, "row", "card-two", 0.0],
    ["a", 4, "col", "card-two", 0.0],
    ["a", 4, "row", "nope", 0.0],
    ["a", 4, "col", "nope", 0.0],
    ["d", 0, "row", null, 8.0],
    ["d", 0, "col", null, 8.0],
    ["d", 0, "row", "card-one", 8.0],
    ["d", 0, "col", "card-one", 8.0],
    ["d", 0, "row", "card-two", 8.0],
    ["d", 0, "col", "card-two", 8.0],
    ["d", 0, "row", "nope", 8.0],
    ["d", 0, "col", "nope", 8.0],
    ["d", 1, "row", null, 8.0],
    ["d", 1, "col", null, 8.0],
    ["d", 1, "row", "card-one", 8.0],
    ["d", 1, "col", "card-one", 8.0],
    ["d", 1, "row", "card-two", 8.0],
    ["d", 1, "col", "card-two", 8.0],
    ["d", 1, "row", "nope", 8.0],
    ["d", 1, "col", "nope", 8.0],
    ["d", 2, "row", null, 8.0],
    ["d", 2, "col", null, 8.0],
    ["d", 2, "row", "card-one", 8.0],
    ["d", 2, "col", "card-one", 8.0],
    ["d", 2, "row", "card-two", 8.0],
    ["d", 2, "col", "card-two", 8.0],
    ["d", 2, "row", "nope", 8.0],
    ["d", 2, "col", "nope", 8.0],
    ["d", 3, "row", null, 8.0],
    ["d", 3, "col", null, 8.0],
    ["d", 3, "row", "card-one", 8.0],
    ["d", 3, "col", "card-one", 8.0],
    ["d", 3, "row", "card-two", 8.0],
    ["d", 3, "col", "card-two", 8.0],
    ["d", 3, "row", "nope", 8.0],
    ["d", 3, "col", "nope", 8.0],
    ["d", 4, "row", null, 8.0],
    ["d", 4, "col", null, 8.0],
    ["d", 4, "row", "card-one", 8.0],
    ["d", 4, "col", "card-one", 8.0],
    ["d", 4, "row", "card-two", 8.0],
    ["d", 4, "col", "card-two", 8.0],
    ["d", 4, "row", "nope", 8.0],
    ["d", 4, "col", "nope", 8.0],
    ["b", 0, "row", null, 3.0],
    ["b", 0, "col", null, 3.0],
    ["b", 0, "row", "card-one", 3.0],
    ["b", 0, "col", "card-one", 3.0],
    ["b", 0, "row", "card-two", 3.0],
    ["b", 0, "col", "card-two", 3.0],
    ["b", 0, "row", "nope", 3.0],
    ["b", 0, "col", "nope", 3.0],
    ["b", 1, "row", null, 7.0],
    ["b", 1, "col", null, 9.0],
    ["b", 1, "row", "card-one", 7.0],
    ["b", 1, "col", "card-one", 9.0],
    ["b", 1, "row", "card-two", 7.0],
    ["b", 1, "col", "card-two", 9.0],
    ["b", 1, "row", "nope", 7.0],
    ["b", 1, "col", "nope", 9.0],
    ["b", 2, "row", null, 7.0],
    ["b", 2, "col", null, 9.0],
    ["b", 2, "row", "card-one", 7.0],
    ["b", 2, "col", "card-one", 9.0],
    ["b", 2, "row", "card-two", 7.0],
    ["b", 2, "col", "card-two", 9.0],
    ["b", 2, "row", "nope", 7.0],
    ["b", 2, "col", "nope", 9.0],
    ["b", 3, "row", null, 7.0],
    ["b", 3, "col", null, 9.0],
    ["b", 3, "row", "card-one", 7.0],
    ["b", 3, "col", "card-one", 9.0],
    ["b", 3, "row", "card-two", 7.0],
    ["b", 3, "col", "card-two", 9.0],
    ["b", 3, "row", "nope", 7.0],
    ["b", 3, "col", "nope", 9.0],
    ["b", 4, "row", null, 7.0],
    ["b", 4, "col", null, 9.0],
    ["b", 4, "row", "card-one", 7.0],
    ["b", 4, "col", "card-one", 9.0],
    ["b", 4, "row", "card-two", 7.0],
    ["b", 4, "col", "card-two", 9.0],
    ["b", 4, "row", "nope", 7.0],
    ["b", 4, "col", "nope", 9.0],
  ];
  for (const [name, level, axis, fixed, want] of cases) {
    const theme = themes[name as keyof typeof themes];
    expect(
      resolveSectionSpacing(level, axis as never, theme, fixed),
      JSON.stringify([name, level, axis, fixed]),
    ).toBe(want);
  }
});

test("element, group and image spacing chain as md2ui's resolvers do", () => {
  const cases: [string, string, number, number, number, number][] = [
    ["a", "row", 0.0, 0.0, 0.0, 0.0],
    ["a", "col", 0.0, 0.0, 0.0, 0.0],
    ["b", "row", 7.0, 7.0, 0.0, 7.0],
    ["b", "col", 9.0, 9.0, 0.0, 9.0],
    ["c", "row", 0.0, 0.0, 0.0, 0.0],
    ["c", "col", 8.0, 0.0, 0.0, 0.0],
    ["d", "row", 8.0, 8.0, 0.0, 8.0],
    ["d", "col", 8.0, 8.0, 0.0, 8.0],
  ];
  for (const [name, axis, element, group, image, unitsGroup] of cases) {
    const theme = themes[name as keyof typeof themes];
    const ax = axes[axis as keyof typeof axes];
    expect([
      resolveElementSpacing(ax, theme),
      resolveGroupSpacing(ax, theme),
      resolveImageSpacing(ax, theme),
    ]).toEqual([element, group, image]);
    expect(unitsGroup).toBe(group);
  }
});

test("paddingX and paddingY sum the opposite insets", () => {
  const pad = { top: 1, left: 2, right: 4, bottom: 8 };
  expect([paddingX(pad), paddingY(pad)]).toEqual([6, 9]);
  expect(paddingX(themeA.sections[1]?.padding ?? pad)).toBe(0);
});

test("marker predicates: a shape or emoji, a styled number, a bar or a quote character", () => {
  const bullet = {
    shape: null,
    size: 8,
    color: null,
    colors: [],
    emoji: null,
    space: 10,
    aside: true,
    alignment: "top",
  } as const;
  expect(bulletedListIsActive(bullet)).toBe(false);
  expect(bulletedListIsActive({ ...bullet, shape: "circle" })).toBe(true);
  expect(bulletedListIsActive({ ...bullet, emoji: "x" })).toBe(true);
  const quote = newQuote();
  expect([quoteIsBar(quote), quoteIsActive(quote)]).toEqual([false, false]);
  expect([
    quoteIsBar({ ...quote, bar_width: 4 }),
    quoteIsActive({ ...quote, bar_width: 4 }),
  ]).toEqual([false, false]);
  expect([
    quoteIsBar({ ...quote, bar_color: 1 }),
    quoteIsActive({ ...quote, bar_color: 1 }),
  ]).toEqual([false, false]);
  expect([
    quoteIsBar({ ...quote, bar_width: 4, bar_color: 1 }),
    quoteIsActive({ ...quote, bar_width: 4, bar_color: 1 }),
  ]).toEqual([true, true]);
  expect([
    quoteIsBar({ ...quote, quote_char: ">" }),
    quoteIsActive({ ...quote, quote_char: ">" }),
  ]).toEqual([false, true]);
  const numbered = themeA.numbered_lists.marker;
  expect(numbered !== null && "number_format" in numbered && numberedListIsActive(numbered)).toBe(
    true,
  );
  const unstyled = {
    text_style: null,
    number_format: "{n}",
    space: 10,
    aside: true,
    alignment: "top",
  } as const;
  expect(numberedListIsActive(unstyled)).toBe(false);
});
