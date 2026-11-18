// What a grouper node is as a layout unit, and how wide it must be: the node-reading
// half of md2ui's `generator_units.py` (`_unit_padding_x`, `_is_pure_element_group`,
// `_is_key_unit`, `_flows_as_line`, `_cell_gap`, `_col_gap`, `_length_category`,
// `kv_role_map`, `_stacked_table_min`, `_measured_min_width`, `_min_width`,
// `_section_level`, `_level_runs`, `_auto_bento_level`, `_is_group`, `_is_leaf`,
// `_is_marked_line`). None of it decides an arrangement; the generator reasons with
// these numbers and tests.
//
// Also the flow's gaps (`_batch_width`, `_flow_pair_gap`, `_row_pair_gap`) and the
// font-free height estimate the grids rank a kind's sample by (`_estimate_cell_height`).
import type { ResolvedTheme, SectionStyle } from "@md2ui/contracts";
import { structuralKind } from "../group/annotate.ts";
import { rowFlows } from "../group/column-rows.ts";
import { type GroupNode, HEADING_TYPE_RE } from "../group/node.ts";
import { pySum } from "../group/py/math.ts";
import type { RegexKit } from "../group/py/re.ts";
import {
  paddingX,
  resolveSectionSpacing,
  resolveSectionStyle,
  sectionIsActive,
} from "../theme/query.ts";
import { markerGutterX } from "./markers.ts";
import type { KvRole } from "./measurer.ts";
import {
  BENTO_EST_GAP,
  BENTO_EST_LINE_H,
  BENTO_EST_LINE_PX,
  BENTO_MIN_CELLS,
  groupSpacing,
  IMAGE_MIN_WIDTH,
  LEAF_WIDTH,
  tableCellPaddingX,
  tableColGap,
} from "./units.ts";
import { defaultImageRatio } from "./url-hints.ts";

/** md2ui `TABLE_KEY_COL_MAX_SHARE`: the most of a stacked card a key label may take. */
const TABLE_KEY_COL_MAX_SHARE = 0.4;

/** md2ui `_is_group`: a node with children and no content of its own. */
export function isGroup(node: GroupNode): boolean {
  return !node.content && node.children.length > 0;
}

/** md2ui `_is_leaf`: a node with content and no children. */
export function isLeaf(node: GroupNode): boolean {
  return node.children.length === 0 && Boolean(node.content);
}

/** md2ui `_length_category`: the node's own length category, else its cluster's. */
export function lengthCategory(node: GroupNode): string | null {
  return node.content_length_category || node.text_length_category;
}

/** md2ui `_section_level`: the heading level of a heading SECTION, else `null`. */
export function sectionLevel(node: GroupNode): number | null {
  return node.heading_group && node.heading_level !== null ? node.heading_level : null;
}

/** The `### <Lists>` style a structural background kind paints with (md2ui `getattr(theme, f"{kind}s")`). */
function structuralStyle(kind: string, theme: ResolvedTheme): SectionStyle {
  switch (kind) {
    case "unordered_list":
      return theme.unordered_lists;
    case "task_list":
      return theme.task_lists;
    case "numbered_list":
      return theme.numbered_lists;
    default:
      return theme.quotes;
  }
}

/**
 * md2ui `_unit_padding_x`: the horizontal padding a unit's own outermost wraps take (its
 * card, its section, its list or quote surface), summed. A photo card is wrapped as an
 * image card, whose own `### Image Cards` padding its overlay sits inside.
 */
export function unitPaddingX(node: GroupNode, theme: ResolvedTheme): number {
  let pad = 0;
  if (node.card_bg_url !== null) {
    const cards = sectionIsActive(theme.image_cards) ? theme.image_cards : theme.elements;
    pad += paddingX(cards.padding);
  } else if (node.glued_content_group) pad += paddingX(theme.elements.padding);
  if (node.heading_group && node.heading_level !== null) {
    const st = resolveSectionStyle(theme, node.heading_level, node.fixed_style_key);
    if (st !== undefined) pad += paddingX(st.padding);
  }
  const kind = structuralKind(node.type);
  if (kind !== null) {
    let style = structuralStyle(kind, theme);
    if (kind === "task_list" && !sectionIsActive(style)) style = theme.unordered_lists;
    pad += paddingX(style.padding);
  }
  return pad;
}

/**
 * md2ui `_is_pure_element_group`: a group whose every leaf is an element (≥ 1), the
 * grouper's `pure_element` stamp.
 */
export function isPureElementGroup(node: GroupNode): boolean {
  return node.pure_element;
}

/** md2ui `_is_key_unit`: a key leaf, or a group whose every leaf is a key (the `key_side` stamp). */
function isKeyUnit(node: GroupNode): boolean {
  if (node.children.length === 0) return Boolean(node.content) && node.type === "key";
  return node.key_side;
}

