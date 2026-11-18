// Spacing: how much air goes between two siblings, and why (md2ui `render_spacing.py`).
// Every gap is one of three kinds and the widest applicable one wins: a section gap
// (between heading sections, per level), a group gap (between grouped blocks inside a
// section) and an element gap (between plain siblings). `siblingGap` is the one place that
// decision is made, for both axes, so a column gap and a row gap never disagree about what
// kind of boundary they are looking at. It owns no drawing and no measurement.
import type { ResolvedTheme } from "@md2ui/contracts";
import { ELEMENT_LEAF_TYPES } from "../group/node.ts";
import type { LayoutNode } from "../layout/node.ts";
import {
  resolveElementSpacing,
  resolveGroupSpacing,
  resolveImageSpacing,
  resolveSectionSpacing,
} from "../theme/query.ts";
import { cardStyle, paintsFill, structuralStyle } from "./layers.ts";
import { isListRow } from "./list-surfaces.ts";
import type { NodeIndex } from "./node-index.ts";

type Axis = "row" | "col";

/** A gap, and whether it is a section gap. */
export interface SiblingGap {
  readonly gap: number;
  readonly isSection: boolean;
}

/** Python truthiness of a render hint: absent, `None` and `""` are all falsy. */
function hasHint(node: LayoutNode, key: string): boolean {
  const v = node.render_properties?.[key];
  return v !== undefined && v !== null && v !== "" && v !== 0 && v !== false;
}

/** The grouping node's type behind a leaf (md2ui `node_index.get(id, {}).get("type")`). */
function leafType(node: LayoutNode, index: NodeIndex): string | undefined {
  return node.content_id === null ? undefined : index.get(node.content_id)?.type;
}

/** md2ui `_is_group_node`: a non-leaf container that is not a heading section. */
function isGroupNode(n: LayoutNode): boolean {
  return (n.type === "row" || n.type === "col") && n.section_level === null;
}

/** md2ui `_is_task_control`: a leaf that is a drawn checkbox or switch. */
function isTaskControl(n: LayoutNode, index: NodeIndex): boolean {
  return n.type === "-" && leafType(n, index) === "drawing_element";
}

/** Whether every leaf under `n` (at least one) satisfies `ok`. */
function everyLeaf(
  n: LayoutNode,
  index: NodeIndex,
  ok: (type: string | undefined) => boolean,
): boolean {
  let found = false;
  const stack = [...n.children];
  for (let x = stack.pop(); x !== undefined; x = stack.pop()) {
    if (x.type === "-") {
      if (!ok(leafType(x, index))) return false;
      found = true;
    } else {
      stack.push(...x.children);
    }
  }
  return found;
}

/**
 * md2ui `_is_pure_element_block`: a plain group whose entire leaf content is pills (links,
 * inline code), so it reads as a run of buttons and is spaced like a lone pill.
 */
function isPureElementBlock(n: LayoutNode, index: NodeIndex): boolean {
  return (
    isGroupNode(n) && everyLeaf(n, index, (t) => t !== undefined && ELEMENT_LEAF_TYPES.includes(t))
  );
}

/**
 * md2ui `_opens_section`: a row/col that opens a heading section. A heading *leaf* also
 * carries a `section_level` (the text seed) but is not a boundary, so this keys on the group.
 */
function opensSection(n: LayoutNode): boolean {
  return (n.type === "row" || n.type === "col") && n.section_level !== null;
}

/** md2ui `_is_key_block`: a KV key side — a `key` leaf, or a plain container of only `key` leaves. */
function isKeyBlock(n: LayoutNode, index: NodeIndex): boolean {
  if (n.type === "-") return leafType(n, index) === "key";
  return isGroupNode(n) && everyLeaf(n, index, (t) => t === "key");
}

/** md2ui `_is_image_leaf`: a leaf referencing an image content node. */
export function isImageLeaf(n: LayoutNode, index: NodeIndex): boolean {
  return n.type === "-" && leafType(n, index) === "image";
}

/** md2ui `_paints_surface`: whether `n` paints a card or a list/quote background of its own. */
function paintsSurface(n: LayoutNode, theme: ResolvedTheme): boolean {
  const card = cardStyle(n, theme);
  if (card !== null && paintsFill(card, n.card_bg_url)) return true;
  const structural = structuralStyle(n, theme);
  return structural !== null && paintsFill(structural.style, null);
}

