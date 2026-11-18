// How many columns a grid keeps once its cards' heights are known, and how full its last
// row is: md2ui's `_cell_height`, `_aspect_cap`, `_kind_aspect_cap`, `_balance_cols` and
// `_balance_kind_cols` (ADR-303: the aspect cap widens only when it shortens). Heights
// are measured on trial builds of the members, which have the side effects of any
// build, so they happen exactly when and as often as md2ui's.
import type { GroupNode } from "../group/node.ts";
import { colGap } from "./node-units.ts";
import type { Run } from "./run.ts";

/** md2ui `MIN_LAST_ROW_FILL`: a ragged last row must fill at least this share of the columns. */
const MIN_LAST_ROW_FILL = 0.5;
/** md2ui `ORPHAN_RUN_SHARE`: the share of a kind's runs whose under-filled last row steps it down. */
const ORPHAN_RUN_SHARE = 1 / 3;
/** md2ui `_SHARE_EPSILON`: shares are compared with this tolerance. */
const SHARE_EPSILON = 1e-9;
/** md2ui `TARGET_ASPECT`: a card taller than this many column widths is a sliver. */
const TARGET_ASPECT = 1.5;
/** md2ui `HEIGHT_GROWTH_CAP`: never widen to where the tallest card grows past this multiple. */
const HEIGHT_GROWTH_CAP = 1.3;
/** md2ui `ASPECT_CAP_SHORTER_BY`: how much shorter (px) the tallest card must get. */
const ASPECT_CAP_SHORTER_BY = 1;
/** md2ui `CELL_HEIGHT_BUCKET`: widths in one bucket share the height measured at its floor. */
const CELL_HEIGHT_BUCKET = 8;
/** md2ui `KIND_SWEEP_FALLBACK`: a sample this close to the threshold sweeps the whole kind. */
const KIND_SWEEP_FALLBACK = 0.3;

/**
 * md2ui `_cell_height`: the rendered height of `unit` at about `width`, measured on a
 * build of it at its 8 px bucket's floor, once per (unit, bucket) for the call.
 */
function cellHeight(run: Run, unit: GroupNode, width: number, ownerLevel: number): number {
  if (width <= 0) return 0;
  const bucket = Math.floor(Math.trunc(width) / CELL_HEIGHT_BUCKET);
  let byBucket = run.cellHeights.get(unit);
  const hit = byBucket?.get(bucket);
  if (hit !== undefined) return hit;
  const w = Math.max(bucket * CELL_HEIGHT_BUCKET, 1);
  const sub = run.renderChild(run, unit, w, false, ownerLevel);
  const h = run.measurer.layoutHeight(sub, w) || 0;
  if (byBucket === undefined) {
    byBucket = new Map();
    run.cellHeights.set(unit, byBucket);
  }
  byBucket.set(bucket, h);
  return h;
}

/**
 * md2ui `_aspect_cap`: widen a grid of `members` (fewer columns) while its tallest member
 * is a tall-thin sliver, landing on the smallest count walked that makes it shorter; it
 * stops where widening makes it taller than `HEIGHT_GROWTH_CAP` allows. `heightAt` is
 * the height of a member at a column width; `gap` the gap between columns.
 */
export function aspectCap(
  members: readonly GroupNode[],
  cols: number,
  available: number,
  gap: number,
  heightAt: (member: GroupNode, width: number) => number,
): number {
  if (cols < 2 || members.length < 2) return cols;
  const colW = (k: number): number => (available - (k - 1) * gap) / k;
  const maxH = (k: number): number => {
    const w = colW(k);
    if (w <= 0) return Number.POSITIVE_INFINITY;
    let tallest = 0;
    let first = true;
    for (const m of members) {
      const h = heightAt(m, w);
      if (first || h > tallest) tallest = h;
      first = false;
    }
    return tallest;
  };
  const baseH = maxH(cols);
  if (baseH <= 0) return cols;
  if (baseH / colW(cols) <= TARGET_ASPECT) return cols;
  let best = cols;
  for (let k = cols - 1; k > 0; k--) {
    const w = colW(k);
    if (w <= 0) continue;
    const h = maxH(k);
    if (h > baseH * HEIGHT_GROWTH_CAP) break;
    if (h < baseH - ASPECT_CAP_SHORTER_BY) best = k;
    if (h / w <= TARGET_ASPECT) break;
  }
  return best;
}

