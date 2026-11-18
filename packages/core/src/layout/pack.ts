// `Stack sections` (md2ui ADR-302): a run of unique heading bands packed side by side,
// each at the width its content asks for, as many per row as fit, the row's leftover
// shared out. md2ui's `_block_width` and `_run_min_width`, and the `_flow_rows` call
// `_build_grouped` makes for such a run. Which children qualify is `grouped.ts`'s.
import type { GroupNode } from "../group/node.ts";
import { flowRows } from "./flow.ts";
import type { LayoutNode } from "./node.ts";
import { colGap, measuredMinWidth, unitPaddingX } from "./node-units.ts";
import type { Run } from "./run.ts";

/**
 * md2ui `_run_min_width`: what the widest same-kind run inside `item` needs to stay on
 * one line: its member count times its widest member, plus the gaps. Asked of the
 * grouper side, where a run is still a run rather than the grid rows it was built into.
 */
function runMinWidth(run: Run, item: GroupNode): number {
  let widest = 0;
  const stack = [item];
  while (stack.length > 0) {
    const node = stack.pop() as GroupNode;
    for (const bucket of node.repeated_children?.values() ?? []) {
      if (bucket.length < 2) continue;
      let unit = 0;
      bucket.forEach((m, k) => {
        const w = measuredMinWidth(m, run.minWidths) + unitPaddingX(m, run.theme);
        // Python's `max(generator)`: the first of equals.
        if (k === 0 || w > unit) unit = w;
      });
      const gap = colGap(run.kit, bucket[0] as GroupNode, run.theme, 0, null);
      widest = Math.max(widest, bucket.length * unit + (bucket.length - 1) * gap);
    }
    stack.push(...node.children);
  }
  return widest;
}

/**
 * md2ui `_block_width`: the width a packed block asks for so nothing in it wraps: the
 * longest row of the block as built at the full width, or its widest run on one line.
 * Measured at the width offered, which a block arranges by even when it fits in less.
 * Trusted, not verified (ADR-302). The build is a trial build with side effects, so
 * the memo decides which builds happen: each block is built once per width per call.
 */
function blockWidth(
  run: Run,
  item: GroupNode,
  width: number,
  inGlued: boolean,
  ownerLevel: number,
): number {
  let byWidth = run.blockWidths.get(item);
  if (byWidth === undefined) {
    byWidth = new Map();
    run.blockWidths.set(item, byWidth);
  }
  const hit = byWidth.get(width);
  if (hit !== undefined) return hit;
  const built = run.renderChild(run, item, width, inGlued, ownerLevel);
  const ask = Math.max(run.measurer.blockWidth(built, width), runMinWidth(run, item));
  byWidth.set(width, ask);
  return ask;
}

/**
 * md2ui `_build_grouped`'s `Stack sections` flow: `items`, a run of packable bands,
 * flowed into rows at their block widths, each row filled to the line and its last two
 * balanced. The rows keep the bands' own vertical rhythm: they are not one `flow_run`.
 */
export function packSections(
  run: Run,
  items: readonly GroupNode[],
  width: number,
  inGlued: boolean,
  ownerLevel: number,
): LayoutNode[] {
  return flowRows(run, items, width, inGlued, ownerLevel, {
    widthOf: (c) => blockWidth(run, c, width, inGlued, ownerLevel),
    oneRun: false,
    fill: true,
    balance: true,
  });
}