/** md2ui `_flows_as_line`: a flowing `:::` row that is a line toward its neighbours. */
function flowsAsLine(unit: GroupNode): boolean {
  return (
    unit.column_row_group && rowFlows(unit) && !unit.children.every((c) => c.children.length > 0)
  );
}

/**
 * md2ui `_cell_gap`: the gap the renderer puts between siblings of this unit kind on
 * `axis`: the enclosing level's section spacing for a section, the element gap for a
 * line, a key or a pure element group, else the group gap.
 */
export function cellGap(
  kit: RegexKit,
  unit: GroupNode,
  theme: ResolvedTheme,
  axis: "row" | "col",
  ownerLevel: number,
  ownerKey: string | null,
): number {
  if (unit.heading_group && unit.heading_level !== null) {
    // The owner's fixed style, not the unit's own (see `fillContainerLevels`).
    return resolveSectionSpacing(ownerLevel, axis, theme, ownerKey);
  }
  if (
    ((unit.line_split_group || flowsAsLine(unit)) &&
      !unit.glued_content_group &&
      kit.re(HEADING_TYPE_RE).match(unit.type) === null) ||
    isKeyUnit(unit) ||
    isPureElementGroup(unit)
  ) {
    return (axis === "row" ? theme.elements.row_spacing : theme.elements.col_spacing) || 0;
  }
  return groupSpacing(axis === "row", theme);
}

/** md2ui `_col_gap`: the row-axis gap between adjacent columns of this unit kind. */
export function colGap(
  kit: RegexKit,
  unit: GroupNode,
  theme: ResolvedTheme,
  ownerLevel: number,
  ownerKey: string | null,
): number {
  return cellGap(kit, unit, theme, "row", ownerLevel, ownerKey);
}

/** Node types a K-V role never reaches: they draw as something other than text. */
const KV_ROLE_ELEMENTS: readonly string[] = Object.freeze([
  "link",
  "image",
  "emoji",
  "inline_code",
  "code_block",
  "drawing_element",
]);

/**
 * md2ui `kv_role_map`: every node the theme's `Key` / `Value` text style covers, with
 * its role (its nearest key or value ancestor's). Empty unless the theme authored the
 * blocks. md2ui keys it by `node_id` and skips a node without one; here it is keyed by
 * the node, with the same skip.
 */
export function kvRoleMap(root: GroupNode, theme: ResolvedTheme): Map<GroupNode, KvRole> {
  const wantKey = theme.key_style !== null;
  const wantValue = theme.value_style !== null;
  const out = new Map<GroupNode, KvRole>();
  if (!(wantKey || wantValue)) return out;
  const walk = (node: GroupNode, inherited: KvRole | null): void => {
    let role = inherited;
    if (node.type === "key") role = wantKey ? "key" : null;
    else if (node.type === "value") role = wantValue ? "value" : null;
    if (role !== null && !KV_ROLE_ELEMENTS.includes(node.type)) {
      if (node.datapoint_display === null && node.node_id) out.set(node, role);
    }
    for (const child of node.children) walk(child, role);
  };
  walk(root, null);
  return out;
}

/**
 * What a min-width question needs besides the node: md2ui's `measure_width`, `theme`,
 * per-call `cache` and `kv_roles` arguments, bound together. `leafMin` is the leaf
 * measurer, `null` where nothing constrains the leaf.
 */
export interface MinWidthScope {
  readonly theme: ResolvedTheme;
  readonly leafMin: (node: GroupNode, role: KvRole | null) => number | null;
  readonly cache: Map<GroupNode, number>;
  readonly kvRoles: ReadonlyMap<GroupNode, KvRole>;
}

const isTableRowType = (type: string): boolean => type === "table_header" || type === "table_row";

/**
 * md2ui `_stacked_table_min`: how narrow a table may go once `Stacking cards` turns
 * each row into a card: the widest value beside the capped key column, or the title
 * cell alone, plus the card padding; `null` with no body row.
 */
function stackedTableMin(node: GroupNode, scope: MinWidthScope): number | null {
  const tt = scope.theme.tables;
  const rows = node.children.filter((c) => c.type === "table_row");
  if (rows.length === 0) return null;
  const title = tt.card_layout === "title";
  let valueMin = 0;
  let firstMin = 0;
  for (const r of rows) {
    r.children.forEach((cell, j) => {
      const m = measuredMinWidth(cell, scope, true);
      if (title && j === 0) firstMin = Math.max(firstMin, m);
      else valueMin = Math.max(valueMin, m);
    });
  }
  const denom = Math.max(0.1, 1 - TABLE_KEY_COL_MAX_SHARE);
  const inner = valueMin > 0 ? (tt.key_spacing + valueMin) / denom : 0;
  return Math.max(inner, firstMin) + paddingX(tt.cells.padding);
}

