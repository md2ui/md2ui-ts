// `+++` spacers on the layout side: md2ui's `generator_spacers.py` (ADR-203). A spacer's
// size is the theme's step at the surface that holds it, a row wraps before its spacers
// give way, and a vertical spacer that landed between the cells of a row moves into the
// cell it belongs to. The builders that put spacer cells into a layout are in `leaves.ts`.
import type { ResolvedTheme, SectionStyle, SpacerKey } from "@md2ui/contracts";
import { GroupNode } from "../group/node.ts";
import { pySum } from "../group/py/math.ts";
import { split } from "../group/py/str.ts";
import { resolveSectionStyle } from "../theme/query.ts";
import { type LayoutNode, layoutNode } from "./node.ts";

type Step = "small" | "medium" | "large";
type Axis = "row" | "col";

/**
 * md2ui `SPACER_MULTIPLES`: what a spacer measures when no surface states it, as a
 * multiple of the group gap along its own direction. Across a line the steps sit closer
 * together, because a large jump in the middle of a line reads as a hole.
 */
export const SPACER_MULTIPLES: Readonly<Record<Axis, Readonly<Record<Step, number>>>> =
  Object.freeze({
    col: Object.freeze({ small: 1, medium: 2, large: 4 }),
    row: Object.freeze({ small: 1, medium: 1.5, large: 2 }),
  });

/**
 * md2ui `SPACER_FLOORS`: the least an unstated spacer measures, the multiples of the
 * default 8px gap, so a theme whose gaps are 0 still draws every written spacer.
 */
export const SPACER_FLOORS: Readonly<Record<Axis, Readonly<Record<Step, number>>>> = Object.freeze({
  col: Object.freeze({ small: 8, medium: 16, large: 32 }),
  row: Object.freeze({ small: 8, medium: 12, large: 16 }),
});

/** md2ui `_FALLBACK_GAP`: the group gap when a theme gives no gap at all to take one from. */
export const FALLBACK_GAP = 8;

/** md2ui `SPACER_STEPS`: a spelling's length is its step, `+++` small to `+++++` large. */
export const SPACER_STEPS: Readonly<Record<number, Step>> = Object.freeze({
  3: "small",
  4: "medium",
  5: "large",
});

/**
 * md2ui `_group_gap`: the group gap along `axis` at this surface: the heading level's own,
 * then `### Elements`', then the element gap, then 8. Without a theme, 8.
 */
export function groupGap(
  theme: ResolvedTheme | null,
  axis: Axis,
  section: SectionStyle | undefined,
): number {
  if (theme === null) return FALLBACK_GAP;
  const row = axis === "row";
  for (const st of [section, theme.elements]) {
    if (st === undefined) continue;
    const gap = row ? st.group_row_spacing : st.group_col_spacing;
    if (gap !== null) return gap;
  }
  // Python's `or`: an element gap of 0 also falls through to 8.
  return (row ? theme.elements.row_spacing : theme.elements.col_spacing) || FALLBACK_GAP;
}

/**
 * md2ui `spacer_size`: the px a spacer of `step` measures along `axis`. The nearest
 * surface that states the step decides (the image-card block for a spacer inside a photo
 * card, then the heading level that owns it, then the root), `Spacer <step> <axis>`
 * beating plain `Spacer <step>` within one surface; otherwise a multiple of the group gap,
 * never less than its floor.
 */
export function spacerSize(
  theme: ResolvedTheme | null,
  step: Step,
  axis: Axis,
  level: number,
  fixedStyleKey: string | null = null,
  inImageCard = false,
): number {
  const surfaces: { spacers: Readonly<Partial<Record<SpacerKey, number>>> }[] = [];
  let sec: SectionStyle | undefined;
  if (theme !== null) {
    if (inImageCard) surfaces.push(theme.image_cards);
    if (level) {
      sec = resolveSectionStyle(theme, level, fixedStyleKey);
      if (sec !== undefined) surfaces.push(sec);
    }
    surfaces.push(theme.root);
  }
  for (const st of surfaces) {
    const size = st.spacers[`${step} ${axis}`] ?? st.spacers[step];
    if (size !== undefined) return size;
  }
  return Math.max(
    SPACER_MULTIPLES[axis][step] * groupGap(theme, axis, sec),
    SPACER_FLOORS[axis][step],
  );
}

