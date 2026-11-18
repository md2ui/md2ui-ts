// Stamps the grouper puts on its nodes (md2ui: pipeline/grouper_annotate.py): the
// data-point annotation of Phase 3, and the finishing stamps of Phases 6.06–6.26 that
// record what later stages would otherwise re-infer from the text (ADR-100).

import { placeholderRef } from "../utils/image-params.ts";
import { isSegmentedRun } from "./choices.ts";
import { editContent } from "./content-edits.ts";
import { detectDataPoints } from "./detect/detector.ts";
import { asDict, type DataPoint } from "./detect/types.ts";
import { bareContent } from "./display-vocab.ts";
import { STAR_SCORE_LABELS, tryContainerDisplay, tryLeafDisplay } from "./displays.ts";
import { ESCAPABLE_SEPARATORS, valueEscapeSpans } from "./escapes.ts";
import { glueStackedBlock } from "./glue.ts";
import { quotedElementEdits } from "./inline-marks.ts";
import { classifyLinkContent } from "./link-content.ts";
import { ELEMENT_LEAF_TYPES, GroupNode } from "./node.ts";
import { lateEscapeEdits } from "./node-reads.ts";
import { compile, type RegexKit } from "./py/re.ts";
import { charAt, charBefore, isspace } from "./py/str.ts";
import { bracketQuoteRanges, mergePq } from "./ranges.ts";

// md2ui: _ATX_PREFIX_RE. An ATX heading marker still on a leaf's text: a heading
// written inside another block (`- # Title`, `> # Title`), which the block parse
// keeps as the block's text.
// py: re.compile(r"^(#{1,6}) (?=.)")
const ATX_PREFIX_RE = compile("^(#{1,6}) (?=.)");
/** The leaves whose text is literal: an ATX marker in them is code, not a heading. */
const CODE_TYPES: readonly string[] = Object.freeze(["code_block", "inline_code"]);

/**
 * md2ui: `_detect_through_markers`. The data points of `content`, detected as if
 * escape backslashes and wrap-marker underscore runs were not there (a `\b` pattern
 * cannot see past `_`), with every offset mapped back to the real content. A data
 * point inside a token the author escaped as text is dropped, except a link.
 */
export function detectThroughMarkers(kit: RegexKit, content: string): DataPoint[] {
  return kit.dataPoints(content, (text) => detectUnmarked(kit, text));
}

/** `detectThroughMarkers`, worked out. */
function detectUnmarked(kit: RegexKit, content: string): DataPoint[] {
  if (!content.includes("\\") && !content.includes("_")) return detectDataPoints(content, kit);
  let clean = "";
  const back: number[] = []; // clean index -> index in content
  const n = content.length;
  let i = 0;
  while (i < n) {
    if (content[i] === "\\" && i + 1 < n && ESCAPABLE_SEPARATORS.includes(charAt(content, i + 1))) {
      i += 1; // drop the backslash, keep what it protects
      continue;
    }
    if (content[i] === "_") {
      let j = i;
      while (j < n && content[j] === "_") j += 1;
      // Only a run that OPENS or CLOSES a wrap: white space or the edge outside it.
      const opens = i === 0 || isspace(charBefore(content, i));
      const closes = j === n || isspace(charAt(content, j));
      if (opens || closes) {
        i = j;
        continue;
      }
    }
    clean += content[i];
    back.push(i);
    i += 1;
  }
  let dps = detectDataPoints(clean, kit).map((dp) => {
    // The END is exclusive, so it maps through the last character the match covers.
    const start = dp.start < back.length ? (back[dp.start] as number) : n;
    const end = dp.end > dp.start ? (back[dp.end - 1] as number) + 1 : start;
    return { ...dp, start, end, matched: content.slice(start, end) };
  });
  const escaped = valueEscapeSpans(content);
  if (escaped.length > 0) {
    // A link is an element, not a reading: an escape in its label declines what the
    // label's words would read as, never the link, whose label is never divided
    // (`[Plan a 5\-day itinerary](…)` stays a button).
    dps = dps.filter(
      (dp) => dp.type === "link" || !escaped.some(([s, e]) => dp.start < e && s < dp.end),
    );
  }
  return dps;
}

/**
 * md2ui: `_annotate_data_points_walk` (Phase 3). Data points, and the paren/quote
 * spans outside them, on every node with content, whatever its label.
 */
