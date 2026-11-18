// Stacking a node's children in document order, gridding its repeated runs and flowing
// its one-line runs: md2ui's `_build_grouped`, with the `Stack sections` eligibility
// tests it and the router share (`_packs_any_unique`, `_packs_unique`,
// `_is_titled_section`, `_deep_last`). The packing itself is `pack.ts`'s; bento's
// mosaics arrive built, in `packed`.
import { ELEMENT_LEAF_TYPES, type GroupNode, HEADING_TYPE_RE } from "../group/node.ts";
import { strip } from "../group/py/str.ts";
import { balanceCols, runAspectCap } from "./aspect.ts";
import { stackedLines } from "./fit-votes.ts";
import { flowRows } from "./flow.ts";
import { gridRows } from "./grid.ts";
import { colsForUnit, kindCols } from "./grid-fit.ts";
import { lineItemWidth } from "./line-pieces.ts";
import { type LayoutNode, layoutNode } from "./node.ts";
import { isGroup, isMarkedLine, sectionLevel } from "./node-units.ts";
import { packSections } from "./pack.ts";
import type { Run } from "./run.ts";
import { unifyRun, unifyRunRender, unitMinFor } from "./run-poll.ts";

/** md2ui `_LIST_ITEM_TYPES`: list items, whose runs of one-line items grid like groups. */
const LIST_ITEM_TYPES: readonly string[] = Object.freeze([
  "list_item",
  "ordered_item",
  "task_open",
  "task_done",
]);

/** Every member of `node`'s same-kind runs. */
function repeatedMembers(node: GroupNode): Set<GroupNode> {
  const repeated = new Set<GroupNode>();
  for (const bucket of node.repeated_children?.values() ?? []) {
    for (const n of bucket) repeated.add(n);
  }
  return repeated;
}

/** How many distinct `source_line_id`s a run's members carry. */
function lineCount(members: readonly GroupNode[]): number {
  return new Set(members.map((m) => m.source_line_id)).size;
}

/**
 * md2ui `_build_grouped`: `node`'s children in a col, in document order. A lone child
 * renders full width (an orphan member at its kind's card width, a run of packable
 * sections side by side); a same-kind run flows when it is one line's elements or
 * pieces, stacks when it is several lines of them or a run of leaves, and grids when it
 * is a run of groups: its members poll (`_unify_run`), its unit is measured under the
 * outcome, and its column count is the kind's shared one or its own fit, aspect cap and
 * fill rule. `packed` maps a child index to a layout already built for the children up
 * to an end index (bento's mosaics), which takes their place.
 */
