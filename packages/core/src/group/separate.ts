// The separation walk: one depth-first pass that cuts a line into structure (md2ui:
// pipeline/grouper_separate.py, Phase 4+5).
//
// It visits each node once and decides, in a fixed order of precedence, how that
// line divides: springs first, then the separators, which always outrank a key-value
// colon (md2ui ADR-205), colon columns and key-values within a piece, and the
// value-compatibility relabel last. Each decision calls the module that owns it.
// `promoteAlignRegions` walks each region it makes, so the recursion is mutual.
import { detectThroughMarkers } from "./annotate.ts";
import { BREAK_TYPES, KEEP_WHEN_EMPTY } from "./block-splits.ts";
import { keepContent } from "./content-edits.ts";
import { type IdMint, inheritGlue } from "./ids.ts";
import { GroupNode, type NodeType } from "./node.ts";
import {
  classificationText,
  extractKeyFromPrefix,
  plainColonKv,
  protectedOf,
  protectedRanges,
  rowSeparatorChars,
} from "./node-reads.ts";
import type { RegexKit } from "./py/re.ts";
import { rstrip } from "./py/str.ts";
import {
  bracketQuoteRanges,
  mergePq,
  partitionRanges,
  type Range,
  sortedRanges,
} from "./ranges.ts";
import {
  type SplitPiece,
  splitAlignRegions,
  splitColonColumns,
  splitSeparators,
} from "./separator-splits.ts";
import { takeEdgeSpacers } from "./spacers.ts";
import { applicable } from "./split/criteria.ts";
import { applyAllDatapointsToNode, flattenEmptyText, partitionDataPoints } from "./split-apply.ts";
import { splitKvStyled } from "./value-splits.ts";

// md2ui: MarkdownGrouper._ANNOTATE_DEFAULT_LABELS. The leaves the walk re-detects.
const ANNOTATE_LABELS: readonly NodeType[] = Object.freeze([
  "text",
  "key",
  "value",
  "list_item",
  "ordered_item",
  "task_open",
  "task_done",
  "bold",
  "italic",
  "strikethrough",
  "inline_code",
  "table_cell",
]);

/** Data points and paren/quote spans detected afresh for `node.content`. */
function reannotate(kit: RegexKit, node: GroupNode): void {
  node.data_points = detectThroughMarkers(kit, node.content);
  node.paren_quote_ranges = mergePq(
    bracketQuoteRanges(
      node.content,
      node.data_points.map((dp) => [dp.start, dp.end] as const),
    ),
  );
}

/** Nodes for a split's pieces. */
function nodesOf(pieces: readonly SplitPiece[]): GroupNode[] {
  return pieces.map(([label, text]) => new GroupNode(text, label));
}

/** The parent's data points and paren/quote spans, partitioned onto `kids`. */
function partitionOnto(
  parent: GroupNode,
  pieces: readonly SplitPiece[],
  kids: readonly GroupNode[],
  pq: readonly Range[],
): void {
  if (parent.data_points.length > 0) {
    partitionDataPoints(parent.content, parent.data_points, pieces).forEach((dps, i) => {
      const kid = kids[i];
      if (kid !== undefined) kid.data_points = dps;
    });
    parent.data_points = [];
  }
  if (pq.length > 0) {
    partitionRanges(parent.content, pq, pieces).forEach((ranges, i) => {
      const kid = kids[i];
      if (kid !== undefined) kid.paren_quote_ranges = ranges;
    });
  }
}

/** The node becomes the container of `kids`, ahead of any children it holds. */
function becomeContainer(node: GroupNode, kids: readonly GroupNode[]): void {
  if (node.type === "text") node.type = "group";
  node.children = [...kids, ...node.children];
  node.content = "";
  node.applicable = null;
}

/**
 * md2ui: `_separate_structured_content_walk`. One depth-first walk that annotates
 * each leaf and cuts it into structure: springs, key-values, separators, colon
 * columns, then the per-piece value pass.
 */
