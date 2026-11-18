// In the generator, a run that stacks never narrows a gridded run of its kind, list rows of one
// shape share their pictures' params, and a spacer cell beside a list item that splits into a
// line is laid out as the text cell it stands for. Each test is md2ui's own, run through this
// port's grouper and the deterministic fake measurer; they need no fixtures.
import type { ResolvedTheme } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { groupMarkdown } from "../src/group/grouper.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { generate } from "../src/layout/generate.ts";
import { buildKindMaps } from "../src/layout/grid-fit.ts";
import { layoutInput } from "../src/layout/input.ts";
import type { LayoutNode } from "../src/layout/node.ts";
import { kvRoleMap } from "../src/layout/node-units.ts";
import { sizingMeasurer } from "../src/measure/sizing.ts";
import { createFakeMeasurer } from "../src/text/fake-measurer.ts";
import { parseTheme } from "../src/theme/parse.ts";

/** `markdown` grouped by this port and laid out at `width` under `theme`. */
function layout(markdown: string, width: number, theme: ResolvedTheme = parseTheme("")) {
  const kit = new RegexKit();
  const grouping = groupMarkdown(markdown, kit);
  const input = layoutInput(kit, grouping);
  const measurer = sizingMeasurer(input, theme, createFakeMeasurer(), {
    emojiFamily: (path) => path ?? "emoji",
  });
  return { grouping, root: generate(input, width, theme, measurer) };
}

function walk(n: LayoutNode): LayoutNode[] {
  return [n, ...n.children.flatMap(walk)];
}

// --- a stacked run is no grid --------------------------------------------------

const RINGS =
  "- Basic text answer: 2/10 difficulty\n- Structured cards and actions: 4/10\n" +
  "- A polished interactive session: 7/10\n- Live data with reliable images: 8/10\n";
const NOTES =
  "Clicks return as clear sentences, so actions are easy to interpret.\n\n" +
  "Updating one control without rebuilding the page is a strong feature.\n";

const gridCols = (doc: string): number =>
  Math.max(...walk(layout(doc, 1280).root).map((n) => n.grid_cols ?? 0));

// md2ui layout_list_grid_tests: test_a_stacked_list_does_not_narrow_a_grid_of_its_kind
test("a stacked list does not narrow a grid of its kind", () => {
  // The bullets share the rings' kind (every list item is one) but stack, so the rings
  // keep the count they have beside paragraphs.
  const alone = gridCols(`${RINGS}\n\n## Notes\n\n${NOTES}`);
  const bullets = NOTES.split("\n\n")
    .map((line) => `- ${line.trim()}\n`)
    .join("");
  expect(alone).toBe(4);
  expect(gridCols(`${RINGS}\n\n## Notes\n\n${bullets}`)).toBe(alone);
});

// md2ui `_build_kind_maps`, the half its test does not reach: an orphaned leaf
// is no occurrence of its kind either. Here a text is orphaned beside a run of two texts
// (which stack), so its kind has no grid member at all; counted, the orphan would make
// the kind occur.
test("an orphaned leaf and a run of leaves are no occurrence of their kind", () => {
  const kit = new RegexKit();
  const doc = "4.8/5.0 - ⭐\n\n__4.8/5.0__\nGlued, this turns into a group.\n⭐\n";
  const { root } = layoutInput(kit, groupMarkdown(doc, kit));
  const [orphaned, glued] = root.children;
  const orphan = orphaned?.children[0];
  expect(orphan?.orphan_grid).toBe(true);
  expect(orphan?.children).toEqual([]);
  expect([...(glued?.repeated_children?.values() ?? [])].map((b) => b.length)).toEqual([2]);
  const theme = parseTheme("");
  const scope = { theme, leafMin: () => 0, cache: new Map(), kvRoles: kvRoleMap(root, theme) };
  const kinds = buildKindMaps(root, scope);
  expect(kinds.occurrences.has(orphan?.kind_hash ?? null)).toBe(false);
  expect(kinds.members.has(orphan?.kind_hash ?? null)).toBe(false);
});

// --- list rows share their pictures' params -------------------------------------

