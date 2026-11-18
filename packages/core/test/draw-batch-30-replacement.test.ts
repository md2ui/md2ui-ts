// Color replacements reaching surface fills, chart text and code blocks, as display-list
// entries through the whole pipeline (fake measurer).
// Ported from md2ui's tests/paint_replacement_tests.py (the code-block tests) and
// tests/section_stroke_replacement_tests.py. Not ported: the four chart-label tests of
// paint_replacement_tests.py (`test_chart_rows_labels_and_values_are_replaced`,
// `test_chart_legend_is_replaced`, `test_chart_tick_labels_are_replaced`,
// `test_line_chart_ticks_are_replaced`), which belong to the chart drawing.
import type { FillEntry, ScrollEntry, StrokeEntry, TextEntry } from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { emitWrapBoxes } from "../src/scene/backgrounds.ts";
import { parseTheme } from "../src/theme/parse.ts";
import { paintMarkdown } from "./scene-kit.ts";

const entriesOf = (md: string, theme: string, width = 400) =>
  paintMarkdown(md, theme, width).painted.list.entries;
const fills = (md: string, theme: string): FillEntry[] =>
  entriesOf(md, theme).filter((e): e is FillEntry => e.type === "fill");
const colorOf = (e: FillEntry): string | undefined =>
  e.paint.kind === "color" ? e.paint.color : undefined;

describe("a section fill is replaced against what it sits on (md2ui 142505f1)", () => {
  // md2ui `test_section_fill_is_replaced_against_what_it_sits_on`.
  it("replaces a heading section's fill through the fill channel of its surface", () => {
    const theme = `## Styling & Spacing

### Root
Background color: #000000

### Heading 1
Background color: #FF0000

## Color Replacements
On background color: #000000
- Fill color: #FF0000, Replacement: #00FF00
`;
    const colors = fills("# Title\n", theme).map(colorOf);
    expect(colors).toContain("#00ff00ff");
    expect(colors).not.toContain("#ff0000ff");
  });

  // md2ui `test_replaced_list_fill_is_its_contents_context`.
  it("a list item's contents sit on its replaced fill, not the authored one", () => {
    const theme = parseTheme(`## Styling & Spacing

### Unordered Lists
Background color: #FF0000

## Color Replacements
On background color: #000000
- Fill color: #FF0000, Replacement: #00FF00
`);
    const layers = [{ kind: "unordered_list" as const, level: 0, style: theme.unordered_lists }];
    const who = {
      ring: null,
      bgImageUrl: null,
      rotationIndex: null,
      rotationChain: [],
      rotationPath: [],
      fixedStyleKey: null,
    };
    const inner = emitWrapBoxes([], 0, 0, 10, 10, layers, who, theme, [0xff000000]);
    expect(inner.bgStack).toEqual([0xff00ff00, 0xff000000]);
  });
});

describe("a code block follows the surface it sits on (md2ui 142505f1)", () => {
  const block = (extra: string, copy = "Icon: none") => `## Code Blocks
Syntax style: monokai
Background color: #002B0A
Padding: 10
${extra}
### Copy Button
${copy}
`;
  const surface = `## Styling & Spacing

### Root
Background color: #18181B
`;
  const md = "```\nx = 1\n```\n";
  const texts = (theme: string): TextEntry[] =>
    entriesOf(md, theme).filter((e): e is TextEntry => e.type === "text");

  // md2ui `test_code_block_fill_and_runs_are_replaced`.
  it("replaces the block's fill, and its runs key on the replaced fill", () => {
    const theme = `${surface}${block("")}
## Color Replacements
On background color: #18181B
- Fill color: #002B0A, Replacement: #FF0000

On background color: #FF0000
- Replacement: #0000FF
`;
    const block0 = fills(md, theme).find((e) => colorOf(e) === "#ff0000ff");
    expect(block0).toBeDefined();
    expect(fills(md, theme).map(colorOf)).not.toContain("#002b0aff");
    expect(new Set(texts(theme).map((t) => t.runs[0]?.color))).toEqual(new Set(["#0000ffff"]));
  });

  // md2ui `test_code_block_fill_and_runs_are_replaced` (the fade the replaced fill tints).
  it("a scrolling block's fade is the replaced fill", () => {
    const theme = `${surface}${block("Fade: yes")}
## Color Replacements
On background color: #18181B
- Fill color: #002B0A, Replacement: #FF0000
`;
    const wide = `\`\`\`\n${"x".repeat(200)}\n\`\`\`\n`;
    const scroll = entriesOf(wide, theme).find((e): e is ScrollEntry => e.type === "scroll");
    expect(scroll?.fade).toBe("#ff0000ff");
  });

  // md2ui `code_block_scrollables` (`bg_stack=box.bg_stack`): what a host redraws the block against.
  it("a scrollable carries what its block sits on", () => {
    const wide = `\`\`\`\n${"x".repeat(200)}\n\`\`\`\n`;
    const [scrollable] = paintMarkdown(wide, `${surface}${block("")}`, 400).scene.scrollables;
    expect(scrollable?.bg_stack).toEqual([0xff18181b]);
  });

  // md2ui `test_copy_button_stroke_is_replaced_against_the_block`.
  it("replaces the copy button's stroke against the code block's fill", () => {
    const theme = `${surface}${block("", "Icon: C\nStroke width: 2\nStroke color: #FFFFFF")}
## Color Replacements
On background color: #002B0A
- Stroke color: #FFFFFF, Replacement: #00FF00
`;
    const strokes = entriesOf(md, theme).filter((e): e is StrokeEntry => e.type === "stroke");
    expect(strokes.map((s) => s.color)).toContain("#00ff00ff");
    expect(strokes.map((s) => s.color)).not.toContain("#ffffffff");
  });
});
