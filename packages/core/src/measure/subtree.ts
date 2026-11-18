// How big a built layout subtree wants to be (md2ui `render_measure.natural_height`,
// `natural_width`, `first_baseline`, `_cell_heights`). A leaf answers for itself; a
// column stacks its children with the gaps `siblingGap` puts between them; a row is laid
// out (`rows.ts`); a table is planned (`tables.ts`). A wrapped child (a section
// background, a list surface, a card) is measured at its padding-reduced width and
// extended by its padding, opening its section level for the children beneath it.
//
// Nothing is cached across the generator's questions: it edits the nodes it built after
// asking about them. Placement asks of a finished tree, and re-asks the same heights at
// every level it descends, so it measures through a sizer that remembers heights for
// that one placement (md2ui `height_memo`).
import type { ResolvedTheme } from "@md2ui/contracts";
import { pySum } from "../group/py/math.ts";
import type { LayoutNode } from "../layout/node.ts";
import { paddingX, paddingY } from "../theme/query.ts";
import { childOwnerLevel, layersPad, paddedChildren, wrapLayers } from "./layers.ts";
import { imageCardHeight, type LeafHeights } from "./leaf-heights.ts";
import { type LeafKit, type Props, truthy } from "./leaf-kit.ts";
import type { LeafWidths } from "./leaf-widths.ts";
import type { NodeIndex, SizedNode } from "./node-index.ts";
import { rowDesiredWidths, rowHeight } from "./rows.ts";
import { type Levels, type Sizer, type Wrap, wrapOf } from "./sizer.ts";
import { rowSlots } from "./slots.ts";
import { siblingGap } from "./spacing.ts";
import { tablePlan } from "./tables.ts";

const rpOf = (node: LayoutNode): Props | null => node.render_properties;