export function separateStructuredContentWalk(kit: RegexKit, node: GroupNode, ids: IdMint): void {
  for (const child of [...node.children]) separateStructuredContentWalk(kit, child, ids);

  // The prune, inline: no content and no children goes, breaks and cells stay.
  node.children = node.children.filter(
    (c) => c.content || c.children.length > 0 || KEEP_WHEN_EMPTY.includes(c.type),
  );
  flattenEmptyText(node);

  if (!node.content) return;

  // Step 1 — annotate.
  if (ANNOTATE_LABELS.includes(node.type))
    node.data_points = detectThroughMarkers(kit, node.content);

  // An image, a link or a break holds a spelling, not content.
  if (node.type === "image" || node.type === "link" || BREAK_TYPES.includes(node.type)) return;

  // A spacer at either end of the line is space around it, not a cut (ADR-203).
  const [lead, trail, rest] = takeEdgeSpacers(node.content);
  if (lead || trail) {
    keepContent(node, rest);
    node.spacer_lead = lead || node.spacer_lead;
    node.spacer_trail = trail || node.spacer_trail;
  }

  // A line ending in a colon (`Panelists:`, `**Bold:**`) is drawn as written: no colon
  // is stripped (ADR-205), and with nothing after it there is no value to pair.
  const stripped = rstrip(node.content);
  if (stripped.endsWith(":") || extractKeyFromPrefix(kit, stripped) !== null) return;

  const pq = node.paren_quote_ranges;

  // The criteria for this node's classification text, cached on the node.
  const criteria =
    node.applicable ?? applicable(classificationText(kit, node.content, node.data_points), kit);
  node.applicable = criteria;
  const keyValueApplicable = criteria.has("KEY_VALUE");
  // Prose declines key-values; a spring still springs on any line.
  const prose = !keyValueApplicable;
  if (prose && promoteAlignRegions(kit, node, sortedRanges(protectedRanges(node)), ids)) return;

  const protectedSpans = protectedOf(
    node.data_points.map((dp) => [dp.start, dp.end] as const),
    pq,
  );
  const sortedProtected = sortedRanges(protectedSpans);

  // Step 1.9 — a spring cuts the line into aligned regions, ahead of the separator /
  // key-value / column chain. `Key: ... Value` is a spring like any other: two regions,
  // the colon kept in the first (ADR-205).
  if (!prose && promoteAlignRegions(kit, node, sortedProtected, ids)) return;

  // Step 2 — separator split; the characters it ate are kept for display. A separator
  // always outranks a key-value colon (ADR-205): `Key: A | B` divides at its pipe as
  // `Key\: A | B` does, and each piece may then pair.
  const sep = splitSeparators(kit, node.content, sortedProtected);
  if (sep !== null) {
    node.separator_chars = rowSeparatorChars(node.content, sortedProtected);
    const kids = nodesOf(sep);
    inheritGlue(node, kids, ids);
    partitionOnto(node, sep, kids, pq);
    becomeContainer(node, kids);
    // Step 2.5 — per-piece colon columns, else a key-value promotion.
    for (const child of kids) {
      const childProtected = protectedRanges(child);
      if (promoteColonColumns(kit, child, childProtected, ids)) continue;
      const kv =
        splitKvStyled(kit, child.content, childProtected) ??
        plainColonKv(kit, child.content, childProtected);
      if (kv === null) continue;
      child.pair_source = [child.type, child.content];
      child.type = "key-value";
      child.children = nodesOf(kv);
      if (child.data_points.length > 0) {
        partitionDataPoints(child.content, child.data_points, kv).forEach((dps, i) => {
          const sub = child.children[i];
          if (sub !== undefined) sub.data_points = dps;
        });
        child.data_points = [];
      }
      if (child.paren_quote_ranges.length > 0) {
        partitionRanges(child.content, child.paren_quote_ranges, kv).forEach((ranges, i) => {
          const sub = child.children[i];
          if (sub !== undefined) sub.paren_quote_ranges = ranges;
        });
        child.paren_quote_ranges = [];
      }
      // Glue before the value's pass, so it inherits rather than mints.
      inheritGlue(child, child.children, ids);
      for (const sub of child.children) {
        if (sub.type === "value") applyAllDatapointsToNode(kit, sub, ids);
      }
      child.content = "";
    }
    // Step 3 — the value pass on every piece.
    for (const child of kids) applyAllDatapointsToNode(kit, child, ids);
    return;
  }

  // Step 2.4 — a spaced-colon COLUMN split, reached only when no separator claimed
  // the line.
  const columns = promoteColonColumns(kit, node, protectedSpans, ids);
  // Step 2.5 — a key-value.
  const kv =
    columns || !keyValueApplicable
      ? null
      : (splitKvStyled(kit, node.content, protectedSpans) ??
        plainColonKv(kit, node.content, protectedSpans));
  if (kv !== null) {
    const kvNode = new GroupNode("", "key-value");
    kvNode.glued_content_id = node.glued_content_id;
    kvNode.pair_source = ["text", node.content];
    kvNode.children = nodesOf(kv);
    partitionOnto(node, kv, kvNode.children, pq);
    inheritGlue(node, kvNode.children, ids);
    for (const child of kvNode.children) {
      if (child.type === "value") applyAllDatapointsToNode(kit, child, ids);
    }
    becomeContainer(node, [kvNode]);
  }
  // Step 3 — the value pass (a promoted node has no content left: a no-op).
  applyAllDatapointsToNode(kit, node, ids);
}