/**
 * md2ui `_measured_min_width`: the widest unbreakable unit in `node`'s subtree (a whole
 * pill, a single word, a table's summed column minima), with each descendant's own wrap
 * padding on the path. `stackedTables` asks for the page floor, where a stacking table
 * needs only a card's width. Memoised per node in `scope.cache`; a cache serves one
 * value of `stackedTables` only, as every caller here uses one.
 */
export function measuredMinWidth(
  node: GroupNode,
  scope: MinWidthScope,
  stackedTables = false,
): number {
  const { theme, cache } = scope;
  const role = node.node_id ? (scope.kvRoles.get(node) ?? null) : null;
  const hit = cache.get(node);
  if (hit !== undefined) return hit;
  let result: number;
  if (node.table_group && node.children.some((c) => isTableRowType(c.type))) {
    const stacked = stackedTables && theme.tables.stacking ? stackedTableMin(node, scope) : null;
    if (stacked !== null) {
      result = stacked;
    } else {
      const gap = tableColGap(theme);
      const rows = node.children.filter((c) => isTableRowType(c.type));
      const nCols = Math.max(...rows.map((r) => r.children.length));
      const colMins = new Array<number>(nCols).fill(0);
      for (const r of rows) {
        r.children.forEach((cell, j) => {
          colMins[j] = Math.max(
            colMins[j] as number,
            measuredMinWidth(cell, scope, stackedTables) +
              tableCellPaddingX(cell.table_role, theme),
          );
        });
      }
      result = pySum(colMins) + Math.max(0, nCols - 1) * gap;
    }
    for (const c of node.children) {
      if (!isTableRowType(c.type)) {
        result = Math.max(
          result,
          measuredMinWidth(c, scope, stackedTables) + unitPaddingX(c, theme),
        );
      }
    }
  } else if (isTableRowType(node.type)) {
    const gap = tableColGap(theme);
    result =
      pySum(
        node.children.map(
          (c) => measuredMinWidth(c, scope, stackedTables) + tableCellPaddingX(c.table_role, theme),
        ),
      ) +
      Math.max(0, node.children.length - 1) * gap;
  } else if (node.children.length > 0) {
    result = 0;
    let first = true;
    for (const c of node.children) {
      const w = measuredMinWidth(c, scope, stackedTables) + unitPaddingX(c, theme);
      // Python's `max(generator, default=0.0)`: the first of equals.
      if (first || w > result) result = w;
      first = false;
    }
  } else {
    result = scope.leafMin(node, role) || 0;
    if (stackedTables && node.type === "code_block") {
      result = Math.min(result, theme.code_blocks.min_width);
    }
  }
  const dp = theme.datapoints;
  if (
    node.datapoint_display === "unit_ratio" &&
    dp.unit_ratio_enabled &&
    dp.unit_ratio_style === "ring"
  ) {
    result = Math.max(result, dp.ring.diameter);
  }
  cache.set(node, result);
  return result;
}

/**
 * md2ui `_min_width`: the least width `node` renders in without compression: its
 * length category's `LEAF_WIDTH` (a code block's 0; `Infinity` for a long paragraph or
 * no category), floored at its measured minimum, plus its own wrap padding and marker
 * gutter. An image's is its authored `min_width`, which the measurer reports, else
 * `IMAGE_MIN_WIDTH`: an authored floor replaces the default, lower or higher.
 */
export function minWidth(node: GroupNode, scope: MinWidthScope): number {
  let base: number;
  if (node.type === "image" || node.type === "code_block") base = 0;
  else {
    const w = LEAF_WIDTH[lengthCategory(node) ?? ""];
    if (w === undefined) return Number.POSITIVE_INFINITY;
    base = w;
  }
  base = Math.max(base, measuredMinWidth(node, scope));
  // No authored floor was measured: the default stands.
  if (node.type === "image" && base === 0) base = IMAGE_MIN_WIDTH;
  return base + unitPaddingX(node, scope.theme) + markerGutterX(node, scope.theme);
}

/**
 * md2ui `_level_runs`: per heading level, the longest contiguous run of sections at that
 * level under one parent, over the whole subtree.
 */
function levelRuns(node: GroupNode, best: Map<number, number>): void {
  let runLevel: number | null = null;
  let runLen = 0;
  for (const child of node.children) {
    const lvl = sectionLevel(child);
    if (lvl !== null && lvl === runLevel) runLen += 1;
    else {
      runLevel = lvl;
      runLen = lvl !== null ? 1 : 0;
    }
    if (runLevel !== null) best.set(runLevel, Math.max(best.get(runLevel) ?? 0, runLen));
    levelRuns(child, best);
  }
}

