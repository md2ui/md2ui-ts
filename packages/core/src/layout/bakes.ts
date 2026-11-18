// The tree bakes that turn the generated LayoutNode tree into the baked tree (md2ui
// `session.build_scene`): the render cascade, the merged-row photo, the list surfaces
// (cards inside an item, merged lists, a run of items alone), and the image cards their
// picture sizes. They resolve, once per width and in place, what measurement and painting
// would otherwise each have to rediscover by walking ancestors (ADR-400 in md2ui).
import type { ResolvedTheme, SectionStyle } from "@md2ui/contracts";
import { RegexKit } from "../group/py/re.ts";
import {
  childOwnerLevel,
  filled,
  isTransparentContainer,
  paintsFill,
  rowBackgroundsMatch,
  structuralStyle,
} from "../measure/layers.ts";
import { isListKind, type ListKind, listStyle, mergesRows } from "../measure/list-surfaces.ts";
import { resolveSectionStyle, sectionIsActive } from "../theme/query.ts";
import { urlParams } from "../utils/image-params.ts";
import type { LayoutNode, RenderProperties } from "./node.ts";

/**
 * The themed alignment a node opens: its section's value first (a section that is also a
 * glued card owns its content), the card style's as the fallback. Shared body of md2ui's
 * `_level_align` and `_level_line_align`, which differ only in the key they read.
 */
function levelValue(
  node: LayoutNode,
  theme: ResolvedTheme,
  key: "align" | "line_align",
): string | null {
  if (node.section_level !== null && !isTransparentContainer(node, theme)) {
    const st = resolveSectionStyle(theme, node.section_level, node.section_style_key);
    if (st !== undefined && st[key] !== null) return st[key];
  }
  if (!node.is_card) return null;
  const kind = node.card_kind;
  let card: SectionStyle;
  if (kind === "image_card") {
    card = sectionIsActive(theme.image_cards) ? theme.image_cards : theme.elements;
  } else if (kind === "date_chip" || kind === "ring") {
    return null; // drawn chips, not a themed content level
  } else {
    card = theme.elements;
  }
  return card[key];
}

/**
 * Seed one cascading hint into an empty `render_properties` slot, leaving an authored
 * value alone.
 */
function seed(node: LayoutNode, key: string, value: unknown): void {
  if (!filled(value) || filled(node.render_properties?.[key])) return;
  node.render_properties = { ...node.render_properties, [key]: value };
}

/** The cascading hints one node hands down (md2ui `_cascade_render`). */
interface Cascade {
  content_align: string | null;
  line_align: string | null;
}

/**
 * md2ui `_cascade_render`: own value (the nearest ancestor) beats a farther one.
 *
 * md2ui also cascades `content_weight`. It is not here: it is a leftover of the removed
 * layout model, and nothing the generator emits ever carries it.
 */
function cascadeRender(node: LayoutNode, inherited: Cascade): Cascade {
  const own: RenderProperties = node.render_properties ?? {};
  const pick = (ownValue: unknown, inheritedValue: string | null): string | null =>
    filled(ownValue) ? ownValue : inheritedValue;
  return {
    content_align: pick(own["content_align"], inherited.content_align),
    line_align: pick(own["line_align"], inherited.line_align),
  };
}

/**
 * md2ui `bake_render_cascade`: push `content_align` onto leaves and `line_align` onto
 * every node, seed a level's themed `Align` / `Line align` into the node that opens it
 * (only into an empty slot), and set `gap_in_line` on every container that is a line
 * block or a card inside one.
 */
function bakeRenderCascade(
  node: LayoutNode,
  theme: ResolvedTheme,
  inherited: Cascade,
  inLine: boolean,
  ownerLevel: number,
): void {
  seed(node, "content_align", levelValue(node, theme, "align"));
  seed(node, "line_align", levelValue(node, theme, "line_align"));
  const cascade = cascadeRender(node, inherited);
  seed(node, "line_align", cascade.line_align);
  node.gap_in_line = node.line_split || (node.is_card && inLine);
  if (node.type === "-") {
    const rp = { ...node.render_properties };
    if (filled(cascade.content_align) && !filled(rp["content_align"])) {
      rp["content_align"] = cascade.content_align;
    }
    node.render_properties = Object.keys(rp).length > 0 ? rp : null;
    return;
  }
  const childLevel = childOwnerLevel(node, theme, ownerLevel);
  for (const child of node.children) {
    bakeRenderCascade(child, theme, cascade, node.gap_in_line, childLevel);
  }
}

/**
 * md2ui `bake_merged_row_cards`: a merging row takes its children's shared photo and the
 * children stop repeating it. Only a shared photo triggers this.
 */
