// A choice run drawn as one segmented control (md2ui `render_segmented.paint_segmented`,
// ADR-405). A run of buttons the author divided with ` | ` whose options all share one
// `md2ui.choice` name, which the grouper stamps `segmented_run`, is drawn as one control
// when the theme asks for it (`## Links` → `Segmented: yes`): a surface in the quieter button's paint behind the run, the chosen option's own pill on
// it, the others their labels only (`choiceStyle`), and a thin divider between two
// unchosen neighbours. The surface is painted as a button pill is (`paintPill`): replaced
// against what it sits on, at the variant's `Stroke align`, and each segment is painted
// against the stack the surface makes, as a pill on a card is against the card. Each segment stays its own button, at the pill it is measured and
// tapped at: the surface is paint, never a box, so no layout changes. A run its row
// cannot hold on one line (its pills wrapped) stays separate pills, as does every run under
// a theme that does not ask: the look is the theme's, the behaviour the same.
import type { GroupingNode } from "@md2ui/contracts";
import type { Sizer } from "../../measure/sizer.ts";
import type { BgStack, LayoutBox } from "../boxes.ts";
import { linkPillRect } from "../regions.ts";
import type { Draw } from "./context.ts";
import { resolvedLinkStyle, shownChosen } from "./link-styles.ts";
import type { Box, Pen } from "./pen.ts";
import { paintPill } from "./pill-paint.ts";

// md2ui `_INSET`: how far the surface reaches past the run's pills, on every side.
const INSET = 3;

/** A segmented run drawn as one control: its group, its buttons and the pills they paint. */
export interface SegmentedRun {
  /** The node stamped `segmented_run`, whose children are the buttons. */
  readonly id: string;
  readonly buttons: readonly string[];
  readonly pills: readonly Box[];
  /** What the run sits on: its first button's background stack. */
  readonly stack: BgStack;
}

/**
 * The runs md2ui `paint_segmented` draws: under a theme that asks for the control
 * (`links.segmented`), every run the grouper stamped whose buttons are all placed and whose
 * pills share the first pill's row. A fact of the theme and the width alone.
 */
export function segmentedRuns(
  sizer: Sizer,
  boxes: readonly LayoutBox[],
  nodes: ReadonlyMap<string, GroupingNode>,
): SegmentedRun[] {
  if (!sizer.theme.links.segmented) return [];
  const placed = new Map<string, LayoutBox>();
  for (const box of boxes) if (box.content_id) placed.set(box.content_id, box);
  const runs: SegmentedRun[] = [];
  for (const node of nodes.values()) {
    if (!node.segmented_run) continue;
    const buttons = node.children.map((k) => k.node_id);
    const pills: Box[] = [];
    for (const id of buttons) {
      const box = placed.get(id);
      const sized = sizer.index.get(id);
      if (box === undefined || sized === undefined) break;
      const [x, y, width, height] = linkPillRect(sizer, box, sized);
      pills.push({ x, y, width, height });
    }
    const first = pills[0];
    const firstBox = placed.get(buttons[0] ?? "");
    if (first === undefined || firstBox === undefined || pills.length < buttons.length) continue;
    const top = first.y;
    const bottom = first.y + first.height;
    if (pills.some((r) => r.y >= bottom || r.y + r.height <= top)) continue; // wrapped
    runs.push({ id: node.node_id, buttons, pills, stack: firstBox.bg_stack });
  }
  return runs;
}

/**
 * md2ui `paint_segmented` for one run: the surface, the quieter button's pill `INSET`
 * outside the pills with its corners grown with it, and a divider between two unchosen
 * neighbours in the surface's ink at a third of its strength. No label names the surface,
 * so no pin colours it. Which options are chosen is the host's tap or else as written, so
 * a tap moves the divider. Returns the stack the surface makes, which each segment is
 * painted against (md2ui `segment_stack`).
 */
export function paintSegmented(d: Draw, run: SegmentedRun, p: Pen): BgStack {
  const firstId = run.buttons[0] ?? "";
  const sized = d.sized.get(firstId);
  const first = run.pills[0];
  const last = run.pills.at(-1);
  if (sized === undefined || first === undefined || last === undefined) return run.stack;
  // The surface is the control's, not its first option's: that option's disabled or
  // pending state (both stamped `link_disabled`) stays its own.
  const quiet = resolvedLinkStyle(
    d,
    { ...sized, link_variant: "secondary", link_disabled: false },
    d.nodes.get(firstId),
  );
  const top = Math.min(...run.pills.map((r) => r.y)) - INSET;
  const bottom = Math.max(...run.pills.map((r) => r.y + r.height)) + INSET;
  const left = first.x - INSET;
  const surface = {
    x: left,
    y: top,
    width: last.x + last.width + INSET - left,
    height: bottom - top,
  };
  const grown = { ...quiet, corner_radius: (quiet.corner_radius ?? 16) + INSET };
  const painted = paintPill(p, d.sizer.theme, surface, grown, undefined, run.stack);

  const chosen = run.buttons.map((id) => {
    const nd = d.sized.get(id);
    return nd === undefined || shownChosen(d, nd);
  });
  const ink = ((painted.ink & 0xffffff) | 0x55000000) >>> 0;
  for (let k = 0; k + 1 < run.pills.length; k++) {
    const a = run.pills[k] as Box;
    const b = run.pills[k + 1] as Box;
    if (chosen[k] || chosen[k + 1]) continue;
    const x = (a.x + a.width + b.x) / 2;
    const cy = a.y + a.height / 2;
    const h = a.height / 4;
    p.line(x, cy - h, x, cy + h, 1, ink);
  }
  return painted.stack;
}