const PHOTO = "https://upload.wikimedia.org/wikipedia/commons/e/e3/Che_ne_saj.jpg";

// md2ui image_url_params_tests: test_list_rows_of_one_shape_share_the_first_rows_params
test("`- ` rows of one shape share the first row's params", () => {
  // md2ui findings/list-rows-do-not-share-params: `- ` rows of one shape are
  // a run like cards, so the first row's params draw every picture.
  const circle = "?md2ui.max_width=56&md2ui.aspect_ratio=1:1&md2ui.shape=circle";
  const rows = ["Eva", "Ben", "Marco"].map(
    (t) => `- ![${t}](${PHOTO}${t === "Eva" ? circle : ""}) - **${t}** : _Received_ ... +$5.00`,
  );
  const { grouping, root } = layout(`## Today\n\n${rows.join("\n")}\n`, 900);
  const images = new Set<string>();
  const collect = (n: typeof grouping): void => {
    if (n.type === "image") images.add(n.node_id);
    for (const c of n.children) collect(c);
  };
  collect(grouping);
  const props = walk(root)
    .filter((n) => n.content_id !== null && images.has(n.content_id))
    .map((n) => n.render_properties ?? {});
  expect(props).toHaveLength(3);
  for (const p of props) expect(p).toEqual(props[0]);
  expect(props[0]?.["shape"]).toBe("circle");
});

// --- a spacer cell beside a split list item --------------------------------------

/**
 * md2ui `_spaced_items`: two `:::` rows, each a spacer cell beside a list item that splits
 * on ` - `; `first` / `second` say which side each row's spacer is on.
 */
function spacedItems(first: "lead" | "trail", second: "lead" | "trail"): string {
  const cell = "+++++ +++++";
  const item = "- List item - [Link](/x)";
  const row = (side: "lead" | "trail"): string =>
    (side === "lead" ? [cell, item] : [item, cell]).join("\n\n:::\n\n");
  return `#### T\n\n;;;\n\n${row(first)}\n\n;;;\n\n${row(second)}\n\n;;;\n`;
}

/** md2ui `_boxes_holding_spacers`: for each spacer leaf, whether a painted box encloses it. */
function boxesHoldingSpacers(n: LayoutNode, boxed = false, out: boolean[] = []): boolean[] {
  const inBox = boxed || n.background_kind !== null;
  if (n.render_properties?.["spacer"] !== undefined) out.push(inBox);
  for (const c of n.children) boxesHoldingSpacers(c, inBox, out);
  return out;
}

// md2ui spacer_tests: test_a_spacer_cell_beside_a_split_list_item_is_outside_its_box
test("a spacer cell beside a split list item is outside its box", () => {
  // The item splits into a line: the line keeps the item's box and the space stands
  // beside it, as a cell would (probe 04).
  const { grouping, root } = layout(spacedItems("lead", "trail"), 600);
  const items: (typeof grouping)[] = [];
  const collect = (n: typeof grouping): void => {
    if (n.type === "list_item") items.push(n);
    for (const c of n.children) collect(c);
  };
  collect(grouping);
  expect(items).toHaveLength(2);
  for (const n of items) expect(n.line_split_group && n.spacer_beside).toBe(true);
  expect(boxesHoldingSpacers(root)).toEqual([false, false]);
});

// md2ui spacer_tests: test_a_spacer_cell_holds_the_item_beside_it
test("a spacer cell holds the item beside it", () => {
  // The item beside a spacer cell narrows to its minimum before the space gives way, as
  // it would beside a leaf cell: a pushed line (`...`) asks the whole width, and its
  // floor is still its own minimum.
  const doc = spacedItems("lead", "trail").replaceAll("(/x)", "(/x) ... ***➡️***");
  const floors = walk(layout(doc, 600).root)
    .filter((n) => n.background_kind !== null)
    .map((n) => n.render_properties?.["held_floor"]);
  expect(floors).toHaveLength(2);
  for (const f of floors) {
    expect(typeof f).toBe("number");
    expect(f as number).toBeLessThan(300);
  }
});
