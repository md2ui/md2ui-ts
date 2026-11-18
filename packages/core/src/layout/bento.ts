// Bento (md2ui ADR-300, theme `Layout: bento`): a run of target-level sections tiled as
// an order-preserving Mondrian mosaic. md2ui's `_build_bento_runs` and `_build_bento`.
// The search is exact: its memo keys, its Pareto beam, its stable sorts on tuple keys
// and the order of its float operations decide which mosaic wins, and every cell build
// is a trial build with side effects, made in md2ui's order.
import type { GroupNode } from "../group/node.ts";
import { pyRound, pySum } from "../group/py/math.ts";
import { buildGrouped } from "./grouped.ts";
import { type LayoutNode, layoutNode } from "./node.ts";
import { cellGap, minWidth } from "./node-units.ts";
import type { Run } from "./run.ts";
import { bentoCol } from "./units.ts";

/** md2ui `BENTO_WIDE_WIDTH`: from this width a root takes 3–5 divisions, else 1–3. */
const BENTO_WIDE_WIDTH = 760;
/** md2ui `BENTO_UNIT_TARGET`: the target width of one division. */
const BENTO_UNIT_TARGET = 260;
/** md2ui `BENTO_MAX_DEPTH`: how deep the guillotine cuts nest (rows within bands). */
const BENTO_MAX_DEPTH = 3;
/** md2ui `BENTO_BEAM`: the Pareto candidates kept per memo state. */
const BENTO_BEAM = 4;
/** md2ui `BENTO_ASPECT_WEIGHT`: the weight of the area-scaled aspect penalty. */
const BENTO_ASPECT_WEIGHT = 0.25;
/** md2ui `BENTO_DEV_STEPS`: the aspect deviation's grid, so `Math.log`'s last bit,
 * which differs by platform, cannot break a tie (md2ui ADR-300). */
const BENTO_DEV_STEPS = 1e9;

/** A vertical stack: its parts, height and cost (md2ui `pack_v`'s candidates). */
type Stack = readonly [parts: readonly LayoutNode[], height: number, cost: number];
/** One built band or row: its node, height and cost (`band`'s and `pack_h`'s candidates). */
type Built = readonly [node: LayoutNode, height: number, cost: number];
/** A band of a row: its node, span and height. */
type Band = readonly [node: LayoutNode, span: number, height: number];
/** Bands side by side: `fill` is the sum of each band's height times its width. */
type Bands = readonly [bands: readonly Band[], maxHeight: number, fill: number, cost: number];

/** Python's `<` on two numbers, as a sort comparison. */
function cmp(a: number, b: number): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * md2ui `pareto`: the (height, cost) frontier of `cands`, at most `BENTO_BEAM`, from a
 * stable sort by (cost, height).
 */
function pareto<T>(cands: readonly T[], heightOf: (c: T) => number, costOf: (c: T) => number): T[] {
  const sorted = [...cands].sort(
    (a, b) => cmp(costOf(a), costOf(b)) || cmp(heightOf(a), heightOf(b)),
  );
  const kept: T[] = [];
  let bestH = Number.POSITIVE_INFINITY;
  for (const c of sorted) {
    const h = heightOf(c);
    if (h < bestH) {
      kept.push(c);
      bestH = h;
      if (kept.length >= BENTO_BEAM) break;
    }
  }
  return kept;
}

/** Python's `max` of a non-empty slice of numbers. */
function maxOf(values: readonly number[], from: number, to: number): number {
  let best = values[from] as number;
  for (let k = from + 1; k < to; k++) best = Math.max(best, values[k] as number);
  return best;
}

/**
 * md2ui `_build_bento`: `cells`, a run of sections, packed into a mosaic of nested
 * rows and cols. The width is divided into a few grid columns and the ordered cells are
 * cut into contiguous row and column bands (guillotine cuts), so reading order is
 * document order; candidates are scored by whitespace area plus a penalty pushing cells
 * toward square, 2:1 or 1:2. `null` when the width is too narrow for a mosaic.
 */
