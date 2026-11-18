// md2ui tests/layout_orphan_row_tests.py `test_a_fixed_style_owns_its_grids_orphan_row`:
// `Orphan row` is read from the style of the section that owns the grid, a fixed style
// included, which replaces its heading level whole; not from the first card's style
// (which has none) nor `### Heading 1`. Through the whole pipeline (fake measurer).
import { expect, test } from "vitest";
import type { LayoutNode } from "../src/layout/node.ts";
import { paintMarkdown } from "./scene-kit.ts";

const BAND_THEME = `## Styling & Spacing
### Root
Padding: 24
### Fixed styles
#### Band
Padding: 24
Orphan row: Center
`;

const CARDS = [
  ["Become a Dasher", "As a delivery driver, make money and work on your own schedule."],
  ["Become a Merchant", "Attract new customers and grow your sales, starting today."],
  ["Get the app", "Experience the best your neighbourhood has to offer, in one app."],
];
const BAND = `# {#band-1}\n\n${CARDS.map(([title, line]) => `#### ${title}\n${line}\n[\`Open\`](/x)`).join("\n\n")}\n`;

function nodes(n: LayoutNode): LayoutNode[] {
  return [n, ...n.children.flatMap(nodes)];
}

test("a fixed style states its grid's orphan row, as a heading level does", () => {
  const { layout } = paintMarkdown(BAND, BAND_THEME, 767);
  const grids = nodes(layout).filter((n) => n.type === "row" && n.grid);
  const ragged = grids.filter((g) => g.children.length < (g.grid_cols ?? 0));
  expect(
    ragged.length,
    JSON.stringify(grids.map((g) => [g.children.length, g.grid_cols])),
  ).toBeGreaterThan(0);
  expect(ragged.map((g) => g.render_properties?.["orphan_row"])).toEqual(["center"]);
});
