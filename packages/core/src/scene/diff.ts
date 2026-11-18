// What changed between two display lists of one view, by node id (ADR-104): the
// diff a host animates when a document is re-sent or streamed. The tweening is
// the painter's and the frames are the host's; this only matches. Identical nodes are
// matched by position first (`alignNodeIds`), so an occurrence shifted by an edit
// elsewhere does not move them.
import type { DisplayEntry, DisplayList, ListDiff, MovedNode, Rect } from "@md2ui/contracts";

/** Sub-pixel differences are not a move: no frame would show them. */
const EPSILON = 0.01;

/** Each node's entries, in paint order, and the union of their bounds. */
interface NodePaint {
  readonly entries: DisplayEntry[];
  box: Rect;
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

function nodesOf(list: DisplayList): Map<string, NodePaint> {
  const nodes = new Map<string, NodePaint>();
  for (const entry of list.entries) {
    if (entry.nodeId === "") continue;
    const node = nodes.get(entry.nodeId);
    if (node === undefined) {
      nodes.set(entry.nodeId, { entries: [entry], box: entry.bounds });
    } else {
      node.entries.push(entry);
      node.box = union(node.box, entry.bounds);
    }
  }
  return nodes;
}

/** An id's content key (ADR-104): the id without its `-<occurrence>`. */
function keyOf(id: string): string {
  const dash = id.lastIndexOf("-");
  return dash < 0 ? id : id.slice(0, dash);
}

const area = (r: Rect): number => r.width * r.height;
const NO_BOX: Rect = Object.freeze({ x: 0, y: 0, width: 0, height: 0 });

/** What a list's holders hold, and what holds each node. */
interface Holders {
  /** Each holder's nodes that are not holders themselves, and their area in all. */
  readonly holds: Map<string, { readonly ids: string[]; area: number }>;
  /** Each node's holders, outermost first. */
  readonly heldBy: Map<string, string[]>;
}

/** Whether `e` paints a box: a fill, a stroke, a shadow, or a muted control's layer of them. */
const boxed = (e: DisplayEntry): boolean =>
  e.type === "fill" || e.type === "stroke" || e.type === "shadow" || e.type === "layer";

/**
 * The nodes whose box holds another node's centre: a card's or a section's background,
 * which carries its node's id (ADR-104). Only a node with a box (a fill, a stroke, a
 * shadow) holds anything: a picture with a caption over it is still a picture.
 */
function holdersOf(nodes: Map<string, NodePaint>): Holders {
  const holds: Holders["holds"] = new Map();
  const heldBy = new Map<string, string[]>();
  // Every node's centre, top first, to find what lies inside a box by its rows.
  const centres = [...nodes]
    .map(([id, { box }]) => ({
      id,
      x: box.x + box.width / 2,
      y: box.y + box.height / 2,
      a: area(box),
    }))
    .sort((p, q) => p.y - q.y);
  // Largest first, so a holder is met before what it holds.
  const bySize = [...nodes].sort(([, a], [, b]) => area(b.box) - area(a.box));
  for (const [id, { entries, box }] of bySize) {
    if (!entries.some(boxed)) continue;
    let lo = 0;
    let hi = centres.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((centres[mid]?.y ?? 0) < box.y) lo = mid + 1;
      else hi = mid;
    }
    for (let c = centres[lo]; c !== undefined && c.y <= box.y + box.height; c = centres[++lo]) {
      if (c.a >= area(box) || c.x < box.x || c.x > box.x + box.width) continue;
      if (!holds.has(id)) holds.set(id, { ids: [], area: 0 });
      const by = heldBy.get(c.id);
      if (by === undefined) heldBy.set(c.id, [id]);
      else by.push(id);
    }
  }
  for (const [other, by] of heldBy) {
    if (holds.has(other)) continue;
    const size = area(nodes.get(other)?.box ?? NO_BOX);
    for (const id of by) {
      const held = holds.get(id);
      if (held === undefined) continue;
      held.ids.push(other);
      held.area += size;
    }
  }
  return { holds, heldBy };
}

/**
 * The nodes of `list` whose box holds another node's (a card's or a section's
 * background): matched across an update by what they hold, and never what a reader's
 * place is kept by.
 */
export function holderIds(list: DisplayList): ReadonlySet<string> {
  return new Set(holdersOf(nodesOf(list)).holds.keys());
}

