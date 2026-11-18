// Glued content: which siblings become one card, and which wrappers go away (md2ui:
// pipeline/grouper_glue.py). A glued segment is a run of siblings the author wrote
// as one unbroken stretch of source; Phase 5.6 turns their shared id into a wrapper
// flagged `glued_content_group`, and Phase 6 unwraps the levels that wrapping and
// splitting left redundant. Nothing here splits text or mints an id.
import { handDownValign } from "./column-rows.ts";
import type { DataPointType } from "./detect/types.ts";
import { GroupNode, HEADING_TYPE_RE, sameSectionKind } from "./node.ts";
import type { RegexKit } from "./py/re.ts";
import { carryEdgeSpacers } from "./spacers.ts";

/**
 * md2ui: `_wrap_glued_content` (Phase 5.6). Post-order: a blank-split paragraph is
 * flagged in place; any other run of consecutive siblings sharing a segment id moves
 * into a new glued `group`. The flags that name whoever directly holds the pieces
 * follow them when the run is all of them.
 */
export function wrapGluedContent(node: GroupNode): void {
  for (const child of node.children) wrapGluedContent(child);
  const children = node.children;
  const n = children.length;
  const out: GroupNode[] = [];
  let i = 0;
  while (i < n) {
    const child = children[i] as GroupNode;
    const gid = child.glued_content_id;
    if (gid === null || gid === node.glued_content_id) {
      // Not in a segment, or a member of the parent's own (the parent is the wrapper).
      out.push(child);
      i += 1;
    } else if (child.glue_root) {
      child.glued_content_group = true;
      child.glue_root = false;
      out.push(child);
      i += 1;
    } else {
      let j = i;
      while (j < n && children[j]?.glued_content_id === gid && !children[j]?.glue_root) j += 1;
      const wrapper = new GroupNode("", "group");
      wrapper.glued_content_group = true;
      wrapper.glued_content_id = gid;
      wrapper.children = children.slice(i, j);
      const all = j - i === n;
      if (node.column_split_group && all) {
        wrapper.column_split_group = true;
        node.column_split_group = false;
      }
      if (node.align_group && all) {
        wrapper.align_group = true;
        node.align_group = false;
      }
      if (node.separator_chars.length > 0 && all) {
        wrapper.separator_chars = node.separator_chars;
        node.separator_chars = [];
      }
      out.push(wrapper);
      i = j;
    }
  }
  node.children = out;
}

/**
 * md2ui: `_keep_card_role`. A node a collapse handed a photo still paints it: a
 * plain group becomes an image card, a semantic wrapper is marked glued. A heading
 * section paints the photo with its own role.
 */
function keepCardRole(node: GroupNode): void {
  if (node.card_bg_url === null || node.heading_group) return;
  if (node.type === "group") node.type = "image_card";
  else if (node.type !== "image_card" && !node.glued_content_group) node.glued_content_group = true;
}

/**
 * md2ui: `_wrap_lone_root_content` (Phase 6.04). A childless root's content moved
 * onto a TEXT child, with everything that describes the leaf: a root is a
 * container, never a leaf.
 */
export function wrapLoneRootContent(root: GroupNode): void {
  if (root.children.length > 0 || !root.content) return;
  const child = new GroupNode(root.content, "text");
  child.glued_content_id = root.glued_content_id;
  child.source_line_id = root.source_line_id;
  child.text_style = root.text_style;
  child.data_points = root.data_points;
  child.paren_quote_ranges = root.paren_quote_ranges;
  root.content = "";
  root.text_style = null;
  root.data_points = [];
  root.paren_quote_ranges = [];
  root.children = [child];
}

/** What a dissolved level hands the node that absorbs it (md2ui's merge / absorb branches). */
function absorbLevel(into: GroupNode, inner: GroupNode): void {
  if (inner.glued_content_group) into.glued_content_group = true;
  // These name whoever directly holds the pieces, so they follow them up.
  if (inner.column_split_group) into.column_split_group = true;
  if (inner.column_row_group) into.take_column_row(inner);
  if (inner.align_group) into.align_group = true;
  // So does the flag a `...` line leaves on whoever holds its regions.
  if (inner.valign_group) into.valign_group = true;
  if (inner.authored_align && !into.authored_align) into.authored_align = inner.authored_align;
  carryEdgeSpacers(inner, into);
  if (inner.separator_chars.length > 0 && into.separator_chars.length === 0) {
    into.separator_chars = inner.separator_chars;
  }
  if (inner.heading_group) {
    into.heading_group = true;
    if (inner.heading_level !== null) into.heading_level = inner.heading_level;
    into.heading_id = inner.heading_id;
    into.fixed_style_key = inner.fixed_style_key;
  }
  into.glued_content_id ??= inner.glued_content_id;
  into.link_url ??= inner.link_url;
}

/**
 * md2ui: `_collapse_groups` (Phase 6). Post-order: a plain group holding one plain
 * group merges with it; a plain group with no child goes, and one with one child is
 * replaced by it unless it is glued; a non-root container whose only child is a
 * glued group or an image card absorbs it, except that an image card keeps a
 * one-line row as its own level. A heading section of a different level
 * from its sole child always survives (`sameSectionKind`).
 */
