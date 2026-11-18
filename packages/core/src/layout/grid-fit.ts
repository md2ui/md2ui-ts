// How many columns a same-kind run fits: md2ui's `_build_kind_maps`, `_kind_cols` and
// `_cols_for_unit`, and `generator_displays.column_floor` / `column_padding_x`. A kind
// that occurs more than once shares one count across its runs and orphans; a lone run
// keeps its own fit (its caller applies the aspect cap and the fill rule).
import type { ResolvedTheme } from "@md2ui/contracts";
import type { GroupNode } from "../group/node.ts";
import { paddingX } from "../theme/query.ts";
import { balanceKindCols, kindAspectCap } from "./aspect.ts";
import { dpDisplayEnabled, unitRatioIsRing } from "./display-gates.ts";
import { markerGutterX } from "./markers.ts";
import {
  colGap,
  estimateCellHeight,
  isGroup,
  lengthCategory,
  type MinWidthScope,
  measuredMinWidth,
  unitPaddingX,
} from "./node-units.ts";
import type { KindMaps, Run } from "./run.ts";
import { LEAF_WIDTH } from "./units.ts";

/** md2ui `KIND_SWEEP_SAMPLE`: how many likely-tallest members a large kind is checked on first. */
const KIND_SWEEP_SAMPLE = 5;
/** md2ui `KIND_SWEEP_RANK_WIDTH`: the width the font-free estimate ranks a kind's members at. */
const KIND_SWEEP_RANK_WIDTH = 300;

/**
 * md2ui `_build_kind_maps`: per `kind_hash`, the grid members (the nodes of a
 * `repeated_children` bucket of groups and the `orphan_grid` groups), the widest member's min
 * width, the longest run, the number of occurrences, every run's length and, for a
 * large kind, its likely-tallest members, so every run of a kind can share one column
 * count.
 */
export function buildKindMaps(root: GroupNode, scope: MinWidthScope): KindMaps {
  const maps: KindMaps = {
    members: new Map(),
    minWidth: new Map(),
    maxRun: new Map(),
    occurrences: new Map(),
    runLens: new Map(),
    sample: new Map(),
  };
  const add = (k: bigint | null, nodes: readonly GroupNode[]): void => {
    const list = maps.members.get(k);
    if (list === undefined) maps.members.set(k, [...nodes]);
    else list.push(...nodes);
    maps.occurrences.set(k, (maps.occurrences.get(k) ?? 0) + 1);
  };
  const walk = (node: GroupNode): void => {
    for (const bucket of node.repeated_children?.values() ?? []) {
      // Leaves stack (only groups grid), so a leaf is no occurrence.
      const first = bucket[0];
      const k = first !== undefined && isGroup(first) ? first.kind_hash : null;
      if (k === null) continue;
      add(k, bucket);
      maps.maxRun.set(k, Math.max(maps.maxRun.get(k) ?? 0, bucket.length));
      const lens = maps.runLens.get(k);
      if (lens === undefined) maps.runLens.set(k, [bucket.length]);
      else lens.push(bucket.length);
    }
    for (const c of node.children) {
      if (c.orphan_grid && c.kind_hash !== null && isGroup(c)) add(c.kind_hash, [c]);
      walk(c);
    }
  };
  walk(root);
  for (const [k, ms] of maps.members) {
    let mw = 0;
    for (const m of ms) {
      const soft = columnFloor(scope.theme, m) || 0;
      mw = Math.max(mw, soft, measuredMinWidth(m, scope));
    }
    maps.minWidth.set(k, mw);
    if (ms.length > KIND_SWEEP_SAMPLE) {
      const ranked = ms.map((m) => [m, estimateCellHeight(m, KIND_SWEEP_RANK_WIDTH)] as const);
      // A stable sort, tallest first: Python's `sorted(..., reverse=True)` keeps ties in order.
      ranked.sort((a, b) => b[1] - a[1]);
      maps.sample.set(
        k,
        ranked.slice(0, KIND_SWEEP_SAMPLE).map(([m]) => m),
      );
    }
  }
  return maps;
}

/** md2ui `_is_drawn_date_chip`: a date chip the theme draws. */
function isDrawnDateChip(theme: ResolvedTheme, node: GroupNode): boolean {
  return node.datapoint_display === "date_chip" && dpDisplayEnabled(theme, node);
}