/**
 * md2ui `spacer_props`: the `spacer` render property of one spacer leaf, its size
 * resolved. `spelling` holds every mark the spacer was written as (`+++ ++++` for two in
 * a row) and its size is the sum of their steps.
 */
export function spacerProps(
  theme: ResolvedTheme | null,
  spelling: string,
  axis: Axis,
  level: number,
  fixedStyleKey: string | null,
  inImageCard: boolean,
  binds: string | null = null,
): { axis: Axis; size: number; binds: string | null } {
  const size = pySum(
    split(spelling).map((mark) =>
      spacerSize(
        theme,
        SPACER_STEPS[[...mark].length] ?? "small",
        axis,
        level,
        fixedStyleKey,
        inImageCard,
      ),
    ),
  );
  return { axis, size, binds };
}

/** A layout leaf's `spacer` render property, empty when it is not a spacer. */
function spacerOf(n: LayoutNode): { axis?: unknown; binds?: unknown } {
  return (n.render_properties?.["spacer"] as { axis?: unknown; binds?: unknown } | null) ?? {};
}

/** Vertical only: a horizontal spacer is a cell of its row. */
function isVerticalSpacer(n: LayoutNode): boolean {
  return n.type === "-" && spacerOf(n).axis === "col";
}

/**
 * md2ui `_stack`: `cell` with `before` / `after` spacers stacked around its content,
 * in place when it is a column, else wrapped in a new one.
 */
function stack(cell: LayoutNode, before: LayoutNode[], after: LayoutNode[]): LayoutNode {
  if (cell.type === "col") {
    cell.children = [...before, ...cell.children, ...after];
    cell.ratios = cell.children.map(() => 1);
    return cell;
  }
  const kids = [...before, cell, ...after];
  return layoutNode(
    "col",
    kids.map(() => 1),
    kids,
  );
}

/**
 * md2ui `fold_row_spacers`: move every vertical spacer that landed as a cell of a row into
 * the cell it binds to (`binds: "prev"`, the cell before it; otherwise the cell after it,
 * and the trailing ones into the last cell), stacked with that cell's content, since a
 * spacer is space inside a cell and never a column of its own. Bottom-up, in place. A row
 * of nothing but spacers has no cell to fold them into and stays as written; a child with
 * no ratio of its own takes the default share.
 */
export function foldRowSpacers(layout: LayoutNode): void {
  for (const child of layout.children) foldRowSpacers(child);
  if (layout.type !== "row") return;
  if (!layout.children.some(isVerticalSpacer)) return;
  if (layout.children.every(isVerticalSpacer)) return;

  const cells: LayoutNode[] = [];
  const ratios: number[] = [];
  let pending: LayoutNode[] = [];
  layout.children.forEach((child, i) => {
    if (isVerticalSpacer(child)) {
      const last = cells.length - 1;
      if (spacerOf(child).binds === "prev" && last >= 0) {
        cells[last] = stack(cells[last] as LayoutNode, [], [child]);
      } else {
        pending.push(child);
      }
      return;
    }
    cells.push(pending.length > 0 ? stack(child, pending, []) : child);
    ratios.push(layout.ratios[i] ?? 1);
    pending = [];
  });
  // Not all spacers, so some cell exists.
  const last = cells.length - 1;
  if (pending.length > 0) cells[last] = stack(cells[last] as LayoutNode, [], pending);
  layout.children = cells;
  layout.ratios = ratios;
}

/**
 * md2ui `spacer_cell`: the piece an inline spacer becomes in its line, a spacer marked
 * as a row gap by `separator_kind`. It takes the spring alignment of the piece it
 * belongs to (`beside`); an `edge` spacer is the line's own and stays where the line
 * starts or ends.
 */