function buildBento(
  run: Run,
  cells: readonly GroupNode[],
  width: number,
  inGlued: boolean,
  ownerLevel: number,
): LayoutNode | null {
  const { theme } = run;
  const n = cells.length;
  let d = pyRound(width / BENTO_UNIT_TARGET);
  d = width >= BENTO_WIDE_WIDTH ? Math.min(5, Math.max(3, d)) : Math.min(3, Math.max(1, d));
  if (d <= 1) return null;
  let gX = 0;
  let gY = 0;
  for (const c of cells) {
    gX = Math.max(gX, cellGap(run.kit, c, theme, "row", ownerLevel, run.spacerScope[1]));
    gY = Math.max(gY, cellGap(run.kit, c, theme, "col", ownerLevel, run.spacerScope[1]));
  }
  const unit = (width - (d - 1) * gX) / d;
  if (unit <= 0) return null;

  const spanW = (s: number): number => s * unit + (s - 1) * gX;
  const sw = [0];
  for (let k = 1; k <= d; k++) sw.push(spanW(k));

  const sMin = cells.map((c) => {
    const need = minWidth(c, run.minWidths);
    for (let k = 1; k <= d; k++) if (spanW(k) >= need) return k;
    return d;
  });

  // Each cell built and measured once per span: md2ui's `cell_cache`.
  const cellCache = new Map<string, readonly [LayoutNode, number]>();
  const cellAt = (i: number, s: number): readonly [LayoutNode, number] => {
    const key = `${i},${s}`;
    let hit = cellCache.get(key);
    if (hit === undefined) {
      const sub = run.renderChild(run, cells[i] as GroupNode, spanW(s), inGlued, ownerLevel);
      const h = run.measurer.layoutHeight(sub, spanW(s));
      hit = [sub, Math.max(h, 1)];
      cellCache.set(key, hit);
    }
    return hit;
  };

  // Cell `i` at span `s`, its cost the aspect penalty (md2ui `leaf_cand`).
  const leafCand = (i: number, s: number): Stack => {
    const [sub, h] = cellAt(i, s);
    const wd = spanW(s);
    const r = wd / h;
    const dev =
      pyRound(
        Math.min(Math.abs(Math.log(r)), Math.abs(Math.log(r / 2)), Math.abs(Math.log(2 * r))) *
          BENTO_DEV_STEPS,
      ) / BENTO_DEV_STEPS;
    let pen = BENTO_ASPECT_WEIGHT * dev * wd * h;
    if (r > 4 || r < 0.25) pen *= 2;
    return [[sub], h, pen];
  };

  const memoV = new Map<string, Stack[]>();
  const memoB = new Map<string, Bands[]>();
  const memoH = new Map<string, Built[]>();
  const memoBand = new Map<string, Built[]>();

  // Cells [i, j) stacked at span `s`: one cell over the rest, or a row over the rest.
  const packV = (i: number, j: number, s: number, depth: number): Stack[] => {
    const key = `${i},${j},${s},${depth}`;
    const hit = memoV.get(key);
    if (hit !== undefined) return hit;
    let out: Stack[] = [];
    if (s >= (sMin[i] as number)) {
      const [headParts, headH, headC] = leafCand(i, s);
      if (i + 1 === j) out.push([headParts, headH, headC]);
      else {
        for (const [parts, h, c] of packV(i + 1, j, s, depth)) {
          out.push([[...headParts, ...parts], headH + gY + h, headC + c]);
        }
      }
    }
    if (depth < BENTO_MAX_DEPTH && s >= 2) {
      for (let k = i + 2; k <= j; k++) {
        for (const [rowNode, rowH, rowC] of packH(i, k, s, depth + 1)) {
          if (k === j) out.push([[rowNode], rowH, rowC]);
          else {
            for (const [parts, h, c] of packV(k, j, s, depth)) {
              out.push([[rowNode, ...parts], rowH + gY + h, rowC + c]);
            }
          }
        }
      }
    }
    out = pareto(
      out,
      (c) => c[1],
      (c) => c[2],
    );
    memoV.set(key, out);
    return out;
  };

  // A column band of cells [i, j) at span `t`.
  const band = (i: number, j: number, t: number, depth: number): Built[] => {
    const key = `${i},${j},${t},${depth}`;
    const hit = memoBand.get(key);
    if (hit !== undefined) return hit;
    let out: Built[] = [];
    if (j - i === 1) {
      if (t >= (sMin[i] as number)) {
        const [parts, h, c] = leafCand(i, t);
        out = [[parts[0] as LayoutNode, h, c]];
      }
    } else {
      out = packV(i, j, t, depth).map(([parts, h, c]) => [
        parts.length === 1 ? (parts[0] as LayoutNode) : bentoCol(parts),
        h,
        c,
      ]);
    }
    memoBand.set(key, out);
    return out;
  };

  // Cells [i, j) as bands side by side spanning `s`, unfinished: the row's whitespace
  // is added once its height is known. Dominance on (max height, cost - fill) is exact
  // for any completion.
  const bands = (i: number, j: number, s: number, depth: number): Bands[] => {
    const key = `${i},${j},${s},${depth}`;
    const hit = memoB.get(key);
    if (hit !== undefined) return hit;
    let out: Bands[] = [];
    for (const [bn, bh, bc] of band(i, j, s, depth)) {
      out.push([[[bn, s, bh]], bh, bh * (sw[s] as number), bc]);
    }
    for (let m = i + 1; m < j; m++) {
      const headMin = maxOf(sMin, i, m);
      const restMin = maxOf(sMin, m, j);
      for (let t = headMin; t <= s - restMin; t++) {
        const heads = band(i, m, t, depth);
        if (heads.length === 0) continue;
        const tails = bands(m, j, s - t, depth);
        for (const [hn, hh, hc] of heads) {
          for (const [tb, tmax, tfill, tc] of tails) {
            out.push([
              [[hn, t, hh], ...tb],
              Math.max(hh, tmax),
              hh * (sw[t] as number) + tfill,
              hc + tc,
            ]);
          }
        }
      }
    }
    out = pareto(
      out,
      (c) => c[1],
      (c) => c[3] - c[2],
    );
    memoB.set(key, out);
    return out;
  };

  // Cells [i, j) as one row of two or more bands spanning `s`.
  const packH = (i: number, j: number, s: number, depth: number): Built[] => {
    const key = `${i},${j},${s},${depth}`;
    const hit = memoH.get(key);
    if (hit !== undefined) return hit;
    const out: (readonly [readonly Band[], number, number])[] = [];
    for (let m = i + 1; m < j; m++) {
      const headMin = maxOf(sMin, i, m);
      const restMin = maxOf(sMin, m, j);
      for (let t = headMin; t <= s - restMin; t++) {
        for (const [hn, hh, hc] of band(i, m, t, depth)) {
          for (const [tb, tmax, tfill, tc] of bands(m, j, s - t, depth)) {
            const allBands: Band[] = [[hn, t, hh], ...tb];
            const rowH = Math.max(hh, tmax);
            const fill = hh * (sw[t] as number) + tfill;
            const waste = rowH * pySum(allBands.map(([, sp]) => sw[sp] as number)) - fill;
            out.push([allBands, rowH, hc + tc + waste]);
          }
        }
      }
    }
    // A row node only for the candidates the beam keeps.
    const kept: Built[] = pareto(
      out,
      (c) => c[1],
      (c) => c[2],
    ).map(([allBands, rowH, cost]) => [
      layoutNode(
        "row",
        allBands.map(([, sp]) => sp),
        allBands.map(([bn]) => bn),
        { bento: true },
      ),
      rowH,
      cost,
    ]);
    memoH.set(key, kept);
    return kept;
  };

  let best: Stack | null = null;
  for (const cand of packV(0, n, d, 0)) {
    const [, h, c] = cand;
    if (best === null || c < best[2] || (c === best[2] && h < best[1])) best = cand;
  }
  if (best === null) return null;
  const parts = best[0];
  return parts.length === 1 ? (parts[0] as LayoutNode) : bentoCol(parts);
}

