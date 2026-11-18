// Where the lines Pretext broke a text into are placed in their box, and the runs of a
// region across one line (md2ui `_flag_runs`): one link's underline and click region,
// one marker's background, one strike-through, however many fragments it spans. Click
// regions and the display list both read these, so a tap lands on the ink.
import type { LineFragment, TextLine } from "@md2ui/contracts";

/** md2ui's three-way line start: left at the box, centred, or flush right. */
export function lineStart(x: number, width: number, lineWidth: number, align: string): number {
  if (align === "center") return x + (width - lineWidth) / 2;
  if (align === "right") return x + (width - lineWidth);
  return x;
}

/** One region's extent on one line, and the index of its first fragment. */
export interface FlagRun {
  readonly id: number;
  readonly x0: number;
  readonly x1: number;
  readonly first: number;
}

/**
 * md2ui `_flag_runs`: the contiguous fragments of `line` sharing a non-zero region id,
 * from the first one's left edge to the last one's right, so the space inside one region
 * is covered and the space between two is not. `start` is the line's left edge.
 */
export function flagRuns(
  line: TextLine,
  start: number,
  idOf: (fragment: LineFragment) => number,
): FlagRun[] {
  const runs: FlagRun[] = [];
  let open: { id: number; x0: number; x1: number; first: number } | null = null;
  line.fragments.forEach((fragment, i) => {
    const id = idOf(fragment);
    if (open !== null && open.id !== id) {
      runs.push(open);
      open = null;
    }
    if (id === 0) return;
    const x0 = start + fragment.x;
    if (open === null) open = { id, x0, x1: x0, first: i };
    open.x1 = x0 + fragment.width;
  });
  if (open !== null) runs.push(open);
  return runs;
}