export function spacerCell(
  spelling: string,
  beside: GroupNode | null = null,
  edge = false,
): GroupNode {
  const cell = new GroupNode(spelling, "spacer");
  cell.separator_kind = "spacer";
  cell.spacer_binds = edge ? "edge" : null;
  if (beside !== null) cell.authored_align = beside.authored_align;
  return cell;
}

/**
 * md2ui `holds`: whether `node`'s spacers hold it, so it narrows to its own minimum
 * before they give way: a block between two spacers, and one beside a spacer cell, which
 * takes its room as the leaf cell it stands for would.
 */
export function holds(node: GroupNode): boolean {
  if (node.children.length === 0) return false;
  return node.spacer_beside || Boolean(node.spacer_lead && node.spacer_trail);
}

/**
 * md2ui `line_ask`: the width `cell` asks for beside other cells on a line: its minimum,
 * and for every line inside it that minimum with its spacers across at full size.
 */
export function lineAsk(
  cell: GroupNode,
  minOf: (n: GroupNode) => number,
  sizeOf: (spelling: string) => number,
): number {
  const across = (n: GroupNode): number => {
    const marks = [n.spacer_lead, n.spacer_trail];
    for (const c of n.children) if (c.separator_kind === "spacer") marks.push(c.content);
    return pySum(marks.filter((m): m is string => Boolean(m)).map(sizeOf));
  };
  let ask = minOf(cell);
  const stack = [cell];
  while (stack.length > 0) {
    const n = stack.pop() as GroupNode;
    const spaced = across(n);
    if (spaced) ask = Math.max(ask, minOf(n) + spaced);
    stack.push(...n.children.filter((c) => c.type !== "spacer"));
  }
  return ask;
}

/**
 * md2ui `short_of_room`: whether a row of `items` holding spacers has no room for them
 * at `width` (the renderer's give-way test). `askOf` is what a piece needs beside a
 * spacer; in a weighted row every weighted cell must keep that ask at its share.
 */
export function shortOfRoom(
  items: readonly GroupNode[],
  width: number,
  askOf: (n: GroupNode) => number,
  gapOf: (a: GroupNode, b: GroupNode) => number,
  weights: readonly number[] | null = null,
): boolean {
  const gaps = pySum(items.slice(1).map((item, i) => gapOf(items[i] as GroupNode, item)));
  const asks = items.map(askOf);
  if (weights === null) {
    return gaps + pySum(asks) > width;
  }
  // Python's `zip`: the shorter of the two decides.
  const n = Math.min(asks.length, weights.length);
  const held: number[] = [];
  const total = pySum(weights) || 1;
  let share = 0;
  let first = true;
  for (let i = 0; i < n; i++) {
    const a = asks[i] as number;
    const w = weights[i] as number;
    if (!w) {
      held.push(a);
      continue;
    }
    const s = (a * total) / w;
    if (first || s > share) share = s;
    first = false;
  }
  return gaps + pySum(held) + share > width;
}

/**
 * md2ui `trim_row_edges`: the flowed rows of one line with the gaps they wrapped at taken
 * out (a separator or spacer between pieces exists only between neighbours; a line's own
 * edge spacer stays). A row left with nothing but spacers is dropped.
 */
export function trimRowEdges(
  batches: readonly (readonly [GroupNode[], number[]])[],
): [GroupNode[], number[]][] {
  const gap = (n: GroupNode): boolean => n.separator_kind !== null && n.spacer_binds !== "edge";
  const blank = (n: GroupNode): boolean => n.separator_kind === "spacer";
  const out: [GroupNode[], number[]][] = [];
  for (const [batch, widths] of batches) {
    let lo = 0;
    let hi = batch.length;
    while (lo < hi && gap(batch[lo] as GroupNode)) lo += 1;
    while (hi > lo && gap(batch[hi - 1] as GroupNode)) hi -= 1;
    const kept = batch.slice(lo, hi);
    if (kept.length > 0 && !kept.every(blank)) out.push([kept, widths.slice(lo, hi)]);
  }
  return out;
}