export function buildGrouped(
  run: Run,
  node: GroupNode,
  width: number,
  inGlued: boolean,
  ownerLevel: number,
  packed: ReadonlyMap<number, readonly [LayoutNode, number]> = new Map(),
): LayoutNode {
  const repeated = repeatedMembers(node);
  const sections: LayoutNode[] = [];
  const kids = node.children;
  const n = kids.length;
  const stack = (members: readonly GroupNode[]): void => {
    for (const c of members) sections.push(run.renderChild(run, c, width, inGlued, ownerLevel));
  };
  const lineWidth = (c: GroupNode): number => lineItemWidth(run, c, width);
  let i = 0;
  while (i < n) {
    const mosaic = packed.get(i);
    if (mosaic !== undefined) {
      sections.push(mosaic[0]);
      i = mosaic[1];
      continue;
    }
    const child = kids[i] as GroupNode;
    if (!repeated.has(child)) {
      // An orphaned member of a kind its siblings grid: one cell at their card width.
      if (child.orphan_grid && isGroup(child)) {
        const ocols = kindCols(run, child, width, ownerLevel) || 1;
        if (ocols > 1) {
          sections.push(...gridRows(run, [child], width, ocols, inGlued, ownerLevel));
          i += 1;
          continue;
        }
      }
      let j = i;
      while (j < n && !packed.has(j) && packsUnique(run, kids[j] as GroupNode, repeated)) j += 1;
      if (j - i >= 2) {
        sections.push(...packSections(run, kids.slice(i, j), width, inGlued, ownerLevel));
        i = j;
        continue;
      }
      stack([child]);
      i += 1;
      continue;
    }
    const key = child.run_key;
    let j = i + 1;
    while (
      j < n &&
      !packed.has(j) &&
      repeated.has(kids[j] as GroupNode) &&
      (kids[j] as GroupNode).run_key === key
    ) {
      j += 1;
    }
    const members = kids.slice(i, j);
    const head = members[0] as GroupNode;
    // A run of one line's elements flows; spread over several lines it is a list.
    if (ELEMENT_LEAF_TYPES.includes(head.type) && lineCount(members) === 1) {
      sections.push(
        ...flowRows(run, members, width, inGlued, ownerLevel, {
          widthOf: lineWidth,
          lineSplit: true,
        }),
      );
      i = j;
      continue;
    }
    const sameLine = lineCount(members) === 1;
    const vote = 2 * members.filter((m) => m.align_group).length - members.length;
    const springs = vote > 0 || (vote === 0 && head.align_group);
    const line = springs || isMarkedLine(head);
    if (
      isGroup(head) &&
      head.line_split_group &&
      (sameLine || line || !LIST_ITEM_TYPES.includes(head.type))
    ) {
      if (sameLine) {
        sections.push(
          ...flowRows(run, members, width, inGlued, ownerLevel, {
            widthOf: lineWidth,
            // A run of carded line groups emits rows of cards, which space as cards.
            lineSplit: !head.glued_content_group,
          }),
        );
      } else {
        // List rows share their pictures' params like any run (md2ui `shares_params`).
        if (LIST_ITEM_TYPES.includes(head.type)) unifyRunRender(run, members, width);
        // One wraps, all wrap (ADR-301): the lines poll their breaks.
        sections.push(
          ...stackedLines(run.fitPolls, members, (c) =>
            run.renderChild(run, c, width, inGlued, ownerLevel),
          ),
        );
      }
      i = j;
      continue;
    }
    let cols = 1;
    if (isGroup(head)) {
      // Poll, then measure, then grid. Heading sections are built at their own level, so
      // the poll asks there; a run that mixes levels keeps its container's.
      const levels = new Set(members.map((m) => (m.heading_group ? m.heading_level : null)));
      const [only] = levels;
      const built = (levels.size === 1 ? only : null) || ownerLevel;
      const asides = unifyRun(run, members, built, width);
      const unitMin = unitMinFor(run, members, asides, built);
      const shared = kindCols(run, head, width, ownerLevel, unitMin);
      if (shared !== null) cols = shared;
      else {
        cols = colsForUnit(run, head, width, members, ownerLevel, unitMin);
        if (cols > 1) cols = runAspectCap(run, members, cols, width, ownerLevel);
        // The fill rule last: the aspect cap can strand the row it just cleared.
        cols = balanceCols(cols, members.length);
      }
    }
    if (cols > 1) sections.push(...gridRows(run, members, width, cols, inGlued, ownerLevel));
    else stack(members);
    i = j;
  }
  return layoutNode(
    "col",
    sections.map(() => 1),
    sections,
  );
}

/** md2ui `_deep_last`: the last descendant, following the last child down. */
function deepLast(node: GroupNode): GroupNode {
  let n = node;
  while (n.children.length > 0) n = n.children[n.children.length - 1] as GroupNode;
  return n;
}

/** md2ui `_is_titled_section`: a heading group written with a title. */
function isTitledSection(run: Run, node: GroupNode): boolean {
  return node.children.some(
    (c) => run.kit.re(HEADING_TYPE_RE).match(c.type) !== null && strip(c.content) !== "",
  );
}

/**
 * md2ui `_packs_unique`: `child` is a heading band `Stack sections` may put beside its
 * neighbours: no repeated or orphan member, no list item, table or line, not ending in
 * a rule, and not a titled section at the document's top heading rank.
 */
function packsUnique(run: Run, child: GroupNode, repeated: ReadonlySet<GroupNode>): boolean {
  if (!run.packUnique) return false;
  if (repeated.has(child) || !isGroup(child)) return false;
  if (!child.heading_group) return false;
  if (child.orphan_grid) return false;
  if (child.type === "list_item") return false;
  if (deepLast(child).type === "horizontal_rule") return false;
  const top = run.topHeadingLevel;
  if (top !== null && sectionLevel(child) === top && isTitledSection(run, child)) return false;
  return !(child.table_group || child.column_split_group || child.line_split_group);
}

/** md2ui `_packs_any_unique`: two adjacent children `Stack sections` would pack. */
export function packsAnyUnique(run: Run, node: GroupNode): boolean {
  const repeated = repeatedMembers(node);
  let count = 0;
  for (const child of node.children) {
    count = packsUnique(run, child, repeated) ? count + 1 : 0;
    if (count >= 2) return true;
  }
  return false;
}
