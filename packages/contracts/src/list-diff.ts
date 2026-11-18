// What changed between two display lists (C4) of one view, matched by node id
// (ADR-104): what a host animates when a document is re-sent or streamed. The core
// computes it, the painter tweens it, the host runs the frames. Internal, not
// public: a host app never sees it.
import type { Rect } from "./c4-display-list.ts";

/** A node in both lists whose box is not where it was. */
export interface MovedNode {
  readonly nodeId: string;
  /** The union of its entries' bounds in the earlier list, in content space. */
  readonly from: Rect;
  /** The same in the later list. */
  readonly to: Rect;
}

/**
 * Nodes by id; a card's or section's background is its node's (C4). Entries with no node
 * (`nodeId: ""`: the page's box, dividers) have no identity to match, so they are in
 * none of these.
 */
export interface ListDiff {
  /** Painted only in the later list. */
  readonly added: readonly string[];
  /** Painted only in the earlier list. */
  readonly removed: readonly string[];
  /** In both, with a box that moved or changed size. */
  readonly moved: readonly MovedNode[];
  /**
   * In both, painted otherwise than the earlier list moved to the later place: a new
   * colour, a ticked box, text that wrapped anew. A node can be moved and restyled.
   */
  readonly restyled: readonly string[];
}
