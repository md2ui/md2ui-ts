// Leaves, render hints and the spacers beside a node: md2ui's `_make_leaf`,
// `_make_leaf_bare`, `_attach_render` (with `_url_render`), `_edge_spacers`,
// `_ride_spacers`, and `generator_spacers`' `edge_spacers` and `ride_spacers`. md2ui's
// render oracle is not here: it was gold only.
import { GroupNode } from "../group/node.ts";
import { dpDisplayEnabled, unitRatioIsRing } from "./display-gates.ts";
import { buildRing, leafBarDisplay } from "./displays.ts";
import { voteSpacers } from "./line-pieces.ts";
import { markerSplit, wrapMarker } from "./marker-wrap.ts";
import { type LayoutNode, layoutNode } from "./node.ts";
import { minWidth } from "./node-units.ts";
import type { Run } from "./run.ts";
import { holds, spacerCell, spacerProps } from "./spacers.ts";
import { heightSized, urlRenderDict, WIDE_BREAKPOINT } from "./url-hints.ts";

/**
 * md2ui `_attach_render`: a node's own render hints: its run's unified hints when its
 * run poll pinned them, else its image URL params (the `_wide` twin where its space is
 * wide), a `max_height` turned into its width cap at the node's own ratio; then an
 * authored `...` spring's `content_align` and `content_valign`, which outrank them.
 * Replaces `render_properties` when there is any.
 */
export function attachRender(run: Run, layout: LayoutNode, node: GroupNode, width: number): void {
  const springAlign = node.authored_align;
  const url = run.urlProps.get(node);
  const pinned = run.pinnedRender.get(node);
  if (
    url === undefined &&
    pinned === undefined &&
    springAlign === null &&
    node.authored_valign === null
  ) {
    return;
  }
  const own = url === undefined ? undefined : urlRenderDict(url, width >= WIDE_BREAKPOINT);
  let props = heightSized(pinned ?? own ?? {}, own?.["aspect_ratio"]);
  if (springAlign !== null) props = { ...props, content_align: springAlign };
  if (node.authored_valign !== null) props = { ...props, content_valign: node.authored_valign };
  if (Object.keys(props).length > 0) layout.render_properties = props;
}

/**
 * md2ui `_SURFACE`: what paints a node's surface, moved onto the row that holds its
 * spacers.
 */
const SURFACE = Object.freeze([
  "is_card",
  "card_kind",
  "background_kind",
  "section_level",
  "card_bg_url",
  "link_url",
  "link_node_id",
] as const);

type SurfaceField = (typeof SURFACE)[number];

/** md2ui `_SURFACE_NAMES`: what names a node's surface, which its content keeps too. */
const SURFACE_NAMES = Object.freeze([
  "section_style_key",
  "heading_id",
  "rotation_index",
  "rotation_chain",
  "rotation_path",
] as const);

/** Copy `from`'s `fields` onto `to`, field by field. */
function copyFields<K extends keyof LayoutNode>(
  to: LayoutNode,
  from: LayoutNode,
  fields: readonly K[],
): void {
  for (const name of fields) to[name] = from[name];
}

/** md2ui `_OWN_BOX`: the box a node paints for itself, which space beside it stays outside of. */
const OWN_BOX: readonly SurfaceField[] = Object.freeze(["background_kind"]);

/**
 * md2ui `_hand_surface`: `holder`, now painting the surface `result` painted except
 * `keep`; `result` keeps the names its content reads its style by.
 */
function handSurface(
  result: LayoutNode,
  holder: LayoutNode,
  keep: readonly SurfaceField[] = [],
): LayoutNode {
  const moved = SURFACE.filter((name) => !keep.includes(name));
  copyFields(holder, result, moved);
  copyFields(result, layoutNode("row", [], []), moved);
  copyFields(holder, result, SURFACE_NAMES);
  return holder;
}

/**
 * md2ui `_edge_spacers` (`edge_spacers`): `result` with the spacers written at its edges
 * around it. Across, it sits in a row with them, entered in its grid run's poll with
 * whether it is short of room for them. `ownLine`: `result` is the node's own line or
 * row, which holds its edges across itself, so what is left is the space written above
 * and below it, stacked with it in a column, and the space of a cell beside it, which is
 * not the line's.
 *
 * The space is inside whatever surface the node is: a card or a section moves onto the
 * holder, so the card keeps its width and its spacers sit between its edge and its
 * content. Space that was a cell beside the node (`spacer_beside`) stays outside the box
 * the node paints for itself. A block its spacers hold (`holds`) floors at its own
 * minimum, which the renderer reads as `held_floor`.
 */
