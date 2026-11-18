// Turning a split result into children, and the housekeeping that follows (md2ui:
// pipeline/grouper_split_apply.py): the pieces become nodes, each takes the data
// points and paren/quote spans that fall inside it with every offset rebased, and
// the parent's glue.
import type { DataPoint } from "./detect/types.ts";
import type { ElementPiece } from "./element-splits.ts";
import { type IdMint, inheritGlue } from "./ids.ts";
import { detectStyleWrap, SPLIT_WRAP_CHARS } from "./inline-marks.ts";
import { GroupNode, type NodeType } from "./node.ts";
import { classificationText } from "./node-reads.ts";
import type { RegexKit } from "./py/re.ts";
import { lstrip, rstrip, strip } from "./py/str.ts";
import { partitionRanges, type Range } from "./ranges.ts";
import type { SplitPiece } from "./separator-splits.ts";
import { applicable } from "./split/criteria.ts";
import { BOUNDARY_DP_TYPES } from "./value-splits.ts";

// md2ui: _RECOVERY_MARKERS. Markers a split can have ADDED to a piece, longest first.
const RECOVERY_MARKERS = ["***", "___", "~~", "**", "__", "*", "_", "`"] as const;

// md2ui: _LABEL_IS_A_ROLE. Labels a node keeps when a split leaves one piece: the
// type IS the node's role (the bullet, the ordinal, the quote bar, the cell, the value).
const LABEL_IS_A_ROLE: readonly NodeType[] = Object.freeze([
  "root",
  "value",
  "list_item",
  "ordered_item",
  "blockquote",
  "table_cell",
]);

/** md2ui: `_flatten_empty_text`. Unwraps each contentless TEXT child into its children. */
export function flattenEmptyText(node: GroupNode): void {
  const children: GroupNode[] = [];
  for (const c of node.children) {
    if (c.type === "text" && !c.content && c.children.length > 0) children.push(...c.children);
    else children.push(c);
  }
  node.children = children;
}

/**
 * md2ui: `_hand_data_points`. Each of `children` takes the data points inside its
 * piece of `node`'s content, and `node` keeps none: it is about to become their
 * empty container, and a data point it kept would index text it no longer has.
 */
export function handDataPoints(
  node: GroupNode,
  children: readonly GroupNode[],
  pieces: readonly string[],
): void {
  const labelled = pieces.map((piece) => ["", piece] as const);
  partitionDataPoints(node.content, node.data_points, labelled).forEach((share, i) => {
    const child = children[i];
    if (child !== undefined) child.data_points = share;
  });
  node.data_points = [];
}

/**
 * md2ui: `_partition_data_points`. Each data point handed to the first piece whose
 * span in the parent holds it whole, rebased to that piece; one across a cut is
 * dropped. A piece a split added markers to is found by stripping them back off.
 */
export function partitionDataPoints(
  parentContent: string,
  dataPoints: readonly DataPoint[],
  result: readonly (readonly [string, string, ...unknown[]])[],
): DataPoint[][] {
  const partitioned: DataPoint[][] = result.map(() => []);
  if (dataPoints.length === 0) return partitioned;

  const childRanges: ([number, number, number] | null)[] = [];
  let searchFrom = 0;
  for (const [, text] of result) {
    if (!text) {
      childRanges.push(null);
      continue;
    }
    let leadingOffset = 0;
    let idx = parentContent.indexOf(text, searchFrom);
    let length = text.length;
    if (idx === -1) {
      const stripped = strip(text);
      idx = parentContent.indexOf(stripped, searchFrom);
      length = stripped.length;
    }
    if (idx === -1) {
      const core = strip(text);
      for (const m of RECOVERY_MARKERS) {
        if (core.endsWith(m)) {
          const candidate = core.slice(0, -m.length);
          const i2 = parentContent.indexOf(candidate, searchFrom);
          if (i2 >= 0) {
            idx = i2;
            length = candidate.length;
          }
          break;
        }
      }
      if (idx === -1) {
        for (const m of RECOVERY_MARKERS) {
          if (core.startsWith(m)) {
            const candidate = core.slice(m.length);
            const i2 = parentContent.indexOf(candidate, searchFrom);
            if (i2 >= 0) {
              idx = i2;
              length = candidate.length;
              leadingOffset = m.length;
            }
            break;
          }
        }
      }
    }
    if (idx >= 0) {
      childRanges.push([idx, idx + length, leadingOffset]);
      // Past the matched span, so a later piece with identical text finds its own.
      searchFrom = idx + length;
    } else {
      childRanges.push(null);
    }
  }

  for (const dp of dataPoints) {
    for (const [i, r] of childRanges.entries()) {
      if (r === null) continue;
      const [cStart, cEnd, leadOff] = r;
      if (dp.start >= cStart && dp.end <= cEnd) {
        partitioned[i]?.push({
          ...dp,
          start: dp.start - cStart + leadOff,
          end: dp.end - cStart + leadOff,
        });
        break;
      }
    }
  }
  return partitioned;
}