export function collapseGroups(node: GroupNode): void {
  for (const child of [...node.children]) collapseGroups(child);
  const out: GroupNode[] = [];
  for (const child of node.children) {
    for (
      let inner = child.children[0];
      child.type === "group" &&
      !child.content &&
      child.children.length === 1 &&
      inner !== undefined &&
      inner.type === "group" &&
      !inner.content &&
      sameSectionKind(child, inner);
      inner = child.children[0]
    ) {
      absorbLevel(child, inner);
      child.card_bg_url ??= inner.card_bg_url;
      child.children = inner.children;
      keepCardRole(child);
    }
    if (child.type === "group" && !child.content) {
      const promoted = child.children[0];
      if (promoted === undefined) continue; // an empty group is dropped
      if (
        child.children.length === 1 &&
        !child.glued_content_group &&
        sameSectionKind(child, promoted)
      ) {
        // The section flag, the alignment, the edge space, the click and the photo
        // survive the unwrap.
        if (child.heading_group && !promoted.heading_group) {
          promoted.heading_group = true;
          promoted.heading_level = child.heading_level;
          promoted.heading_id = child.heading_id;
          promoted.fixed_style_key = child.fixed_style_key;
        }
        if (child.authored_align && !promoted.authored_align)
          promoted.authored_align = child.authored_align;
        carryEdgeSpacers(child, promoted);
        if (child.link_url !== null && promoted.link_url === null)
          promoted.link_url = child.link_url;
        if (child.card_bg_url !== null && promoted.card_bg_url === null) {
          promoted.card_bg_url = child.card_bg_url;
          keepCardRole(promoted);
        }
        out.push(promoted);
      } else {
        out.push(child);
      }
    } else {
      out.push(child);
    }
  }
  node.children = out;

  // Glued-redundancy absorb: a non-root container whose sole child is a glued
  // group (or an image card) becomes it.
  const only = node.children[0];
  if (
    node.type !== "root" &&
    !node.content &&
    node.children.length === 1 &&
    only !== undefined &&
    !only.content &&
    ((only.type === "group" && only.glued_content_group) || only.type === "image_card") &&
    sameSectionKind(node, only) &&
    // A card never flows as a line, so a one-line row absorbed into it would
    // stack its pieces.
    !(node.type === "image_card" && oneLine(only))
  ) {
    // A `...` region's placement belongs to its content, like the flags.
    handDownValign(only, only.children);
    node.children = only.children;
    absorbLevel(node, only);
    node.card_bg_url ??= only.card_bg_url;
    keepCardRole(node);
  }
}

/** md2ui: `_one_line`. Whether `node` holds two or more pieces written on one source line. */
function oneLine(node: GroupNode): boolean {
  const lines = new Set(node.children.map((c) => c.source_line_id));
  return node.children.length > 1 && lines.size === 1 && !lines.has(null);
}

/**
 * md2ui: `_glue_stacked_block` (Phase 6.15). A stacked block, a `Key: value` pair or
 * a colon column of 2+ pieces, gets its own glue, outside a glued group or a heading
 * text. Returns what the children inherit: `[inGlued, inHeading]`.
 */
export function glueStackedBlock(
  kit: RegexKit,
  node: GroupNode,
  inGlued: boolean,
  inHeading: boolean,
): [boolean, boolean] {
  const heading = kit.re(HEADING_TYPE_RE).match(node.type) !== null;
  if (!inGlued && !inHeading && !heading) {
    if (node.type === "key-value" || (node.column_split_group && node.children.length >= 2)) {
      node.glued_content_group = true;
    }
  }
  return [inGlued || node.glued_content_group, inHeading || heading];
}

/**
 * md2ui: `_clear_false_glue`. Glue means consecutive lines stuck together: a
 * same-line split that flows, or a group holding a heading leaf, is not glue.
 */
export function clearFalseGlue(kit: RegexKit, node: GroupNode, flowsOneLine: boolean): void {
  if (!node.glued_content_group) return;
  if (flowsOneLine || node.children.some((c) => kit.re(HEADING_TYPE_RE).match(c.type) !== null))
    node.glued_content_group = false;
}

// md2ui: _ANNOTATE_ONLY_SPLIT_GROUP_TYPES. Values whose former DATAPOINT leaf sat
// beside TEXT siblings in a same-line value group.
const ANNOTATE_ONLY_SPLIT_GROUP_TYPES: readonly DataPointType[] = Object.freeze([
  "quantity",
  "time",
  "change",
  "currency",
  "ranking",
  "ratio",
  "percentage",
]);

/**
 * md2ui: `_is_datapoint_split_group`. A same-line group that is one value line
 * shattered into DATAPOINT / TEXT pieces (or its annotate-only equivalent), which
 * fingerprints as the unsplit line.
 */
export function isDatapointSplitGroup(node: GroupNode): boolean {
  if (!node.line_split_group || node.type !== "group" || node.children.length === 0) return false;
  let sawDatapoint = false;
  for (const c of node.children) {
    if (c.children.length > 0 || (c.type !== "datapoint" && c.type !== "text")) return false;
    if (c.type === "datapoint" || isWholeAnnotateOnlyLeaf(c)) sawDatapoint = true;
  }
  return sawDatapoint;
}

/**
 * md2ui: `_is_whole_annotate_only_leaf`. A TEXT leaf that is exactly one value of a
 * former split type. Read only from what `toDict()` keeps, so the live tree and the
 * one rebuilt for layout fingerprint a spring-cut stat line alike.
 */
function isWholeAnnotateOnlyLeaf(leaf: GroupNode): boolean {
  const [only, ...rest] = leaf.data_points;
  return (
    leaf.type === "text" &&
    only !== undefined &&
    rest.length === 0 &&
    only.matched === leaf.content &&
    ANNOTATE_ONLY_SPLIT_GROUP_TYPES.includes(only.type)
  );
}
