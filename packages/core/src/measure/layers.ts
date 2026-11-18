// The wrap layers of a built layout node (md2ui `render_backgrounds._wrap_layers` and
// the small questions it asks), with the section-ownership helpers measurement shares
// (`render_measure._padded_children`, `_is_transparent_container`, `_child_owner_level`).
// A node can sit inside a section background, a list or quote surface, and a card, each
// with its own padding; measurement and painting both ask this module which of them wrap
// a node and how much they inset it (ADR-400 in md2ui: one normalization point).
import type { PaddingBox, ResolvedTheme, SectionStyle } from "@md2ui/contracts";
import { type LayoutNode, layoutNode } from "../layout/node.ts";
import { newSectionStyle } from "../theme/model.ts";
import { resolveSectionStyle, sectionIsActive } from "../theme/query.ts";
import { type MergedLayerKind, mergedLayer } from "./list-surfaces.ts";

/** md2ui `render_style._RING_TEXT_MARGIN`: the margin between the ring stroke and its text region. */
const RING_TEXT_MARGIN = 4;

/**
 * What a wrap layer is: the heading section, a list or quote surface (or a merged list's
 * shell or row), or a card of some kind.
 */
export type LayerKind =
  | "section"
  | "unordered_list"
  | "task_list"
  | "numbered_list"
  | MergedLayerKind
  | "quote"
  | "date_chip"
  | "ring"
  | "image_card"
  | "card";

/** One background-and-padding wrap of a node: md2ui's `(kind, level, style)` tuple. */
export interface Layer {
  readonly kind: LayerKind;
  /** The heading level of a `section` layer; 0 for every other kind. */
  readonly level: number;
  readonly style: SectionStyle;
}

/** Python truthiness for the values a render hint or a style field can hold: `None` and `""` are empty. */
export function filled(value: unknown): value is string {
  return value !== null && value !== undefined && value !== "";
}

/** md2ui `in_levels | {level}`: the section levels open around a node, plus one. */
export function withLevel(inLevels: ReadonlySet<number>, level: number): ReadonlySet<number> {
  return new Set([...inLevels, level]);
}

/** md2ui `split_md2ui_params(url)[0]`: the url without its `md2ui.*` query segments. */
function cleanImageUrl(url: string | null): string | null {
  if (url === null) return null;
  if (url === "" || !url.includes("md2ui.")) return url;
  if (url.slice(0, 5).toLowerCase() === "data:") return url;
  const hash = url.indexOf("#");
  const head = hash < 0 ? url : url.slice(0, hash);
  const fragment = hash < 0 ? "" : url.slice(hash);
  const q = head.indexOf("?");
  if (q < 0) return url;
  const base = head.slice(0, q);
  const kept: string[] = [];
  let found = false;
  for (const segment of head.slice(q).match(/[?&][^?&]*/g) ?? []) {
    const key = segment.slice(1).split("=")[0] ?? "";
    if (!key.toLowerCase().startsWith("md2ui.")) {
      kept.push(segment);
      continue;
    }
    const eq = segment.indexOf("=");
    const raw = eq < 0 ? "" : segment.slice(eq + 1);
    let value = raw;
    try {
      value = decodeURIComponent(raw.replaceAll("+", "%2B"));
    } catch {
      value = raw;
    }
    if (key.length > "md2ui.".length && value !== "" && !/\s/.test(value)) found = true;
  }
  if (!found) return url;
  const first = kept[0];
  if (first !== undefined) kept[0] = `?${first.slice(1)}`;
  return base + kept.join("") + fragment;
}

/**
 * md2ui `_row_backgrounds_match`: every same-level section in the row paints one
 * background (same style key, same photo ignoring `md2ui.*` annotations), so one merged
 * rect can stand in for all of them.
 */
export function rowBackgroundsMatch(row: LayoutNode, level: number): boolean {
  const same = row.children.filter((c) => c.section_level === level);
  return (
    new Set(same.map((c) => c.section_style_key)).size <= 1 &&
    new Set(same.map((c) => cleanImageUrl(c.card_bg_url))).size <= 1
  );
}

/** md2ui `_is_transparent_container`: the node only groups 2+ same-level sibling sections. */
export function isTransparentContainer(node: LayoutNode, theme: ResolvedTheme): boolean {
  const level = node.section_level;
  if (level === null) return false;
  if (node.children.filter((c) => c.section_level === level).length < 2) return false;
  const st = resolveSectionStyle(theme, level, node.section_style_key);
  if (
    node.type === "row" &&
    st !== undefined &&
    st.merge_rows &&
    rowBackgroundsMatch(node, level)
  ) {
    return false;
  }
  return true;
}

/** md2ui `_child_owner_level`: the level that owns the section gaps beneath `node`. */
export function childOwnerLevel(
  node: LayoutNode,
  theme: ResolvedTheme,
  ownerLevel: number,
): number {
  if (node.section_level === null || isTransparentContainer(node, theme)) return ownerLevel;
  return node.section_level;
}

/** md2ui `_padded_children`: the children, then implicit `-` leaves up to one per ratio. */
export function paddedChildren(node: LayoutNode): LayoutNode[] {
  const children = [...node.children];
  while (children.length < node.ratios.length) children.push(layoutNode("-", [], []));
  return children;
}

/** md2ui `_paints_fill`: the style (or the node's own photo) covers its rect with something visible. */
export function paintsFill(st: SectionStyle, bgImageUrl: string | null): boolean {
  return (
    st.bg_colors.length > 0 ||
    filled(st.bg_image) ||
    st.gradient !== null ||
    (st.stroke_width > 0 && st.stroke_color !== null) ||
    filled(bgImageUrl)
  );
}