/**
 * md2ui `_build_bento_runs`: each of `runs` (`[start, end)` among `node`'s children)
 * tiled in place, the rest laid out as if bento were off. The mosaic itself when one
 * run covers every child; `null` when no run could be tiled at this width, so the rules
 * go on.
 */
export function buildBentoRuns(
  run: Run,
  node: GroupNode,
  runs: readonly (readonly [number, number])[],
  width: number,
  inGlued: boolean,
  ownerLevel: number,
): LayoutNode | null {
  const packed = new Map<number, LayoutNode>();
  for (const [start, end] of runs) {
    const mosaic = buildBento(run, node.children.slice(start, end), width, inGlued, ownerLevel);
    if (mosaic !== null) packed.set(start, mosaic);
  }
  if (packed.size === 0) return null;
  const runEnd = new Map(runs);
  const [first] = packed;
  if (packed.size === 1 && first !== undefined) {
    const [start, mosaic] = first;
    if (start === 0 && runEnd.get(start) === node.children.length) return mosaic;
  }
  const spliced = new Map<number, readonly [LayoutNode, number]>();
  for (const [start, mosaic] of packed) spliced.set(start, [mosaic, runEnd.get(start) as number]);
  return buildGrouped(run, node, width, inGlued, ownerLevel, spliced);
}
