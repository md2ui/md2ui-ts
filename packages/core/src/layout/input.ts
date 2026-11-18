// The generator's input: md2ui's `layout_render.load_grouping_ast_node`, which rebuilds the
// tree from the grouper's JSON (`MarkdownGroupNode.from_dict`), stamps each node's
// heading context (`_stamp_heading_ctx`) and runs the pattern analyzer
// (`ASTPatternAnalyzer.fingerprints`). md2ui's own session does the same round trip
// (`session.load_grouping`: `load_grouping_ast_node(ast.to_dict())`), so the generator
// never sees the grouper's live tree; here too, production goes through `toDict()`.
import type { GroupingDataPoint, GroupingNode } from "@md2ui/contracts";
import type { DataPoint, DataPointType, DataPointValue } from "../group/detect/types.ts";
import { fingerprints } from "../group/fingerprint.ts";
import { GroupNode, HEADING_TYPE_RE, type NodeType } from "../group/node.ts";
import type { RegexKit } from "../group/py/re.ts";
import type { LeafInputs } from "./measurer.ts";

/** The link fields md2ui's `from_dict` reads back (`_classify_link_content`'s answer). */
interface LinkFields {
  readonly link_variant: string | null;
  readonly link_label: string | null;
  readonly link_is_emoji: boolean;
  readonly link_disabled: boolean;
  readonly link_emphasis: GroupingNode["link_emphasis"] | null;
}

/**
 * A tree ready to lay out, and what md2ui's node holds that `GroupNode` does not: the
 * link fields `to_dict` classifies (computed in `toDict`, never on the node).
 */
export interface LayoutInput {
  readonly root: GroupNode;
  readonly links: ReadonlyMap<GroupNode, LinkFields>;
}

/** md2ui `normalize_emoji_kind`: `peeled` is the old spelling of `text`. */
function emojiKind(kind: string | undefined): GroupNode["emoji_kind"] {
  if (kind === undefined) return null;
  return (kind === "peeled" ? "text" : kind) as GroupNode["emoji_kind"];
}

/** The type a C1 label names: `dp_ratio` is `ratio`. Checked against `DataPointType`. */
type Labelled<L> = L extends `dp_${infer T}` ? T : never;

/**
 * md2ui `_attach_data_points`: a node's data points as C1 holds them. The analyzer
 * reads them (a spring-cut value line fingerprints as one value).
 */
function dataPoint(point: GroupingDataPoint): DataPoint {
  const type: DataPointType = point.label.slice("dp_".length) as Labelled<
    GroupingDataPoint["label"]
  >;
  return {
    type,
    matched: point.matched,
    // C1 types the value `unknown`; `toDict` writes it from a `DataPointValue`.
    value: point.value as DataPointValue,
    start: point.start,
    end: point.end,
  };
}

/** md2ui `MarkdownGroupNode.from_dict`, field for field; link fields go to `links`. */
function fromDict(d: GroupingNode, links: Map<GroupNode, LinkFields>): GroupNode {
  const node = new GroupNode(d.content ?? "", (d.type ?? "") as NodeType);
  node.node_id = d.node_id ?? "";
  node.glued_content_id = d.glued_content_id ?? null;
  node.glued_content_group = d.glued_content_group ?? false;
  node.line_split_group = d.line_split_group ?? false;
  node.segmented_run = d.segmented_run ?? false;
  node.feed_slots = (d.feed_slots ?? []).map((slot) => ({ ...slot }));
  node.column_split_group = d.column_split_group ?? false;
  node.column_weight = d.column_weight ?? null;
  node.column_row_group = d.column_row_group ?? false;
  node.column_weights = [...(d.column_weights ?? [])];
  node.column_weights_wide = [...(d.column_weights_wide ?? [])];
  node.column_cuts = [...(d.column_cuts ?? [])];
  node.valign_group = d.valign_group ?? false;
  node.authored_valign = d.authored_valign ?? null;
  node.line_valign = d.line_valign ?? null;
  node.align_group = d.align_group ?? false;
  node.authored_align = d.authored_align ?? null;
  node.separator_chars = [...(d.separator_chars ?? [])];
  node.spacer_binds = d.spacer_binds ?? null;
  node.spacer_lead = d.spacer_lead ?? null;
  node.spacer_trail = d.spacer_trail ?? null;
  node.spacer_above = d.spacer_above ?? null;
  node.spacer_below = d.spacer_below ?? null;
  node.spacer_beside = d.spacer_beside ?? false;
  node.source_line_id = d.source_line_id ?? null;
  node.heading_group = d.heading_group ?? false;
  node.heading_level = d.heading_level ?? null;
  node.heading_id = d.heading_id ?? null;
  node.fixed_style_key = d.fixed_style_key ?? null;
  node.pure_element = d.pure_element ?? false;
  node.key_side = d.key_side ?? false;
  node.top_heading_level = d.top_heading_level ?? null;
  node.atx_level = d.atx_level ?? 0;
  node.section_style_key = d.section_style_key ?? null;
  node.table_group = d.table_group ?? false;
  node.table_role = d.table_role ?? null;
  node.table_align = d.table_align ?? null;
  node.datapoint_display = d.datapoint_display ?? null;
  node.datapoint_payload = d.datapoint_payload ?? null;
  node.drawing_element = d.drawing_element ?? null;
  node.text_style = d.text_style ?? null;
  node.chart_group = d.chart_group ?? false;
  node.chart_data = d.chart_data ?? null;
  node.line_group = d.line_group ?? false;
  node.line_data = d.line_data ?? null;
  node.card_bg_url = d.card_bg_url ?? null;
  node.link_url = d.link_url ?? null;
  node.emoji_variant = d.emoji_variant ?? null;
  node.code_variant = d.code_variant ?? null;
  node.code_language = d.code_language ?? null;
  node.emoji_kind = emojiKind(d.emoji_kind);
  node.in_key = d.in_key ?? false;
  node.emoji_index = d.emoji_index ?? 0;
  node.rotation_index = d.rotation_index ?? 0;
  node.fixed_rotation_index = d.fixed_rotation_index ?? 0;
  node.rotation_chain = [...(d.rotation_chain ?? [])];
  node.text_style_chain = [...(d.text_style_chain ?? [])];
  node.rotation_path = [...(d.rotation_path ?? [])];
  node.list_ordinal = d.list_ordinal ?? null;
  node.list_number = d.list_number ?? null;
  node.list_heading_level = d.list_heading_level ?? null;
  node.avg_word_count = d.avg_word_count ?? null;
  node.text_length_category = d.text_length_category ?? null;
  node.content_length_category = d.content_length_category ?? null;
  node.child_types = [...(d.child_types ?? [])];
  node.child_type_counts = { ...d.child_type_counts };
  node.data_points = (d.data_points ?? []).map(dataPoint);
  node.children = (d.children ?? []).map((c) => fromDict(c, links));
  if (
    d.link_variant !== undefined ||
    d.link_label !== undefined ||
    d.link_is_emoji !== undefined ||
    d.link_disabled !== undefined ||
    d.link_emphasis !== undefined
  ) {
    links.set(node, {
      link_variant: d.link_variant ?? null,
      link_label: d.link_label ?? null,
      link_is_emoji: d.link_is_emoji ?? false,
      link_disabled: d.link_disabled ?? false,
      link_emphasis: d.link_emphasis ?? null,
    });
  }
  return node;
}