/**
 * md2ui `_is_pure_image_block`: an image leaf, or a plain group whose entire leaf content
 * is images (≥ 1). A group that paints a surface of its own (a card fill, a list or quote
 * background), itself or anywhere inside, is not: it is a group like any other. A card
 * that paints nothing draws as its pictures, so it counts.
 */
export function isPureImageBlock(n: LayoutNode, index: NodeIndex, theme: ResolvedTheme): boolean {
  if (n.type === "-") return isImageLeaf(n, index);
  if (!isGroupNode(n)) return false;
  let found = false;
  const stack = [n];
  for (let x = stack.pop(); x !== undefined; x = stack.pop()) {
    if (x.type === "-") {
      if (!isImageLeaf(x, index)) return false;
      found = true;
    } else if (paintsSurface(x, theme)) {
      return false;
    } else {
      stack.push(...x.children);
    }
  }
  return found;
}

/** md2ui `_is_rule_leaf`: a leaf referencing a painted `___` rule. */
function isRuleLeaf(n: LayoutNode, index: NodeIndex): boolean {
  return n.type === "-" && leafType(n, index) === "horizontal_rule";
}

/** md2ui `_is_separator_cell`: a DRAWN row separator, synthetic and carrying its own render props. */
function isSeparatorCell(n: LayoutNode): boolean {
  const v = n.render_properties?.["separator"];
  return v !== undefined && v !== null;
}

/** md2ui `_is_break_leaf`: a leaf referencing a lone-`_` content break, structural and free of space. */
function isBreakLeaf(n: LayoutNode, index: NodeIndex): boolean {
  return n.type === "-" && leafType(n, index) === "content_break";
}

/** md2ui `_prev_real_sibling`: the sibling before `child` that is not a content break, or `null`. */
function prevRealSibling(
  container: LayoutNode | null,
  child: LayoutNode,
  index: NodeIndex,
): LayoutNode | null {
  if (container === null) return null;
  const kids = container.children;
  const i = kids.indexOf(child);
  if (i < 0) return null;
  for (let j = i - 1; j >= 0; j--) {
    const kid = kids[j];
    if (kid !== undefined && !isBreakLeaf(kid, index)) return kid;
  }
  return null;
}

/**
 * md2ui `_line_side`: a line block (one source line's pieces) that element-spaces any
 * adjacency. Not when it is also a glued card (glued wins), a heading's line, or a line of
 * blocks (colon columns, KV pairs), which is a group of groups toward its neighbours.
 */
function isLineSide(n: LayoutNode): boolean {
  return n.line_split && !n.is_card && !n.heading_line && !n.block_line;
}

/**
 * md2ui `_sibling_gap`: the gap between two adjacent siblings on `axis`, and whether it is a
 * section gap. `container` is the node they are children of; its baked `gap_in_line` scopes
 * the pure-pill exception to one line block's own content, and without it that exception
 * does not apply.
 *
 * Exactly one gap kind applies, in priority order: a content break costs nothing and the
 * sibling after it is spaced against the last real one before it; two rows of one merged
 * list meet with none; a task control, a list
 * marker, a date chip, a ring and a table each carry their own spacing; a section change
 * (either side opens a section, or both carry a section level) takes the enclosing
 * section's gap; a rule takes the group gap; two picture-only siblings that paint no
 * surface of their own take the image gap; a group neighbour takes the group gap unless it is a line block, a KV key, one flow
 * run, or a pure-pill block inside one line; everything else takes the element gap.
 */
