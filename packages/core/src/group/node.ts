// The grouper's node (md2ui `grouper_types.MarkdownGroupNode`) and its JSON form
// (`to_dict`, contract C1). Field names mirror md2ui's (ADR-005), so every field can be
// found in md2ui by name; what each one means is documented there.
import type { GroupingDataPoint, GroupingNode } from "@md2ui/contracts";
import type { DataPoint } from "./detect/types.ts";
import { classifyLinkContent } from "./link-content.ts";
import { compile, RegexKit } from "./py/re.ts";
import type { Criterion } from "./split/criteria.ts";

/** One `feed_slots` entry of C1: a slot's words, `content.slice(start, end)` (ADR-206). */
export type FeedSlotEntry = NonNullable<GroupingNode["feed_slots"]>[number];

/** md2ui: `_HEADING_TYPE_RE` (grouper_types). A heading leaf's type, `heading1`–`heading6`. */
// py: re.compile(r"^heading(\d)$")
export const HEADING_TYPE_RE = compile(String.raw`^heading(\d)$`);

/** md2ui `NodeType` values, plus `root` and `heading1`–`heading6`, which label sections. */
export type NodeType =
  | "text"
  | "key"
  | "value"
  | "group"
  | "key-value"
  | "segment"
  | "image"
  | "link"
  | "emoji"
  | "bold"
  | "italic"
  | "strikethrough"
  | "inline_code"
  | "code_block"
  | "list_item"
  | "ordered_item"
  | "task_open"
  | "task_done"
  | "drawing_element"
  | "blockquote"
  | "bullet_point"
  | "table_header"
  | "table_row"
  | "table_cell"
  | "horizontal_rule"
  | "content_break"
  | "section_stop"
  | "column_divider"
  | "vertical_spring"
  | "row_closer"
  | "spacer"
  | "datapoint"
  | "image_card"
  | "root"
  | `heading${1 | 2 | 3 | 4 | 5 | 6}`;

/** md2ui `ELEMENT_LEAF_TYPES` (grouper_types): chips, links, emojis and drawn controls. */
export const ELEMENT_LEAF_TYPES: readonly string[] = Object.freeze([
  "link",
  "inline_code",
  "emoji",
  "drawing_element",
]);

/** A field's value in C1, without the "absent" that makes it optional there. */
type C1<K extends keyof GroupingNode> = NonNullable<GroupingNode[K]>;