/**
 * md2ui: `_promote_colon_columns`. `node` cut at its spaced colons into STACKED
 * children (`column_split_group`), each then given the value pass. True when it fired.
 */
function promoteColonColumns(
  kit: RegexKit,
  node: GroupNode,
  protectedSpans: readonly Range[],
  ids: IdMint,
): boolean {
  const cols = splitColonColumns(kit, node.content, sortedRanges(protectedSpans));
  if (cols === null) return false;
  const kids = nodesOf(cols);
  partitionOnto(node, cols, kids, node.paren_quote_ranges);
  if (node.paren_quote_ranges.length > 0) node.paren_quote_ranges = [];
  inheritGlue(node, kids, ids);
  becomeContainer(node, kids);
  node.column_split_group = true;
  for (const kid of kids) applyAllDatapointsToNode(kit, kid, ids);
  return true;
}

/**
 * md2ui: `_promote_align_regions`. `node` cut at its springs into aligned regions
 * (`align_group`, each region's `authored_align`), each then walked as a line of its
 * own. One region on a non-TEXT node aligns the node itself. True when it fired.
 */
function promoteAlignRegions(
  kit: RegexKit,
  node: GroupNode,
  protectedSpans: readonly Range[],
  ids: IdMint,
): boolean {
  const regions = splitAlignRegions(kit, node.content, sortedRanges(protectedSpans));
  if (regions === null) return false;
  const lone = regions[0];
  if (regions.length === 1 && lone !== undefined && node.type !== "text") {
    [node.content, node.authored_align] = lone;
    reannotate(kit, node);
    node.applicable = null;
    separateStructuredContentWalk(kit, node, ids);
    return true;
  }
  const pieces = regions.map(([txt]): SplitPiece => ["text", txt]);
  const kids = regions.map(([txt, align]) => {
    const kid = new GroupNode(txt, "text");
    kid.authored_align = align;
    return kid;
  });
  partitionOnto(node, pieces, kids, node.paren_quote_ranges);
  if (node.paren_quote_ranges.length > 0) node.paren_quote_ranges = [];
  inheritGlue(node, kids, ids);
  becomeContainer(node, kids);
  node.align_group = true;
  for (const kid of kids) separateStructuredContentWalk(kit, kid, ids);
  return true;
}