export function annotateDataPointsWalk(kit: RegexKit, node: GroupNode): void {
  for (const child of node.children) annotateDataPointsWalk(kit, child);
  if (node.content) {
    node.data_points = detectThroughMarkers(kit, node.content);
    node.paren_quote_ranges = mergePq(
      bracketQuoteRanges(
        node.content,
        node.data_points.map((dp) => [dp.start, dp.end] as const),
      ),
    );
  }
}

// py: re.compile(r"^[⭐★☆]+$")
const STAR_RUN_RE = compile("^[⭐★☆]+$");

/** md2ui: `_is_star_leaf`. A star-glyph run, or a leaf holding a star-rating SCORE. */
function isStarLeaf(kit: RegexKit, node: GroupNode): boolean {
  if (kit.re(STAR_RUN_RE).fullmatch(bareContent(node.content)) !== null) return true;
  return node.data_points.some((dp) => {
    const v = asDict(dp.value);
    if (dp.type !== "score" || v === null) return false;
    const label =
      typeof v["label"] === "string" ? v["label"] : v["label"] ? String(v["label"]) : "";
    return STAR_SCORE_LABELS.includes(label.toLowerCase()) || v["subtype"] === "single_star";
  });
}

/**
 * md2ui: `_annotate_datapoint_displays` (Phase 6.06). Post-order: leaf families are
 * decided from the parent (star context comes from siblings), container families
 * from the node. Tables are skipped; an authored tier keeps a pair out of the running.
 */
export function annotateDatapointDisplays(
  kit: RegexKit,
  node: GroupNode,
  inTable = false,
  root = true,
): void {
  const tableHere = inTable || node.table_group;
  for (const c of node.children) annotateDatapointDisplays(kit, c, tableHere, false);
  if (tableHere) return;
  if (node.children.length === 0) {
    // A one-line document's lone leaf root has no parent to decide it.
    if (root && node.datapoint_display === null && node.text_style === null)
      tryLeafDisplay(node, false);
    return;
  }
  const starContext = node.children.some((c) => isStarLeaf(kit, c));
  for (const c of node.children) {
    if (c.children.length === 0 && c.datapoint_display === null && c.text_style === null) {
      tryLeafDisplay(c, starContext);
    }
  }
  if (node.datapoint_display === null && !node.children.some((c) => c.text_style)) {
    tryContainerDisplay(kit, node, starContext);
  }
}

/**
 * md2ui: `_wrap_date_chip_groups` (Phase 6.065). A date-chip leaf becomes a group of
 * two TEXT leaves, its key and its day, so repeated chips grid; the source text
 * travels in the payload.
 */
export function wrapDateChipGroups(node: GroupNode): void {
  for (const child of node.children) wrapDateChipGroups(child);
  if (node.datapoint_display !== "date_chip" || node.children.length > 0) return;
  const payload = { ...(node.datapoint_payload ?? {}), text: node.content };
  node.datapoint_payload = payload;
  const key = new GroupNode(payloadString(payload["key"]), "text");
  const day = new GroupNode(payloadString(payload["day"]), "text");
  key.source_line_id = node.source_line_id;
  day.source_line_id = node.source_line_id;
  node.type = "group";
  node.content = "";
  node.data_points = [];
  node.children = [key, day];
}

// Python `str(payload.get(name, ""))` for a chip's key and day.
function payloadString(v: unknown): string {
  return v === undefined ? "" : String(v);
}

/**
 * md2ui: `_stamp_emoji_children` (Phase 6.2). Each EMOJI child's render role
 * (heading > text > alone) and ordinal among its emoji siblings; returns the heading
 * context the children hand down.
 */
function stampEmojiChildren(node: GroupNode, inHeading: boolean): boolean {
  const childInHeading = inHeading || node.type.startsWith("heading");
  const textContext = node.type === "key" || node.table_role !== null;
  let ordinal = 0;
  for (const child of node.children) {
    if (child.type !== "emoji") continue;
    child.emoji_index = ordinal;
    ordinal += 1;
    child.emoji_kind = childInHeading ? "heading" : textContext ? "text" : "alone";
    if (node.type === "key") child.in_key = true;
  }
  return childInHeading;
}

