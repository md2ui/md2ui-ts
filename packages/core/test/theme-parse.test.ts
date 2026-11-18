// What md2ui's parser does with keys and text it does not expect. Each expected value
// was measured on md2ui's `parse_theme` (pipeline/theme.py).
import { expect, test } from "vitest";
import { parseTheme } from "../src/index.ts";

const pad = (text: string): number[] => {
  const p = parseTheme(text).root.padding;
  return [p.top, p.left, p.right, p.bottom];
};

test("an unknown key is ignored and ends the open bullet list (theme.py:857-862)", () => {
  const theme = parseTheme(
    "## Sections\n### Heading 2\nBackground colors:\n- #FF0000\nFrobnicate: 3\n- #00FF00\n",
  );
  expect(theme.sections[2]?.bg_colors).toEqual([0xffff0000]);
  expect(theme).not.toHaveProperty("frobnicate");
});

test("an unknown ## block is skipped whole; the next known block reads (theme.py:1841)", () => {
  const theme = parseTheme(
    "## Frobnicate\nBackground color: #FF0000\n## Root\nWobble: 4\nPadding: 8\n",
  );
  expect(theme.root.bg_color).toBe(parseTheme("").root.bg_color);
  expect(pad("## Frobnicate\nBackground color: #FF0000\n## Root\nWobble: 4\nPadding: 8\n")).toEqual(
    [8, 8, 8, 8],
  );
});

test("numbers read as Python's float(): underscores, Unicode digits, inf, nan, -0", () => {
  const theme = parseTheme(
    "## Root\nMax width: 1_000\nBox radius: ١٢\nPadding top: inf\nPadding left: nan\nPadding right: 0x10\nPadding bottom: -0\n",
  );
  expect(theme.root.max_width).toBe(1000);
  expect(theme.root.box_radius).toBe(12);
  const p = theme.root.padding;
  expect([p.top, p.left, p.right]).toEqual([Number.POSITIVE_INFINITY, Number.NaN, 0]);
  expect(Object.is(p.bottom, -0)).toBe(true);
});

test("a clamp keeps its bound when the value is NaN, as Python's max does", () => {
  expect(parseTheme("## Root\nMax width: nan\n").root.max_width).toBe(320);
});

test("lines strip as Python's str.strip: NBSP goes, a BOM stays (and breaks the key)", () => {
  const theme = parseTheme("## Root\n Padding: 7 \n﻿Box radius: 5\n");
  expect(theme.root.padding.top).toBe(7);
  expect(theme.root.box_radius).toBe(0);
});

test("a ### under ## Links that names no button style configures Primary", () => {
  for (const sub of ["resolved", "__class__", "foo", "inline"]) {
    const theme = parseTheme(`## Links\n### ${sub}\nFill color: #008800\n`);
    expect(theme.links.primary.fill_color === 0xff008800).toBe(sub !== "inline");
  }
});

test("an unusable Max lines is dropped and the default stays", () => {
  for (const val of ["inf", "1e999", "nan", "0", "seven"]) {
    expect(parseTheme(`## Code Blocks\nMax lines: ${val}\n`).code_blocks.max_lines, val).toBe(20);
  }
});

test("malformed text never throws", () => {
  const junk = [
    "",
    "#",
    "## ",
    "## Root\n- \n  - :\n:::\n",
    "## Styling & Spacing\n### Fixed styles\n#### !!!\n##### text\n- Font color:\n- #zz\n",
    "## Links\n### resolved\nFill color: #FFFFFF\n### __class__\nCorner radius: x\n",
    "## Code Blocks\nMax lines: inf\nMax lines: 1e400\n",
    "<!-- open\n## Root\nPadding: 3",
    "\u0000  \r\n\v\f## Root\r\nPadding: 2\r",
  ];
  for (const text of junk) expect(() => parseTheme(text)).not.toThrow();
});