export function siblingGap(
  prev: LayoutNode,
  child: LayoutNode,
  theme: ResolvedTheme,
  axis: Axis,
  ownerLevel: number,
  index: NodeIndex,
  container: LayoutNode | null,
): SiblingGap {
  const element = (): SiblingGap => ({ gap: resolveElementSpacing(axis, theme), isSection: false });
  const group = (): SiblingGap => ({ gap: resolveGroupSpacing(axis, theme), isSection: false });
  const plain = (gap: number): SiblingGap => ({ gap, isSection: false });

  // A lone-`_` content break is structural: it cuts the run of siblings but occupies no
  // space, so the sibling AFTER it is spaced against the last real one BEFORE it, and the
  // pair keeps exactly the one gap it would have had if the break were never written.
  if (isBreakLeaf(child, index)) return plain(0);
  let before = prev;
  if (isBreakLeaf(before, index)) {
    const real = prevRealSibling(container, before, index);
    if (real === null) return plain(0);
    before = real;
  }
  // The rows of one merged list card meet edge to edge: their padding is the room between
  // them, and the rule is drawn on the edge they share.
  if (axis === "col" && isListRow(before) && isListRow(child)) return plain(0);
  if (axis === "row" && (isTaskControl(before, index) || isTaskControl(child, index))) {
    return plain(theme.datapoints.task_controls.space);
  }
  // A gutter marker's `Space` IS this gap: the space between the bare marker cell and the
  // content it labels is inserted here, so the generator's aside split and the renderer agree.
  for (const n of [before, child]) {
    if (n.type !== "-") continue;
    const lm = n.render_properties?.["list_marker"];
    if (lm !== undefined && lm !== null) {
      return plain(Number((lm as { space?: number }).space ?? 0));
    }
  }
  // The two leaves of a date chip (key over day) and of a ring (value, unit) use the
  // chip's or ring's own spacing, not the generic element gap.
  if (hasHint(before, "date_role") && hasHint(child, "date_role")) {
    return plain(theme.datapoints.date_chip.spacing);
  }
  if (hasHint(before, "ring_role") && hasHint(child, "ring_role")) {
    return plain(theme.datapoints.ring.spacing);
  }
  // Table gaps: between two cells of one table row the table's row spacing; between two
  // table rows the col spacing, forced to 0 in merged mode. Unset falls back to the element gap.
  if (axis === "row" && before.in_table !== null && child.in_table !== null) {
    return plain(theme.tables.table.row_spacing ?? resolveElementSpacing(axis, theme));
  }
  if (axis === "col" && before.table_row !== null && child.table_row !== null) {
    if (theme.tables.table.merge_rows) return plain(0);
    return plain(theme.tables.table.col_spacing ?? resolveElementSpacing(axis, theme));
  }
  if (
    opensSection(before) ||
    opensSection(child) ||
    (before.section_level !== null && child.section_level !== null)
  ) {
    // The ENCLOSING section owns the gap, at every level including the root. The container
    // names the style when it is a section itself; a transparent same-level wrapper does
    // not, so the fixed style key is read off whichever sibling sits at the owner's level.
    // A wrapper of deeper sections (a grid row) names THEIR style, so the owner's is the
    // one it encloses: gridded children space like stacked ones.
    let styleKey: string | null = null;
    if (container !== null) {
      styleKey = container.section_style_key;
      const rp = container.render_properties;
      const deeper = container.section_level !== null && container.section_level !== ownerLevel;
      if (deeper && rp !== null && "enclosing_style" in rp) {
        styleKey = rp["enclosing_style"] as string | null;
      }
    }
    if (styleKey === null) {
      styleKey =
        [before, child].find((n) => n.section_level === ownerLevel && n.section_style_key !== null)
          ?.section_style_key ?? null;
    }
    return { gap: resolveSectionSpacing(ownerLevel, axis, theme, styleKey), isSection: true };
  }
  // A rule is a DIVIDER: it takes the group gap whatever it separates (section boundaries
  // above still win).
  if (isRuleLeaf(before, index) || isRuleLeaf(child, index)) return group();
  // Pictures beside pictures are one gallery, however they were written (a line of them,
  // a stack of lines, a `:::` row of picture cells), so two mosaics on a page meet at the
  // same gap their pictures do.
  if (isPureImageBlock(before, index, theme) && isPureImageBlock(child, index, theme)) {
    return plain(resolveImageSpacing(axis, theme));
  }
  // A separator separates whatever is on either side of it, so it is not a
  // group-triggering neighbour: falling through lands on the leaf rules, the element gap.
  if (
    !(isSeparatorCell(before) || isSeparatorCell(child)) &&
    (isGroupNode(before) || isGroupNode(child))
  ) {
    // Line-split blocks element-space ANY adjacency, one-sided.
    if (isLineSide(before) || isLineSide(child)) return element();
    // A KV key and its value stay element-spaced whatever the value's shape.
    if (isKeyBlock(before, index) || isKeyBlock(child, index)) return element();
    // The rows ONE flowed run wrapped onto are one unit (a shared `flow_run` id); cards are
    // excluded on both sides, glued wins.
    if (
      before.flow_run !== 0 &&
      before.flow_run === child.flow_run &&
      !before.is_card &&
      !child.is_card
    ) {
      return element();
    }
    // Pure-pill blocks are spaced like the pill leaves they contain, but only INSIDE one
    // line block, so a line's pills stay evenly spaced after the flow wraps them.
    const pilly = (n: LayoutNode): boolean => n.type === "-" || isPureElementBlock(n, index);
    if (container?.gap_in_line && pilly(before) && pilly(child)) return element();
    return group();
  }
  return element();
}
