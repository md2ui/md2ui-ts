// The generator's two questions about a block it built (md2ui `layout_render`:
// `make_layout_measurer`, `make_block_width_measurer`, `_stacked_text_width`).
//
// - Height: the block's natural height at an outer cell width, its own wrap padding
//   included.
// - Block width: the width below which the block starts to collapse, which is its longest
//   row. A row costs its cells plus the gaps and paddings between and around them, a
//   column its widest child, and a leaf the width it draws at: a whole pill, for text
//   the whole line (a stacked section wraps to the next row before its text wraps), and
//   for a code block its plan width, never under its length category's floor.
import type { ResolvedTheme } from "@md2ui/contracts";
import { pySum } from "../group/py/math.ts";
import type { LayoutNode } from "../layout/node.ts";
import { LEAF_WIDTH } from "../layout/units.ts";
import { paddingX, paddingY } from "../theme/query.ts";
import { chartVerticalMinWidth } from "./charts.ts";
import { codeBlockPlan } from "./code-blocks.ts";
import {
  childOwnerLevel,
  layersPad,
  layersSectionLevel,
  paddedChildren,
  wrapLayers,
} from "./layers.ts";
import { hint, type Props } from "./leaf-kit.ts";
import type { SizedNode } from "./node-index.ts";
import type { Levels, Sizer } from "./sizer.ts";
import { siblingGap } from "./spacing.ts";
import { tableCellMinWidth } from "./tables.ts";

/** md2ui `frozenset({slvl}) if slvl is not None else levels`: a new section restarts the set. */
function levelsInside(level: number | null, levels: Levels): Levels {
  return level === null ? levels : new Set([level]);
}

/** md2ui `make_layout_measurer`: a built subtree's height at its outer cell width. */
export function layoutHeight(sizer: Sizer, cell: LayoutNode, width: number): number {
  const { theme } = sizer;
  const layers = wrapLayers(cell, theme, new Set());
  if (layers.length === 0) return sizer.naturalHeight(cell, width);
  const pad = layersPad(layers);
  return (
    sizer.naturalHeight(
      cell,
      Math.max(0, width - paddingX(pad)),
      levelsInside(layersSectionLevel(layers), new Set()),
      childOwnerLevel(cell, theme, 0),
    ) + paddingY(pad)
  );
}

/**
 * md2ui `_stacked_text_width`: a text leaf's width on one line, or `null` when the leaf
 * is not text (a pill, a chip, an emoji, an image) or is a filler that just returns the
 * width it is offered. A code block's line is its widest source line in the code face:
 * the width its paint draws, though it scrolls once placed.
 */
function stackedTextWidth(sizer: Sizer, nd: SizedNode | null, rp: Props | null): number | null {
  if (nd === null) return null;
  if (nd.type === "code_block")
    return codeBlockPlan(nd.content, sizer.theme, sizer.leaves.text).width;
  if (["link", "inline_code", "emoji", "image"].includes(nd.type)) return null;
  if (nd.content === "") return null;
  const w = sizer.widths.leafNaturalWidth(nd, Number.POSITIVE_INFINITY, rp);
  return Number.isFinite(w) ? w : null;
}

/** md2ui `make_block_width_measurer`: the width below which `cell` starts to collapse. */
export function blockWidth(sizer: Sizer, cell: LayoutNode, available: number): number {
  return widthOf(sizer, sizer.theme, cell, available, new Set(), 0);
}

function widthOf(
  sizer: Sizer,
  theme: ResolvedTheme,
  cell: LayoutNode,
  avail: number,
  levels: Levels,
  owner: number,
): number {
  const layers = wrapLayers(cell, theme, levels);
  const padX = layers.length > 0 ? paddingX(layersPad(layers)) : 0;
  const innerLevels = levelsInside(layers.length > 0 ? layersSectionLevel(layers) : null, levels);
  const innerOwner = childOwnerLevel(cell, theme, owner);
  const kids = paddedChildren(cell);
  if (kids.length === 0) {
    const rp = cell.render_properties ?? {};
    // A gutter marker and a drawn separator have no node behind them: their width is in
    // their baked props, and counting it is what reserves the gutter.
    const nd = sizer.leafNode(cell);
    if (hint(rp, "list_marker") !== null || hint(rp, "separator") !== null) {
      return sizer.widths.leafNaturalWidth(nd, avail, rp) + padX;
    }
    const chart = hint(rp, "chart") as Props | null;
    if (chart !== null) {
      // A stacked section wraps to the next row before its chart turns on its side.
      const flip = chartVerticalMinWidth(chart, sizer.leaves);
      if (flip !== null) return flip + padX;
    }
    const category = nd?.content_length_category || "";
    const floor = Object.hasOwn(LEAF_WIDTH, category) ? (LEAF_WIDTH[category] as number) : 0;
    const oneLine = stackedTextWidth(sizer, nd, rp);
    if (oneLine !== null) return Math.max(oneLine, floor) + padX;
    return Math.max(tableCellMinWidth(sizer, cell, avail), floor) + padX;
  }
  const inner = Math.max(0, avail - padX);
  let total: number;
  if (cell.type === "row") {
    total = pySum(kids.map((c) => widthOf(sizer, theme, c, inner, innerLevels, innerOwner)));
    total += pySum(
      kids
        .slice(1)
        .map(
          (c, i) =>
            siblingGap(kids[i] as LayoutNode, c, theme, "row", innerOwner, sizer.index, cell).gap,
        ),
    );
  } else {
    const ws = kids.map((c) => widthOf(sizer, theme, c, inner, innerLevels, innerOwner));
    total = ws.length > 0 ? Math.max(...ws) : 0;
  }
  return total + padX;
}
