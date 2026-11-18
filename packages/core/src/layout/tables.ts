// A table container: md2ui's `_build_table`.
import type { GroupNode } from "../group/node.ts";
import { makeLeaf } from "./leaves.ts";
import { type LayoutNode, layoutNode } from "./node.ts";
import { isGroup } from "./node-units.ts";
import type { Run } from "./run.ts";

/**
 * md2ui `_build_table`: a `table` col of `table_row` rows, each an equal-ratio row of
 * its cells (the renderer re-measures the columns), each cell marked `in_table` and
 * carrying its column's authored alignment. Stray children build as usual.
 */
export function buildTable(
  run: Run,
  node: GroupNode,
  width: number,
  inGlued: boolean,
  ownerLevel: number,
): LayoutNode {
  const rows: LayoutNode[] = [];
  for (const child of node.children) {
    if (child.type === "table_header" || child.type === "table_row") {
      const role = child.type === "table_header" ? "header" : "body";
      const n = Math.max(1, child.children.length);
      const cells: LayoutNode[] = [];
      for (const cell of child.children) {
        const built = isGroup(cell)
          ? run.decideGroup(run, cell, width / n, inGlued, ownerLevel)
          : makeLeaf(run, cell, width / n);
        built.in_table = role;
        if (cell.table_align) {
          built.render_properties = { ...built.render_properties, content_align: cell.table_align };
        }
        cells.push(built);
      }
      rows.push(
        layoutNode(
          "row",
          cells.map(() => 1),
          cells,
          { table_row: role },
        ),
      );
    } else if (isGroup(child)) {
      rows.push(run.decideGroup(run, child, width, inGlued, ownerLevel));
    } else {
      rows.push(makeLeaf(run, child, width));
    }
  }
  return layoutNode(
    "col",
    rows.map(() => 1),
    rows,
    { table: true },
  );
}
