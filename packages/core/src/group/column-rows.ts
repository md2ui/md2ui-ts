// The two authored partitions of a box: `:::` across, `...` down (md2ui:
// pipeline/grouper_column_rows.py).
//
// Both are whole-line tokens that cut a run of siblings and say how the pieces share
// the space: `:::` divides the width into CELLS with weights, `...` divides the
// height into REGIONS pushed to the top and bottom. Both are Phase 1 instructions,
// consumed here; neither type survives into the finished tree.
import { ITEM_DIVIDER } from "./block-splits.ts";
import { GroupNode, HEADING_TYPE_RE, type NodeType } from "./node.ts";
import type { RegexKit } from "./py/re.ts";
import { strip } from "./py/str.ts";

// md2ui: _OTHER_BREAKS. The break spellings that BOUND a row rather than divide it.
// Not `---`: it paints a line and cuts nothing, so a rule inside a row is content of
// the cell it is written in.
const OTHER_BREAKS: readonly NodeType[] = Object.freeze([
  "content_break",
  "section_stop",
  "row_closer",
]);

const isDivider = (node: GroupNode): boolean => node.type === "column_divider";
const isSpring = (node: GroupNode): boolean => node.type === "vertical_spring";
const isRule = (node: GroupNode): boolean => node.type === "horizontal_rule";
const isHeading = (kit: RegexKit, node: GroupNode): boolean =>
  kit.re(HEADING_TYPE_RE).match(node.type) !== null;

// md2ui: _holds_divider. Index of the first `:::` among node's own children, or null.
function holdsDivider(node: GroupNode): number | null {
  const i = node.children.findIndex(isDivider);
  return i < 0 ? null : i;
}

/**
 * md2ui: `_leading_cells`. Detaches and returns the cells the peel absorbed ABOVE a
 * section's heading, once the section is itself a cell of a row outside it.
 */
function leadingCells(kit: RegexKit, section: GroupNode, rowOpen: boolean): GroupNode[] {
  const kids = section.children;
  const heading = kids.findIndex((c) => isHeading(kit, c));
  if (heading < 0) return [];
  const above: number[] = [];
  for (let i = 0; i < heading; i += 1) if (isDivider(kids[i] as GroupNode)) above.push(i);
  const lastAbove = above.at(-1);
  if (lastAbove === undefined) return [];
  const below: number[] = [];
  for (let i = heading; i < kids.length; i += 1) if (isDivider(kids[i] as GroupNode)) below.push(i);
  const closedAsCell = below.length === 1 && below[0] === kids.length - 1;
  if (!(rowOpen || closedAsCell)) return [];
  return kids.splice(0, lastAbove + 1);
}

/** md2ui: `_lift_dividers`. Raises every `:::` in this node's run up to the run's own depth. */
function liftDividers(kit: RegexKit, node: GroupNode): void {
  const pending = [...node.children];
  const out: GroupNode[] = [];
  let rowOpen = false;
  for (let child = pending.shift(); child !== undefined; child = pending.shift()) {
    if (isDivider(child)) {
      rowOpen = true;
      out.push(child);
      continue;
    }
    if (OTHER_BREAKS.includes(child.type)) {
      // A row's scope ends at the other breaks.
      rowOpen = false;
      out.push(child);
      continue;
    }
    if (child.heading_group) {
      const lead = leadingCells(kit, child, rowOpen);
      if (lead.length > 0) {
        // The cells above the heading go back ahead of it, so their divider opens the row.
        pending.unshift(...lead, child);
        continue;
      }
      const at = holdsDivider(child);
      // A section whose ONE divider is its last line is a cell that `:::` closes.
      const closesSection = at !== null && at === child.children.length - 1;
      if (at !== null && (rowOpen || closesSection)) {
        const tail = child.children.splice(at);
        out.push(child);
        pending.unshift(...tail);
        continue;
      }
    }
    out.push(child);
  }
  node.children = out;
}

/**
 * md2ui: `_partition`. A sibling run split at its dividers into cells, and the divider
 * that closes each cell (null: the run ended without one).
 */
function partition(children: readonly GroupNode[]): [GroupNode[][], (GroupNode | null)[]] {
  const cells: GroupNode[][] = [];
  const closers: (GroupNode | null)[] = [];
  let cur: GroupNode[] = [];
  for (const child of children) {
    if (!isDivider(child)) {
      cur.push(child);
      continue;
    }
    if (cur.length > 0) {
      cells.push(cur);
      closers.push(child);
      cur = [];
    }
  }
  if (cur.length > 0) {
    cells.push(cur);
    closers.push(null);
  }
  return [cells, closers];
}