// md2ui: _TEXT_STYLE_SURFACES. The structural surfaces a node's text styling cascades through.
function textStyleSurfaces(type: string): readonly string[] {
  switch (type) {
    case "image_card":
      return ["image_cards"];
    case "list_item":
      return ["unordered_lists"];
    case "task_open":
    case "task_done":
      return ["unordered_lists", "task_lists"];
    case "ordered_item":
      return ["numbered_lists"];
    case "blockquote":
      return ["quotes"];
    default:
      return [];
  }
}

/**
 * md2ui: `_text_style_chain` (Phase 6.245). The styling scopes enclosing a node,
 * outermost first: root, heading levels (and a fixed style), then surfaces.
 */
function textStyleChain(node: GroupNode, chain: readonly string[]): string[] {
  const current = [...chain];
  if (node.heading_group && node.heading_level) {
    current.push(`heading:${node.heading_level}`);
    if (node.fixed_style_key) current.push(`fixed:${node.fixed_style_key}`);
  }
  for (const scope of textStyleSurfaces(node.type))
    if (!current.includes(scope)) current.push(scope);
  node.text_style_chain = current;
  return current;
}

/**
 * md2ui: `_stamp_finished_tree` (Phases 6.15–6.245): the stamps on the finished tree,
 * in one pre-order walk. 6.15 one glue per stacked block; 6.18 a heading written inside
 * another block keeps its level as `atx_level`, not its marker; 6.17 the late escapes
 * and a declined element's quotes dropped from the content (after 6.18, so `\# x` stays
 * text); 6.2 emoji roles; 6.24 the fixed section style; 6.245 the styling chain; 6.246
 * a segmented choice run.
 */
export function stampFinishedTree(
  kit: RegexKit,
  node: GroupNode,
  inGlued = false,
  inHeading = false,
  emojiInHeading = false,
  sectionKey: string | null = null,
  chain: readonly string[] = ["root"],
): void {
  const [childGlued, childInHeading] = glueStackedBlock(kit, node, inGlued, inHeading);
  // 6.18 — a heading written inside another block keeps its level, not its marker, so
  // no later stage parses it. Code is literal; `\# x` (6.17 not yet run) is text.
  if (node.content && node.children.length === 0 && !CODE_TYPES.includes(node.type)) {
    const atx = kit.re(ATX_PREFIX_RE).match(node.content);
    if (atx !== null) {
      node.atx_level = atx.text(1).length;
      editContent(node, [[0, atx.end(), ""]]);
    }
  }
  // 6.17 — the separator backslashes go, then the quotes of a declined element;
  // nothing can split any more, so from here they would only be drawn.
  if (node.content) {
    editContent(node, lateEscapeEdits(kit, node));
    editContent(node, quotedElementEdits(kit, node.content));
  }
  const childEmojiInHeading = stampEmojiChildren(node, emojiInHeading);
  let key = sectionKey;
  if (node.heading_group) key = node.fixed_style_key;
  node.section_style_key = key;
  const childChain = textStyleChain(node, chain);
  // 6.246 — a ` | ` run of one choice's options, drawn as one control (md2ui ADR-405).
  node.segmented_run = isSegmentedRun(kit, node);
  for (const child of node.children) {
    stampFinishedTree(kit, child, childGlued, childInHeading, childEmojiInHeading, key, childChain);
  }
}

// md2ui: STRUCTURAL_BACKGROUND_KINDS (grouper_types)
export function structuralKind(type: string): string | null {
  switch (type) {
    case "list_item":
      return "unordered_list";
    case "task_open":
    case "task_done":
      return "task_list";
    case "ordered_item":
      return "numbered_list";
    case "blockquote":
      return "quote";
    default:
      return null;
  }
}

/**
 * md2ui: `_rotation_channel`. The one color-rotation cycle a node takes part in:
 * a section level, a structural surface, an element variant, a named image
 * placeholder, or a card.
 */
function rotationChannel(kit: RegexKit, node: GroupNode): string | null {
  if (node.heading_group) return `section:${node.heading_level ?? "None"}`;
  const kind = structuralKind(node.type);
  if (kind !== null) return `structural:${kind}`;
  if (node.type === "emoji") return `emoji:${node.emoji_variant ?? "primary"}`;
  if (node.type === "link")
    return `link:${classifyLinkContent(kit, node.content).variant || "primary"}`;
  if (node.type === "inline_code") return `chip:${node.code_variant ?? "primary"}`;
  // Each named image placeholder counts its own cycle (ADR-406).
  const ref = node.type === "image" ? placeholderRef(kit, node.content || "") : null;
  if (ref !== null) return `placeholder:${ref.name}`;
  if (node.glued_content_group) return "card";
  return null;
}