/** The leaves that never take a heading's style (md2ui `_NO_HEADING_STYLE`). */
const NO_HEADING_STYLE: readonly string[] = Object.freeze([
  "link",
  "inline_code",
  "image",
  "horizontal_rule",
  "content_break",
  "spacer",
]);

/** md2ui `_node_heading_level`: the level a node's type or the grouper's `atx_level` declares, else 0. */
function nodeHeadingLevel(kit: RegexKit, node: GroupNode): number {
  const m = kit.re(HEADING_TYPE_RE).match(node.type);
  return m !== null ? Number(m.text(1)) : node.atx_level;
}

/**
 * md2ui `_stamp_heading_ctx`: every node on a heading's source line takes the heading
 * level as `heading_ctx`, so its min width is measured at the heading's style.
 */
function stampHeadingCtx(
  kit: RegexKit,
  node: GroupNode,
  hLevel = 0,
  hLine: number | null = null,
): void {
  let level = hLevel;
  let line = hLine;
  const own = nodeHeadingLevel(kit, node);
  if (own && node.source_line_id !== null) {
    level = own;
    line = node.source_line_id;
  }
  if (level && node.source_line_id === line && !NO_HEADING_STYLE.includes(node.type)) {
    node.heading_ctx = level;
  }
  for (const child of node.children) stampHeadingCtx(kit, child, level, line);
}

/** Every node of the tree, parents first. */
function* walk(node: GroupNode): Generator<GroupNode> {
  yield node;
  for (const child of node.children) yield* walk(child);
}

/**
 * md2ui `load_grouping_ast_node`: the grouper's JSON (contract C1) as the tree the
 * generator reads. The analyzer re-derives what the generator groups by (`kind_hash`,
 * `run_key`, `repeated_children`, `orphan_grid`, length categories).
 *
 * md2ui's analyzer renumbers `node_id` to tree paths, which md2ui's JSON already
 * holds; this repository's renumbers to content ids, which its JSON already holds. Either way the
 * ids come back as the JSON wrote them, so they are restored after the analyzer runs:
 * that is the same answer, and it keeps md2ui's ids on md2ui's fixtures.
 */
export function layoutInput(kit: RegexKit, tree: GroupingNode): LayoutInput {
  const links = new Map<GroupNode, LinkFields>();
  const root = fromDict(tree, links);
  stampHeadingCtx(kit, root);
  const ids = [...walk(root)].map((n) => [n, n.node_id] as const);
  fingerprints(kit, root);
  for (const [n, id] of ids) n.node_id = id;
  return { root, links };
}

/** What md2ui's leaf measurers read off `node` (`_LEAF_INPUTS`), absent link fields defaulted. */
export function leafInputs(input: LayoutInput, node: GroupNode): LeafInputs {
  const link = input.links.get(node);
  return {
    node_id: node.node_id,
    type: node.type,
    content: node.content,
    heading_ctx: node.heading_ctx,
    atx_level: node.atx_level,
    text_style: node.text_style,
    text_style_chain: node.text_style_chain,
    code_variant: node.code_variant,
    code_language: node.code_language,
    emoji_kind: node.emoji_kind,
    emoji_index: node.emoji_index,
    emoji_variant: node.emoji_variant,
    in_key: node.in_key,
    table_role: node.table_role,
    link_variant: link?.link_variant ?? null,
    link_label: link?.link_label ?? null,
    link_is_emoji: link?.link_is_emoji ?? false,
    link_disabled: link?.link_disabled ?? false,
    drawing_element: node.drawing_element,
  };
}