/** md2ui: `_describe_row`. The row stamped with what each cell's closing divider wrote. */
function describeRow(row: GroupNode, closers: readonly (GroupNode | null)[]): void {
  row.column_weights = closers.map((d) => (d === null ? null : d.column_weight));
  const wide = closers.map((d) => (d === null ? null : d.column_weight_wide));
  const cuts = closers.map((d) => (d === null ? null : d.column_when));
  row.column_weights_wide = wide.some((w) => w !== null) ? wide : [];
  row.column_cuts = cuts.some((c) => c !== null) ? cuts : [];
}

/** md2ui: `_marker_prefix`. How many leading children are EMPTY heading markers. */
function markerPrefix(kit: RegexKit, children: readonly GroupNode[]): number {
  let n = 0;
  for (const child of children) {
    if (!isHeading(kit, child) || strip(child.content)) break;
    n += 1;
  }
  return n;
}

/** md2ui: `_segments`. A sibling run cut at every break that bounds a row (`OTHER_BREAKS`). */
function segments(children: readonly GroupNode[]): [boolean, GroupNode[]][] {
  const out: [boolean, GroupNode[]][] = [];
  let cur: GroupNode[] = [];
  for (const child of children) {
    if (OTHER_BREAKS.includes(child.type)) {
      if (cur.length > 0) {
        out.push([true, cur]);
        cur = [];
      }
      out.push([false, [child]]);
      continue;
    }
    cur.push(child);
  }
  if (cur.length > 0) out.push([true, cur]);
  return out;
}

/** md2ui: `_region_valigns`. First region to the top, last to the bottom, the rest centred. */
function regionValigns(n: number): ("top" | "center" | "bottom")[] {
  if (n === 1) return ["top"];
  return ["top", ...Array<"center">(n - 2).fill("center"), "bottom"];
}

/**
 * md2ui: `build_vertical_springs`. Consumes every `...` line under `node`, stamping
 * the regions it places.
 */
export function buildVerticalSprings(node: GroupNode): void {
  for (const child of node.children) buildVerticalSprings(child);
  if (!node.children.some(isSpring)) return;
  const regions: GroupNode[][] = [[]];
  for (const child of node.children) {
    if (isSpring(child)) regions.push([]);
    else regions.at(-1)?.push(child);
  }
  const valigns = regionValigns(regions.length);
  const out: GroupNode[] = [];
  regions.forEach((nodes, i) => {
    const valign = valigns[i];
    if (nodes.length === 0 || valign === undefined) return; // an empty region keeps its slot
    for (const n of nodes) if (n.authored_valign === null) n.authored_valign = valign;
    out.push(...nodes);
  });
  if (out.length > 0) node.valign_group = true;
  node.children = out;
}

/**
 * md2ui: `hand_down_valign`. A `...` region is placed as one block in the box the
 * springs divide; when a later phase splits it into its lines, or dissolves its
 * level, the pieces stand in that box directly and take the region's alignment
 * unless they have their own.
 */
export function handDownValign(region: GroupNode, pieces: readonly GroupNode[]): void {
  if (region.authored_valign === null) return;
  for (const piece of pieces) piece.authored_valign ??= region.authored_valign;
}

/**
 * md2ui: `take_edge_spacer_cells`. Takes the cells at either end of a row's partition
 * that hold only `+++` spacers, and returns `[lead, trail]`, the space they were. Space
 * at a row's edge is the row's own, as `+++ A | B` puts it on its line, never a
 * column; consecutive ones are one space, their marks in written order.
 */
function takeEdgeSpacerCells(
  cells: GroupNode[][],
  closers: (GroupNode | null)[],
): [string | null, string | null] {
  const allSpacers = (cell: readonly GroupNode[] | undefined): boolean =>
    cell?.every((n) => n.type === "spacer") ?? false;
  const lead: string[] = [];
  while (allSpacers(cells[0])) {
    lead.push(...(cells.shift() as GroupNode[]).map((n) => n.content));
    closers.shift();
  }
  const trail: string[] = [];
  while (allSpacers(cells.at(-1))) {
    trail.unshift(...(cells.pop() as GroupNode[]).map((n) => n.content));
    closers.pop();
  }
  return [lead.join(" ") || null, trail.join(" ") || null];
}

/**
 * md2ui: `_as_cell`. One cell: the node itself when it is alone, else a plain wrapper.
 * A lone text the blank-line split will still divide keeps its wrapper: it is several
 * blocks of one side, and unwrapped they would land in the row as columns of their own.
 */
function asCell(nodes: GroupNode[]): GroupNode {
  const [only] = nodes;
  if (nodes.length === 1 && only !== undefined && !holdsBlocks(only)) return only;
  const cell = new GroupNode("", "group");
  cell.children = nodes;
  return cell;
}

/** md2ui: `_holds_blocks`. Whether `node` is a leaf text that a blank line still divides. */
function holdsBlocks(node: GroupNode): boolean {
  return node.type === "text" && node.children.length === 0 && strip(node.content).includes("\n\n");
}

