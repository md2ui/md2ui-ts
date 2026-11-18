// A run gridded into rows of equal columns: md2ui's `_grid_rows` and `_orphan_row_mode`.
// The members' fit choices are votes (ADR-301): a run whose members disagreed is built
// once more with the result pinned.
import type { GroupNode } from "../group/node.ts";
import { resolveSectionStyle } from "../theme/query.ts";
import { openPoll, settle } from "./fit-votes.ts";
import { type LayoutNode, layoutNode } from "./node.ts";
import { colGap } from "./node-units.ts";
import type { Run } from "./run.ts";

/**
 * md2ui `_orphan_row_mode`: the theme's `Orphan row` for the section that owns the grid
 * (its fixed style, which replaces its level whole, else its level), else the root's: `left` keeps a ragged last row's cells at one column's width,
 * `center` centres them, `stretch` shares the whole row between them.
 */
function orphanRowMode(run: Run, ownerLevel: number, fixedStyleKey: string | null): string {
  const st = resolveSectionStyle(run.theme, ownerLevel, fixedStyleKey);
  return st?.orphan_row || run.theme.root.orphan_row;
}

/**
 * md2ui `_grid_rows`: `items` in rows of `cols`, each built at one column's width and
 * tagged `grid`; a ragged last row keeps its real cells only (under `stretch` they share
 * the row; under `center` the row is stamped for the renderer).
 */
export function gridRows(
  run: Run,
  items: readonly GroupNode[],
  available: number,
  cols: number,
  inGlued: boolean,
  ownerLevel: number,
): LayoutNode[] {
  const head = items[0] as GroupNode;
  const ownerKey = run.spacerScope[1];
  const gap = colGap(run.kit, head, run.theme, ownerLevel, ownerKey);
  const childWidth = Math.max(0, (available - (cols - 1) * gap) / cols);
  const mode = orphanRowMode(run, ownerLevel, ownerKey);
  const poll = openPoll(run.fitPolls, items);
  for (;;) {
    const rows: LayoutNode[] = [];
    for (let k = 0; k < items.length; k += cols) {
      const batch = items.slice(k, k + cols);
      const n = batch.length;
      const ragged = n < cols;
      let width = childWidth;
      let rowCols = cols;
      if (ragged && mode === "stretch") {
        width = Math.max(0, (available - (n - 1) * gap) / n);
        rowCols = n;
      }
      const children = batch.map((item) => run.renderChild(run, item, width, inGlued, ownerLevel));
      const row = layoutNode("row", new Array<number>(rowCols).fill(1), children, {
        grid: true,
        grid_cols: rowCols,
      });
      if (ragged && mode === "center") {
        row.render_properties = { ...row.render_properties, orphan_row: mode };
      }
      rows.push(row);
    }
    if (!settle(run.fitPolls, poll)) return rows;
  }
}
