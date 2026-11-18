// The element walk, Phase 5.5 (md2ui: markdown_grouper._peel_boundary_dps_walk,
// _peel_elements, _expand_emoji_run_dp): images cut out, then every leaf's boundary
// run of emoji, links and chips peeled, in one post-order walk.
import { detectThroughMarkers } from "./annotate.ts";
import { applySplitterPieces } from "./block-passes.ts";
import { BREAK_TYPES, INLINE_CODE_RE, KEEP_WHEN_EMPTY, splitImages } from "./block-splits.ts";
import { parseEmoji } from "./detect/parsers.ts";
import type { DataPoint } from "./detect/types.ts";
import { splitElements, splitEmojiClusters } from "./element-splits.ts";
import type { IdMint } from "./ids.ts";
import type { GroupNode } from "./node.ts";
import type { RegexKit } from "./py/re.ts";
import { applySplitResult, flattenEmptyText } from "./split-apply.ts";

/**
 * md2ui: `_expand_emoji_run_dp`. One EMOJI data point spanning several visual emoji
 * becomes one per emoji, so each peels to its own node.
 */
function expandEmojiRunDp(content: string, dp: DataPoint): DataPoint[] {
  const spanText = content.slice(dp.start, dp.end);
  const clusters = splitEmojiClusters(spanText);
  if (clusters.length <= 1) return [dp];
  return clusters.map(([start, end]) => {
    const clusterText = spanText.slice(start, end);
    return {
      type: dp.type,
      matched: clusterText,
      value: parseEmoji(clusterText),
      start: dp.start + start,
      end: dp.start + end,
    };
  });
}

/**
 * md2ui: `_peel_boundary_dps_walk` (Phase 5.5). Post-order: unwrap empty TEXT
 * wrappers and drop empty leaves, cut out images, then peel the element run off
 * the pieces that cut made and off the node itself.
 */
export function peelBoundaryDpsWalk(kit: RegexKit, ids: IdMint, node: GroupNode): void {
  for (const child of [...node.children]) peelBoundaryDpsWalk(kit, ids, child);
  flattenEmptyText(node);
  node.children = node.children.filter(
    (c) => c.content || c.children.length > 0 || KEEP_WHEN_EMPTY.includes(c.type),
  );
  // A break's content is its spelling, and an image or link is already an element.
  if (
    node.content &&
    node.type !== "image" &&
    node.type !== "link" &&
    !BREAK_TYPES.includes(node.type)
  ) {
    const result = splitImages(kit, node.content);
    if (result !== null) {
      for (const piece of applySplitterPieces(ids, node, result)) peelElements(kit, ids, piece);
    }
  }
  peelElements(kit, ids, node);
}

/**
 * md2ui: `_peel_elements`. The node's boundary element run peeled, on data points
 * detected afresh (marker repair can shift a boundary value off its annotation),
 * one per visual emoji; values inside a paren/quote span stay inline.
 */
function peelElements(kit: RegexKit, ids: IdMint, node: GroupNode): void {
  if (
    !node.content ||
    node.type === "image" ||
    node.type === "link" ||
    node.type === "emoji" ||
    node.type === "datapoint" ||
    node.type === "inline_code" // literal code: never peel its contents
  ) {
    return;
  }
  const detected = detectThroughMarkers(kit, node.content);
  // A backtick span is an element but not a data point.
  if (detected.length === 0 && !kit.re(INLINE_CODE_RE).test(node.content)) return;
  const dps = detected.flatMap((dp) =>
    dp.type === "emoji" ? expandEmojiRunDp(node.content, dp) : [dp],
  );
  const pq = node.paren_quote_ranges;
  const effective =
    pq.length > 0
      ? dps.filter((dp) => !pq.some(([ps, pe]) => ps <= dp.start && dp.end <= pe))
      : dps;
  // A remainder split out of the root is plain TEXT.
  const pieceLabel = node.type === "root" ? "text" : node.type;
  const result = splitElements(kit, node.content, pieceLabel, effective);
  if (result === null) return;
  // The partition uses the fresh positions.
  node.data_points = dps;
  applySplitResult(node, result, pq, ids);
}