/** How many painted nodes each content key has. */
function keyCounts(ids: Iterable<string>): Map<string, number> {
  const counts = new Map<string, number>();
  for (const id of ids) {
    const key = keyOf(id);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** A node matched by its place among its anchor's, and the anchor painted last before it. */
interface Member {
  readonly id: string;
  readonly key: string;
}

/**
 * The nodes `ids` names, in paint order, by the anchor before them: the last node alone
 * in its key on both sides, which its id already matches ("" before the first).
 */
function membersOf(ids: Iterable<string>, alone: (key: string) => boolean): Map<string, Member[]> {
  const byAnchor = new Map<string, Member[]>();
  let anchor = "";
  for (const id of ids) {
    const key = keyOf(id);
    if (alone(key)) {
      anchor = key;
    } else {
      const run = byAnchor.get(anchor);
      if (run === undefined) byAnchor.set(anchor, [{ id, key }]);
      else run.push({ id, key });
    }
  }
  return byAnchor;
}

/** Past this many cells (a 1,000-by-1,000 run), a run is matched key by key instead. */
const RUN_CELLS = 1_000_000;

/**
 * The pairs [old, new] of a longest common run of keys, `olds` against `news`, as a
 * text diff matches lines: a card dropped from a run of identical cards drops whole,
 * not a title from one and a price from another. The earlier pairing wins a tie, so
 * what is left over is the run's end.
 */
function commonRun(olds: readonly Member[], news: readonly Member[]): [number, number][] {
  const a = olds.length;
  const b = news.length;
  if (a * b > RUN_CELLS) {
    // Each key's nodes in order, as their occurrences pair them.
    const free = new Map<string, number[]>();
    news.forEach(({ key }, j) => {
      const js = free.get(key);
      if (js === undefined) free.set(key, [j]);
      else js.push(j);
    });
    return olds.flatMap(({ key }, i): [number, number][] => {
      const j = free.get(key)?.shift();
      return j === undefined ? [] : [[i, j]];
    });
  }
  // The longest common run of olds[i..] and news[j..], at i * (b + 1) + j.
  const rest = new Int32Array((a + 1) * (b + 1));
  for (let i = a - 1; i >= 0; i--) {
    for (let j = b - 1; j >= 0; j--) {
      rest[i * (b + 1) + j] =
        olds[i]?.key === news[j]?.key
          ? (rest[(i + 1) * (b + 1) + j + 1] ?? 0) + 1
          : Math.max(rest[(i + 1) * (b + 1) + j] ?? 0, rest[i * (b + 1) + j + 1] ?? 0);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < a && j < b) {
    if (olds[i]?.key === news[j]?.key) pairs.push([i++, j++]);
    else if ((rest[(i + 1) * (b + 1) + j] ?? 0) >= (rest[i * (b + 1) + j + 1] ?? 0)) i++;
    else j++;
  }
  return pairs;
}

/** What a node paints, by kind: a count's `1` and `0` are of one kind, a box and a line not. */
const kindOf = (node: NodePaint | undefined): string =>
  node?.entries.map((e) => e.type).join() ?? "";

/**
 * `before`, its entries' node ids renamed to the ids their nodes match in `after`: what
 * the diff, the transition and the scroll anchoring read across an update.
 *
 * Ids tell identical subtrees apart by occurrence (ADR-104), so one more `0` above
 * shifts every later `0`'s occurrence, and a card whose count changed has a new id.
 * - **Nodes are matched by place:** after the same anchor (the last node before them
 *   alone in its key on both sides, such as their card's title), in the longest common
 *   run of keys. Between two matches, what is left on both sides pairs in order where it
 *   paints the same kinds of entry: a count's `1` with its `0`.
 * - **A holder (a card's or section's box) is matched by what it holds:** to the holder
 *   holding the partners of more than half of what it holds, by area, on either side;
 *   of two that do, the nearer its size. A card keeps its box through a changed count;
 *   one whose title and picture changed is another card.
 * - **A pair stands only where its holders match:** in a card that is another card, all
 *   of it fades. A holder matched to nothing on one side only is passed over.
 * One left unmatched takes an id `after` does not have, so the diff finds it removed.
 */
export function alignNodeIds(before: DisplayList, after: DisplayList): DisplayList {
  const old = nodesOf(before);
  const now = nodesOf(after);
  const was = holdersOf(old);
  const is = holdersOf(now);
  const leaves = (nodes: Map<string, NodePaint>, { holds }: Holders) =>
    [...nodes.keys()].filter((id) => !holds.has(id));
  const oldLeaves = leaves(old, was);
  const nowLeaves = leaves(now, is);
  const oldCounts = keyCounts(oldLeaves);
  const nowCounts = keyCounts(nowLeaves);
  const alone = (key: string) => oldCounts.get(key) === 1 && nowCounts.get(key) === 1;
  // Partners by key (anchors and common runs), and leftovers paired between them.
  const sure = new Map(oldLeaves.flatMap((id) => (alone(keyOf(id)) ? [[id, id] as const] : [])));
  const leftover: [string, string][] = [];
  const news = membersOf(nowLeaves, alone);
  for (const [anchor, olds] of membersOf(oldLeaves, alone)) {
    const run = news.get(anchor) ?? [];
    const pairs = commonRun(olds, run);
    for (const [i, j] of pairs) sure.set((olds[i] as Member).id, (run[j] as Member).id);
    // Past RUN_CELLS the pairs are by key, not in order: nothing lies between them.
    if (olds.length * run.length > RUN_CELLS) continue;
    let i0 = 0;
    let j0 = 0;
    const end: [number, number] = [olds.length, run.length];
    for (const [i, j] of [...pairs, end]) {
      for (let k = 0; i0 + k < i && j0 + k < j; k++) {
        const from = (olds[i0 + k] as Member).id;
        const to = (run[j0 + k] as Member).id;
        if (kindOf(old.get(from)) === kindOf(now.get(to))) leftover.push([from, to]);
      }
      i0 = i + 1;
      j0 = j + 1;
    }
  }
  // Each holder to the one holding most of its nodes' partners; of two holding the same
  // (a section around one card, and the card), the one nearest its size.
  const boxes = new Map<string, string>();
  const claimed = new Set<string>();
  for (const [id, mine] of was.holds) {
    const overlap = new Map<string, [number, number]>();
    for (const n of mine.ids) {
      const partner = sure.get(n);
      for (const h of partner === undefined ? [] : (is.heldBy.get(partner) ?? [])) {
        const [a, b] = overlap.get(h) ?? [0, 0];
        overlap.set(h, [
          a + area(old.get(n)?.box ?? NO_BOX),
          b + area(now.get(partner ?? "")?.box ?? NO_BOX),
        ]);
      }
    }
    const size = area(old.get(id)?.box ?? NO_BOX);
    const unlike = (h: string) => Math.abs(area(now.get(h)?.box ?? NO_BOX) - size);
    let best: string | undefined;
    let score = 0;
    for (const [h, [a, b]] of overlap) {
      const fits = (2 * a > mine.area || 2 * b > (is.holds.get(h)?.area ?? 0)) && !claimed.has(h);
      if (fits && (a + b > score || (a + b === score && unlike(h) < unlike(best ?? h)))) {
        best = h;
        score = a + b;
      }
    }
    if (best !== undefined) {
      boxes.set(id, best);
      claimed.add(best);
    }
  }
  // A pair stands where its matched holders do, a holder matched to nothing (a row's box
  // on one side only) passed over; but not between two holders matched to nothing: in a
  // card that is another card, all of it fades.
  const pairs = new Map(boxes);
  for (const [from, to] of [...sure, ...leftover]) {
    const mine = was.heldBy.get(from) ?? [];
    const into = is.heldBy.get(to) ?? [];
    const other = (h: string | undefined) => h !== undefined && !boxes.has(h);
    const another =
      other(mine.at(-1)) && into.at(-1) !== undefined && !claimed.has(into.at(-1) ?? "");
    const held = mine.filter((h) => boxes.has(h)).at(-1);
    const holds = into.filter((h) => claimed.has(h)).at(-1);
    if (!another && (held === undefined ? undefined : boxes.get(held)) === holds)
      pairs.set(from, to);
  }
  const renamed = new Map<string, string>();
  for (const id of old.keys()) {
    const to = pairs.get(id);
    // Unmatched under an id `after` paints: no id of `after` ends in a letter.
    if (to === undefined ? now.has(id) : to !== id) renamed.set(id, to ?? `${id}-gone`);
  }
  if (renamed.size === 0) return before;
  const entries = before.entries.map((entry) => {
    const id = renamed.get(entry.nodeId);
    return id === undefined ? entry : named(entry, id);
  });
  return { ...before, entries };
}

/** `entry` naming `id`, and a layer's entries with it. */
const named = (entry: DisplayEntry, id: string): DisplayEntry =>
  entry.type === "layer"
    ? { ...entry, nodeId: id, entries: entry.entries.map((e) => named(e, id)) }
    : { ...entry, nodeId: id };

/** The area `r` and `view` share. */
function overlap(r: Rect, view: Rect): number {
  const w = Math.min(r.x + r.width, view.x + view.width) - Math.max(r.x, view.x);
  const h = Math.min(r.y + r.height, view.y + view.height) - Math.max(r.y, view.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/**
 * The entry types a card's or section's box paints, which carry the id of what it holds;
 * a muted control's layer paints its fills.
 */
const BOX_TYPES: readonly string[] = Object.freeze(["fill", "stroke", "shadow", "layer", "image"]);

/**
 * How much of the page an update keeps where the reader looks: of what `before` painted
 * inside `seen` and what `after` paints inside `now` (each in its own content space),
 * the larger share, by area, of paint that has a partner in `aligned` (`alignNodeIds`
 * of the two) showing the same content. A pair between two different contents (the
 * leftovers paired by kind between matches) is not kept, but a box is: it is matched by
 * what it holds, and its id changes with its content. 0 when neither paints a node there.
 */
export function keptShare(
  before: DisplayList,
  aligned: DisplayList,
  after: DisplayList,
  seen: Rect,
  now: Rect,
): number {
  // Each node of `after` an old node partners, by the old node's own id.
  const partner = new Map<string, string>();
  aligned.entries.forEach((e, i) => {
    partner.set(e.nodeId, before.entries[i]?.nodeId ?? "");
  });
  const same = (id: string, other: string | undefined, type: string): boolean =>
    other !== undefined && (BOX_TYPES.includes(type) || keyOf(id) === keyOf(other));
  const share = (entries: readonly DisplayEntry[], view: Rect, kept: (i: number) => boolean) => {
    let all = 0;
    let part = 0;
    entries.forEach((entry, i) => {
      if (entry.nodeId === "") return;
      const a = overlap(entry.bounds, view);
      all += a;
      if (a > 0 && kept(i)) part += a;
    });
    return all === 0 ? 0 : part / all;
  };
  const shown = new Set(after.entries.map((e) => e.nodeId));
  const was = share(aligned.entries, seen, (i) => {
    const { nodeId, type } = aligned.entries[i] as DisplayEntry;
    return shown.has(nodeId) && same(nodeId, before.entries[i]?.nodeId, type);
  });
  const will = share(after.entries, now, (i) => {
    const { nodeId, type } = after.entries[i] as DisplayEntry;
    return same(nodeId, partner.get(nodeId), type);
  });
  return Math.max(was, will);
}

const near = (a: number, b: number): boolean => Math.abs(a - b) <= EPSILON;

function sameRect(a: Rect, b: Rect): boolean {
  return near(a.x, b.x) && near(a.y, b.y) && near(a.width, b.width) && near(a.height, b.height);
}

/** C4's horizontal and vertical coordinates, which a move shifts; nothing else does. */
const X_KEYS: readonly string[] = Object.freeze(["x", "x0", "x1", "cx"]);
const Y_KEYS: readonly string[] = Object.freeze(["y", "y0", "y1", "cy"]);

/** Whether `a`, shifted by (dx, dy), paints what `b` paints. */
function samePaint(a: unknown, b: unknown, dx: number, dy: number, key = ""): boolean {
  if (typeof a === "number" && typeof b === "number") {
    return near(a + (X_KEYS.includes(key) ? dx : Y_KEYS.includes(key) ? dy : 0), b);
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => samePaint(v, b[i], dx, dy));
  }
  if (a !== null && b !== null && typeof a === "object" && typeof b === "object") {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every(
        (k) => k in b && samePaint(a[k as keyof typeof a], b[k as keyof typeof b], dx, dy, k),
      )
    );
  }
  return a === b;
}

/**
 * What changed from `before` to `after`, node by node. A node is moved when its box
 * moved or changed size, and restyled when its entries, moved with the box's corner,
 * paint something else.
 */
export function diffDisplayLists(before: DisplayList, after: DisplayList): ListDiff {
  const old = nodesOf(before);
  const now = nodesOf(after);
  const added: string[] = [];
  const moved: MovedNode[] = [];
  const restyled: string[] = [];
  for (const [nodeId, next] of now) {
    const prev = old.get(nodeId);
    if (prev === undefined) {
      added.push(nodeId);
      continue;
    }
    if (!sameRect(prev.box, next.box)) moved.push({ nodeId, from: prev.box, to: next.box });
    const dx = next.box.x - prev.box.x;
    const dy = next.box.y - prev.box.y;
    if (!samePaint(prev.entries, next.entries, dx, dy)) restyled.push(nodeId);
  }
  const removed = [...old.keys()].filter((nodeId) => !now.has(nodeId));
  return { added, removed, moved, restyled };
}
