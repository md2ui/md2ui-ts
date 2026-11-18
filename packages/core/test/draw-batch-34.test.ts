// md2ui rules for the scene and its paint, through the whole pipeline (fake
// measurer). Expected values are md2ui's own tests.
import type { FillEntry, ResolvedTheme, Shape, TextEntry, TextRun } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { emitWrapBoxes, replaceColor } from "../src/scene/backgrounds.ts";
import { createFakeMeasurer } from "../src/text/fake-measurer.ts";
import { parseTheme } from "../src/theme/parse.ts";
import { paintMarkdown } from "./scene-kit.ts";

// md2ui tests/color_replacement_tests.py: _DARK_TABLE.
const DARK_TABLE = `# t
## Styling & Spacing
### Fixed styles
#### Dark
Background color: #101010

## Tables
### Header
Background color: #00E70019
### Cells
Background colors:
- #FDFDFD

## Color Replacements
On background color: #101010
- Fill color: #FDFDFD, Replacement: #FFFFFF14
- Fill color: #00E70019, Replacement: #00E70033
`;

// md2ui: test_table_fills_are_replaced_against_the_card_they_sit_on
test("a table's fills are replaced against the card it sits on", () => {
  const { scene, sizer, painted } = paintMarkdown(
    "## Dark {#dark-1}\n\n| A | B |\n|---|---|\n| 1 | 2 |\n",
    DARK_TABLE,
    600,
  );
  const rows = scene.sections.filter((s) => s.kind === "table_header" || s.kind === "table_row");
  expect(rows.length).toBeGreaterThan(0);
  for (const row of rows) expect(row.bg_stack.slice(0, 1)).toEqual([0xff101010]);
  const cellContexts = new Set(
    scene.boxes
      .filter((b) => b.content_id !== null && sizer.index.get(b.content_id)?.table_role)
      .map((b) => b.bg_stack[0]),
  );
  expect(cellContexts).toEqual(new Set([0x14ffffff, 0x3300e700]));
  // And the rows paint the replaced fills.
  const fills = painted.list.entries.flatMap((e) =>
    e.type === "fill" && e.paint.kind === "color" ? [e.paint.color] : [],
  );
  expect(fills).toEqual(expect.arrayContaining(["#ffffff14", "#00e70033"]));
  expect(fills).not.toContain("#fdfdfdff");
});

// md2ui: test_a_stacked_tables_keys_read_the_replaced_fill: a stacked card's keys
// sit on the cell fill its values sit on, replaced as theirs is (`render_place._fill_bg`).
test("a stacked table's keys read the replaced fill", () => {
  const words = [
    "Supercalifragilistic",
    "Antidisestablishment",
    "Floccinaucinihilipil",
    "Pneumonoultramicrosc",
  ];
  const table = `| A | B | C | D |\n|---|---|---|---|\n| ${words.join(" | ")} |\n`;
  const { scene } = paintMarkdown(
    `## Dark {#dark-1}\n\n${table}`,
    DARK_TABLE.replace("## Tables\n", "## Tables\n### Table\nStacking cards: yes\n"),
    360,
  );
  const keys = scene.boxes.filter((b) => b.render_properties?.["table_key"] !== undefined);
  expect(keys.length, "the table must stack").toBeGreaterThan(0);
  expect(new Set(keys.map((b) => b.bg_stack[0]))).toEqual(new Set([0x14ffffff]));
});

// md2ui tests/color_replacement_tests.py constants.
const W = 0xffffffff;
const BLACK = 0xff101010;
const INK = 0xff0a0a0a;

const PHOTOS = `# t
## Styling & Spacing
### Fixed styles
#### Music player
Background image: p.png
#### Podcast
Background image: q.png

## Color Replacements
On background color: image
- Replacement: #FFFFFF
On background color: image Music player
- Replacement: #101010
`;

const who = (fixedStyleKey: string | null) => ({
  ring: null,
  bgImageUrl: null,
  rotationIndex: null,
  rotationChain: [],
  rotationPath: [],
  fixedStyleKey,
});

/** The surface a section of heading `level` painted by `fixedStyleKey` hands its content. */
function surfaceOf(theme: ResolvedTheme, level: number, fixedStyleKey: string | null) {
  const layers = [{ kind: "section" as const, level, style: theme.elements }];
  return emitWrapBoxes([], 0, 0, 10, 10, layers, who(fixedStyleKey), theme, []).bgStack;
}

// md2ui: test_a_fixed_style_names_its_own_photo
test("a fixed style names its own photo; the rest keep image", () => {
  const theme = parseTheme(PHOTOS);
  expect(theme.color_replacements).toEqual({
    image: { text: { null: W } },
    "image:music-player": { text: { null: BLACK } },
  });
  const own = surfaceOf(theme, 4, "music-player");
  expect(own).toEqual(["image:music-player"]);
  expect(replaceColor(INK, own, theme)).toBe(BLACK);
  // A styled photo with no rules of its own falls back to the theme's.
  const other = surfaceOf(theme, 4, "podcast");
  expect(other).toEqual(["image:podcast"]);
  expect(replaceColor(INK, other, theme)).toBe(W);
  expect(replaceColor(INK, ["image"], theme)).toBe(W);
});

