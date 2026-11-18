// An authored `:::` row: md2ui's `_row_weights`, `_column_row_widths`,
// `_column_row_lines`, `_image_floor_of`, `_build_column_row` and `_column_stack`. A row
// with no number written flows like a line's pieces; once a number is written each line
// of it is a `column_row` whose ratios are the weights of the cells on it, and a cell
// that does not fit starts the next line, as a line's piece does.
import type { GroupNode } from "../group/node.ts";
import { pySum } from "../group/py/math.ts";
import { groupGaps, rowGroups, stackOf } from "./column-cuts.ts";
import { lineBreaks } from "./fit-votes.ts";
import { flowLineGroup } from "./flow.ts";
import { edgeSpacers } from "./leaves.ts";
import { lineItemWidth, rowSpacerPx, voteSpacers, withSeparators } from "./line-pieces.ts";
import { type LayoutNode, layoutNode } from "./node.ts";
import { minWidth, rowPairGap, unitPaddingX } from "./node-units.ts";
import type { Run } from "./run.ts";
import { lineAsk, trimRowEdges } from "./spacers.ts";

/**
 * md2ui `_row_weights`: one weight per cell of a `:::` row, always `count` of them (an
 * unweighted cell takes 1), or `null` when no number was written anywhere in the row.
 */
function rowWeights(count: number, written: readonly (number | null)[]): number[] | null {
  if (written.every((w) => w === null)) return null;
  const weights = written.map((w) => (w === null ? 1 : w));
  while (weights.length < count) weights.push(1);
  return weights.slice(0, count);
}

/**
 * md2ui `_column_row_widths`: the approximate width of each weighted cell on one line:
 * a cell of weight 0 keeps its minimum, the rest share the surplus by weight.
 */
function columnRowWidths(
  run: Run,
  cells: readonly GroupNode[],
  weights: readonly number[],
  available: number,
  ownerLevel: number,
): number[] {
  const mins = cells.map((c) =>
    c.separator_kind ? lineItemWidth(run, c) : minWidth(c, run.minWidths),
  );
  const gaps = pySum(
    cells
      .slice(1)
      .map((cell, i) =>
        rowPairGap(run.kit, cells[i] as GroupNode, cell, run.theme, ownerLevel, run.spacerScope[1]),
      ),
  );
  const surplus = available - gaps;
  // Python's `zip`: the shorter of the two decides.
  const n = Math.min(mins.length, weights.length);
  const reserved = pySum(mins.slice(0, n).filter((_, i) => !weights[i]));
  const share = Math.max(0, surplus - reserved);
  const total = pySum(weights.filter((w) => w));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const m = mins[i] as number;
    const w = weights[i] as number;
    out.push(!w ? m : total ? (share * w) / total : share / cells.length);
  }
  return out;
}

/**
 * md2ui `_image_floor_of`: the least width the renderer raises a `:::` cell to so its
 * images keep their `min_width`; 0 for a cell holding no floored image.
 */
function imageFloorOf(run: Run, node: GroupNode): number {
  if (run.imageFloors.size === 0) return 0;
  let inner: number;
  if (node.type === "image") inner = run.imageFloors.get(node) ?? 0;
  else {
    inner = 0;
    let first = true;
    for (const c of node.children) {
      const f = imageFloorOf(run, c);
      if (first || f > inner) inner = f;
      first = false;
    }
  }
  return inner ? inner + unitPaddingX(node, run.theme) : 0;
}

/**
 * md2ui `_column_row_lines`: which items of a weighted `:::` row share each line:
 * greedy first-fit on each cell's ask plus the gaps, a cell joining a line only if, at
 * the shares the weights will draw them at, every cell on it still gets its ask.
 * `breaks` start a new line wherever they fall.
 */