function bakeMergedRowCards(node: LayoutNode, theme: ResolvedTheme): void {
  const level = node.section_level;
  if (node.type === "row" && level !== null) {
    const style = resolveSectionStyle(theme, level, node.section_style_key);
    const same = node.children.filter((c) => c.section_level === level);
    const photo = same[0]?.card_bg_url;
    if (
      same.length >= 2 &&
      style !== undefined &&
      sectionIsActive(style) &&
      style.merge_rows &&
      rowBackgroundsMatch(node, level) &&
      filled(photo)
    ) {
      node.card_bg_url = photo;
      for (const child of same) {
        child.card_bg_url = null;
        child.is_card = false;
        child.card_kind = null;
      }
    }
  }
  for (const child of node.children) bakeMergedRowCards(child, theme);
}

/** Does `node` carry a list surface the theme paints (md2ui `_structural_style_for` plus `_paints_fill`). */
function paintsListSurface(node: LayoutNode, theme: ResolvedTheme): boolean {
  const surface = structuralStyle(node, theme);
  return surface !== null && isListKind(surface.kind) && paintsFill(surface.style, null);
}

/**
 * md2ui `bake_list_cards`: inside a painted list surface a glued run keeps its glue but
 * loses its card. Image cards, date chips and rings keep theirs (`card_kind` is set).
 */
function bakeListCards(node: LayoutNode, theme: ResolvedTheme, inList: boolean): void {
  const inside = inList || paintsListSurface(node, theme);
  if (inside && node.is_card && node.card_kind === null) node.is_card = false;
  for (const child of node.children) bakeListCards(child, theme, inside);
}

/**
 * md2ui `bake_merged_lists`: mark each stacked run of list items whose level merges its
 * rows, the column as the shell (`list_shell`) and each item as a row (`list_row`). Baked
 * after `bakeListCards`, which already took the element cards out of every item: a merged
 * row paints nothing, so they must stay gone. The run's own element card goes too: the
 * shell IS the list's surface, and a card of the same extent would paint over it.
 */
function bakeMergedLists(node: LayoutNode, theme: ResolvedTheme): void {
  const kinds = new Set(node.children.map((c) => c.background_kind));
  const [kind = null] = kinds;
  if (
    node.type === "col" &&
    node.children.length >= 2 &&
    kinds.size === 1 &&
    mergesRows(theme, kind)
  ) {
    if (node.card_kind === null) node.is_card = false;
    node.render_properties = { ...node.render_properties, list_shell: kind };
    for (const child of node.children) {
      child.render_properties = { ...child.render_properties, list_row: kind };
    }
  }
  for (const child of node.children) bakeMergedLists(child, theme);
}

/**
 * md2ui `_list_kinds`: the list kinds of the items `node` holds, through the rows and
 * columns that arrange them; empty when anything else is among them.
 */
function listKinds(node: LayoutNode): Set<ListKind> {
  const kinds = new Set<ListKind>();
  for (const child of node.children) {
    if (isListKind(child.background_kind)) {
      kinds.add(child.background_kind);
    } else if (child.background_kind === null && child.children.length > 0 && !child.is_card) {
      const inner = listKinds(child);
      if (inner.size === 0) return new Set();
      for (const k of inner) kinds.add(k);
    } else {
      return new Set();
    }
  }
  return kinds;
}

/**
 * md2ui `bake_list_run_cards`: a run of list items alone, gridded or stacked, draws
 * without the element card the grouper's glue gives it, unless a level among them says
 * `List card: yes`. A lead-in or a line glued to the list keeps the card: the run is not a
 * list alone.
 */
function bakeListRunCards(node: LayoutNode, theme: ResolvedTheme): void {
  const kinds = listKinds(node);
  if (node.is_card && node.card_kind === null && kinds.size > 0) {
    if (![...kinds].some((k) => listStyle(theme, k).list_card)) node.is_card = false;
  }
  for (const child of node.children) bakeListRunCards(child, theme);
}

/**
 * md2ui `bake_card_ratios`: each image card whose url writes an `aspect_ratio` takes its
 * picture's own size (`photo_sized`, read by the sizer). Baked after the generator chose
 * the arrangement from the content, so the ratio sizes a card in the columns it was given
 * and never changes how many there are.
 */
function bakeCardRatios(node: LayoutNode, kit: RegexKit): void {
  const url = node.card_bg_url;
  if (node.card_kind === "image_card" && url && urlParams(kit, url).has("aspect_ratio")) {
    node.render_properties = { ...node.render_properties, photo_sized: true };
  }
  for (const child of node.children) bakeCardRatios(child, kit);
}

/**
 * md2ui's tree bakes, in `session.build_scene` order, mutating the generated tree into
 * the baked one.
 */
export function bakeLayout(root: LayoutNode, theme: ResolvedTheme): void {
  bakeRenderCascade(root, theme, { content_align: null, line_align: null }, false, 0);
  bakeMergedRowCards(root, theme);
  bakeListCards(root, theme, false);
  bakeMergedLists(root, theme);
  bakeListRunCards(root, theme);
  bakeCardRatios(root, new RegexKit());
}
