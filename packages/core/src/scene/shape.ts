// A document's shape: the grouper's structural fingerprints of the
// nodes a reader sees, which a re-sent page with new values everywhere (a weather or a
// dashboard refreshed) keeps and a different document does not. What the view weighs,
// besides the content `keptShare` measures, to tell a new page from an edit.
import type { DisplayList, GroupingNode, Rect } from "@md2ui/contracts";

/** A document's grouping nodes in document order, the root first. */
export interface DocumentShape {
  readonly ids: readonly string[];
  /** Each node's parent, by index; -1 for the root. */
  readonly parents: readonly number[];
  /** Each node's `fingerprint_hash`: its structure, not its content. */
  readonly prints: readonly string[];
}

/** The shape of the grouping tree `root`; once per document. */
export function documentShape(root: GroupingNode): DocumentShape {
  const ids: string[] = [];
  const parents: number[] = [];
  const prints: string[] = [];
  const visit = (node: GroupingNode, parent: number): void => {
    const at = ids.length;
    ids.push(node.node_id);
    parents.push(parent);
    prints.push(String(node.fingerprint_hash));
    for (const child of node.children) visit(child, at);
  };
  visit(root, -1);
  return { ids, parents, prints };
}

const meets = (r: Rect, v: Rect): boolean =>
  r.x < v.x + v.width && r.x + r.width > v.x && r.y < v.y + v.height && r.y + r.height > v.y;

/** The prints of the nodes `list` paints inside `view`, and of all that holds them, in document order. */
function seenPrints(shape: DocumentShape, list: DisplayList, view: Rect): string[] {
  const index = new Map(shape.ids.map((id, i) => [id, i]));
  const marked = new Uint8Array(shape.ids.length);
  for (const entry of list.entries) {
    if (entry.nodeId === "" || !meets(entry.bounds, view)) continue;
    // Up to the root, which every document has, or to a node already marked.
    for (
      let i = index.get(entry.nodeId) ?? -1;
      i > 0 && marked[i] === 0;
      i = shape.parents[i] ?? -1
    ) {
      marked[i] = 1;
    }
  }
  return shape.prints.filter((_, i) => marked[i] === 1);
}

/** Past this many cells, two sequences are compared as multisets, not in order. */
const CELLS = 1_000_000;

/** How many of `a` and `b` pair up in order (their longest common subsequence). */
function common(a: readonly string[], b: readonly string[]): number {
  if (a.length * b.length > CELLS) {
    const left = new Map<string, number>();
    for (const p of a) left.set(p, (left.get(p) ?? 0) + 1);
    return b.filter((p) => {
      const n = left.get(p) ?? 0;
      left.set(p, n - 1);
      return n > 0;
    }).length;
  }
  let prev = new Int32Array(b.length + 1);
  for (const p of a) {
    const row = new Int32Array(b.length + 1);
    for (let j = 1; j <= b.length; j++) {
      row[j] = p === b[j - 1] ? (prev[j - 1] ?? 0) + 1 : Math.max(prev[j] ?? 0, row[j - 1] ?? 0);
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

/**
 * How alike the shapes a reader sees are, before and after an update: of the nodes
 * `before` painted inside `seen` and `after` paints inside `now` (each in its own
 * content space), with what holds them, the share whose structural fingerprints pair up
 * in order, of the longer. 1 for the same page with other values; 0 when neither shows
 * a node.
 */
export function shapeShare(
  was: DocumentShape,
  before: DisplayList,
  seen: Rect,
  is: DocumentShape,
  after: DisplayList,
  now: Rect,
): number {
  const a = seenPrints(was, before, seen);
  const b = seenPrints(is, after, now);
  const longer = Math.max(a.length, b.length);
  return longer === 0 ? 0 : common(a, b) / longer;
}
