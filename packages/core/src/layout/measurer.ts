// What the layout generator asks about sizes: md2ui's measurer closures
// (`layout_render.make_width_measurer`, `make_line_width_measurer`,
// `make_marker_measurer`, `make_block_width_measurer`, `make_layout_measurer`). Each adds theme chrome to text answers (C3), so the interface
// belongs to layout, not to the text contract. Two implementations: one composed from C3
// (stage B), and a replay of md2ui's recorded answers for conformance (stage A).

import type { LayoutNode } from "./node.ts";

/** A leaf's Key / Value text role (md2ui `kv_role_map`). */
export type KvRole = "key" | "value";

/**
 * The fields md2ui's two leaf closures read off a node, by md2ui's names. All but
 * `atx_level` are the key its answers are filed under
 * (`scripts/ts_fixture_closures._LEAF_INPUTS`). The generator also measures nodes it
 * builds (a text override, a separator cell), so `node_id` alone is not one. An absent
 * value is `null`, never `undefined`.
 */
export interface LeafInputs {
  readonly node_id: string;
  readonly type: string;
  readonly content: string;
  readonly heading_ctx: number;
  /** md2ui `atx_level`: the level of a heading written inside another block, else 0. */
  readonly atx_level: number;
  readonly text_style: string | null;
  readonly text_style_chain: readonly string[];
  readonly code_variant: string | null;
  readonly code_language: string | null;
  readonly emoji_kind: string | null;
  readonly emoji_index: number;
  readonly emoji_variant: string | null;
  readonly in_key: boolean;
  readonly table_role: string | null;
  readonly link_variant: string | null;
  readonly link_label: string | null;
  readonly link_is_emoji: boolean;
  readonly link_disabled: boolean;
  readonly drawing_element: Readonly<Record<string, unknown>> | null;
}

export interface LayoutMeasurer {
  /**
   * md2ui `measure_width`: the narrowest width a leaf renders at without clipping (its
   * widest word, a whole pill), or `null` when no text constrains it (an image, a rule).
   */
  leafMinWidth(node: LeafInputs, kvRole: KvRole | null): number | null;
  /** md2ui `measure_line`: the width a leaf takes on one line, or `null` (image, rule). */
  leafLineWidth(node: LeafInputs, kvRole: KvRole | null): number | null;
  /** md2ui `measure_marker`: the drawn width of a gutter marker, from its baked props. */
  markerWidth(props: Readonly<Record<string, unknown>>): number;
  /**
   * md2ui `measure_block`: the width below which a built block starts to collapse (its
   * longest row, gaps and paddings included), asked of the block built at `available`.
   */
  blockWidth(built: LayoutNode, available: number): number;
  /**
   * md2ui `measure`: the rendered height of a built subtree at an outer cell width, its
   * own wrap padding included. The aspect cap and bento score arrangements with it.
   */
  layoutHeight(built: LayoutNode, width: number): number;
}
