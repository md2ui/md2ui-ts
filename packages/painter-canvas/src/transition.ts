// FLIP between two display lists of one view: what was on screen slides and
// fades into what replaced it, node by node, as the core's diff matched them
// (ADR-104). The tween is here, the progress is the host's (its frame loop and
// easing), and neither list is laid out again: every line of text keeps the wrap
// Pretext gave it in its own list (ADR-403), so text snaps or cross-fades and never
// re-wraps mid-animation. The motion is staged: what goes fades out first, what stays
// slides, and what comes fades in last, each stage overlapping the next.
import type { DisplayEntry, DisplayList, ListDiff, Rect } from "@md2ui/contracts";
import type { Context2D } from "./context.ts";
import { createLayers } from "./draw/layer.ts";
import {
  contentOriginX,
  drawEntry,
  drawEnv,
  type Frame,
  paintBackground,
  startFrame,
} from "./painter.ts";
import { createShadowCache, createShadowSprites, type ShadowSprites } from "./shadow-cache.ts";

/**
 * Where each stage runs within the motion, as fractions of its duration (fixed, not a
 * theme key). Removed paint is mostly gone before the cards it leaves
 * room for reach their midway, and added paint starts only once they have passed it, so
 * nothing new lands on something still moving through; the overlaps keep the whole one
 * `Duration` with no still moment between stages.
 * - **exit:** removed nodes fade out;
 * - **move:** nodes in both slide, and what changed in them cross-fades;
 * - **enter:** added nodes fade in.
 */
export const STAGES = Object.freeze({
  exit: Object.freeze([0, 0.4] as const),
  move: Object.freeze([0.15, 0.85] as const),
  enter: Object.freeze([0.55, 1] as const),
});

/** How far each stage has got, 0 to 1, each eased by the host on its own. */
export interface Stages {
  /** Removed paint fading out. */
  readonly exit: number;
  /** Paint in both lists sliding, and what changed in it cross-fading. */
  readonly move: number;
  /** Added paint fading in. */
  readonly enter: number;
}

/** Each stage's progress at `progress` of the whole, uneased within its stage. */
function stagesAt(progress: number): Stages {
  const at = ([start, end]: readonly [number, number]) =>
    Math.min(1, Math.max(0, (progress - start) / (end - start)));
  return { exit: at(STAGES.exit), move: at(STAGES.move), enter: at(STAGES.enter) };
}

/** Paints the frames between two lists. */
export interface Transition {
  /**
   * Clears `ctx` and paints the frame `progress` of the way from the earlier list to
   * the later: 0 is the earlier as it was seen, 1 the later. Either each stage's own
   * progress (`STAGES`), which a host eases stage by stage, or the whole's, split into
   * the stages as it is.
   */
  paint(ctx: Context2D, frame: Frame, progress: number | Stages): void;
}

/** How the earlier list is placed and what the transition reuses. */
export interface TransitionOptions {
  /**
   * Where the earlier list's content sits in the later one's content space: the
   * distance the host scrolled to keep its anchor in place. Default none.
   */
  readonly shift?: { readonly x: number; readonly y: number };
  /** The host's shadow bitmaps, as `createPainter` takes them. */
  readonly sprites?: ShadowSprites;
}

/** Where an entry is drawn, offset from its own place, at the start and at the end. */
interface Step {
  readonly entry: DisplayEntry;
  readonly start: Offset;
  readonly end: Offset;
  /**
   * "enter" fades in and "exit" fades out, with the stages of those names; "in" and
   * "out" cross-fade what changed in a node, as it moves; "stay" is opaque throughout.
   */
  readonly fade: "enter" | "exit" | "in" | "out" | "stay";
}

interface Offset {
  readonly x: number;
  readonly y: number;
}

const NONE: Offset = Object.freeze({ x: 0, y: 0 });

/** C4's horizontal and vertical coordinates, which a move shifts; nothing else does. */
const X_KEYS: readonly string[] = Object.freeze(["x", "x0", "x1", "cx"]);
const Y_KEYS: readonly string[] = Object.freeze(["y", "y0", "y1", "cy"]);

/** `entry` moved by `by`, as text: equal for entries that paint the same pixels. */
function signature(entry: DisplayEntry, by: Offset): string {
  return JSON.stringify(entry, (key, value: unknown) => {
    if (typeof value !== "number") return value;
    const moved = value + (X_KEYS.includes(key) ? by.x : Y_KEYS.includes(key) ? by.y : 0);
    return Math.round(moved * 1000) / 1000;
  });
}

function entriesByNode(entries: readonly DisplayEntry[]): Map<string, DisplayEntry[]> {
  const byNode = new Map<string, DisplayEntry[]>();
  for (const entry of entries) {
    if (entry.nodeId === "") continue;
    const list = byNode.get(entry.nodeId);
    if (list === undefined) byNode.set(entry.nodeId, [entry]);
    else list.push(entry);
  }
  return byNode;
}

/**
 * The steps from `from` to `to`, in paint order; `shift` places the earlier list in
 * the later one's content space.
 * - A node in both slides from where it was seen to where it is: its box's corner moves.
 * - In a node the diff restyled, what changed cross-fades, the old paint over the new,
 *   both riding the corner; what did not change stays opaque, so it never dims.
 * - An added node fades in where it is (the enter stage); a removed one fades out where
 *   it was (the exit stage).
 * - An entry with no node stays when the later list paints it unchanged; otherwise the
 *   old one exits and the new one enters.
 * What fades out is painted first, under the later list, except a restyled node's old
 * paint, each entry right over the node's new entry in its place (its fill over the new
 * fill, its stroke over the new stroke).
 */
