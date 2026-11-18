// The state of one `generate()` call: what md2ui keeps on the `LayoutGenerator`
// instance and resets at the top of `generate`. Here it is one object made per call
// and dropped when the call returns, so nothing outlives a layout (ADR-003). Every memo
// is keyed by the grouper node itself, never by its `node_id`: ids are md2ui's tree
// paths on the fixtures and the grouper's content ids in production, and nothing may read them.
//
// The builders reach back into the decision core through `decideGroup` and
// `renderChild`, so a builder module never imports the core that imports it.
import type { ResolvedTheme } from "@md2ui/contracts";
import type { GroupNode } from "../group/node.ts";
import type { RegexKit } from "../group/py/re.ts";
import type { FitPoll } from "./fit-votes.ts";
import type { LayoutInput } from "./input.ts";
import type { KvRole, LayoutMeasurer } from "./measurer.ts";
import type { LayoutNode } from "./node.ts";
import type { MinWidthScope } from "./node-units.ts";
import type { UrlProps } from "./url-hints.ts";

/**
 * md2ui `_spacer_scope`: where a spacer among the children being built takes its size
 * from: the level that owns them, its fixed style, and whether they sit in a photo card.
 */
type SpacerScope = readonly [level: number, fixedStyleKey: string | null, inImageCard: boolean];

/** md2ui `_decide_group` / `_render_child`: build one grouper node at a width. */
type BuildNode = (
  run: Run,
  node: GroupNode,
  width: number,
  inGlued?: boolean,
  ownerLevel?: number,
) => LayoutNode;

/** md2ui's per-kind grid maps (`_kind_members`, `_kind_min_width`, `_kind_max_run`, `_kind_occurrences`). */
export interface KindMaps {
  /** Every grid member of a kind: run members and orphan members. */
  readonly members: Map<bigint | null, GroupNode[]>;
  /** The widest member's min width (its length category's, or measured). */
  readonly minWidth: Map<bigint | null, number>;
  /** The longest run of the kind. */
  readonly maxRun: Map<bigint | null, number>;
  /** How many runs and orphans the kind has. */
  readonly occurrences: Map<bigint | null, number>;
  /** md2ui `_kind_run_lens`: every run's length, for the kind's fill vote. */
  readonly runLens: Map<bigint | null, number[]>;
  /** md2ui `_kind_sample`: a large kind's likely-tallest members, checked before the whole kind. */
  readonly sample: Map<bigint | null, GroupNode[]>;
}

export interface Run {
  readonly input: LayoutInput;
  readonly theme: ResolvedTheme;
  readonly measurer: LayoutMeasurer;
  readonly kit: RegexKit;
  /** md2ui `_kv_roles`: the theme's `Key` / `Value` text role of each node it covers. */
  readonly kvRoles: ReadonlyMap<GroupNode, KvRole>;
  /** md2ui `_url_props`: each image's `?md2ui.*` params. */
  readonly urlProps: ReadonlyMap<GroupNode, UrlProps>;
  /** md2ui `_image_floors`: each image's `min_width` floor, capped by its `max_width`. */
  readonly imageFloors: ReadonlyMap<GroupNode, number>;
  /** md2ui `_min_width` / `_measured_min_width`'s standing arguments and `_min_w_cache`. */
  readonly minWidths: MinWidthScope;
  /** md2ui's per-kind grid maps (`_build_kind_maps`). */
  readonly kinds: KindMaps;
  /** md2ui `_marker_props_cache`: each item's baked gutter marker, `null` for none. */
  readonly markerProps: Map<GroupNode, Record<string, unknown> | null>;
  /** md2ui `_theme_asides`: some level of the theme sets `Emoji aside`. */
  readonly themeAsides: boolean;
  /** md2ui `_bento_level` when `_bento` is on, else `null`. */
  readonly bentoLevel: number | null;
  /** md2ui `_pack_unique`: the theme's `Stack sections`. */
  readonly packUnique: boolean;
  /** md2ui `_top_heading_level`: the document's shallowest heading section level. */
  readonly topHeadingLevel: number | null;
  /** md2ui `_marker_suppressed`: an ancestor being built already owns a gutter marker. */
  markerSuppressed: boolean;
  spacerScope: SpacerScope;
  /** md2ui `_spacers_built`: some spacer leaf was made, so rows may need folding. */
  spacersBuilt: boolean;
  /** md2ui `_flow_seq`: the last `flow_run` number handed out. */
  flowSeq: number;
  /** md2ui `_fit_polls`: the grid runs being built, innermost last (ADR-301). */
  readonly fitPolls: FitPoll[];
  /** md2ui `_pinned`: the members of a run whose poll unified on the icon aside. */
  readonly pinned: Set<GroupNode>;
  /** md2ui `_pinned_render`: a run's unified render hints, per member node. */
  readonly pinnedRender: Map<GroupNode, Record<string, unknown>>;
  /** md2ui `_card_urls`: some photo card's url writes a layout param. */
  readonly cardUrls: boolean;
  /** md2ui `_pinned_card`: a run's photo card, its url carrying the run's polled params. */
  readonly pinnedCard: Map<GroupNode, string>;
  /** md2ui `_cell_h_cache`: a unit's measured height per 8 px width bucket. */
  readonly cellHeights: Map<GroupNode, Map<number, number>>;
  /**
   * md2ui `_block_w_cache`: a `Stack sections` block's width ask, per width offered (a
   * block arranges by the width it is offered). It lives for this call only.
   */
  readonly blockWidths: Map<GroupNode, Map<number, number>>;
  /** md2ui `_column_stacks`: per `:::` row, the wrapper of each group of cells standing as one. */
  readonly columnStacks: Map<GroupNode, Map<string, GroupNode>>;
  /** md2ui `_stack_ids`: those wrappers, which `renderChild` stacks. */
  readonly stackIds: Set<GroupNode>;
  readonly decideGroup: BuildNode;
  readonly renderChild: BuildNode;
}