function columnRowLines(
  run: Run,
  items: readonly GroupNode[],
  available: number,
  ownerLevel: number,
  weightOf: ReadonlyMap<GroupNode, number>,
  breaks: ReadonlySet<GroupNode> = new Set(),
): GroupNode[][] {
  const fits = (cells: readonly GroupNode[], asks: readonly number[], used: number): boolean => {
    // An unweighted cell (a gap cell, a `:::0`) keeps its ask, and so does one the
    // renderer raises to its image floor; the rest is shared by weight.
    const weights = cells.map((c) => weightOf.get(c) ?? 0);
    const room = available - (used - pySum(asks));
    const floors = cells.map((c) => imageFloorOf(run, c));
    const held = new Map<number, number>();
    weights.forEach((w, i) => {
      if (!w) held.set(i, asks[i] as number);
    });
    let drawn = new Map<number, number>();
    for (;;) {
      const total = pySum(weights.filter((_, i) => !held.has(i)));
      const share = room - pySum(held.values());
      if (!total) return share >= 0;
      drawn = new Map();
      weights.forEach((w, i) => {
        if (!held.has(i)) drawn.set(i, (share * w) / total);
      });
      const raised: [number, number][] = [];
      for (const [i, d] of drawn) {
        const f = floors[i] as number;
        if (f > d) raised.push([i, f]);
      }
      if (raised.length === 0) break;
      for (const [i, f] of raised) held.set(i, f);
    }
    return cells.every((_, i) => {
      const got = drawn.get(i) ?? held.get(i) ?? 0;
      return got >= (asks[i] as number) - 1e-6;
    });
  };

  const batches: [GroupNode[], number[]][] = [];
  let used = 0;
  for (const item of items) {
    let w = lineItemWidth(run, item, available);
    if (item.separator_kind === null) {
      // Short cells ask for their real content; prose at most its wrapping floor.
      const ask = lineAsk(
        item,
        (n) => minWidth(n, run.minWidths),
        (s) => rowSpacerPx(run, s),
      );
      w = Math.min(w, ask);
    }
    const lastBatch = batches[batches.length - 1];
    const prev = lastBatch?.[0][lastBatch[0].length - 1];
    const gap =
      prev !== undefined
        ? rowPairGap(run.kit, prev, item, run.theme, ownerLevel, run.spacerScope[1])
        : 0;
    if (
      lastBatch !== undefined &&
      !breaks.has(item) &&
      fits([...lastBatch[0], item], [...lastBatch[1], w], used + gap + w)
    ) {
      lastBatch[0].push(item);
      lastBatch[1].push(w);
      used += gap + w;
    } else {
      batches.push([[item], [w]]);
      used = w;
    }
  }
  return trimRowEdges(batches).map(([b]) => b);
}

/**
 * md2ui `_column_stack`: the cells of one group as one cell: the cell itself when it is
 * alone, else a wrapper `renderChild` stacks (made once per row and group for the call).
 */
function columnStack(run: Run, row: GroupNode, group: readonly number[]): GroupNode {
  if (group.length === 1) return row.children[group[0] as number] as GroupNode;
  const key = `${group[0]}:${group[group.length - 1]}`;
  let byRow = run.columnStacks.get(row);
  if (byRow === undefined) {
    byRow = new Map();
    run.columnStacks.set(row, byRow);
  }
  let stack = byRow.get(key);
  if (stack === undefined) {
    stack = stackOf(row.children, group);
    byRow.set(key, stack);
    run.stackIds.add(stack);
  }
  return stack;
}

/**
 * md2ui `_build_column_row`: an authored `:::` row, one cell per division that applies
 * at this width. No number written: the cells flow as a line's pieces. Any number
 * written: lines of `column_row`s proportioned by their cells' weights.
 */
export function buildColumnRow(
  run: Run,
  node: GroupNode,
  available: number,
  inGlued: boolean,
  ownerLevel: number,
): LayoutNode {
  const [groups, written] = rowGroups(node, node.children.length, available);
  const cells = groups.map((g) => columnStack(run, node, g));
  if (cells.length === 1) {
    const only = run.renderChild(run, cells[0] as GroupNode, available, inGlued, ownerLevel);
    return edgeSpacers(run, node, only, available);
  }
  const gaps = groupGaps(node, groups);
  const weights = rowWeights(cells.length, written);
  if (weights === null) {
    return flowLineGroup(run, node, available, inGlued, ownerLevel, cells, gaps);
  }
  // The row's gaps are cells of no weight: a line's, laid between its cells.
  const items = withSeparators(run, node, cells, gaps);
  const weightOf = new Map<GroupNode, number>();
  cells.forEach((c, i) => {
    weightOf.set(c, weights[i] as number);
  });
  let split = columnRowLines(run, items, available, ownerLevel, weightOf);
  // One wraps, all wrap: the cells a row wrapped before are a vote in its run.
  const pin = lineBreaks(run.fitPolls, node, cells, split);
  if (pin.size > 0) split = columnRowLines(run, items, available, ownerLevel, weightOf, pin);
  const lines: LayoutNode[] = [];
  for (const lineCells of split) {
    if (lineCells.length === 1) {
      lines.push(run.renderChild(run, lineCells[0] as GroupNode, available, inGlued, ownerLevel));
      continue;
    }
    const lineWeights = lineCells.map((c) => weightOf.get(c) ?? 0);
    const widths = columnRowWidths(run, lineCells, lineWeights, available, ownerLevel);
    const row = layoutNode(
      "row",
      lineWeights,
      lineCells.map((c, k) => run.renderChild(run, c, widths[k] as number, inGlued, ownerLevel)),
    );
    row.column_row = true;
    voteSpacers(run, node, [row], [lineCells], available, lineWeights);
    lines.push(row);
  }
  if (lines.length === 1) return lines[0] as LayoutNode;
  return layoutNode(
    "col",
    lines.map(() => 1),
    lines,
  );
}
