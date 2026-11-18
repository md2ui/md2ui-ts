// Edge spacers placed as leaves: space above and below a card's only
// row, and space beside a list item outside the box it paints. The cases are md2ui
// `tests/spacer_tests.py`'s, run on md2ui's own grouping of each document so they do not
// depend on the port's grouper; `layout-spacer-edges.expected.json` holds that grouping
// and md2ui's layout of it (md2ui's real measurer at 600 under
// `Theme()`). The stand-in measurer here is coarser, which these small documents do not
// feel: every layout below equals md2ui's node for node.
import type { GroupingNode } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { RegexKit } from "../src/group/py/re.ts";
import { generate } from "../src/layout/generate.ts";
import { layoutInput } from "../src/layout/input.ts";
import type { LayoutMeasurer } from "../src/layout/measurer.ts";
import type { LayoutNode } from "../src/layout/node.ts";
import { parseTheme } from "../src/theme/parse.ts";
import expected from "./layout-spacer-edges.expected.json" with { type: "json" };

type Case = "card_line" | "card_column_row" | "beside_items" | "beside_item_lines" | "inside_items";

interface Compact {
  type: string;
  content_id?: string;
  is_card?: true;
  background_kind?: string;
  section_level?: number;
  spacer?: string;
  children?: Compact[];
}

/** Every leaf of a built subtree. */
function leaves(n: LayoutNode): number {
  return n.children.length === 0 ? 1 : n.children.reduce((s, c) => s + leaves(c), 0);
}

/** A word is 7 px a character; a block or subtree 20 px a leaf. */
const MEASURER: LayoutMeasurer = {
  leafMinWidth: (node) => {
    const words = node.content.split(/\s+/).filter((w) => w !== "");
    return Math.max(0, ...words.map((w) => w.length)) * 7;
  },
  leafLineWidth: (node) => node.content.length * 7,
  markerWidth: (props) => (props["size"] as number) + 1.5,
  blockWidth: (built) => 20 * leaves(built),
  layoutHeight: (built) => 20 * leaves(built),
};

/** md2ui's layout of `name`'s document, and the port's of the same grouping. */
function layouts(name: Case): { md2ui: Compact; port: LayoutNode } {
  const c = expected[name];
  const input = layoutInput(new RegexKit(), c.grouping as unknown as GroupingNode);
  return { md2ui: c.layout as Compact, port: generate(input, 600, parseTheme(""), MEASURER) };
}

/** The fields the expected layouts record, in their shape. */
function compact(n: LayoutNode): Compact {
  const out: Compact = { type: n.type };
  if (n.content_id) out.content_id = n.content_id;
  if (n.is_card) out.is_card = true;
  if (n.background_kind) out.background_kind = n.background_kind;
  if (n.section_level !== null) out.section_level = n.section_level;
  const spacer = n.render_properties?.["spacer"] as { axis: string } | undefined;
  if (spacer) out.spacer = spacer.axis;
  if (n.children.length > 0) out.children = n.children.map(compact);
  return out;
}

/** md2ui `_surfaces`: every section or card, outermost first. */
function* surfaces(n: LayoutNode): Generator<LayoutNode> {
  if (n.section_level !== null || n.is_card) yield n;
  for (const c of n.children) yield* surfaces(c);
}

/** md2ui `_boxes_holding_spacers`: for each spacer leaf, whether a painted box encloses it. */
function boxesHoldingSpacers(n: LayoutNode, boxed = false, out: boolean[] = []): boolean[] {
  const inBox = boxed || n.background_kind !== null;
  if (n.render_properties?.["spacer"] !== undefined) out.push(inBox);
  for (const c of n.children) boxesHoldingSpacers(c, inBox, out);
  return out;
}

/** Every spacer leaf of a subtree. */
function spacerLeaves(n: LayoutNode): LayoutNode[] {
  const own = n.render_properties?.["spacer"] !== undefined ? [n] : [];
  return [...own, ...n.children.flatMap(spacerLeaves)];
}

/** A card holding only a row: its spacers are space above and below the row. */
function expectSpaceAroundTheRow(name: Case): void {
  const { md2ui, port } = layouts(name);
  expect(compact(port)).toEqual(md2ui);
  const [card] = [...surfaces(port)];
  expect(card?.children.map((c) => c.type)).toEqual(["-", "row", "-"]);
  const axes = card?.children.map(
    (c) => (c.render_properties?.["spacer"] as { axis: string } | undefined)?.axis ?? null,
  );
  expect(axes).toEqual(["col", null, "col"]);
  expect(spacerLeaves(card?.children[1] as LayoutNode)).toEqual([]);
}

// md2ui `test_spacers_beside_a_cards_only_line_are_above_and_below_it` (probe 01).
test("the spacers beside a card's only line are above and below it", () => {
  expect(expected.card_line.grouping.children[0]).toMatchObject({
    line_split_group: true,
    spacer_above: "+++++",
    spacer_below: "+++++",
  });
  expectSpaceAroundTheRow("card_line");
});

// md2ui `test_spacers_beside_a_cards_only_column_row_are_above_and_below_it` (probe 02).
test("the spacers beside a card's only column row are above and below it, not in its cells", () => {
  expect(expected.card_column_row.grouping.children[0]).toMatchObject({
    column_row_group: true,
    spacer_above: "+++++",
    spacer_below: "+++++",
  });
  expectSpaceAroundTheRow("card_column_row");
});

// md2ui `test_a_spacer_cell_beside_a_list_item_is_outside_its_box` (probe 03).
test("a spacer cell beside a list item is outside its box", () => {
  for (const name of ["beside_items", "beside_item_lines"] as const) {
    const { md2ui, port } = layouts(name);
    expect(compact(port)).toEqual(md2ui);
    expect(boxesHoldingSpacers(port)).toEqual(expected[name].boxed);
    expect(boxesHoldingSpacers(port).some(Boolean)).toBe(false);
  }
});

// md2ui `test_a_spacer_inside_a_list_items_line_is_inside_its_box`.
test("a spacer inside a list item's line is inside its box", () => {
  const { md2ui, port } = layouts("inside_items");
  expect(compact(port)).toEqual(md2ui);
  expect(boxesHoldingSpacers(port)).toEqual([true, true]);
});

// The across row keeps its card's surface, and the item keeps only its own box.
test("space beside an item moves the item's surface but its own box onto the row", () => {
  const { port } = layouts("beside_items");
  const rows = (port.children[0] as LayoutNode).children.slice(1);
  for (const row of rows) {
    expect(row.type).toBe("row");
    expect(row.background_kind).toBeNull();
    const item = row.children.find((c) => spacerLeaves(c).length === 0) as LayoutNode;
    expect(item.background_kind).toBe("unordered_list");
  }
});
