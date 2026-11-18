// Matching pieces of the cards in one grid row share the tallest one's height (md2ui
// `render_slots`, ADR-410). Cards of one run side by side are stretched to one height,
// but each stacks its pieces from the top: a title that wraps in one card pushes its
// subtitle, picture, text and button below their twins. So in a grid row the piece at
// the same place in every card takes the tallest of their heights, keeps the top of its
// slot, and the gap opens under it. Only a row's own cards share; the last piece shares
// nothing, and neither does a piece that is or holds a picture, whose height is its ratio.
//
// Measuring and placing both read heights through the sizer's `naturalHeight`, which
// lifts a piece to its slot here, so the two agree (md2ui ADR-400). One table per sizer:
// a grid row shares again whenever it is laid out.
import type { LayoutNode } from "../layout/node.ts";

/** A grid row's shared piece heights, as one sizer measures them. */
export interface RowSlots {
  /** md2ui `lift`: `height`, or the slot `node` shares in its grid row at `width` if taller. */
  lift(node: LayoutNode, width: number, height: number): number;
  /**
   * md2ui `share`: give the matching pieces of `cards`, one grid row, one height. Cards
   * share only when each stacks the same number of pieces, of the same kinds in the same
   * order. `measure` measures the row's cards as the row does.
   */
  share(
    cards: readonly LayoutNode[],
    measure: () => unknown,
    isPicture: (node: LayoutNode) => boolean,
  ): void;
}

/** md2ui `_pieces`: the pieces `card` stacks, and the wrappers down to them. */
function piecesOf(card: LayoutNode): { pieces: readonly LayoutNode[]; chain: LayoutNode[] } {
  const chain = [card];
  let at = card;
  while (
    at.children.length === 1 &&
    (at.type === "col" || at.type === "row" || at.type === "layout")
  ) {
    at = at.children[0] as LayoutNode;
    chain.push(at);
  }
  return { pieces: at.type === "col" ? at.children : [], chain };
}

/**
 * md2ui `_holds_picture`: whether `node` is a picture or holds one (an image card, a
 * photo beside its caption, a photo its own background draws). A taller slot would
 * draw the picture taller than its ratio.
 */
export function holdsPicture(node: LayoutNode, isPicture: (node: LayoutNode) => boolean): boolean {
  return (
    isPicture(node) ||
    node.card_bg_url !== null ||
    node.children.some((c) => holdsPicture(c, isPicture))
  );
}

/** A sizer's slots; `forget` drops the remembered heights of nodes a share changed. */
export function rowSlots(forget: (nodes: readonly LayoutNode[]) => void): RowSlots {
  const slots = new WeakMap<LayoutNode, { readonly width: number; readonly height: number }>();
  // While a row measures its cards: every node asked, at its width and own height.
  let seen: Map<LayoutNode, { readonly width: number; readonly height: number }> | null = null;
  return {
    lift(node, width, height) {
      seen?.set(node, { width, height });
      const slot = slots.get(node);
      if (slot === undefined || Math.abs(slot.width - width) > 0.5) return height;
      return Math.max(height, slot.height);
    },
    share(cards, measure, isPicture) {
      const stacks = cards.map(piecesOf);
      const pieces = stacks.map((s) => s.pieces);
      const first = pieces[0] ?? [];
      if (cards.length < 2 || pieces.some((p) => p.length !== first.length) || first.length < 2) {
        return;
      }
      if (
        first.some((_, i) =>
          pieces.some((p) => (p[i] as LayoutNode).type !== (first[i] as LayoutNode).type),
        )
      ) {
        return;
      }
      for (const p of pieces) for (const piece of p) slots.delete(piece);
      const chains = stacks.flatMap((s) => s.chain);
      forget(chains);
      // A card can hold a grid row of its own, which shares while this row measures:
      // each row records into its own table and hands the outer one back after.
      const outer = seen;
      const asked = new Map<LayoutNode, { readonly width: number; readonly height: number }>();
      seen = asked;
      try {
        measure();
      } finally {
        seen = outer;
      }
      for (let i = 0; i < first.length - 1; i++) {
        const column = pieces.map((p) => p[i] as LayoutNode);
        const heights = column.flatMap((c) => {
          const a = asked.get(c);
          return a === undefined ? [] : [a];
        });
        if (heights.length < column.length || column.some((c) => holdsPicture(c, isPicture))) {
          continue;
        }
        const top = Math.max(...heights.map((h) => h.height));
        column.forEach((piece, k) => {
          const { width, height } = heights[k] as { width: number; height: number };
          if (top - height > 0.5) slots.set(piece, { width, height: top });
        });
      }
      forget(chains);
    },
  };
}