// md2ui tests/fixed_section_style_tests.py: OVERRIDE, and
// test_override_paints_the_merged_style_and_the_level_image.
test("an inherited level photo is named by the style that paints it", () => {
  const theme = parseTheme(`# Override
## Background styles and Spacing
### Heading 2
Background colors:
- #AA0000
- #BB0000
Corner radius: 8
Padding: 99
Background image: level.png

### Fixed styles
#### Featured
Mode: override
Background color: #101010
Corner radius: 24
`);
  expect(surfaceOf(theme, 2, "featured")).toEqual(["image:featured"]);
});

// The stroke a fixed style's photo card draws is replaced against that photo
// (md2ui `_own_surface` in `_paint_section_background`).
test("a photo card's stroke is replaced against its own style's photo", () => {
  const theme = `# t
## Styling & Spacing
### Fixed styles
#### Music player
Background image: p.png
Stroke width: 2
Stroke color: #000000

## Color Replacements
On background color: image Music player
- Stroke color: #000000, Replacement: #FF0000
`;
  const strokes = paintMarkdown(
    "## Music player {#music-player-1}\n\nNow playing\n",
    theme,
  ).painted.list.entries.flatMap((e) => (e.type === "stroke" ? [e.color] : []));
  expect(strokes).toEqual(["#ff0000ff"]);
});

// md2ui tests/task_control_tests.py.
const SYMBOL_THEME = (kind: string, symbol: string) => `## Drawing elements
### Task controls
Type: ${kind}
### Checked outer
Background color: #5B4FC4
### Checked inner
Background color: #FFFFFF
${symbol}
`;

/** The glyph runs a task control paints, with its inner shape and its baseline. */
function drawnSymbols(themeText: string, checked = true) {
  const { painted } = paintMarkdown(checked ? "- [x] Done\n" : "- [ ] Done\n", themeText, 400);
  const entries = painted.list.entries;
  const control = entries.find((e) => e.type === "fill")?.nodeId;
  const parts = entries.filter((e): e is FillEntry => e.type === "fill" && e.nodeId === control);
  const inner = parts.at(-1)?.shape as Shape;
  const texts = entries.filter((e): e is TextEntry => e.type === "text" && e.nodeId === control);
  return { texts, inner };
}

// md2ui: test_inner_symbol_keys_parse
test("the inner symbol keys parse", () => {
  const controls = parseTheme(`## Drawing elements
### Checked inner
Background color: #FFFFFF
Symbol: ✓
Symbol color: #5B4FC4
### Unchecked inner
Symbol: ✕
`).datapoints.task_controls;
  expect([controls.checked_symbol, controls.checked_symbol_color]).toEqual(["✓", 0xff5b4fc4]);
  expect([controls.unchecked_symbol, controls.unchecked_symbol_color]).toEqual(["✕", null]);
  expect(controls.checked_inner.bg_colors).toEqual([0xffffffff]);
  const plain = parseTheme("").datapoints.task_controls;
  expect([plain.checked_symbol, plain.unchecked_symbol]).toEqual([null, null]);
});

// md2ui: test_no_symbol_key_draws_no_glyph
test("no symbol key draws no glyph", () => {
  expect(drawnSymbols(SYMBOL_THEME("checkbox", "")).texts).toEqual([]);
});

// md2ui: test_symbol_is_centred_in_the_outer_fill_color (and _assert_centred)
test("the symbol is centred in the outer fill colour", () => {
  const text = createFakeMeasurer();
  for (const kind of ["checkbox", "switch"]) {
    const { texts, inner } = drawnSymbols(SYMBOL_THEME(kind, "Symbol: ✓"));
    expect(texts.flatMap((t) => t.runs.map((r) => r.text))).toEqual(["✓"]);
    const entry = texts[0] as TextEntry;
    const run = entry.runs[0] as TextRun;
    expect(run.color).toBe("#5b4fc4ff");
    const width = text.advance(run.text, run.font);
    const m = text.fontMetrics(run.font);
    expect(run.x + width / 2).toBeCloseTo(inner.x + inner.width / 2, 2);
    expect(entry.y - (m.ascent - m.descent) / 2).toBeCloseTo(inner.y + inner.height / 2, 2);
    expect(run.font.size).toBeLessThanOrEqual(inner.height);
    expect(width).toBeLessThanOrEqual(inner.width + 1e-9);
  }
});

// md2ui `_draw_symbol`: a glyph wider than the inner shape shrinks to its width.
test("a symbol wider than the inner shape shrinks to fit it", () => {
  const text = createFakeMeasurer();
  const { texts, inner } = drawnSymbols(SYMBOL_THEME("switch", "Symbol: ✓✓✓"));
  const run = texts[0]?.runs[0] as TextRun;
  expect(run.font.size).toBeLessThan(inner.height * 0.7);
  expect(text.advance(run.text, run.font)).toBeCloseTo(inner.width, 6);
});

// md2ui: test_an_explicit_symbol_color_wins
test("an explicit symbol colour wins", () => {
  const theme = SYMBOL_THEME("checkbox", "Symbol: ✓\nSymbol color: #D03030");
  expect(drawnSymbols(theme).texts[0]?.runs[0]?.color).toBe("#d03030ff");
  expect(drawnSymbols(theme, false).texts).toEqual([]);
});

// md2ui: test_symbol_color_is_replaced_on_the_inner_background
test("the symbol colour is replaced on the inner background", () => {
  const theme = `${SYMBOL_THEME("checkbox", "Symbol: ✓")}
## Color Replacements
On background color: #FFFFFF
- Text color: #5B4FC4, Replacement: #101010
`;
  expect(drawnSymbols(theme).texts[0]?.runs[0]?.color).toBe("#101010ff");
});