// md2ui: _lend_slot_to_title. A section's own title pieces take the section's slot.
function lendSlotToTitle(node: GroupNode, level: number, slot: number): void {
  if (node.type === `heading${level}`) node.rotation_index = slot;
  for (const child of node.children) if (!child.heading_group) lendSlotToTitle(child, level, slot);
}

// md2ui: _lend_fixed_slot_to_title
function lendFixedSlotToTitle(node: GroupNode, slot: number): void {
  if (node.type.startsWith("heading")) node.fixed_rotation_index = slot;
  for (const child of node.children) if (!child.heading_group) lendFixedSlotToTitle(child, slot);
}

/**
 * md2ui: `_annotate_rotation_indices` (Phase 6.25). Each node's slot in its section's
 * color cycle: one counter per channel per enclosing section, every other container
 * transparent; a section opens a fresh scope and joins its children's chain and path.
 */
export function annotateRotationIndices(
  kit: RegexKit,
  node: GroupNode,
  scope: Map<string, number> = new Map(),
  chain: readonly (number | string)[] = [],
  path: readonly number[] = [],
): void {
  for (const child of node.children) {
    child.rotation_chain = [...chain];
    child.rotation_path = [...path];
    const channel = rotationChannel(kit, child);
    if (channel !== null) {
      child.rotation_index = scope.get(channel) ?? 0;
      scope.set(channel, child.rotation_index + 1);
    }
    if (child.heading_group && child.fixed_style_key) {
      const fixed = `fixed:${child.fixed_style_key}`;
      child.fixed_rotation_index = scope.get(fixed) ?? 0;
      scope.set(fixed, child.fixed_rotation_index + 1);
    }
    if (child.heading_group) {
      const level = child.heading_level ?? 0;
      lendSlotToTitle(child, level, child.rotation_index);
      if (child.fixed_style_key) lendFixedSlotToTitle(child, child.fixed_rotation_index);
      const link = child.fixed_style_key
        ? `fixed:${child.fixed_style_key}|${level}|${child.fixed_rotation_index}`
        : level;
      annotateRotationIndices(
        kit,
        child,
        new Map(),
        [...chain, link],
        [...path, child.rotation_index],
      );
    } else {
      annotateRotationIndices(kit, child, scope, chain, path);
    }
  }
}

/**
 * md2ui: `_stamp_leaf_kinds` (Phase 6.26). `pure_element` / `key_side` on every group
 * and `top_heading_level` on the root, so the layout generator, which asks them many
 * times per layout, never walks a subtree to find out.
 */
export function stampLeafKinds(root: GroupNode): void {
  root.top_heading_level = stampGroupKinds(root).top;
}

/** What `stampGroupKinds` found under a node. */
interface LeafKinds {
  /** At least one leaf with content. */
  readonly found: boolean;
  /** Every such leaf is a pill (`ELEMENT_LEAF_TYPES`). */
  readonly element: boolean;
  /** Every such leaf is a KV key. */
  readonly key: boolean;
  /** The shallowest heading-section level below the node. */
  readonly top: number | null;
}

/**
 * md2ui: `stamp_group_kinds`. Stamps `node` and the groups under it, in one post-order
 * walk. Also how the layout generator stamps the one group it builds itself, a `:::`
 * column stack.
 */
export function stampGroupKinds(node: GroupNode): LeafKinds {
  let found = false;
  let element = true;
  let key = true;
  let top: number | null = null;
  for (const child of node.children) {
    let childTop: number | null = null;
    if (child.children.length > 0) {
      const below = stampGroupKinds(child);
      found ||= below.found;
      element &&= below.element;
      key &&= below.key;
      childTop = below.top;
    } else if (child.content) {
      found = true;
      element &&= ELEMENT_LEAF_TYPES.includes(child.type);
      key &&= child.type === "key";
    }
    if (child.heading_group && child.heading_level !== null) {
      childTop = childTop === null ? child.heading_level : Math.min(childTop, child.heading_level);
    }
    if (childTop !== null) top = top === null ? childTop : Math.min(top, childTop);
  }
  node.pure_element = found && element;
  node.key_side = found && key;
  return { found, element, key, top };
}