function steps(from: DisplayList, to: DisplayList, diff: ListDiff, shift: Offset): Step[] {
  const moved = new Map(diff.moved.map((m) => [m.nodeId, m]));
  const restyled = new Set(diff.restyled);
  const before = entriesByNode(from.entries);
  const after = entriesByNode(to.entries);
  /** How far a node in both lists travels on screen: its box's corner, earlier to later. */
  const travel = (nodeId: string): Offset => {
    const m = moved.get(nodeId);
    if (m === undefined) return { x: -shift.x, y: -shift.y };
    return { x: m.to.x - (m.from.x + shift.x), y: m.to.y - (m.from.y + shift.y) };
  };
  const unnamed = (list: DisplayList, by: Offset) =>
    new Set(list.entries.filter((e) => e.nodeId === "").map((e) => signature(e, by)));
  const kept = unnamed(from, shift);
  const shown = unnamed(to, NONE);

  const out: Step[] = [];
  for (const entry of from.entries) {
    const gone =
      entry.nodeId === "" ? !shown.has(signature(entry, shift)) : !after.has(entry.nodeId);
    if (gone) out.push({ entry, start: shift, end: shift, fade: "exit" });
  }
  /** How many of each node's entries are placed so far. */
  const placed = new Map<string, number>();
  for (const entry of to.entries) {
    const { nodeId } = entry;
    const old = nodeId === "" ? undefined : before.get(nodeId);
    if (old === undefined) {
      const stays = nodeId === "" && kept.has(signature(entry, NONE));
      out.push({ entry, start: NONE, end: NONE, fade: stays ? "stay" : "enter" });
      continue;
    }
    const t = travel(nodeId);
    // Where the old paint would land if it rode the box's corner all the way.
    const end = { x: shift.x + t.x, y: shift.y + t.y };
    const changed = restyled.has(nodeId) ? changes(old, after.get(nodeId) ?? [], end) : null;
    const fade = changed?.added.has(entry) ? "in" : "stay";
    out.push({ entry, start: { x: -t.x, y: -t.y }, end: NONE, fade });
    const k = placed.get(nodeId) ?? 0;
    placed.set(nodeId, k + 1);
    // The old paint goes over the new paint in its place: a card's old fill over its
    // fill, under its text; what the new paint has no place for, over its last.
    const last = k === (after.get(nodeId)?.length ?? 0) - 1;
    for (const was of changed?.removed ?? []) {
      const i = old.indexOf(was);
      if (i === k || (last && i > k)) out.push({ entry: was, start: shift, end, fade: "out" });
    }
  }
  return out;
}

/**
 * What a restyled node paints only before (`removed`) and only after (`added`), the
 * old paint moved by `by`; what both paint stays opaque.
 */
function changes(old: readonly DisplayEntry[], now: readonly DisplayEntry[], by: Offset) {
  const left = new Map<string, number>();
  for (const e of old) {
    const key = signature(e, by);
    left.set(key, (left.get(key) ?? 0) + 1);
  }
  const added = new Set<DisplayEntry>();
  for (const e of now) {
    const key = signature(e, NONE);
    const n = left.get(key) ?? 0;
    if (n > 0) left.set(key, n - 1);
    else added.add(e);
  }
  const removed = old.filter((e) => {
    const key = signature(e, by);
    const n = left.get(key) ?? 0;
    if (n > 0) left.set(key, n - 1);
    return n > 0;
  });
  return { added, removed };
}

/** Whether `r`, moved by `dx, dy`, meets `view`. */
function meets(r: Rect, dx: number, dy: number, view: Rect): boolean {
  return (
    r.x + dx < view.x + view.width &&
    r.x + dx + r.width > view.x &&
    r.y + dy < view.y + view.height &&
    r.y + dy + r.height > view.y
  );
}

/**
 * The frames from `from` to `to`, matched by `diff` (the core's `diffDisplayLists` of
 * the two). The later list decides the page: its background, padding and centring.
 */
export function createTransition(
  from: DisplayList,
  to: DisplayList,
  diff: ListDiff,
  options: TransitionOptions = {},
): Transition {
  const plan = steps(from, to, diff, options.shift ?? NONE);
  const shadows = createShadowCache(options.sprites ?? createShadowSprites());
  const layers = createLayers();

  return {
    paint(ctx, frame, progress) {
      const stage = typeof progress === "number" ? stagesAt(progress) : progress;
      const alphas = {
        enter: stage.enter,
        exit: 1 - stage.exit,
        in: stage.move,
        out: 1 - stage.move,
        stay: 1,
      };
      const p = Math.min(1, Math.max(0, stage.move));
      const env = drawEnv(frame);
      startFrame(ctx, frame);
      if (frame.background !== false) paintBackground(ctx, to.background, frame, env, shadows);
      const ox = contentOriginX(to, frame) - frame.scrollX;
      const oy = to.padding.top - frame.scrollY;
      ctx.translate(ox, oy);
      const view = { x: -ox, y: -oy, width: frame.width, height: frame.height };
      for (const { entry, start, end, fade } of plan) {
        const alpha = Math.min(1, Math.max(0, alphas[fade]));
        const dx = start.x + (end.x - start.x) * p;
        const dy = start.y + (end.y - start.y) * p;
        if (alpha <= 0 || !meets(entry.bounds, dx, dy, view)) continue;
        ctx.globalAlpha = alpha;
        ctx.translate(dx, dy);
        drawEntry(ctx, entry, env, shadows, layers);
        ctx.translate(-dx, -dy);
      }
      ctx.restore();
    },
  };
}