export class GroupNode {
  content: string;
  type: NodeType;
  glued_content_id: number | null = null;
  glued_content_group = false;
  /** md2ui `_glue_root`: a multi-line paragraph the blank-line split made its own segment. */
  glue_root = false;
  line_split_group = false;
  /** md2ui: the children are the buttons of ONE choice divided by ` | ` (ADR-405), stamped in Phase 6.246. */
  segmented_run = false;
  /** md2ui: the feed slots this node draws, each a range of `content` (ADR-206), stamped in Phase 6.246. */
  feed_slots: FeedSlotEntry[] = [];
  column_split_group = false;
  column_weight: number | null = null;
  column_weight_wide: number | null = null;
  column_when: C1<"column_cuts">[number] = null;
  column_row_group = false;
  column_weights: (number | null)[] = [];
  column_weights_wide: (number | null)[] = [];
  column_cuts: C1<"column_cuts"> = [];
  valign_group = false;
  authored_valign: C1<"authored_valign"> | null = null;
  line_valign: string | null = null;
  align_group = false;
  authored_align: C1<"authored_align"> | null = null;
  /**
   * md2ui `pair_source`, on a `key-value` pair: the type and text of the line it was cut
   * from. A pair exists only while a display reads it (ADR-205): a pair that still
   * holds this when Phase 6.075 runs becomes that line again. Never serialized.
   */
  pair_source: readonly [NodeType, string] | null = null;
  separator_chars: string[] = [];
  /** `edge` only on the line-edge spacer cells the layout generator makes (md2ui `spacer_cell`). */
  spacer_binds: C1<"spacer_binds"> | "edge" | null = null;
  spacer_lead: string | null = null;
  spacer_trail: string | null = null;
  /** md2ui `spacer_beside`: the edge space was a `:::` cell of its own, beside the box this node paints. */
  spacer_beside = false;
  /** md2ui `spacer_above`: space written above a row the plain grouping merged with its card. */
  spacer_above: string | null = null;
  /** md2ui `spacer_below`: space written below a row the plain grouping merged with its card. */
  spacer_below: string | null = null;
  separator_kind: string | null = null;
  source_line_id: number | null = null;
  heading_group = false;
  heading_level: number | null = null;
  heading_id: string | null = null;
  fixed_style_key: string | null = null;
  /** md2ui `pure_element`: every leaf of this group is a pill (`ELEMENT_LEAF_TYPES`), ≥ 1 (Phase 6.26). */
  pure_element = false;
  /** md2ui `key_side`: every leaf of this group is a KV `key`, ≥ 1 (Phase 6.26). */
  key_side = false;
  /** md2ui `top_heading_level`, on the root only: the shallowest heading-section level in the document. */
  top_heading_level: number | null = null;
  /** md2ui `atx_level`, on a leaf written as a heading inside another block (`- # Title`): its ATX level, the marker dropped from `content` (Phase 6.18). 0 when it is not one. */
  atx_level = 0;
  section_style_key: string | null = null;
  heading_ctx = 0;
  table_group = false;
  table_role: C1<"table_role"> | null = null;
  table_align: C1<"table_align"> | null = null;
  datapoint_display: C1<"datapoint_display"> | null = null;
  datapoint_payload: C1<"datapoint_payload"> | null = null;
  drawing_element: C1<"drawing_element"> | null = null;
  text_style: C1<"text_style"> | null = null;
  chart_group = false;
  chart_data: C1<"chart_data"> | null = null;
  /** Several lines on one axis: a bullet run of `Key: a → b → c` items (Phase 6.07, ADR-204). */
  line_group = false;
  line_data: C1<"line_data"> | null = null;
  emoji_variant: C1<"emoji_variant"> | null = null;
  code_variant: C1<"code_variant"> | null = null;
  /** An emoji or chip wrapped in `~~`: muted, the `link_disabled` of a badge or chip. */
  element_muted = false;
  code_language: string | null = null;
  card_bg_url: string | null = null;
  link_url: string | null = null;
  emoji_kind: C1<"emoji_kind"> | null = null;
  emoji_index = 0;
  rotation_index = 0;
  fixed_rotation_index = 0;
  rotation_chain: (number | string)[] = [];
  text_style_chain: string[] = [];
  rotation_path: number[] = [];
  in_key = false;
  list_ordinal: number | null = null;
  list_number: number | null = null;
  list_heading_level: number | null = null;
  node_id = "";
  children: GroupNode[] = [];
  fingerprint_hash: bigint | null = null;
  /** md2ui `kind_hash`: the normalized same-kind signature's hash (Phase 6.5). */
  kind_hash: bigint | null = null;
  /** md2ui `run_key`: the contiguous same-kind run of siblings this node belongs to. */
  run_key: bigint | null = null;
  /** md2ui `repeated_children`: this node's same-kind runs of 2+ children, by run key. */
  repeated_children: Map<bigint, GroupNode[]> | null = null;
  /** md2ui `orphan_grid`: a lone member of a kind its siblings' runs grid. */
  orphan_grid = false;
  data_points: DataPoint[] = [];
  /** md2ui `paren_quote_ranges`: balanced bracket and quote spans, protected from cuts. */
  paren_quote_ranges: (readonly [number, number])[] = [];
  applicable: ReadonlySet<Criterion> | null = null;
  avg_word_count: number | null = null;
  text_length_category: C1<"text_length_category"> | null = null;
  content_length_category: C1<"content_length_category"> | null = null;
  child_types: string[] = [];
  child_type_counts: Record<string, number> = {};