export function subtreeSizer(
  theme: ResolvedTheme,
  index: NodeIndex,
  leaves: LeafKit,
  widths: LeafWidths,
  heights: LeafHeights,
  /**
   * Heights already measured, by node and then by width, levels and owner; given only
   * for a tree nothing edits while the sizer lives.
   */
  memo: Map<LayoutNode, Map<string, number>> | null = null,
): Sizer {
  const leafNode = (node: LayoutNode): SizedNode | null =>
    node.content_id ? (index.get(node.content_id) ?? null) : null;

  /** A wrapped-or-not child measured one way: `measure` at an inner width, plus its padding. */
  const throughWrap = (
    child: LayoutNode,
    levels: Levels,
    owner: number,
    measure: (w: Wrap | null, childOwner: number) => number,
  ): number => measure(wrapOf(child, theme, levels), childOwnerLevel(child, theme, owner));

  /** md2ui `_natural_height_uncached`. */
  const measureHeight = (
    node: LayoutNode,
    width: number,
    levels: Levels,
    owner: number,
  ): number => {
    if (node.type === "layout") {
      const child = node.children[0];
      if (child === undefined) return 0;
      return throughWrap(child, levels, owner, (wrap, childOwner) =>
        wrap === null
          ? sizer.naturalHeight(child, width, levels, childOwner)
          : sizer.naturalHeight(
              child,
              Math.max(0, width - paddingX(wrap.pad)),
              wrap.levels,
              childOwner,
            ) + paddingY(wrap.pad),
      );
    }
    if (node.type === "-") return heights.leafHeight(leafNode(node), width, rpOf(node));
    if (node.type === "row") return rowHeight(sizer, node, width, levels, owner);
    if (node.type === "col") {
      if (node.card_kind === "ring") return theme.datapoints.ring.diameter;
      if (node.table) return tablePlan(sizer, node, width).height;
      const children = paddedChildren(node);
      const hs = children.map((c) =>
        throughWrap(c, levels, owner, (wrap, childOwner) =>
          wrap === null
            ? sizer.naturalHeight(c, width, levels, childOwner)
            : sizer.naturalHeight(c, width - paddingX(wrap.pad), wrap.levels, childOwner) +
              paddingY(wrap.pad),
        ),
      );
      const gaps = pySum(
        children
          .slice(1)
          .map(
            (c, i) =>
              siblingGap(children[i] as LayoutNode, c, theme, "col", owner, index, node).gap,
          ),
      );
      return pySum(hs) + gaps;
    }
    return 0;
  };

  /**
   * md2ui `_card_sized`: the content's height, or a baked image card's own when its
   * picture asks for more (`imageCardHeight`, read at the card's outer width).
   */
  const cardSized = (node: LayoutNode, width: number, levels: Levels, owner: number): number => {
    const h = measureHeight(node, width, levels, owner);
    if (!truthy(node.render_properties?.["photo_sized"])) return h;
    const pad = layersPad(wrapLayers(node, theme, new Set()));
    return Math.max(
      h,
      imageCardHeight(leaves.kit, node.card_bg_url, width + paddingX(pad)) - paddingY(pad),
    );
  };

  // The heights a share changed are measured again.
  const slots = rowSlots((nodes) => {
    for (const n of nodes) memo?.delete(n);
  });

  const sizer: Sizer = {
    theme,
    index,
    leaves,
    widths,
    heights,
    leafNode,

    slots,

    naturalHeight(node, width, levels: Levels = new Set(), owner = 0) {
      let h: number | undefined;
      if (memo === null) h = cardSized(node, width, levels, owner);
      else {
        const key = `${width}|${[...levels].sort().join(",")}|${owner}`;
        let byNode = memo.get(node);
        if (byNode === undefined) {
          byNode = new Map();
          memo.set(node, byNode);
        }
        h = byNode.get(key);
        if (h === undefined) {
          h = cardSized(node, width, levels, owner);
          byNode.set(key, h);
        }
      }
      // A piece of a card in a grid row takes the slot its twins share (ADR-410).
      return slots.lift(node, width, h);
    },

    naturalWidth(node, available, levels: Levels = new Set(), owner = 0) {
      if (node.type === "layout") {
        const body = node.children[0];
        if (body === undefined) return 0;
        return throughWrap(body, levels, owner, (wrap, bodyOwner) =>
          wrap === null
            ? sizer.naturalWidth(body, available, levels, bodyOwner)
            : sizer.naturalWidth(
                body,
                Math.max(0, available - paddingX(wrap.pad)),
                wrap.levels,
                bodyOwner,
              ) + paddingX(wrap.pad),
        );
      }
      if (node.type === "-") return widths.leafNaturalWidth(leafNode(node), available, rpOf(node));
      if (node.type === "row") {
        // Grids, bento rows, spring rows and authored `:::` rows stretch to their space.
        if (node.grid || node.bento || node.spring || node.column_row) return available;
        const { children, desired } = rowDesiredWidths(sizer, node, available, levels, owner);
        const gaps = pySum(
          children
            .slice(1)
            .map(
              (c, i) =>
                siblingGap(children[i] as LayoutNode, c, theme, "row", owner, index, node).gap,
            ),
        );
        return Math.min(pySum(desired) + gaps, available);
      }
      if (node.type === "col") {
        if (node.card_kind === "ring") return Math.min(theme.datapoints.ring.diameter, available);
        if (node.table) return Math.min(tablePlan(sizer, node, available).width, available);
        const ws = paddedChildren(node).map((c) =>
          throughWrap(c, levels, owner, (wrap, childOwner) =>
            wrap === null
              ? sizer.naturalWidth(c, available, levels, childOwner)
              : sizer.naturalWidth(
                  c,
                  Math.max(0, available - paddingX(wrap.pad)),
                  wrap.levels,
                  childOwner,
                ) + paddingX(wrap.pad),
          ),
        );
        return Math.min(ws.length > 0 ? Math.max(...ws) : 0, available);
      }
      return 0;
    },

    firstBaseline(node) {
      if (node.type === "-") return heights.leafFirstBaseline(leafNode(node), rpOf(node));
      const padTop = layersPad(wrapLayers(node, theme, new Set())).top;
      for (const child of paddedChildren(node)) {
        const base = sizer.firstBaseline(child);
        if (base !== null) return base + padTop;
      }
      return null;
    },

    cellHeights(children, cellWidths, levels, owner) {
      const hs: number[] = [];
      const wrapped: boolean[] = [];
      const n = Math.min(children.length, cellWidths.length);
      for (let i = 0; i < n; i++) {
        const child = children[i] as LayoutNode;
        const w = cellWidths[i] as number;
        const wrap = wrapOf(child, theme, levels);
        const childOwner = childOwnerLevel(child, theme, owner);
        hs.push(
          wrap === null
            ? sizer.naturalHeight(child, w, levels, childOwner)
            : sizer.naturalHeight(child, w - paddingX(wrap.pad), wrap.levels, childOwner) +
                paddingY(wrap.pad),
        );
        wrapped.push(wrap !== null);
      }
      return { heights: hs, wrapped };
    },
  };
  return sizer;
}