/** md2ui `_is_drawn_ring`: a unit ratio the theme draws as a ring. */
function isDrawnRing(theme: ResolvedTheme, node: GroupNode): boolean {
  return (
    node.datapoint_display === "unit_ratio" &&
    dpDisplayEnabled(theme, node) &&
    unitRatioIsRing(theme)
  );
}

/**
 * md2ui `generator_displays.column_floor`: the per-column minimum a grid of `unit`
 * starts from, before measurement — its length category's `LEAF_WIDTH`, a prose
 * heuristic for text that wraps. A drawn date chip or ring that is the whole unit
 * (through any single-child wrap, such as a list item) is as wide as it draws, which
 * the measurement already floors, so it gets 0: flooring a ring by its key's word count
 * made a run of rings grid by its first member's label. Bars and charts keep the floor.
 */
function columnFloor(theme: ResolvedTheme, unit: GroupNode): number | undefined {
  for (let node = unit; ; ) {
    if (isDrawnDateChip(theme, node) || isDrawnRing(theme, node)) return 0;
    const only = node.children.length === 1 ? node.children[0] : undefined;
    if (only === undefined) break;
    node = only;
  }
  return LEAF_WIDTH[lengthCategory(unit) ?? ""];
}

/**
 * md2ui `generator_displays.column_padding_x`: the unit's padding, plus the `### Dates`
 * card padding of a drawn chip (the chip card is the unit's own outermost wrap).
 */
function columnPaddingX(theme: ResolvedTheme, unit: GroupNode): number {
  const pad = unitPaddingX(unit, theme);
  return isDrawnDateChip(theme, unit)
    ? pad + paddingX(theme.datapoints.date_chip.chip.padding)
    : pad;
}

/** Python's `int((available + gap) / denom) if denom > 0 else 1`, the fit's column count. */
function fitColumns(available: number, unitWidth: number, gap: number): number {
  const denom = unitWidth + gap;
  return denom > 0 ? Math.trunc((available + gap) / denom) : 1;
}

/**
 * md2ui `_kind_cols`: the column count every run of `unit`'s kind shares at `width`: the
 * fit of the kind's widest member (floored at `unitMin`, a run's decision-aware width),
 * clamped to its longest run, then the kind's aspect cap and last its fill vote; `null`
 * when the kind occurs once (the run keeps its own fit).
 */
export function kindCols(
  run: Run,
  unit: GroupNode,
  width: number,
  ownerLevel: number,
  unitMin: number | null = null,
): number | null {
  const k = unit.kind_hash;
  const members = run.kinds.members.get(k);
  let minW = run.kinds.minWidth.get(k);
  if (
    members === undefined ||
    members.length === 0 ||
    !minW ||
    minW <= 0 ||
    (run.kinds.occurrences.get(k) ?? 0) < 2
  ) {
    return null;
  }
  minW = Math.max(minW, unitMin || 0);
  const unitWidth = minW + columnPaddingX(run.theme, unit) + markerGutterX(unit, run.theme);
  const gap = colGap(run.kit, unit, run.theme, ownerLevel, run.spacerScope[1]);
  let cols = fitColumns(width, unitWidth, gap);
  cols = Math.min(run.kinds.maxRun.get(k) ?? cols, Math.max(1, cols));
  if (cols > 1) cols = kindAspectCap(run, k, members, cols, width, ownerLevel);
  // The fill vote has the last word: the aspect cap can strand a run's last row.
  return balanceKindCols(cols, run.kinds.runLens.get(k) ?? []);
}

/**
 * md2ui `_cols_for_unit`: the most columns of `unit` that fit `width` (at most one per
 * member), each as wide as its length category's floor, the widest member's measured
 * minimum and `unitMin` (a run's decision-aware width), plus its padding and its
 * marker gutter.
 */
export function colsForUnit(
  run: Run,
  unit: GroupNode,
  width: number,
  members: readonly GroupNode[],
  ownerLevel: number,
  unitMin: number | null,
): number {
  const floor = columnFloor(run.theme, unit);
  if (floor === undefined || floor < 0) return 1;
  let measured = 0;
  let first = true;
  for (const m of members) {
    const w = measuredMinWidth(m, run.minWidths);
    if (first || w > measured) measured = w;
    first = false;
  }
  const minW = Math.max(floor, measured, unitMin || 0);
  const unitWidth = minW + columnPaddingX(run.theme, unit) + markerGutterX(unit, run.theme);
  const gap = colGap(run.kit, unit, run.theme, ownerLevel, run.spacerScope[1]);
  return Math.min(members.length, Math.max(1, fitColumns(width, unitWidth, gap)));
}