export function edgeSpacers(
  run: Run,
  node: GroupNode,
  result: LayoutNode,
  width: number,
  ownLine = false,
): LayoutNode {
  const leaf = (spelling: string): LayoutNode => makeLeaf(run, spacerCell(spelling), width);
  let inner = result;
  if (ownLine) {
    const down = (spelling: string | null): LayoutNode[] =>
      spelling ? [makeLeaf(run, new GroupNode(spelling, "spacer"), width)] : [];
    const above = down(node.spacer_above);
    const below = down(node.spacer_below);
    if (above.length > 0 || below.length > 0) {
      const kids = [...above, result, ...below];
      inner = handSurface(
        result,
        layoutNode(
          "col",
          kids.map(() => 1),
          kids,
        ),
      );
    }
    if (!node.spacer_beside) return inner;
  }
  if (!node.spacer_lead && !node.spacer_trail) return inner;
  const lead = node.spacer_lead ? [leaf(node.spacer_lead)] : [];
  const trail = node.spacer_trail ? [leaf(node.spacer_trail)] : [];
  const kids = [...lead, inner, ...trail];
  const row = layoutNode(
    "row",
    kids.map(() => 1),
    kids,
  );
  // A line with a cell beside it is spaced as the `:::` row of the two is: a line.
  row.line_split = ownLine;
  const align = inner.render_properties?.["content_align"];
  if (align !== undefined && align !== null) row.render_properties = { content_align: align };
  handSurface(inner, row, node.spacer_beside ? OWN_BOX : []);
  if (holds(node)) {
    const floor = minWidth(node, run.minWidths);
    result.render_properties = { ...result.render_properties, held_floor: floor };
  }
  const items = [
    ...(node.spacer_lead ? [spacerCell(node.spacer_lead)] : []),
    node,
    ...(node.spacer_trail ? [spacerCell(node.spacer_trail)] : []),
  ];
  voteSpacers(run, node, [row], [items], width);
  return row;
}

/**
 * md2ui `ride_spacers`: `result` (built for `only`, the one non-spacer child of `node`)
 * with `node`'s spacers stacked at the start and end of its column.
 */
export function rideSpacers(
  run: Run,
  node: GroupNode,
  only: GroupNode,
  result: LayoutNode,
  width: number,
): LayoutNode {
  const at = node.children.indexOf(only);
  const before = node.children.slice(0, at).map((c) => makeLeaf(run, c, width));
  const after = node.children.slice(at + 1).map((c) => makeLeaf(run, c, width));
  if (result.type !== "col") {
    const kids = [...before, result, ...after];
    return layoutNode(
      "col",
      kids.map(() => 1),
      kids,
    );
  }
  result.children = [...before, ...result.children, ...after];
  result.ratios = result.children.map(() => 1);
  return result;
}

/** Python truthiness of a drawing element: `None` and `{}` are false. */
function hasDrawing(node: GroupNode): boolean {
  return node.drawing_element !== null && Object.keys(node.drawing_element).length > 0;
}

/**
 * md2ui `_make_leaf_bare`: leaf `node` as a `-` layout node: its section, rotation
 * slot, link-card click, render hints, spacer size and K-V role, wrapped with its
 * gutter marker. A drawn ring or bar replaces or wraps the text leaf.
 */
function makeLeafBare(run: Run, node: GroupNode, width: number): LayoutNode {
  const { theme } = run;
  const cardUrl = hasDrawing(node) ? null : node.link_url;
  const fixed =
    Boolean(node.section_style_key) &&
    Object.hasOwn(theme.fixed_sections, node.section_style_key as string);
  const leaf = layoutNode("-", [], [], {
    content_id: node.node_id,
    section_level: node.heading_group ? node.heading_level : null,
    section_style_key: node.section_style_key,
    heading_id: node.heading_group ? node.heading_id : null,
    rotation_index: fixed ? node.fixed_rotation_index : node.rotation_index,
    rotation_chain: [...node.rotation_chain],
    rotation_path: [...node.rotation_path],
    link_url: cardUrl,
    link_node_id: cardUrl ? node.node_id : null,
  });
  attachRender(run, leaf, node, width);
  if (node.type === "spacer") {
    run.spacersBuilt = true;
    const axis = node.separator_kind === "spacer" ? "row" : "col";
    const [level, fixedKey, inImageCard] = run.spacerScope;
    leaf.render_properties = {
      ...leaf.render_properties,
      spacer: spacerProps(
        theme,
        node.content,
        axis,
        level,
        fixedKey,
        inImageCard,
        node.spacer_binds,
      ),
    };
  }
  const kvRole = node.node_id ? run.kvRoles.get(node) : undefined;
  if (kvRole !== undefined) leaf.render_properties = { ...leaf.render_properties, kv_role: kvRole };
  if (
    node.datapoint_display === "unit_ratio" &&
    dpDisplayEnabled(theme, node) &&
    unitRatioIsRing(theme)
  ) {
    // The ring replaces the leaf; only its spring's alignment is carried onto the row
    // that positions the card (everything else on the leaf describes text it does not draw).
    const ring = buildRing(run, node);
    const align = leaf.render_properties?.["content_align"];
    if (align !== undefined && align !== null) {
      ring.render_properties = { ...ring.render_properties, content_align: align };
    }
    return wrapMarker(run, node, ring, width);
  }
  // A bar is sized against the width the marker leaves.
  const contentWidth = run.markerSuppressed ? width : markerSplit(run, node, width)[2];
  const bar = leafBarDisplay(run, node, leaf, contentWidth);
  return wrapMarker(run, node, bar ?? leaf, width);
}

/**
 * md2ui `_make_leaf`: the layout of leaf `node`, with the spacers at its line's edges
 * beside it. md2ui's `parent` argument is never read, so it is not taken here.
 */
export function makeLeaf(run: Run, node: GroupNode, width: number): LayoutNode {
  return edgeSpacers(run, node, makeLeafBare(run, node, width), width);
}
