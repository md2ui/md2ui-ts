// Which cells of a `:::` row stand side by side at the width it is offered: md2ui's
// `generator_column_cuts.py`. A divider may cut in narrow space only (`::: 1 <`), in wide
// space only (`::: 1 >`), or write a second weight for wide space (`::: 1 1.5`); where a
// cut does not apply, the cells either side of it stand as one cell, stacked.
import { stampGroupKinds } from "../group/annotate.ts";
import { GroupNode } from "../group/node.ts";
import { lengthCategory } from "./node-units.ts";
import { IMAGE_MIN_WIDTH, LEAF_WIDTH } from "./units.ts";
import { WIDE_BREAKPOINT } from "./url-hints.ts";

/**
 * md2ui `row_groups`: the cell indices of `row` that stand together at `width`, in
 * order, and the weight written for each group (`null`: no number).
 */
export function rowGroups(
  row: GroupNode,
  count: number,
  width: number,
): [groups: number[][], written: (number | null)[]] {
  const wide = width >= WIDE_BREAKPOINT;
  let weights: (number | null)[] = [...row.column_weights];
  if (wide && row.column_weights_wide.length > 0) {
    // Python's `zip`: the shorter of the two decides.
    const n = Math.min(weights.length, row.column_weights_wide.length);
    weights = weights.slice(0, n).map((w, i) => row.column_weights_wide[i] ?? w);
  }
  while (weights.length < count) weights.push(null);
  const cuts = [...row.column_cuts, ...new Array<null>(count).fill(null)];
  const here = wide ? "wide" : "narrow";
  const groups: number[][] = [[]];
  const written: (number | null)[] = [];
  for (let i = 0; i < count; i++) {
    (groups[groups.length - 1] as number[]).push(i);
    const cut = cuts[i] ?? null;
    if (i === count - 1 || cut === null || cut === here) {
      written.push(weights[i] ?? null);
      if (i < count - 1) groups.push([]);
    }
  }
  return [groups, written];
}

/**
 * md2ui `group_gaps`: the row's gaps (`separator_chars`) between `groups`: the gap after
 * a group's last cell stays between it and the next.
 */
export function groupGaps(row: GroupNode, groups: readonly (readonly number[])[]): string[] {
  const chars = row.separator_chars;
  if (chars.length === 0) return [];
  return groups.slice(0, -1).map((g) => {
    const last = g[g.length - 1] as number;
    return last < chars.length ? (chars[last] as string) : "";
  });
}

/**
 * md2ui `stack_category`: the length category of cells standing as one: the narrowest
 * as wide as the widest of them, or `null` (no bound) when a member has none.
 */
function stackCategory(members: readonly GroupNode[]): string | null {
  let widest = 0;
  for (const m of members) {
    const w = m.type === "image" ? IMAGE_MIN_WIDTH : LEAF_WIDTH[lengthCategory(m) ?? ""];
    if (w === undefined) return null;
    widest = Math.max(widest, w);
  }
  let best: string | null = null;
  for (const [c, w] of Object.entries(LEAF_WIDTH)) {
    if (w >= widest && (best === null || w < (LEAF_WIDTH[best] as number))) best = c;
  }
  return best;
}

/**
 * md2ui `stack_of`: a wrapper for the cells of `group`, standing as one cell whose
 * minimum width is its widest member's. md2ui mints it the id `"<first cell's id>~"`;
 * nothing here reads a wrapper's id, so it keeps none.
 */
export function stackOf(cells: readonly GroupNode[], group: readonly number[]): GroupNode {
  const stack = new GroupNode("", "group");
  stack.children = group.map((i) => cells[i] as GroupNode);
  stack.content_length_category = stackCategory(
    stack.children,
  ) as GroupNode["content_length_category"];
  stampGroupKinds(stack);
  return stack;
}
