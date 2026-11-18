// A code block's own scroll (md2ui `render_scroll_overlay.scrolled_by`): the browser's.
// Over each block md2ui names scrollable (wider than its box, or cut by `Max lines`) the
// accessibility layer holds a transparent native scroller, as large as the block and as
// deep as its lines, and the painter draws the block at that scroller's offsets. So the
// platform gives a block what it gives any scroller: momentum, the bounce, a trackpad's
// inertia, the hand-off to the page at the block's end, keyboard and assistive scrolling.
import type { ScrollEntry } from "@md2ui/contracts";
import type { ScrollOffset } from "@md2ui/painter-canvas";

/** The class a block's scroller carries, which the view's style and input know it by. */
export const SCROLLER = "scroll";

/**
 * Makes `el` the scroller over `block`: a code region a keyboard reaches and scrolls,
 * which reports each offset to `scrolled`. Returns the element its lines go in, as large
 * as all of them, which scrolls with it, so a line selected or found is where it is
 * painted.
 */
export function scrollerOver(
  el: HTMLElement,
  block: ScrollEntry,
  scrolled: (offset: ScrollOffset) => void,
): HTMLElement {
  el.className = SCROLLER;
  el.setAttribute("role", "region");
  el.setAttribute("aria-label", "Code");
  el.tabIndex = 0;
  const first = el.firstElementChild;
  const lines =
    first instanceof HTMLElement ? first : el.appendChild(document.createElement("div"));
  // The scroll range is the block's own (`contentWidth - width`, `contentHeight - height`).
  lines.style.width = `${block.contentWidth}px`;
  lines.style.height = `${block.contentHeight}px`;
  el.onscroll = () => scrolled({ x: el.scrollLeft, y: el.scrollTop });
  return lines;
}

/**
 * After the layer is updated: a scroller just put in place (new, or moved, which the
 * browser resets) is scrolled back to `offsets`, as md2ui keeps a block's offset by its
 * node; then any scroller whose offset is not the one known (the browser clamped it to a
 * new size) reports it, so the painter never draws a block where its scroller is not.
 */
export function followOffsets(
  scrollers: ReadonlyMap<HTMLElement, string>,
  placed: ReadonlySet<HTMLElement>,
  offsets: ReadonlyMap<string, ScrollOffset>,
  scrolled: (nodeId: string, offset: ScrollOffset) => void,
): void {
  for (const [el, nodeId] of scrollers) {
    const known = offsets.get(nodeId) ?? { x: 0, y: 0 };
    if (placed.has(el)) {
      if (el.scrollLeft !== known.x) el.scrollLeft = known.x;
      if (el.scrollTop !== known.y) el.scrollTop = known.y;
    }
    const now = { x: el.scrollLeft, y: el.scrollTop };
    if (now.x !== known.x || now.y !== known.y) scrolled(nodeId, now);
  }
}
