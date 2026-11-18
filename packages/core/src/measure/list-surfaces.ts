// Merged list surfaces (md2ui `render_list_surfaces`): one card behind a whole list, a
// rule between its items. A list level paints one background per item by default;
// `Merge rows: yes` on it asks for the settings-menu shape, where a stacked run of two or
// more items shares ONE card (the shell, on the column) and each item is a row inside it
// (the level's padding, no paint, no gap between rows), with the level-scoped horizontal
// rule as a divider on the edge two rows share. It is the theme's look, never the
// author's: the Markdown is the same list either way.
//
// The decision is baked onto the layout once per width (`layout/bakes.ts`), so measuring
// and painting read the same layers (ADR-400 in md2ui). This module answers what the
// baked marks mean: the wrap layer a shell or row stands for, what each paints, and
// where a divider goes.
import type { PaddingBox, ResolvedTheme, SectionStyle } from "@md2ui/contracts";
import type { LayoutNode } from "../layout/node.ts";
import { newSectionStyle } from "../theme/model.ts";
import { scopedHorizontalRuleStyle, sectionIsActive } from "../theme/query.ts";

/** A list surface: md2ui `LIST_SURFACES`. */
export type ListKind = "unordered_list" | "task_list" | "numbered_list";

/** The wrap layer of a merged list: its shell, or one of its rows. */
export type MergedLayerKind = `${ListKind}_shell` | "list_row";

/** The rule between two merged rows, painted as a thin fill. */
export type DividerKind = `${ListKind}_divider`;

/** md2ui `ROW`: a merged list's row layer, which paints nothing. */
const LIST_ROW = "list_row";

const NO_PADDING: PaddingBox = Object.freeze({ top: 0, left: 0, right: 0, bottom: 0 });

// The scopes a list kind's rule overrides are authored under; task items read the
// unordered level first, as their surface does (md2ui `_RULE_SCOPES`).
const RULE_SCOPES: Readonly<Record<ListKind, readonly string[]>> = Object.freeze({
  unordered_list: Object.freeze(["unordered_lists"]),
  task_list: Object.freeze(["unordered_lists", "task_lists"]),
  numbered_list: Object.freeze(["numbered_lists"]),
});

/** md2ui `LIST_SURFACES` membership. */
export function isListKind(kind: string | null): kind is ListKind {
  return kind === "unordered_list" || kind === "task_list" || kind === "numbered_list";
}

/**
 * md2ui `list_style`: the style a list surface of `kind` paints with; task items fall back
 * to the unordered level when `### Task Lists` paints nothing.
 */
export function listStyle(theme: ResolvedTheme, kind: ListKind): SectionStyle {
  if (kind === "unordered_list") return theme.unordered_lists;
  if (kind === "numbered_list") return theme.numbered_lists;
  return sectionIsActive(theme.task_lists) ? theme.task_lists : theme.unordered_lists;
}

/** md2ui `_merges`: the level of `kind` is active and merges its rows. */
export function mergesRows(theme: ResolvedTheme, kind: string | null): boolean {
  if (!isListKind(kind)) return false;
  const style = listStyle(theme, kind);
  return sectionIsActive(style) && style.merge_rows;
}

function listShell(node: LayoutNode): ListKind | null {
  const kind = node.render_properties?.["list_shell"];
  return typeof kind === "string" && isListKind(kind) ? kind : null;
}

function listRow(node: LayoutNode): ListKind | null {
  const kind = node.render_properties?.["list_row"];
  return typeof kind === "string" && isListKind(kind) ? kind : null;
}

/** md2ui `is_row`: `node` is a row of a merged list. */
export function isListRow(node: LayoutNode): boolean {
  return listRow(node) !== null;
}

/**
 * md2ui `merged_layer`: the wrap layer a merged shell or row stands for, or `null` for any
 * other node. The layer's style is what insets the content (a shell none, a row the
 * level's padding); what it paints is `mergedPaintStyle`'s.
 */
export function mergedLayer(
  node: LayoutNode,
  theme: ResolvedTheme,
): { kind: MergedLayerKind; style: SectionStyle } | null {
  const shell = listShell(node);
  if (shell !== null) {
    return { kind: `${shell}_shell`, style: { ...listStyle(theme, shell), padding: NO_PADDING } };
  }
  const row = listRow(node);
  if (row !== null) {
    return { kind: LIST_ROW, style: newSectionStyle({ padding: listStyle(theme, row).padding }) };
  }
  return null;
}

/**
 * md2ui `paint_style`: what a merged box paints, `null` for a row, `undefined` when `kind`
 * is not a merged one. The shell paints the level's first colour only: it is one box with
 * no item behind it, so a cycle of colours has nothing to deal across. A divider paints
 * the scoped rule as a thin fill.
 */
export function mergedPaintStyle(
  kind: string,
  theme: ResolvedTheme,
): SectionStyle | null | undefined {
  if (kind === LIST_ROW) return null;
  for (const list of Object.keys(RULE_SCOPES) as ListKind[]) {
    if (kind === `${list}_shell`) {
      const style = listStyle(theme, list);
      return { ...style, bg_colors: style.bg_colors.slice(0, 1), padding: NO_PADDING };
    }
    if (kind === `${list}_divider`) {
      const rule = scopedHorizontalRuleStyle(theme, RULE_SCOPES[list]);
      return newSectionStyle({ bg_colors: [rule.stroke_color] });
    }
  }
  return undefined;
}

/** A divider's rect and kind. */
export interface Divider {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly kind: DividerKind;
}

/**
 * md2ui `divider_rect`: the rule painted at `y`, the edge two merged rows share, centred on
 * that edge and inset by the rows' padding so it lines up with their content. `null`
 * between any other two siblings, or when the scoped rule has no width.
 */
export function dividerRect(
  prev: LayoutNode,
  child: LayoutNode,
  x: number,
  y: number,
  width: number,
  theme: ResolvedTheme,
): Divider | null {
  const kind = listRow(child);
  if (kind === null || !isListRow(prev)) return null;
  const rule = scopedHorizontalRuleStyle(theme, RULE_SCOPES[kind]);
  if (rule.stroke_width <= 0) return null;
  const pad = listStyle(theme, kind).padding;
  const w = rule.stroke_width;
  return {
    x: x + pad.left,
    y: y - w / 2,
    width: width - (pad.left + pad.right),
    height: w,
    kind: `${kind}_divider`,
  };
}
