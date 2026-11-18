// What every drawer reads: the document's sizer (theme, faces, text measurer, the sized
// nodes), the grouping nodes for the fields only painting reads (rotation slots,
// datapoints), the `## Fixed colors` pins, and the code highlighter. md2ui's drawers take
// these as `node_index`, `fonts`, `theme` and `background_images`.
import type { Argb, GroupingNode } from "@md2ui/contracts";
import type { NodeIndex, SizedNode } from "../../measure/node-index.ts";
import type { Sizer } from "../../measure/sizer.ts";
import type { BgStack, LayoutBox } from "../boxes.ts";
import type { Pins } from "./colors.ts";
import type { Pen } from "./pen.ts";

/** One token of a highlighted code line, in its colour. */
export interface CodeToken {
  readonly text: string;
  readonly color: Argb;
}

/**
 * Colours a code block's source, line by line: md2ui's `highlighted_lines`. `null` when
 * the language is unknown or unset, and the block paints in its text colour.
 */
export type CodeHighlighter = (
  source: string,
  language: string | null,
) => readonly (readonly CodeToken[])[] | null;

export interface Draw {
  readonly sizer: Sizer;
  /** The sized nodes as the host shows them: `withStates` swaps some (md2ui `with_node_states`). */
  readonly sized: NodeIndex;
  readonly nodes: ReadonlyMap<string, GroupingNode>;
  readonly pins: ReadonlyMap<string, Pins>;
  readonly highlight: CodeHighlighter | null;
  /**
   * md2ui `choice_shown`: a choice option's chosen state as the host's tap shows it, by
   * node id (`withStates`); an option absent here is shown as written.
   */
  readonly choices: ReadonlyMap<string, boolean>;
  /**
   * md2ui `segment` and `segment_stack`: the buttons a segmented run's surface was painted
   * under, by node id, each with the stack that surface makes, which the button is painted
   * against. Whether a run fits one row is a fact of the width; its stack follows the
   * first option's state.
   */
  readonly segments: ReadonlyMap<string, BgStack>;
}

/** A box's grouping node and its sized node, when it has one. */
export function nodesOf(
  d: Draw,
  box: LayoutBox,
): { readonly node: GroupingNode; readonly sized: SizedNode } | null {
  if (box.content_id === null) return null;
  const node = d.nodes.get(box.content_id);
  const sized = d.sized.get(box.content_id);
  return node === undefined || sized === undefined ? null : { node, sized };
}

/** How every leaf drawer is called: one placed box, recorded with its node's pen. */
export type BoxDrawer = (d: Draw, box: LayoutBox, p: Pen) => void;