/**
 * md2ui: `build_column_rows`. Consumes every `:::` under `node`, minting the rows
 * they describe. Top-down: the lift runs at this level before the children are visited.
 */
export function buildColumnRows(kit: RegexKit, node: GroupNode): void {
  liftDividers(kit, node);

  if (node.children.some(isDivider)) {
    // An empty marker stays ahead of the row rather than becoming a cell.
    const keep = markerPrefix(kit, node.children);
    const out = node.children.slice(0, keep);
    for (const [isCandidate, nodes] of segments(node.children.slice(keep))) {
      if (!isCandidate || !nodes.some(isDivider)) {
        out.push(...nodes.filter((n) => !isDivider(n)));
        continue;
      }
      const [cells, closers] = partition(nodes);
      // Rules alone after the last divider are no cell, as an empty run is none: they
      // paint under the row rather than becoming a column.
      let under: GroupNode[] = [];
      const lastCell = cells.at(-1);
      if (lastCell !== undefined && closers.at(-1) === null && lastCell.every(isRule)) {
        under = lastCell;
        cells.pop();
        closers.pop();
      }
      const [lead, trail] = takeEdgeSpacerCells(cells, closers);
      if (cells.length === 1 && (lead || trail)) {
        // One cell between spacer cells is that cell with space beside it, outside any
        // box it paints. Its own level holds the space while later phases split it.
        const only = new GroupNode("", "group");
        only.children = cells[0] as GroupNode[];
        only.spacer_lead = lead;
        only.spacer_trail = trail;
        only.spacer_beside = true;
        out.push(only, ...under);
        continue;
      }
      if (cells.length < 2) {
        // Dividers that partitioned nothing: drop them, keep the content (the rules
        // under it included, where they were written).
        out.push(...nodes.filter((n) => !isDivider(n)));
        continue;
      }
      const row = new GroupNode("", "group");
      row.column_row_group = true;
      describeRow(row, closers);
      row.children = cells.map(asCell);
      row.spacer_lead = lead;
      row.spacer_trail = trail;
      out.push(row, ...under);
    }
    node.children = out;
  }
  // Every `;;;` has bounded its row by now; one outside any row cut nothing.
  node.children = node.children.filter((c) => c.type !== "row_closer");

  for (const child of node.children) buildColumnRows(kit, child);
}

/**
 * md2ui: `build_item_rows`. Turns a list item's scoped `:::` and `...` back into
 * breaks and builds the row and regions they describe, inside the item. `stamp` reads
 * a `:::N` spelling back onto its node.
 */
export function buildItemRows(
  kit: RegexKit,
  item: GroupNode,
  stamp: (kit: RegexKit, node: GroupNode, line: string) => void,
): void {
  const isScoped = (node: GroupNode): boolean =>
    node.children.length === 0 && node.content.startsWith(ITEM_DIVIDER);

  // A divider inside a paragraph group still cuts the item: the paragraph opens up.
  item.children = item.children.flatMap((child) =>
    child.children.length > 0 && child.children.some(isScoped) ? child.children : [child],
  );
  let found = false;
  for (const child of item.children) {
    if (!isScoped(child)) continue;
    const spelling = child.content.slice(ITEM_DIVIDER.length);
    child.content = spelling;
    child.type = spelling === "..." ? "vertical_spring" : "column_divider";
    if (isDivider(child)) stamp(kit, child, spelling);
    found = true;
  }
  if (!found) return;
  // Glue never spans a cut: a piece of one line is no longer glued to anything.
  const pieces: GroupNode[][] = [[]];
  for (const child of item.children) {
    if (isDivider(child) || isSpring(child)) pieces.push([]);
    else pieces.at(-1)?.push(child);
  }
  for (const piece of pieces) {
    const only = piece[0];
    if (piece.length === 1 && only !== undefined) only.glued_content_id = null;
  }
  buildColumnRows(kit, item);
  // The row IS the item, as a ` - ` line is.
  const row = item.children[0];
  if (item.children.length === 1 && row !== undefined && row.column_row_group) {
    item.children = row.children;
    item.take_column_row(row);
  }
  // After the row: a spring inside a cell partitions that cell.
  buildVerticalSprings(item);
}

/**
 * md2ui: `row_flows`. A `:::` row with no weight and no cut written is a LINE spelled
 * across blocks: its cells flow and wrap like the pieces of a ` - ` line.
 */
export function rowFlows(row: GroupNode): boolean {
  return !(
    row.column_weights.some((w) => w !== null) ||
    row.column_weights_wide.length > 0 ||
    row.column_cuts.length > 0
  );
}

/** md2ui: `mark_row_pieces`. A flowing row's one-line text cells become SEGMENTs. */
export function markRowPieces(row: GroupNode): void {
  for (const cell of row.children) {
    if (cell.children.length === 0 && cell.type === "text") cell.type = "segment";
  }
}
