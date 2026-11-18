// The block passes Phases 1, 2 and 2.1 share, at the top level and inside a card
// body (md2ui: markdown_grouper's _subgroup_content, _subgroup_content_classified_multi
// and the walks around them): blank-line and newline splits, the list and quote
// splitters, list-body restructuring, ordinals, the empty-leaf prune, line ids.
import {
  BREAK_TYPES,
  KEEP_WHEN_EMPTY,
  type Piece,
  splitBlankLines,
  splitNewlines,
  stampColumnDivider,
} from "./block-splits.ts";
import { buildItemRows, handDownValign } from "./column-rows.ts";
import { type IdMint, inheritGlue } from "./ids.ts";
import { GroupNode, HEADING_TYPE_RE, type NodeType } from "./node.ts";
import type { RegexKit } from "./py/re.ts";
import { strip, toInt } from "./py/str.ts";
import { flattenEmptyText, partitionDataPoints } from "./split-apply.ts";

/** A block splitter: md2ui's `(label, text[, number])` pieces, or null. */
type Splitter = (kit: RegexKit, content: string) => Piece[] | null;

// md2ui: MarkdownGrouper._LIST_ITEM_LABELS. Items whose bodies are restructured.
const LIST_ITEM_LABELS: readonly NodeType[] = Object.freeze([
  "list_item",
  "ordered_item",
  "task_open",
  "task_done",
  "blockquote",
]);

/**
 * md2ui: `_stamp_list_ordinals`. Each ORDERED_ITEM's ordinal: a run of ordered
 * siblings starts at the number the author wrote and counts up. An item split out of
 * a heading also records that heading's level.
 */
export function stampListOrdinals(kit: RegexKit, node: GroupNode): void {
  const heading = kit.re(HEADING_TYPE_RE).match(node.type);
  let counter = 0;
  let inRun = false;
  for (const child of node.children) {
    if (child.type === "ordered_item") {
      counter = !inRun && child.list_number !== null ? child.list_number : counter + 1;
      inRun = true;
      child.list_ordinal = counter;
      if (heading !== null) child.list_heading_level = toInt(heading.text(1));
    } else {
      counter = 0;
      inRun = false;
    }
    stampListOrdinals(kit, child);
  }
}

/** md2ui: `_prune_empty`. Drops leaf children with no content, except `KEEP_WHEN_EMPTY`. */
export function pruneEmpty(node: GroupNode): void {
  for (const child of [...node.children]) pruneEmpty(child);
  node.children = node.children.filter(
    (c) => c.content || c.children.length > 0 || KEEP_WHEN_EMPTY.includes(c.type),
  );
}

/** md2ui's `if node.data_points:` step of a split: the parent's values move onto its pieces. */
function partitionDataPointsOnto(
  node: GroupNode,
  result: readonly Piece[],
  children: readonly GroupNode[],
): void {
  if (node.data_points.length === 0) return;
  partitionDataPoints(node.content, node.data_points, result).forEach((dps, i) => {
    const child = children[i];
    if (child !== undefined) child.data_points = dps;
  });
  node.data_points = [];
}

/**
 * md2ui: `_subgroup_content`. Depth-first: `splitter` applied to every node with
 * content. Returns the pieces for the parent to splice in place of a leaf TEXT node,
 * or null when the node stays (as a group holding its pieces, if it was split).
 *
 * `crossesSegments` is for the blank-line split only: its first piece continues the
 * parent's glued segment and each later multi-line piece starts a fresh one.
 * `mintsSegments` is for the newline split only: an untagged node split into lines
 * is one glued segment of its own.
 */
export function subgroupContent(
  kit: RegexKit,
  ids: IdMint,
  node: GroupNode,
  splitter: Splitter,
  crossesSegments: boolean,
  mintsSegments: boolean,
): GroupNode[] | null {
  const children: GroupNode[] = [];
  for (const child of [...node.children]) {
    const spliced = subgroupContent(kit, ids, child, splitter, crossesSegments, mintsSegments);
    if (spliced === null) children.push(child);
    else children.push(...spliced);
  }
  node.children = children;
  flattenEmptyText(node);

  if (!node.content) return null;
  // A BREAK leaf's content is the spelling the author wrote, never content to parse.
  if (BREAK_TYPES.includes(node.type)) return null;

  // md2ui's single-piece branch is unreachable here: both splitters on the
  // `process()` path answer null for fewer than two pieces. Nor do these phases
  // run after data points are annotated, so there are none to partition.
  const result = splitter(kit, node.content);
  if (result === null) return null;

  const pieces = result.map(([type, content]) => new GroupNode(content, type));
  if (crossesSegments) {
    result.forEach(([, text], i) => {
      const piece = pieces[i] as GroupNode;
      if (i === 0 && node.glued_content_id !== null) {
        // Continuation of the parent's segment: a member, not its own wrapper.
        piece.glued_content_id = node.glued_content_id;
      } else if (text.includes("\n")) {
        // A fresh multi-line paragraph segment: it is its own wrapper.
        piece.glued_content_id = ids.nextGlued();
        piece.glue_root = true;
      }
    });
  } else {
    let segId = node.glued_content_id;
    // A lone multi-line paragraph: one glued segment of its own.
    if (segId === null && mintsSegments && pieces.length >= 2) segId = ids.nextGlued();
    if (segId !== null) {
      for (const piece of pieces) piece.glued_content_id ??= segId;
    }
  }

  // A leaf TEXT being split: its pieces replace it in the parent.
  if (node.type === "text" && node.children.length === 0) {
    handDownValign(node, pieces); // a `...` region's place goes too
    return pieces;
  }

  // Content-derived children go before existing heading children.
  if (node.type === "text") node.type = "group";
  node.children = [...pieces, ...node.children];
  node.content = "";
  return null;
}

