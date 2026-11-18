// What a host may scroll (md2ui `render_code_blocks.code_block_scrollables`): a code
// block whose widest line runs past its box, or whose lines run past its last shown line
// (`Max lines`), from the same plan its paint uses. Built once per width, like the click
// regions.
import type { GroupingNode } from "@md2ui/contracts";
import { codeBlockPlan } from "../measure/code-blocks.ts";
import type { Sizer } from "../measure/sizer.ts";
import type { LayoutBox, Scrollable } from "./boxes.ts";

export function codeBlockScrollables(
  sizer: Sizer,
  boxes: readonly LayoutBox[],
  nodes: ReadonlyMap<string, GroupingNode>,
): Scrollable[] {
  const found: Scrollable[] = [];
  for (const box of boxes) {
    const nd = box.content_id ? nodes.get(box.content_id) : undefined;
    if (nd === undefined || box.content_id === null || nd.type !== "code_block") continue;
    const plan = codeBlockPlan(nd.content ?? "", sizer.theme, sizer.leaves.text);
    if (plan.width > box.width + 0.5 || plan.full_height > box.height + 0.5) {
      found.push({
        node_id: nd.node_id,
        content_id: box.content_id,
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        content_width: plan.width,
        content_height: plan.full_height,
        bg_stack: box.bg_stack,
      });
    }
  }
  return found;
}
