// Structural fingerprints, same-kind runs and text lengths (md2ui:
// markdown_grouper.ASTPatternAnalyzer.fingerprints, Phase 6.5).
//
// Every node gets a content-derived `node_id` (see `assignContentIds`), an order-preserving structural
// `fingerprint_hash`, the normalized `kind_hash`, its contiguous same-kind runs
// (`run_key`, `repeated_children`, `orphan_grid`) and the average leaf word count of
// its fingerprint cluster as `text_length_category`. Spacers are silenced (ADR-203).
import { isDatapointSplitGroup } from "./glue.ts";
import { fnv1a64, kindSignatures, type LineKindMemo, treeSimilar } from "./kinds.ts";
import type { GroupNode } from "./node.ts";
import type { RegexKit } from "./py/re.ts";
import { split } from "./py/str.ts";

type Category = NonNullable<GroupNode["text_length_category"]>;

// md2ui: _TEXT_LENGTH_CATEGORY_ORDER
const CATEGORY_ORDER: readonly Category[] = Object.freeze([
  "one_word",
  "very_short",
  "short",
  "medium",
  "paragraph",
  "long_paragraph",
]);

/** md2ui: `_word_count_category`. A word count bucketed into a text-length category. */
function wordCountCategory(wc: number): Category {
  if (wc <= 1) return "one_word";
  if (wc <= 4) return "very_short";
  if (wc <= 9) return "short";
  if (wc <= 40) return "medium";
  if (wc <= 100) return "paragraph";
  return "long_paragraph";
}

/**
 * Python's `round(x, 2)`: the nearest hundredth of the stored value, a true tie
 * (which only a short binary fraction such as 0.125 can be) going to the even digit.
 */
function round2(x: number): number {
  // A true tie is an odd number of two-hundredths, so x * 200 is then an exact integer;
  // any other x rounds as `toFixed` rounds it, without the 100-digit expansion below.
  if (!Number.isInteger(x * 200)) return Number(x.toFixed(2));
  const exact = Math.abs(x).toFixed(100);
  const [, fraction = ""] = exact.split(".");
  const rest = fraction.slice(2);
  if (/^50*$/.test(rest)) {
    const down = Math.trunc(Math.abs(x) * 100) / 100;
    const lastDigit = Number(fraction[1] ?? "0");
    const up = (Math.trunc(Math.abs(x) * 100) + 1) / 100;
    const chosen = lastDigit % 2 === 0 ? down : up;
    return x < 0 ? -chosen : chosen;
  }
  return Number(x.toFixed(2));
}

/**
 * md2ui: `drawn_word_count`. The words a leaf's own content draws. A picture draws
 * none: its alt text and URL never reach the page.
 */
function drawnWordCount(node: GroupNode): number {
  return node.type === "image" ? 0 : split(node.content).length;
}

/**
 * Content-derived node ids (ADR-104), where md2ui assigns its tree-path `node_id`.
 *
 * DEPARTS FROM md2ui, whose id is the node's path (`0.2.1`), so inserting one section
 * renumbers every node after it. Here a node's id is the key of its own subtree, then
 * its occurrence among earlier nodes with that key in document order (`9f3c…-0`). The
 * id names no ancestor, so an edit re-ids only the edited node and the nodes that hold
 * it. The occurrence makes every id unique, as md2ui's are, so the partition
 * conformance compares is unchanged. The root keeps md2ui's id, the empty path.
 */
function assignContentIds(root: GroupNode): void {
  root.node_id = "";
  const seen = new Map<string, number>();
  // A subtree's key, held in `node_id` until the node is stamped: its `type` and
  // `content`, then its children's keys in order. Each field carries its length and
  // each key has one width, so no two subtrees encode alike.
  const keyOf = (node: GroupNode): string => {
    const children = node.children.map(keyOf).join("");
    const key = BigInt.asUintN(
      64,
      fnv1a64(`${node.type}:${node.content.length}:${node.content}:${children}`),
    )
      .toString(16)
      .padStart(16, "0");
    node.node_id = key;
    return key;
  };
  const stamp = (node: GroupNode): void => {
    const key = node.node_id;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    node.node_id = `${key}-${occurrence}`;
    for (const c of node.children) stamp(c);
  };
  for (const block of root.children) {
    keyOf(block);
    stamp(block);
  }
}

/** md2ui: `ASTPatternAnalyzer`, the `fingerprints(include_unique=True)` call. */
class PatternAnalyzer {
  private readonly kit: RegexKit;
  private readonly index: GroupNode[] = [];

  constructor(kit: RegexKit) {
    this.kit = kit;
  }
  private readonly wordCounts = new Map<bigint, number[]>();
  private readonly lineKinds: LineKindMemo = new Map();
  private readonly hashes = new Map<string, bigint>();

  private hash(s: string): bigint {
    let h = this.hashes.get(s);
    if (h === undefined) {
      h = fnv1a64(s);
      this.hashes.set(s, h);
    }
    return h;
  }

  run(root: GroupNode): void {
    assignContentIds(root);
    this.build(root);
    this.lineKinds.clear();
    this.annotateTextLengths(root);
  }