/**
 * md2ui: `_subgroup_content_classified_multi`. One walk applying several splitters:
 * the first that splits a node hands its pieces to the rest.
 */
export function subgroupContentClassifiedMulti(
  kit: RegexKit,
  ids: IdMint,
  node: GroupNode,
  splitters: readonly Splitter[],
): void {
  for (const child of [...node.children])
    subgroupContentClassifiedMulti(kit, ids, child, splitters);
  flattenEmptyText(node);

  // An image, a link or a break holds a spelling, not content to parse.
  if (
    !node.content ||
    node.type === "image" ||
    node.type === "link" ||
    BREAK_TYPES.includes(node.type)
  ) {
    return;
  }
  for (const [i, splitter] of splitters.entries()) {
    if (!node.content) continue;
    const result = splitter(kit, node.content);
    if (result === null) continue;
    if (applySplitterPieces(ids, node, result).length > 0) {
      for (const remaining of splitters.slice(i + 1)) {
        for (const child of [...node.children]) applySplitterRecursive(kit, ids, child, remaining);
      }
      break;
    }
  }
}

/**
 * md2ui: `_apply_splitter_pieces`. Puts a splitter's pieces into `node`: one
 * whole-content piece is absorbed by a TEXT or SEGMENT; otherwise the pieces
 * become its leading children. Returns the children it nested.
 */
export function applySplitterPieces(
  ids: IdMint,
  node: GroupNode,
  result: readonly Piece[],
): GroupNode[] {
  const only = result[0];
  if (
    result.length === 1 &&
    only !== undefined &&
    node.children.length === 0 &&
    (node.type === "text" || node.type === "segment")
  ) {
    node.type = only[0];
    node.content = only[1];
    node.list_number = only[2] ?? null;
    return [];
  }
  const children = result.map((piece) => {
    const child = new GroupNode(piece[1], piece[0]);
    child.list_number = piece[2] ?? null;
    return child;
  });
  inheritGlue(node, children, ids);
  partitionDataPointsOnto(node, result, children);
  if (node.type === "text") node.type = "group";
  node.children = [...children, ...node.children];
  node.content = "";
  node.applicable = null;
  return children;
}

/** md2ui: `_apply_splitter_recursive`. One splitter, depth-first, absorbing a single piece. */
function applySplitterRecursive(
  kit: RegexKit,
  ids: IdMint,
  node: GroupNode,
  splitter: Splitter,
): void {
  for (const child of [...node.children]) applySplitterRecursive(kit, ids, child, splitter);
  flattenEmptyText(node);
  if (!node.content) return;
  const result = splitter(kit, node.content);
  if (result === null) return;
  const only = result[0];
  if (result.length === 1 && only !== undefined && node.children.length === 0) {
    node.type = only[0];
    node.content = only[1];
    return;
  }
  const children = result.map((piece) => new GroupNode(piece[1], piece[0]));
  inheritGlue(node, children, ids);
  partitionDataPointsOnto(node, result, children);
  if (node.type === "text") node.type = "group";
  node.children = [...children, ...node.children];
  node.content = "";
}

/**
 * md2ui: `_restructure_list_bodies`. Post-order: each list-item / blockquote body
 * blank-split then newline-split like a mini-document, then its scoped `:::` rows.
 */
export function restructureListBodies(kit: RegexKit, ids: IdMint, node: GroupNode): void {
  for (const child of [...node.children]) restructureListBodies(kit, ids, child);
  if (LIST_ITEM_LABELS.includes(node.type) && node.content) {
    subgroupContent(kit, ids, node, splitBlankLines, true, false);
    subgroupContent(kit, ids, node, splitNewlines, false, true);
    buildItemRows(kit, node, stampColumnDivider);
  }
}

/** md2ui: `_assign_source_line_ids`. A fresh line id on every single-line content leaf. */
export function assignSourceLineIds(ids: IdMint, node: GroupNode): void {
  if (node.children.length > 0) {
    for (const c of node.children) assignSourceLineIds(ids, c);
    return;
  }
  const stripped = strip(node.content);
  if (stripped && !stripped.includes("\n")) node.source_line_id = ids.nextSourceLine();
}
