// One baked layout placed at one width (md2ui `session.build_scene`, after the bakes):
// the document's height, every box and section box, image bleed, the click regions and
// heading anchors, and the code blocks a host may scroll. The display list is painted
// from this.
import type { GroupingNode } from "@md2ui/contracts";
import type { LayoutNode } from "../layout/node.ts";
import type { Sizer } from "../measure/sizer.ts";
import { subtreeSizer } from "../measure/subtree.ts";
import { bakeImageBleed } from "./bleed.ts";
import type { Scene } from "./boxes.ts";
import { placeLayout } from "./place.ts";
import { buildRegions } from "./regions.ts";
import { codeBlockScrollables } from "./scrollables.ts";

/** md2ui `node_index` over the grouping tree: every node by id, as the grouper wrote it. */
export function groupingIndex(root: GroupingNode): Map<string, GroupingNode> {
  const nodes = new Map<string, GroupingNode>();
  const visit = (node: GroupingNode): void => {
    if (node.node_id !== "") nodes.set(node.node_id, node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(root);
  return nodes;
}

/**
 * md2ui `build_scene`'s placement half: `layout` (generated and baked at `width`, the
 * effective width) placed with the document's sizer. `grouping` is the tree the layout
 * was generated from, which click regions read for labels and destinations.
 */
export function placeScene(
  document: Sizer,
  layout: LayoutNode,
  grouping: GroupingNode,
  width: number,
): Scene {
  // The tree is finished, so heights are remembered for this one placement.
  const { theme, index, leaves, widths, heights } = document;
  const sizer = subtreeSizer(theme, index, leaves, widths, heights, new Map());
  const height = sizer.naturalHeight(layout, width);
  const { boxes, sections, marks } = placeLayout(sizer, layout, width, height);
  bakeImageBleed(boxes, sections, sizer.index, sizer.theme);
  const nodes = groupingIndex(grouping);
  const { regions, anchors } = buildRegions(sizer, boxes, marks, nodes);
  const scrollables = codeBlockScrollables(sizer, boxes, nodes);
  return { width, height, boxes, sections, regions, anchors, scrollables };
}
