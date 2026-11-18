// What row, table and block sizing ask of the subtree sizer (`subtree.ts`), kept apart
// from it so the modules it calls can ask it back: md2ui's mutually recursive
// `natural_height`, `natural_width`, `_layout_row` and `_table_plan`. Also the one
// stanza every wrapped child is measured through.
import type { PaddingBox, ResolvedTheme } from "@md2ui/contracts";
import type { LayoutNode } from "../layout/node.ts";
import { type Layer, layersPad, layersSectionLevel, withLevel, wrapLayers } from "./layers.ts";
import type { LeafHeights } from "./leaf-heights.ts";
import type { LeafKit } from "./leaf-kit.ts";
import type { LeafWidths } from "./leaf-widths.ts";
import type { NodeIndex, SizedNode } from "./node-index.ts";
import type { RowSlots } from "./slots.ts";

/** The section levels already open around a node: md2ui's `in_section_levels`. */
export type Levels = ReadonlySet<number>;

/** A child's wrap: its layers, the padding they add, and the levels open inside them. */
export interface Wrap {
  readonly layers: readonly Layer[];
  readonly pad: PaddingBox;
  readonly levels: Levels;
}

/**
 * The wrap of `node` inside `levels`, or `null` when nothing wraps it: md2ui's
 * `_wrap_layers` / `_layers_pad` / `in_section_levels | {slvl}` stanza.
 */
export function wrapOf(node: LayoutNode, theme: ResolvedTheme, levels: Levels): Wrap | null {
  const layers = wrapLayers(node, theme, levels);
  if (layers.length === 0) return null;
  const level = layersSectionLevel(layers);
  return { layers, pad: layersPad(layers), levels: level ? withLevel(levels, level) : levels };
}

/** What row and table sizing ask of the subtree sizer. */
export interface Sizer {
  readonly theme: ResolvedTheme;
  readonly index: NodeIndex;
  readonly leaves: LeafKit;
  readonly widths: LeafWidths;
  readonly heights: LeafHeights;
  /** The heights the pieces of a grid row's cards share (md2ui `render_slots`). */
  readonly slots: RowSlots;
  /** md2ui `node_index.get(node.content_id) if node.content_id else None`. */
  leafNode(node: LayoutNode): SizedNode | null;
  /** md2ui `natural_height`. */
  naturalHeight(node: LayoutNode, width: number, levels?: Levels, owner?: number): number;
  /** md2ui `natural_width`. */
  naturalWidth(node: LayoutNode, available: number, levels?: Levels, owner?: number): number;
  /** md2ui `first_baseline`: from a cell's box top to its first text baseline, or `null`. */
  firstBaseline(node: LayoutNode): number | null;
  /**
   * md2ui `_cell_heights`: the cells' heights at their widths, and which are wrapped
   * (a wrapped cell fills its row).
   */
  cellHeights(
    children: readonly LayoutNode[],
    widths: readonly number[],
    levels: Levels,
    owner: number,
  ): { heights: number[]; wrapped: boolean[] };
}
