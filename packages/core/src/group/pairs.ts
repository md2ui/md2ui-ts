// A pair exists only while a display reads it (md2ui: pipeline/grouper_pairs.py,
// ADR-205).
//
// The separation walk still cuts `Key: value` into a `key-value` pair, because the
// displays read their label and value from one: a percentage bar, a ratio ring, a line,
// a chart row, a slider. Once the displays and the charts are decided (Phases
// 6.06–6.07), a pair that holds none goes back to the line its author wrote, colon and
// markers kept, as one text: the node the line is when its colon is escaped and never
// pairs. A pair that holds one is untouched, so every display draws as it did.
import { detectThroughMarkers } from "./annotate.ts";
import { splitImages } from "./block-splits.ts";
import { restoreEscapedTaskControls } from "./drawing-elements.ts";
import { GroupNode, type NodeType } from "./node.ts";
import type { RegexKit } from "./py/re.ts";
import { bracketQuoteRanges, mergePq } from "./ranges.ts";
import { restoreEscapedSliders } from "./sliders.ts";

/** md2ui `unpair_unread` (Phase 6.075): every pair under `node` no display claimed, back to its line. */
export function unpairUnread(kit: RegexKit, node: GroupNode, inChart = false): void {
  const within = inChart || node.chart_group || node.line_group;
  let restored = false;
  node.children.forEach((child, i) => {
    if (child.type === "key-value" && child.pair_source !== null && !within && !draws(child)) {
      node.children[i] = asWritten(kit, child, child.pair_source);
      restored = true;
    } else {
      unpairUnread(kit, child, within);
    }
  });
  if (node.children.length === 1 && restored) wholeLineAgain(node);
}

/** md2ui `_draws`: whether `node` or anything in it is drawn as a display or a control. */
function draws(node: GroupNode): boolean {
  return (
    Boolean(node.datapoint_display) || node.type === "drawing_element" || node.children.some(draws)
  );
}

/**
 * md2ui `_as_written`: the line `pair` was cut from, as one node in its place. A picture
 * written on it is a picture, so the line comes back as its escaped twin does: its text
 * and its pictures, side by side on one line. The source was taken before Phase 5.55 put
 * an escaped control's bracket back, so it is put back here too: `Volume: \[65%]` is drawn
 * `Volume: [65%]`.
 */
function asWritten(
  kit: RegexKit,
  pair: GroupNode,
  [kind, content]: NonNullable<GroupNode["pair_source"]>,
): GroupNode {
  const pieces = splitImages(kit, content);
  let line: GroupNode;
  if (pieces === null) line = piece(kit, kind, content, pair);
  else {
    line = piece(kit, "group", "", pair);
    line.children = pieces.map(([t, part]) => piece(kit, t === "text" ? kind : t, part, pair));
  }
  restoreEscapedTaskControls(kit, line);
  restoreEscapedSliders(kit, line);
  return line;
}

/** md2ui `_piece`: one node of `pair`'s line, on that line. */
function piece(kit: RegexKit, kind: NodeType, content: string, pair: GroupNode): GroupNode {
  const node = new GroupNode(content, kind);
  node.node_id = pair.node_id;
  node.glued_content_id = pair.glued_content_id;
  // md2ui's `or`: a pair on line 0 asks its leaves too.
  node.source_line_id = pair.source_line_id || firstLineId(pair);
  if (content && kind !== "image") {
    node.text_style = sharedStyle(pair);
    node.data_points = detectThroughMarkers(kit, content);
    node.paren_quote_ranges = mergePq(
      bracketQuoteRanges(
        content,
        node.data_points.map((dp) => [dp.start, dp.end] as const),
      ),
    );
  }
  return node;
}

/**
 * md2ui `_whole_line_again`: `node`'s one line is whole again, so it holds it as it does a
 * line that never split: a heading or an item takes the text back as its own content,
 * and a tier the split had stranded on the container returns to the text.
 */
function wholeLineAgain(node: GroupNode): void {
  const only = node.children[0] as GroupNode;
  const holdsItsLine = node.type === "group" || node.type === "root";
  if (only.children.length > 0 && !holdsItsLine) {
    node.children = only.children; // an item holds its line's pieces itself
    return;
  }
  if (holdsItsLine) {
    if (node.text_style === only.text_style) node.text_style = null;
    return;
  }
  if (node.content) return;
  node.content = only.content;
  node.data_points = only.data_points;
  node.paren_quote_ranges = only.paren_quote_ranges;
  node.children = [];
  if (only.text_style !== null) node.text_style = only.text_style;
}

function leaves(node: GroupNode): GroupNode[] {
  return node.children.length === 0 ? [node] : node.children.flatMap(leaves);
}

function firstLineId(node: GroupNode): number | null {
  return leaves(node).find((leaf) => leaf.source_line_id !== null)?.source_line_id ?? null;
}

/**
 * md2ui `_shared_style`: the text tier every leaf of `pair` carries. A tier written
 * around the whole line was handed down to its pieces, and comes back with the line.
 */
function sharedStyle(pair: GroupNode): GroupNode["text_style"] {
  const styles = new Set(
    leaves(pair)
      .filter((leaf) => leaf.content)
      .map((l) => l.text_style),
  );
  return styles.size === 1 ? ([...styles][0] ?? null) : null;
}
