// Pieces that sit side by side, flowed back into rows: md2ui's `_flow_rows`,
// `_balance_batches`, `_mark_fill` and `_flow_line_group`. A line's pieces, a run of
// one line's elements and the cells of an unweighted `:::` row are packed greedily, as
// many per row as fit at the width each takes on one line, wrapping only when the line
// is too long for the width.
import { type GroupNode, HEADING_TYPE_RE } from "../group/node.ts";
import { pySum } from "../group/py/math.ts";
import { cellPerLine, lineBreaks, rowStacks } from "./fit-votes.ts";
import { lineItemWidth, voteSpacers, withSeparators } from "./line-pieces.ts";
import { type LayoutNode, layoutNode } from "./node.ts";
import { batchWidth, flowPairGap, isPureElementGroup } from "./node-units.ts";
import type { Run } from "./run.ts";
import { trimRowEdges } from "./spacers.ts";
import { rewrap } from "./spring-wrap.ts";

/** One flow batch: its pieces and the width each asked for. */
type Batch = [items: GroupNode[], widths: number[]];

/** How `flowRows` packs and what it stamps (md2ui `_flow_rows`' keyword arguments). */
export interface FlowOptions {
  /** The width a piece asks for. */
  readonly widthOf: (item: GroupNode) => number;
  /** Stamp the rows `line_split`: they are line content. */
  readonly lineSplit?: boolean;
  /** Number the rows of a run that wrapped as one `flow_run`. */
  readonly oneRun?: boolean;
  /** Share each row's leftover across its pieces and stamp them `fill_row`. */
  readonly fill?: boolean;
  /** Even out the last two rows. */
  readonly balance?: boolean;
  /** Pieces a new row starts at, wherever they fall. */
  readonly breaks?: ReadonlySet<GroupNode>;
  /** Receives the pieces of each row. */
  readonly lines?: GroupNode[][];
}

/**
 * md2ui `_balance_batches`: even out a flow's last two rows in place: move pieces back
 * one at a time while the last row is more than one short of the row above it and the
 * move still fits.
 */
function balanceBatches(batches: Batch[], available: number, run: Run): void {
  if (batches.length < 2) return;
  const [prevItems, prevW] = batches[batches.length - 2] as Batch;
  const [lastItems, lastW] = batches[batches.length - 1] as Batch;
  while (lastItems.length < prevItems.length - 1) {
    const moved = prevItems[prevItems.length - 1] as GroupNode;
    const movedW = prevW[prevW.length - 1] as number;
    if (batchWidth([moved, ...lastItems], [movedW, ...lastW], run.theme) > available) return;
    prevItems.pop();
    prevW.pop();
    lastItems.unshift(moved);
    lastW.unshift(movedW);
  }
}

/**
 * md2ui `_mark_fill`: tell the renderer a cell of a packed row keeps the width it was
 * given, rather than collapsing back to its content.
 */
function markFill(built: LayoutNode, fill: boolean): LayoutNode {
  if (fill) built.render_properties = { ...built.render_properties, fill_row: true };
  return built;
}

/**
 * md2ui `_flow_rows`: greedy first-fit batches of `items` in document order, as many per
 * row as fit at their widths plus the gap the renderer puts between each pair. A batch
 * of one renders at the full width; a longer one is a plain row whose ratios are the
 * widths asked (with `fill`, grown by one factor to span the line). The rows of a run
 * that wrapped share one `flow_run`, unless `oneRun` is off.
 */