  constructor(content = "", type: NodeType = "text") {
    this.content = content;
    this.type = type;
  }

  /** md2ui `take_column_row`: become the `:::` row whose cells this node takes over. */
  take_column_row(row: GroupNode): void {
    this.column_row_group = row.column_row_group;
    this.column_weights = row.column_weights;
    this.column_weights_wide = row.column_weights_wide;
    this.column_cuts = row.column_cuts;
  }

  /** md2ui `to_dict`: the node and its subtree in C1's JSON form. */
  toDict(kit: RegexKit = new RegexKit()): GroupingNode {
    const d: GroupingNode = {
      node_id: this.node_id,
      content: this.content,
      type: this.type,
      fingerprint_hash: this.fingerprint_hash,
      children: this.children.map((c) => c.toDict(kit)),
    };
    if (this.glued_content_group) {
      d.glued_content_group = true;
      this.children.forEach((c, i) => {
        const cd = d.children[i];
        if (cd !== undefined && c.glued_content_id !== null)
          cd.glued_content_id = c.glued_content_id;
      });
    }
    if (this.line_split_group) d.line_split_group = true;
    if (this.segmented_run) d.segmented_run = true;
    if (this.feed_slots.length > 0) d.feed_slots = this.feed_slots.map((slot) => ({ ...slot }));
    if (this.column_split_group) d.column_split_group = true;
    if (this.column_weight !== null) d.column_weight = this.column_weight;
    if (this.column_row_group) {
      d.column_row_group = true;
      d.column_weights = [...this.column_weights];
      if (this.column_weights_wide.length > 0)
        d.column_weights_wide = [...this.column_weights_wide];
      if (this.column_cuts.length > 0) d.column_cuts = [...this.column_cuts];
    }
    if (this.valign_group) d.valign_group = true;
    if (this.authored_valign !== null) d.authored_valign = this.authored_valign;
    if (this.line_valign !== null) d.line_valign = this.line_valign;
    if (this.align_group) d.align_group = true;
    if (this.authored_align !== null) d.authored_align = this.authored_align;
    if (this.separator_chars.length > 0) d.separator_chars = [...this.separator_chars];
    // An `edge` cell is the layout generator's own and never reaches C1.
    if (this.spacer_binds !== null && this.spacer_binds !== "edge") {
      d.spacer_binds = this.spacer_binds;
    }
    if (this.spacer_lead !== null) d.spacer_lead = this.spacer_lead;
    if (this.spacer_trail !== null) d.spacer_trail = this.spacer_trail;
    if (this.spacer_above !== null) d.spacer_above = this.spacer_above;
    if (this.spacer_below !== null) d.spacer_below = this.spacer_below;
    if (this.spacer_beside) d.spacer_beside = true;
    if (this.source_line_id !== null) d.source_line_id = this.source_line_id;
    if (this.heading_group) {
      d.heading_group = true;
      d.heading_level = this.heading_level;
      if (this.heading_id !== null) d.heading_id = this.heading_id;
      if (this.fixed_style_key !== null) d.fixed_style_key = this.fixed_style_key;
    }
    if (this.pure_element) d.pure_element = true;
    if (this.key_side) d.key_side = true;
    if (this.top_heading_level !== null) d.top_heading_level = this.top_heading_level;
    if (this.atx_level) d.atx_level = this.atx_level;
    if (this.section_style_key !== null) d.section_style_key = this.section_style_key;
    if (this.table_group) d.table_group = true;
    if (this.table_role !== null) d.table_role = this.table_role;
    if (this.table_align !== null) d.table_align = this.table_align;
    if (this.datapoint_display !== null) {
      d.datapoint_display = this.datapoint_display;
    }
    // Payloads are copied: a later phase adds to them, and a recorded phase must not move.
    if (this.datapoint_payload !== null) d.datapoint_payload = { ...this.datapoint_payload };
    if (this.drawing_element !== null) d.drawing_element = { ...this.drawing_element };
    if (this.text_style !== null) d.text_style = this.text_style;
    if (this.chart_group) d.chart_group = true;
    if (this.chart_data !== null) {
      const { rows, series } = this.chart_data;
      d.chart_data = {
        ...this.chart_data,
        ...(rows === undefined ? {} : { rows: rows.map((r) => ({ ...r, values: [...r.values] })) }),
        ...(series === undefined || series === null ? {} : { series: [...series] }),
      };
    }
    if (this.line_group) d.line_group = true;
    if (this.line_data !== null) d.line_data = this.line_data;
    if (this.card_bg_url !== null) d.card_bg_url = this.card_bg_url;
    if (this.link_url !== null) d.link_url = this.link_url;
    if (this.type === "link") {
      const link = classifyLinkContent(kit, this.content);
      d.link_variant = link.variant;
      d.link_label = link.label;
      if (link.is_emoji) d.link_is_emoji = true;
      if (link.is_disabled) d.link_disabled = true;
      if (link.emphasis !== null) d.link_emphasis = link.emphasis;
    }
    if (this.type === "emoji" && this.emoji_kind !== null) {
      d.emoji_kind = this.emoji_kind;
    }
    if (this.type === "emoji" && this.emoji_variant !== null) {
      d.emoji_variant = this.emoji_variant;
    }
    if (this.type === "inline_code" && this.code_variant !== null) {
      d.code_variant = this.code_variant;
    }
    if (this.element_muted) d.element_muted = true;
    if (this.type === "code_block" && this.code_language !== null)
      d.code_language = this.code_language;
    if (this.type === "emoji" && this.in_key) d.in_key = true;
    if (this.emoji_index !== 0) d.emoji_index = this.emoji_index;
    if (this.rotation_index !== 0) d.rotation_index = this.rotation_index;
    if (this.fixed_rotation_index !== 0) d.fixed_rotation_index = this.fixed_rotation_index;
    if (this.rotation_chain.length > 0) d.rotation_chain = [...this.rotation_chain];
    if (this.text_style_chain.length > 0) d.text_style_chain = [...this.text_style_chain];
    if (this.rotation_path.length > 0) d.rotation_path = [...this.rotation_path];
    if (this.list_ordinal !== null) d.list_ordinal = this.list_ordinal;
    if (this.list_number !== null) d.list_number = this.list_number;
    if (this.list_heading_level !== null) d.list_heading_level = this.list_heading_level;
    if (this.avg_word_count !== null) d.avg_word_count = this.avg_word_count;
    if (this.text_length_category !== null) {
      d.text_length_category = this.text_length_category;
    }
    if (this.content_length_category !== null) {
      d.content_length_category = this.content_length_category;
    }
    if (this.child_types.length > 0) d.child_types = [...this.child_types];
    if (Object.keys(this.child_type_counts).length > 0)
      d.child_type_counts = { ...this.child_type_counts };
    if (this.data_points.length > 0) {
      d.data_points = this.data_points.map(
        (dp): GroupingDataPoint => ({
          label: `dp_${dp.type}`,
          matched: dp.matched,
          value: dp.value,
          start: dp.start,
          end: dp.end,
        }),
      );
    }
    return d;
  }
}

/**
 * md2ui: `grouper_types.same_section_kind`. False when `outer` and `inner` are two
 * DIFFERENT painted containers: heading sections of different levels, each styled
 * by its own level, so neither may absorb the other.
 */
export function sameSectionKind(outer: GroupNode, inner: GroupNode): boolean {
  if (outer.heading_group && inner.heading_group)
    return outer.heading_level === inner.heading_level;
  return true;
}