// md2ui: _is_whole_annotate_only_value. Exactly one value this pass no longer extracts.
function isWholeAnnotateOnlyValue(
  kit: RegexKit,
  node: GroupNode,
  dataPoints: readonly DataPoint[],
): boolean {
  const point = dataPoints[0];
  if (node.children.length > 0 || dataPoints.length !== 1 || point === undefined) return false;
  if (BOUNDARY_DP_TYPES.includes(point.type)) return false;
  const exactOffsets = point.start === 0 && point.end === node.content.length;
  const plainWhole = node.content === strip(node.content) && exactOffsets;
  const leadOffset = node.content.length - lstrip(node.content).length;
  const styleWrap = detectStyleWrap(
    kit,
    node.content,
    leadOffset,
    rstrip(node.content).length,
    SPLIT_WRAP_CHARS,
  );
  const wrappedWhole =
    styleWrap !== null && point.start === styleWrap[1] && point.end === styleWrap[2];
  return plainWhole || wrappedWhole;
}

/**
 * md2ui: `_apply_all_datapoints_to_node`. Since md2ui's T8 no value is cut out of
 * its line (`_split_all_datapoints` always answers None), so all that is left is the
 * compatibility relabel: a node that is exactly one whole structured value keeps the
 * pre-T8 shape, `VALUE(TEXT)` for a role, TEXT for a segment. The split criteria
 * are cached on the node either way.
 */
export function applyAllDatapointsToNode(kit: RegexKit, node: GroupNode, ids: IdMint): void {
  if (
    !node.content ||
    node.type === "image" ||
    node.type === "link" ||
    node.type === "emoji" ||
    node.type === "datapoint"
  ) {
    return;
  }
  node.applicable ??= applicable(classificationText(kit, node.content, node.data_points), kit);
  const pq = node.paren_quote_ranges;
  // A value inside a paren/quote span is not split out; it rides with its leaf.
  const effective =
    pq.length > 0
      ? node.data_points.filter((dp) => !pq.some(([ps, pe]) => ps <= dp.start && dp.end <= pe))
      : node.data_points;
  if (!isWholeAnnotateOnlyValue(kit, node, effective)) return;
  if (!node.applicable.has("KEY_VALUE")) return;
  // md2ui: _whole_annotate_only_piece — only a role or a segment is relabelled.
  if (!LABEL_IS_A_ROLE.includes(node.type) && node.type !== "segment") return;
  applySplitResult(node, [["text", node.content]], pq, ids);
}

/**
 * md2ui: `_apply_split_result`. `node.content` replaced by the split's pieces: one
 * whole piece relabels the node in place, unless its label is a role; otherwise the
 * pieces become its leading children, with the annotations re-homed onto them.
 */
export function applySplitResult(
  node: GroupNode,
  result: readonly (SplitPiece | ElementPiece)[],
  pq: readonly Range[],
  ids: IdMint,
): void {
  const only = result[0];
  if (
    result.length === 1 &&
    only !== undefined &&
    node.children.length === 0 &&
    !LABEL_IS_A_ROLE.includes(node.type)
  ) {
    // A piece shorter than the content needs its annotations rebased onto it.
    const sameText = only[1] === node.content;
    const dps = sameText
      ? [...node.data_points]
      : (partitionDataPoints(node.content, node.data_points, [only])[0] ?? []);
    const pqs = sameText ? [...pq] : (partitionRanges(node.content, pq, [only])[0] ?? []);
    node.type = only[0];
    node.content = only[1];
    node.data_points = dps;
    node.paren_quote_ranges = pqs;
    stampElementPiece(node, only);
    return;
  }
  const children = buildSplitChildren(node, result, pq, ids);
  node.data_points = [];
  if (node.type === "text") node.type = "group";
  node.children = [...children, ...node.children];
  node.content = "";
  node.applicable = null;
}

/**
 * md2ui: `_stamp_element_piece`. What an emoji's or chip's split piece carried past the
 * peel: the variant its wrapper selected (an emoji's on the `*` ladder only), then
 * whether `~~` muted it. Both wrappers are gone from `content`, so this is their only
 * record.
 */
function stampElementPiece(node: GroupNode, piece: SplitPiece | ElementPiece): void {
  if (node.type !== "emoji" && node.type !== "inline_code") return;
  const variant = piece[2];
  if (node.type === "emoji") {
    if (variant === "secondary" || variant === "tertiary" || variant === "quaternary") {
      node.emoji_variant = variant;
    }
  } else if (variant !== undefined && variant !== null) {
    node.code_variant = variant;
  }
  node.element_muted = piece[3] ?? false;
}

/**
 * md2ui: `_build_split_children`. Child nodes for a split's pieces, with the
 * parent's data points and paren/quote spans partitioned onto them and its glue
 * inherited. Leaves `node` itself alone.
 */
function buildSplitChildren(
  node: GroupNode,
  result: readonly (SplitPiece | ElementPiece)[],
  pq: readonly Range[],
  ids: IdMint,
): GroupNode[] {
  const children = result.map((piece) => {
    const child = new GroupNode(piece[1], piece[0]);
    stampElementPiece(child, piece);
    return child;
  });
  inheritGlue(node, children, ids);
  if (node.data_points.length > 0) {
    partitionDataPoints(node.content, node.data_points, result).forEach((dps, i) => {
      const child = children[i];
      if (child !== undefined) child.data_points = dps;
    });
  }
  if (pq.length > 0) {
    partitionRanges(node.content, pq, result).forEach((ranges, i) => {
      const child = children[i];
      if (child !== undefined) child.paren_quote_ranges = ranges;
    });
  }
  return children;
}