/** md2ui `_aspect_cap` as the generator asks it: heights from trial builds. */
export function runAspectCap(
  run: Run,
  members: readonly GroupNode[],
  cols: number,
  available: number,
  ownerLevel: number,
): number {
  if (cols < 2 || members.length < 2) return cols;
  const gap = colGap(run.kit, members[0] as GroupNode, run.theme, ownerLevel, run.spacerScope[1]);
  return aspectCap(members, cols, available, gap, (m, w) => cellHeight(run, m, w, ownerLevel));
}

/**
 * md2ui `_kind_aspect_cap`: the aspect cap over a kind's members, checked on its sample
 * first: a sample clearly under the threshold keeps the count; anything closer, and a
 * kind without a sample, sweeps every member.
 */
export function kindAspectCap(
  run: Run,
  k: bigint | null,
  members: readonly GroupNode[],
  cols: number,
  available: number,
  ownerLevel: number,
): number {
  const sample = k === null ? undefined : run.kinds.sample.get(k);
  if (sample !== undefined && sample.length > 0) {
    const gap = colGap(run.kit, members[0] as GroupNode, run.theme, ownerLevel, run.spacerScope[1]);
    const w = (available - (cols - 1) * gap) / cols;
    if (w > 0) {
      let tallest = 0;
      let first = true;
      for (const m of sample) {
        const h = cellHeight(run, m, w, ownerLevel);
        if (first || h > tallest) tallest = h;
        first = false;
      }
      if (tallest / w <= (1 - KIND_SWEEP_FALLBACK) * TARGET_ASPECT) return cols;
    }
  }
  return runAspectCap(run, members, cols, available, ownerLevel);
}

/**
 * md2ui `_balance_cols`: step a fit-max column count down so a run of `n` ends on a row
 * at least half full: the fewest rows, then the most even last row, then more columns;
 * never below 2, and a count under 3 or a single row stays.
 */
export function balanceCols(cols: number, n: number): number {
  if (cols < 3 || n <= cols) return cols;
  const rows = (k: number): number => Math.ceil(n / k);
  const fill = (k: number): number => (n - (rows(k) - 1) * k) / k;
  if (fill(cols) >= MIN_LAST_ROW_FILL) return cols;
  const cands: number[] = [];
  for (let k = 2; k < cols; k++) if (fill(k) >= MIN_LAST_ROW_FILL) cands.push(k);
  if (cands.length === 0) return 2;
  cands.sort((a, b) => rows(a) - rows(b) || fill(b) - fill(a) || b - a);
  return cands[0] as number;
}

/**
 * md2ui `_balance_kind_cols`: the same fill rule decided once for a whole kind: keep
 * the fit-max unless at least a third of its runs would end on an under-half row, then
 * step down to a count where none does. Runs of one neither orphan nor vote.
 */
export function balanceKindCols(cols: number, runLens: readonly number[]): number {
  const runs = runLens.filter((n) => n >= 2);
  if (cols < 3 || runs.length === 0) return cols;
  const rows = (k: number, n: number): number => Math.ceil(n / k);
  const fill = (k: number, n: number): number => (n <= k ? 1 : (n - (rows(k, n) - 1) * k) / k);
  const orphanShare = (k: number): number =>
    runs.filter((n) => fill(k, n) < MIN_LAST_ROW_FILL).length / runs.length;
  const share = orphanShare(cols);
  if (share === 0 || share < ORPHAN_RUN_SHARE - SHARE_EPSILON) return cols;
  const cands: number[] = [];
  for (let k = 2; k < cols; k++) if (orphanShare(k) === 0) cands.push(k);
  if (cands.length === 0) return 2;
  const totalRows = (k: number): number => runs.reduce((s, n) => s + rows(k, n), 0);
  const leastFill = (k: number): number => Math.min(...runs.map((n) => fill(k, n)));
  cands.sort((a, b) => totalRows(a) - totalRows(b) || leastFill(b) - leastFill(a) || b - a);
  return cands[0] as number;
}