/** md2ui `TableTheme.is_active`: any table styling is configured. */
export function tablesAreActive(theme: ResolvedTheme): boolean {
  const t = theme.tables;
  return (
    sectionIsActive(t.table) ||
    sectionIsActive(t.header) ||
    sectionIsActive(t.cells) ||
    t.header_text !== null ||
    t.cells_text !== null
  );
}

/**
 * md2ui `_section_style_for`: the level and style of the heading section `node` opens, or
 * `null` when it opens none (no level, a level an ancestor already opened, an inactive
 * style, or a transparent same-level container).
 */
function sectionStyleFor(
  node: LayoutNode,
  theme: ResolvedTheme,
  inLevels: ReadonlySet<number>,
): { level: number; style: SectionStyle } | null {
  const level = node.section_level;
  if (level === null || inLevels.has(level)) return null;
  const style = resolveSectionStyle(theme, level, node.section_style_key);
  if (style === undefined || !sectionIsActive(style)) return null;
  const same = node.children.filter((c) => c.section_level === level).length;
  if (same >= 2) {
    return node.type === "row" && style.merge_rows && rowBackgroundsMatch(node, level)
      ? { level, style }
      : null;
  }
  return { level, style };
}

/**
 * md2ui `_structural_style_for`: the list or quote surface `node` carries, when the theme
 * configures it (a task list without its own style takes the unordered list's). A merged
 * list's shell or row stands for its list surface.
 */
export function structuralStyle(
  node: LayoutNode,
  theme: ResolvedTheme,
): { kind: LayerKind; style: SectionStyle } | null {
  const merged = mergedLayer(node, theme);
  if (merged !== null) return merged;
  const kind = node.background_kind;
  let style: SectionStyle;
  switch (kind) {
    case "unordered_list":
      style = theme.unordered_lists;
      break;
    case "task_list":
      style = sectionIsActive(theme.task_lists) ? theme.task_lists : theme.unordered_lists;
      break;
    case "numbered_list":
      style = theme.numbered_lists;
      break;
    case "quote":
      style = theme.quotes;
      break;
    default:
      return null;
  }
  return sectionIsActive(style) ? { kind, style } : null;
}

/** md2ui `_ring_card_style`: symmetric padding that keeps a ring's text clear of its stroke. */
function ringCardStyle(theme: ResolvedTheme): SectionStyle {
  const pad = theme.datapoints.ring.thickness + RING_TEXT_MARGIN;
  return newSectionStyle({ padding: { top: pad, left: pad, right: pad, bottom: pad } });
}

/**
 * md2ui `_card_style_for`: the card style a glued node is wrapped in, or `null` when it is
 * not wrapped. Chips, rings and image cards carry their own style; an ordinary card is
 * wrapped wherever `### Elements` insets it, and never painted: the block keeps only
 * layout keys, and a box comes from a heading style (md2ui ADR-409). An image card with no
 * `### Image Cards` falls back to the element style, so it paints only its photo.
 */
export function cardStyle(node: LayoutNode, theme: ResolvedTheme): SectionStyle | null {
  if (!node.is_card) return null;
  if (node.card_kind === "date_chip") return theme.datapoints.date_chip.chip;
  if (node.card_kind === "ring") return ringCardStyle(theme);
  if (node.card_kind === "image_card") {
    return sectionIsActive(theme.image_cards) ? theme.image_cards : theme.elements;
  }
  if (node.table && tablesAreActive(theme)) return null;
  return sectionIsActive(theme.elements) ? theme.elements : null;
}

/**
 * md2ui `_wrap_layers`: the background-and-padding wraps of `node`, outer to inner. The
 * heading section (per-level style) comes first, then a list or quote surface, then the
 * card. A card is dropped under a section that already paints a fill (heading > image
 * card > glued); chips and rings are the element itself and always compose.
 */
export function wrapLayers(
  node: LayoutNode,
  theme: ResolvedTheme,
  inLevels: ReadonlySet<number>,
): Layer[] {
  const layers: Layer[] = [];
  const section = sectionStyleFor(node, theme, inLevels);
  if (section !== null)
    layers.push({ kind: "section", level: section.level, style: section.style });
  const structural = structuralStyle(node, theme);
  if (structural !== null)
    layers.push({ kind: structural.kind, level: 0, style: structural.style });
  const card = cardStyle(node, theme);
  if (card !== null) {
    const ck = node.card_kind;
    const kind: LayerKind =
      ck === "date_chip" || ck === "ring" || ck === "image_card" ? ck : "card";
    const first = layers[0];
    const covered =
      first !== undefined &&
      first.kind === "section" &&
      (kind === "card" || kind === "image_card") &&
      paintsFill(first.style, node.card_bg_url);
    if (!covered) layers.push({ kind, level: 0, style: card });
  }
  return layers;
}

/** md2ui `_layers_pad`: the summed padding of a layer stack, added field by field in layer order. */
export function layersPad(layers: readonly Layer[]): PaddingBox {
  let top = 0;
  let left = 0;
  let right = 0;
  let bottom = 0;
  for (const { style } of layers) {
    top += style.padding.top;
    left += style.padding.left;
    right += style.padding.right;
    bottom += style.padding.bottom;
  }
  return { top, left, right, bottom };
}

/** md2ui `_layers_section_level`: the heading level among the layers, `null` when card-only. */
export function layersSectionLevel(layers: readonly Layer[]): number | null {
  return layers.find((l) => l.kind === "section")?.level ?? null;
}