/**
 * md2ui `_bento_runs`: the `[start, end)` runs of `level` sections among `node`'s
 * children long enough to tile; none when no level tiles.
 */
export function bentoRuns(level: number | null, node: GroupNode): [number, number][] {
  const runs: [number, number][] = [];
  if (level === null) return runs;
  let start: number | null = null;
  node.children.forEach((child, i) => {
    if (sectionLevel(child) === level) {
      start ??= i;
    } else if (start !== null) {
      if (i - start >= BENTO_MIN_CELLS) runs.push([start, i]);
      start = null;
    }
  });
  if (start !== null && node.children.length - start >= BENTO_MIN_CELLS) {
    runs.push([start, node.children.length]);
  }
  return runs;
}

/**
 * md2ui `_auto_bento_level`: the shallowest heading level with a contiguous run of at
 * least `BENTO_MIN_CELLS` sections under one parent, or `null`.
 */
export function autoBentoLevel(root: GroupNode): number | null {
  const best = new Map<number, number>();
  levelRuns(root, best);
  const levels = [...best.keys()].sort((a, b) => a - b);
  return levels.find((lvl) => (best.get(lvl) ?? 0) >= BENTO_MIN_CELLS) ?? null;
}

/**
 * md2ui `_is_marked_line`: an item of one piece besides its drawn marker, which stacks
 * as the one-piece item `- text` does.
 */
export function isMarkedLine(node: GroupNode): boolean {
  const pieces = node.children.filter((c) => !c.drawing_element?.["marker"]);
  return pieces.length === 1 && (pieces[0] as GroupNode).children.length === 0;
}

/**
 * md2ui `_flow_pair_gap`: the gap the renderer puts between two adjacent pieces of one
 * flowed line: the element gap beside a drawn separator or between two element-ish
 * pieces (leaves, pure-pill blocks, a key side), the group gap beside a block.
 */
export function flowPairGap(prev: GroupNode, cur: GroupNode, theme: ResolvedTheme): number {
  const element = theme.elements.row_spacing || 0;
  const drawn = (n: GroupNode): boolean =>
    n.separator_kind !== null && n.separator_kind !== "spacer";
  if (drawn(prev) || drawn(cur)) return element;
  const elementish = (n: GroupNode): boolean =>
    n.children.length === 0 || isPureElementGroup(n) || isKeyUnit(n);
  if (elementish(prev) && elementish(cur)) return element;
  return groupSpacing(true, theme);
}

/**
 * md2ui `_batch_width`: what one flow batch occupies, its pieces plus the gaps between
 * them (two of Python's compensated sums, added, in md2ui's order).
 */
export function batchWidth(
  items: readonly GroupNode[],
  widths: readonly number[],
  theme: ResolvedTheme,
): number {
  const gaps: number[] = [];
  for (let i = 1; i < items.length; i++) {
    gaps.push(flowPairGap(items[i - 1] as GroupNode, items[i] as GroupNode, theme));
  }
  return pySum(widths) + pySum(gaps);
}

/**
 * md2ui `_row_pair_gap`: the gap between two items of a weighted `:::` row: as in a line
 * beside a gap cell (a spacer, a drawn separator), as columns between two cells.
 */
export function rowPairGap(
  kit: RegexKit,
  prev: GroupNode,
  cur: GroupNode,
  theme: ResolvedTheme,
  ownerLevel: number,
  ownerKey: string | null,
): number {
  if (prev.separator_kind !== null || cur.separator_kind !== null) {
    return flowPairGap(prev, cur, theme);
  }
  return colGap(kit, cur, theme, ownerLevel, ownerKey);
}

/**
 * md2ui `_estimate_cell_height`: a font-free height of `node` at `width`: per text leaf
 * its category's line count at a nominal line height, per image the default image box,
 * with a nominal gap between leaves. Ranks a large kind's tallest members.
 */
export function estimateCellHeight(node: GroupNode, width: number): number {
  const w = Math.max(width, 1);
  let total = 0;
  let count = 0;
  const walk = (n: GroupNode): void => {
    if (n.children.length > 0) {
      for (const c of n.children) walk(c);
      return;
    }
    if (!n.content) return;
    let h: number;
    if (n.type === "image") h = w / defaultImageRatio(w);
    else {
      const px = BENTO_EST_LINE_PX[lengthCategory(n) ?? ""] ?? 300;
      h = Math.max(1, Math.ceil(px / w)) * BENTO_EST_LINE_H;
    }
    total += h;
    count += 1;
  };
  walk(node);
  return total + Math.max(0, count - 1) * BENTO_EST_GAP;
}
