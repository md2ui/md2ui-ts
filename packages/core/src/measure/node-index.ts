// What sizing reads off the grouping tree: md2ui's `node_index`, the grouper's node dicts
// by id (`layout_render.load_node_index`). A layout leaf names its node by `content_id`;
// a synthetic leaf (a marker, a separator, a baked date) names none.
import type { GroupNode } from "../group/node.ts";
import { type LayoutInput, leafInputs } from "../layout/input.ts";
import type { LeafInputs } from "../layout/measurer.ts";

/**
 * A grouping node as sizing reads it: the fields the leaf measurers read (the closure
 * questions carry exactly `LeafInputs`), plus the two only the built-tree sizing reads.
 */
export interface SizedNode extends LeafInputs {
  /** How a Text-variant link label is emphasised (md2ui `_link_emphasis_typeface`). */
  readonly link_emphasis: string | null;
  readonly content_length_category: string | null;
}

export type NodeIndex = ReadonlyMap<string, SizedNode>;

/** A closure question's node, as sizing reads it: md2ui's closures build it without these two. */
export function sizedLeaf(node: LeafInputs): SizedNode {
  return { ...node, link_emphasis: null, content_length_category: null };
}

/** md2ui `load_node_index`: every node of `input` by id. */
export function nodeIndex(input: LayoutInput): NodeIndex {
  const index = new Map<string, SizedNode>();
  const visit = (node: GroupNode): void => {
    if (node.node_id !== "") {
      index.set(node.node_id, {
        ...leafInputs(input, node),
        link_emphasis: input.links.get(node)?.link_emphasis ?? null,
        content_length_category: node.content_length_category,
      });
    }
    for (const child of node.children) visit(child);
  };
  visit(input.root);
  return index;
}