export function flowRows(
  run: Run,
  items: readonly GroupNode[],
  available: number,
  inGlued: boolean,
  ownerLevel: number,
  opts: FlowOptions,
): LayoutNode[] {
  const { theme } = run;
  const { widthOf, lineSplit = false, oneRun = true, fill = false, balance = false } = opts;
  const breaks = opts.breaks ?? new Set<GroupNode>();

  let batches: Batch[] = [];
  let batch: GroupNode[] = [];
  let widths: number[] = [];
  let cur = 0;
  const close = (): void => {
    if (batch.length > 0) batches.push([batch, widths]);
    batch = [];
    widths = [];
    cur = 0;
  };
  for (const item of items) {
    const w = widthOf(item);
    const last = batch[batch.length - 1];
    const pairGap = last !== undefined ? flowPairGap(last, item, theme) : 0;
    let needed = last !== undefined ? cur + pairGap + w : w;
    if (last !== undefined && (needed > available || breaks.has(item))) {
      close();
      needed = w;
    }
    batch.push(item);
    widths.push(w);
    cur = needed;
  }
  close();
  if (balance) balanceBatches(batches, available, run);
  batches = trimRowEdges(batches);
  opts.lines?.push(...batches.map(([b]) => b));

  const rows: LayoutNode[] = [];
  for (const [pieces, asked] of batches) {
    if (pieces.length === 1) {
      rows.push(run.renderChild(run, pieces[0] as GroupNode, available, inGlued, ownerLevel));
      continue;
    }
    let cells = [...asked];
    if (fill) {
      const slack = available - batchWidth(pieces, cells, theme);
      const base = pySum(cells);
      if (slack > 0 && base > 0) cells = cells.map((w) => w + (slack * w) / base);
    }
    const row = layoutNode(
      "row",
      cells,
      pieces.map((item, k) =>
        markFill(run.renderChild(run, item, cells[k] as number, inGlued, ownerLevel), fill),
      ),
    );
    row.line_split = lineSplit;
    rows.push(row);
  }
  if (oneRun && rows.length > 1) {
    run.flowSeq += 1;
    for (const r of rows) r.flow_run = run.flowSeq;
  }
  return rows;
}

/**
 * md2ui `_flow_line_group`: the pieces of one line (`node`'s children), or `cells`, the
 * cells of a `:::` row with no number and the `gaps` between them, flowed into rows. In
 * a grid run a line votes where it wrapped and a `:::` row whether it stacked (ADR-301).
 */
export function flowLineGroup(
  run: Run,
  node: GroupNode,
  available: number,
  inGlued: boolean,
  ownerLevel: number,
  rowCells: readonly GroupNode[] | null = null,
  gaps: readonly string[] | null = null,
): LayoutNode {
  const line = rowCells === null;
  const cells = rowCells ?? [...node.children];
  // One cell per piece: the row's gaps and edges are its line's.
  let pieces = withSeparators(run, node, cells, gaps);
  let widthOf = (c: GroupNode): number => lineItemWidth(run, c, available);
  const flow = (more: Omit<FlowOptions, "widthOf">): LayoutNode[] =>
    flowRows(run, pieces, available, inGlued, ownerLevel, { widthOf, ...more });
  let lines: GroupNode[][] = [];
  let rows = flow({ lines });
  // One wraps, all wrap: a line that wrapped its pieces votes in its run; a cloud of
  // chips or links wraps as words do, and casts nothing.
  const polls = run.fitPolls;
  if (line && !isPureElementGroup(node)) {
    const pin = lineBreaks(polls, node, cells, lines);
    if (pin.size > 0) {
      lines = [];
      rows = flow({ breaks: pin, lines });
    }
  }
  // A `:::` row that wraps its cells has stacked them: a vote in its run.
  if (!line && rowStacks(polls, node, rows)) {
    widthOf = cellPerLine(widthOf, available);
    lines = [];
    rows = flow({ lines });
  }
  if (line) {
    // Where a spring line wrapped, its pieces settle (ADR-304).
    ({ rows, lines } = rewrap(polls, node, rows, lines, (order, breaks) => {
      pieces = withSeparators(run, node, order);
      const flowed: GroupNode[][] = [];
      return { rows: flow({ breaks, lines: flowed }), lines: flowed };
    }));
  }
  voteSpacers(run, node, rows, lines, available);
  for (const r of rows) r.line_split = true;
  if (node.align_group) for (const r of rows) r.spring = true;
  let result = rows[0] as LayoutNode;
  if (rows.length > 1) {
    result = layoutNode(
      "col",
      rows.map(() => 1),
      rows,
    );
    result.line_split = true;
  }
  if (run.kit.re(HEADING_TYPE_RE).match(node.type) !== null) result.heading_line = true;
  result.block_line = cells.length > 0 && cells.every((c) => c.children.length > 0);
  return result;
}