  /**
   * md2ui: `_annotate_orphans`. In each same-kind run, a child whose kind grids in
   * some member but occurs once in its own is an orphaned repeated element.
   */
  private annotateOrphans(node: GroupNode): void {
    for (const run of node.repeated_children?.values() ?? []) {
      const repeated = new Set<bigint>();
      for (const m of run) {
        for (const bucket of m.repeated_children?.values() ?? []) {
          const kind = bucket[0]?.kind_hash;
          if (bucket.length >= 2 && kind !== null && kind !== undefined) repeated.add(kind);
        }
      }
      if (repeated.size === 0) continue;
      for (const m of run) {
        const counts = new Map<bigint, number>();
        for (const c of m.children) {
          if (c.kind_hash !== null) counts.set(c.kind_hash, (counts.get(c.kind_hash) ?? 0) + 1);
        }
        for (const c of m.children) {
          if (c.kind_hash !== null && repeated.has(c.kind_hash) && counts.get(c.kind_hash) === 1) {
            c.orphan_grid = true;
          }
        }
      }
    }
  }

  /** md2ui: `_build_fingerprint`. Bottom-up: `[fingerprint, leaf words, kind for the parent]`. */
  private build(node: GroupNode): [string, number, string] {
    const results = node.children.map((child) => this.build(child));
    // A spacer is indexed like any child but is no part of what its parent matches.
    const kept = results.filter((_, i) => node.children[i]?.type !== "spacer");
    const childFps = kept.map((r) => r[0]);
    const childKinds = kept.map((r) => r[2]);
    const [kindSig, kindUp] = kindSignatures(this.kit, node, childKinds);

    // Maximal contiguous same-kind runs: exact kind, or a card within tolerance of
    // the run's seed. Spacers are read straight past.
    const kids = node.children.filter((c) => c.type !== "spacer");
    const buckets = new Map<bigint, GroupNode[]>();
    for (let i = 0; i < kids.length; ) {
      const seed = kids[i] as GroupNode;
      let j = i + 1;
      while (j < kids.length) {
        const cur = kids[j] as GroupNode;
        const prev = kids[j - 1] as GroupNode;
        const joined =
          (cur.kind_hash !== null && cur.kind_hash === prev.kind_hash) ||
          (seed.children.length > 0 &&
            cur.children.length > 0 &&
            treeSimilar(this.kit, seed, cur, this.lineKinds));
        if (!joined) break;
        j += 1;
      }
      const run = kids.slice(i, j);
      if (run.length >= 2 && run.every((m) => m.kind_hash !== null)) {
        const runKey = this.hash(`${run[0]?.node_id ?? ""}#run`);
        for (const m of run) m.run_key = runKey;
        buckets.set(runKey, run);
      }
      i = j > i ? j : i + 1;
    }
    node.repeated_children = buckets;
    this.annotateOrphans(node);

    node.child_types = node.children.map((c) => c.type);
    const typeCounts: Record<string, number> = {};
    for (const t of node.child_types) typeCounts[t] = (typeCounts[t] ?? 0) + 1;
    node.child_type_counts = typeCounts;

    let fp = `${node.type}(${childFps.join(",")})`;
    const leafWc =
      node.children.length === 0 ? drawnWordCount(node) : kept.reduce((s, r) => s + r[1], 0);
    // A value line, split or whole, fingerprints as plain text.
    if (isDatapointSplitGroup(node) || (node.children.length === 0 && node.type === "datapoint")) {
      fp = "text()";
    }
    // No earlier pass's run survives: a spacer document is analyzed twice.
    node.run_key = null;
    node.orphan_grid = false;
    node.fingerprint_hash = this.hash(fp);
    node.kind_hash = this.hash(kindSig);
    this.index.push(node);
    const counts = this.wordCounts.get(node.fingerprint_hash);
    if (counts === undefined) this.wordCounts.set(node.fingerprint_hash, [leafWc]);
    else counts.push(leafWc);
    return [fp, leafWc, kindUp];
  }

  /**
   * md2ui: `_annotate_text_lengths`. Each node takes its fingerprint cluster's average
   * leaf word count; each leaf its own length; a container the longest of its children's.
   */
  private annotateTextLengths(root: GroupNode): void {
    const average = new Map<bigint, number>();
    for (const [h, counts] of this.wordCounts) {
      average.set(h, counts.reduce((s, c) => s + c, 0) / counts.length);
    }
    for (const node of this.index) {
      const avg = node.fingerprint_hash === null ? undefined : average.get(node.fingerprint_hash);
      if (avg === undefined) continue;
      node.avg_word_count = round2(avg);
      node.text_length_category = wordCountCategory(avg);
    }
    for (const node of this.index) {
      if (node.content && node.children.length === 0) {
        node.content_length_category = wordCountCategory(drawnWordCount(node));
      }
    }
    const propagate = (node: GroupNode): void => {
      for (const c of node.children) propagate(c);
      if (node.content || node.children.length === 0) return;
      for (const attr of ["text_length_category", "content_length_category"] as const) {
        const cats = node.children.map((c) => c[attr]).filter((c): c is Category => c !== null);
        if (cats.length > 0) {
          node[attr] = cats.reduce((best, c) =>
            CATEGORY_ORDER.indexOf(c) > CATEGORY_ORDER.indexOf(best) ? c : best,
          );
        }
      }
    };
    propagate(root);
  }
}

/** md2ui: `ASTPatternAnalyzer(root).fingerprints(include_unique=True)` (Phase 6.5). */
export function fingerprints(kit: RegexKit, root: GroupNode): void {
  new PatternAnalyzer(kit).run(root);
}
