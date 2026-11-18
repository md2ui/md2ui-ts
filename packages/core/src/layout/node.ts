// The layout tree: md2ui's `LayoutNode` (layout_script_parser.py). Field names and
// defaults mirror md2ui's, so a node is its own fixture form: the conformance fixtures
// (`layout-generated/`, `layout/`) hold every field of every node, and a tree built here
// serializes to the same JSON with `JSON.stringify`.

/** A node's kind: the root (`layout`), a horizontal split, a vertical split, or a leaf. */
export type LayoutType = "layout" | "row" | "col" | "-";

/** Render hints, by md2ui's key names (`content_align`, `list_marker`, …). */
export type RenderProperties = Record<string, unknown>;

export interface LayoutNode {
  type: LayoutType;
  ratios: number[];
  children: LayoutNode[];
  content_id: string | null;
  render_properties: RenderProperties | null;
  section_level: number | null;
  section_style_key: string | null;
  heading_id: string | null;
  rotation_index: number | null;
  rotation_chain: (number | string)[];
  rotation_path: number[];
  is_card: boolean;
  card_kind: string | null;
  background_kind: string | null;
  card_bg_url: string | null;
  link_url: string | null;
  link_node_id: string | null;
  grid: boolean;
  grid_cols: number;
  bento: boolean;
  line_split: boolean;
  flow_run: number;
  spring: boolean;
  column_row: boolean;
  col_spring: boolean;
  gap_in_line: boolean;
  heading_line: boolean;
  block_line: boolean;
  table: boolean;
  table_row: string | null;
  in_table: string | null;
}

/** md2ui `LayoutNode(type, ratios, children, …)`: every other field at its default. */
export function layoutNode(
  type: LayoutType,
  ratios: number[],
  children: LayoutNode[],
  fields: Partial<LayoutNode> = {},
): LayoutNode {
  return {
    type,
    ratios,
    children,
    content_id: null,
    render_properties: null,
    section_level: null,
    section_style_key: null,
    heading_id: null,
    rotation_index: null,
    rotation_chain: [],
    rotation_path: [],
    is_card: false,
    card_kind: null,
    background_kind: null,
    card_bg_url: null,
    link_url: null,
    link_node_id: null,
    grid: false,
    grid_cols: 0,
    bento: false,
    line_split: false,
    flow_run: 0,
    spring: false,
    column_row: false,
    col_spring: false,
    gap_in_line: false,
    heading_line: false,
    block_line: false,
    table: false,
    table_row: null,
    in_table: null,
    ...fields,
  };
}
