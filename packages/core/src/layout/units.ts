// What a layout unit is and how big it is: the node-free part of md2ui's
// `generator_units.py` (the vocabulary the arrangement decisions are written in). What
// reads grouper nodes is not here.
import type { ResolvedTheme } from "@md2ui/contracts";
import { paddingX } from "../theme/query.ts";
import { type LayoutNode, layoutNode } from "./node.ts";

/** md2ui `LEAF_WIDTH`: a leaf's width ask by content-length category. */
export const LEAF_WIDTH: Readonly<Record<string, number>> = Object.freeze({
  one_word: 80,
  very_short: 100,
  short: 200,
  medium: 320,
  paragraph: 580,
});

/** md2ui `IMAGE_MIN_WIDTH`: the least width an image cell needs to sit beside content. */
export const IMAGE_MIN_WIDTH = 96;

/** md2ui `BENTO_MIN_CELLS`: containers with fewer cells keep the default layout. */
export const BENTO_MIN_CELLS = 3;

/** md2ui `_BENTO_EST_LINE_PX`: a crude single-line text width per length category, for the measurer-less height estimate. */
export const BENTO_EST_LINE_PX: Readonly<Record<string, number>> = Object.freeze({
  one_word: 70,
  very_short: 120,
  short: 260,
  medium: 480,
  paragraph: 900,
  long_paragraph: 1800,
});

/** md2ui `_BENTO_EST_LINE_H`: nominal wrapped line height (px). */
export const BENTO_EST_LINE_H = 22;

/** md2ui `_BENTO_EST_GAP`: nominal gap between leaves (px). */
export const BENTO_EST_GAP = 8;

/**
 * md2ui `_group_spacing`: the group gap on an axis (`row` true for the row axis), falling
 * back to the element gap, then 0. The generator's twin of the renderer's group spacing.
 */
export function groupSpacing(row: boolean, theme: ResolvedTheme): number {
  const grp = row ? theme.elements.group_row_spacing : theme.elements.group_col_spacing;
  if (grp !== null) return grp;
  // Python's `or`: an element gap of 0 is 0 either way.
  return (row ? theme.elements.row_spacing : theme.elements.col_spacing) || 0;
}

/**
 * md2ui `_table_cell_padding_x`: the horizontal padding a table cell's label gets, from
 * the header or the body cell style; 0 without a theme.
 */
export function tableCellPaddingX(tableRole: string | null, theme: ResolvedTheme | null): number {
  if (theme === null) return 0;
  return paddingX((tableRole === "header" ? theme.tables.header : theme.tables.cells).padding);
}

/**
 * md2ui `_table_col_gap`: the gap between table columns: the table's row spacing, else the
 * element row spacing; 0 without a theme.
 */
export function tableColGap(theme: ResolvedTheme | null): number {
  if (theme === null) return 0;
  return theme.tables.table.row_spacing ?? (theme.elements.row_spacing || 0);
}

/** md2ui `_bento_col`: a vertical band of mosaic parts, marked `bento` for height stretch. */
export function bentoCol(parts: readonly LayoutNode[]): LayoutNode {
  return layoutNode(
    "col",
    parts.map(() => 1),
    [...parts],
    { bento: true },
  );
}

/**
 * md2ui `_fill_container_levels`: give the generator's transparent containers a
 * `section_level`, bottom-up. Only a group without one that holds two or more children of
 * the same level qualifies (a grid of sibling sections): it takes the smallest such level,
 * and their style key when they all share one. A wrapper around a single section stays
 * transparent.
 *
 * Such a wrapper names its children's style, but the gaps between them belong to the
 * section `enclosing` it, gridded or stacked, so when the two differ that one's fixed
 * style rides along as the render hint `enclosing_style`.
 */
export function fillContainerLevels(node: LayoutNode, enclosing: string | null = null): void {
  const inner = node.section_level !== null ? node.section_style_key : enclosing;
  for (const child of node.children) fillContainerLevels(child, inner);
  if (node.type === "-" || node.section_level !== null) return;
  const counts = new Map<number, number>();
  for (const c of node.children) {
    if (c.section_level !== null)
      counts.set(c.section_level, (counts.get(c.section_level) ?? 0) + 1);
  }
  const levels = [...counts].filter(([, n]) => n >= 2).map(([lvl]) => lvl);
  if (levels.length === 0) return;
  node.section_level = Math.min(...levels);
  const keys = new Set(
    node.children
      .filter((c) => c.section_level === node.section_level)
      .map((c) => c.section_style_key),
  );
  if (keys.size === 1) node.section_style_key = [...keys][0] ?? null;
  if (node.section_style_key !== enclosing) {
    node.render_properties = { ...node.render_properties, enclosing_style: enclosing };
  }
}
