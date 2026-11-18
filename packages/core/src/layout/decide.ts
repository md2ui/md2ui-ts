// The decision core: md2ui's `_decide_group` (the transparent passthrough and the tail
// that decorates every group's layout), `_decide_group_rules` (the router),
// `_decide_group_sourced` (the run's pin, then the theme's icon aside), `_kv_pair_node`,
// `_build_col`, `_render_child` and `_is_full_width`, with the routing tests of the
// bento and `Stack sections` branches (`_bento_runs`; `_packs_any_unique` is in
// `grouped.ts`). The mosaics are `bento.ts`'s.
import { type GroupNode, sameSectionKind } from "../group/node.ts";
import { withUnit } from "../group/value-format.ts";
import { iconAside, themeAsksIconAside } from "./asides.ts";
import { buildBentoRuns } from "./bento.ts";
import { buildColumnRow } from "./column-row.ts";
import { dpDisplayEnabled, drawnChart, unitRatioIsRing } from "./display-gates.ts";
import {
  barLeaf,
  barStackCol,
  barTextRow,
  buildChart,
  buildRing,
  lineLeaf,
  textOverrideWidth,
  textWidth,
  unitRatioText,
  withTextOverride,
} from "./displays.ts";
import { vote } from "./fit-votes.ts";
import { flowLineGroup } from "./flow.ts";
import { buildGrouped, packsAnyUnique } from "./grouped.ts";
import { attachRender, edgeSpacers, makeLeaf, rideSpacers } from "./leaves.ts";
import { markerProps, markerSplit, wrapMarker } from "./marker-wrap.ts";
import { type LayoutNode, layoutNode } from "./node.ts";
import {
  bentoRuns,
  colGap,
  isGroup,
  isLeaf,
  lengthCategory,
  minWidth,
  unitPaddingX,
} from "./node-units.ts";
import type { Run } from "./run.ts";
import { buildTable } from "./tables.ts";

/** A node's rotation slot: its fixed style's when it has one the theme knows. */
function rotationIndex(run: Run, node: GroupNode, key: string | null): number {
  const fixed = Boolean(key) && Object.hasOwn(run.theme.fixed_sections, key as string);
  return fixed ? node.fixed_rotation_index : node.rotation_index;
}

/**
 * md2ui `_decide_group`: build group `node` at `width`. A group of one group passes
 * through to it (keeping its section, photo, link and K-V role); anything else goes
 * to an authored `:::` row, the theme's icon aside or the rules, and the result is
 * decorated with the node's render hints, rotation slot, section, card, spring, line
 * flags, edge spacers and gutter marker.
 */
export function decideGroup(
  run: Run,
  node: GroupNode,
  width: number,
  inGlued = false,
  ownerLevel = 0,
): LayoutNode {
  if (isLeaf(node)) return makeLeaf(run, node, width);
  if (node.repeated_children === null) {
    throw new Error("layout: the input was not fingerprinted (md2ui ASTPatternAnalyzer)");
  }
  const { theme } = run;
  const glued = inGlued || node.glued_content_group;
  const section = node.heading_group && node.heading_level !== null;
  const own = section ? (node.heading_level as number) : ownerLevel;
  const innerWidth = Math.max(0, width - unitPaddingX(node, theme));

  const prevSuppressed = run.markerSuppressed;
  const nodeWraps = !prevSuppressed && markerProps(run, node) !== null;
  run.markerSuppressed = prevSuppressed || nodeWraps;
  const prevScope = run.spacerScope;
  run.spacerScope = [
    own,
    section ? node.section_style_key : prevScope[1],
    prevScope[2] || node.type === "image_card" || node.card_bg_url !== null,
  ];
  const childWidth = nodeWraps ? markerSplit(run, node, innerWidth)[2] : innerWidth;

  const solid = node.child_type_counts["spacer"]
    ? node.children.filter((c) => c.type !== "spacer")
    : node.children;
  const only = solid[0];
  if (
    solid.length === 1 &&
    only !== undefined &&
    isGroup(only) &&
    !node.table_group &&
    sameSectionKind(node, only)
  ) {
    let result = decideGroup(run, only, childWidth, glued, own);
    if (node.children.length > 1) result = rideSpacers(run, node, only, result, childWidth);
    if (section && result.section_level === null) {
      result.section_level = node.heading_level;
      result.section_style_key = node.fixed_style_key;
      result.heading_id = node.heading_id;
      result.rotation_index = rotationIndex(run, node, node.fixed_style_key);
      result.rotation_chain = [...node.rotation_chain];
      result.rotation_path = [...node.rotation_path];
    }
    if (node.card_bg_url && result.card_bg_url === null) {
      result.card_bg_url = run.pinnedCard.get(node) ?? node.card_bg_url;
      result.is_card = true;
      result.card_kind = "image_card";
    }
    if (node.link_url) {
      result.link_url = node.link_url;
      result.link_node_id = node.node_id;
    }
    const kvRole = node.node_id ? run.kvRoles.get(node) : undefined;
    if (kvRole !== undefined) {
      result.render_properties = { ...result.render_properties, kv_role: kvRole };
    }
    run.markerSuppressed = prevSuppressed;
    run.spacerScope = prevScope;
    return wrapMarker(run, node, result, innerWidth);
  }

  let result: LayoutNode;
  if (node.column_row_group) {
    result = buildColumnRow(run, node, childWidth, glued, own);
  } else if (
    run.themeAsides &&
    !drawnChart(theme, node) &&
    !dpDisplayEnabled(theme, node) &&
    bentoRuns(run.bentoLevel, node).length === 0
  ) {
    result = decideGroupSourced(run, node, childWidth, glued, own);
  } else {
    result = decideGroupRules(run, node, childWidth, glued, own);
  }
  run.markerSuppressed = prevSuppressed;
  run.spacerScope = prevScope;

  attachRender(run, result, node, childWidth);
  if (result.rotation_index === null) {
    result.rotation_index = rotationIndex(run, node, node.section_style_key);
    result.rotation_chain = [...node.rotation_chain];
    result.rotation_path = [...node.rotation_path];
  }
  result.section_style_key = node.section_style_key;
  if (node.heading_group) result.heading_id = node.heading_id;
  if (node.glued_content_group) result.is_card = true;
  result.card_bg_url = run.pinnedCard.get(node) ?? node.card_bg_url;
  if (node.link_url) {
    result.link_url = node.link_url;
    result.link_node_id = node.node_id;
  }
  if (result.card_bg_url !== null) {
    result.is_card = true;
    result.card_kind = "image_card";
  }
  if (section) {
    result.section_level = node.heading_level;
    result.section_style_key = node.fixed_style_key;
    result.heading_id = node.heading_id;
  }
  if (node.valign_group && result.type === "col") result.col_spring = true;
  if (node.line_split_group && !result.children.some((c) => c.is_card)) result.line_split = true;
  if (node.line_valign) {
    result.render_properties = { ...result.render_properties, line_align: node.line_valign };
  }
  // The gutter marker first, then the edge spacers around it, as a leaf's are; both
  // live in this node's own wrap padding.
  const ownLine = node.line_split_group || node.column_row_group;
  result = wrapMarker(run, node, result, innerWidth);
  return edgeSpacers(run, node, result, innerWidth, ownLine);
}

/**
 * md2ui `_decide_group_sourced`: the icon aside when the node's run poll pinned it or
 * its level asks for one, and it fits; else the rules.
 */
function decideGroupSourced(
  run: Run,
  node: GroupNode,
  width: number,
  inGlued: boolean,
  ownerLevel: number,
): LayoutNode {
  if (run.pinned.has(node) || themeAsksIconAside(run, node, ownerLevel)) {
    const aside = iconAside(run, node, width, inGlued, ownerLevel);
    if (aside !== null) return aside;
  }
  return decideGroupRules(run, node, width, inGlued, ownerLevel);
}

/**
 * md2ui `_decide_group_rules`: tables, drawn displays, bento, a line's
 * pieces, a long paragraph's full-width column, gridded runs and packed sections, in
 * that order; a full-width column otherwise.
 */
function decideGroupRules(
  run: Run,
  node: GroupNode,
  width: number,
  inGlued: boolean,
  ownerLevel: number,
): LayoutNode {
  const { theme } = run;
  if (node.table_group) return buildTable(run, node, width, inGlued, ownerLevel);
  if (drawnChart(theme, node)) return buildChart(node);
  if (
    (node.datapoint_display === "unit_ratio" ||
      node.datapoint_display === "kv_percent_bar" ||
      node.datapoint_display === "line_chart") &&
    dpDisplayEnabled(theme, node)
  ) {
    return buildDatapointDisplay(run, node, width, inGlued, ownerLevel);
  }
  if (node.datapoint_display === "date_chip") {
    if (dpDisplayEnabled(theme, node)) return buildDateChip(run, node, width);
    const text = node.datapoint_payload?.["text"];
    if (text) {
      return layoutNode("-", [], [], {
        render_properties: { date_text: text, text_style_chain: [...node.text_style_chain] },
      });
    }
  }
  if (run.bentoLevel !== null) {
    const runs = bentoRuns(run.bentoLevel, node);
    if (runs.length > 0) {
      const mosaic = buildBentoRuns(run, node, runs, width, inGlued, ownerLevel);
      if (mosaic !== null) return mosaic;
    }
  }
  if (node.line_split_group) return flowLineGroup(run, node, width, inGlued, ownerLevel);
  if (isFullWidth(node)) return buildCol(run, node, width, inGlued, ownerLevel);
  if (
    (node.repeated_children?.size ?? 0) > 0 ||
    node.children.some((c) => c.orphan_grid) ||
    packsAnyUnique(run, node)
  ) {
    return buildGrouped(run, node, width, inGlued, ownerLevel);
  }
  return buildCol(run, node, width, inGlued, ownerLevel);
}

/**
 * md2ui `_kv_pair_node`: `row[key, value]` for a key/value pair written with a spring,
 * the value pushed right, or the two stacked when they cannot fit side by side (inside
 * a grid run, a vote: one stacks, all stack). `null` when it is not a well-formed pair.
 */
function kvPairNode(
  run: Run,
  node: GroupNode,
  width: number,
  inGlued: boolean,
  ownerLevel: number,
): LayoutNode | null {
  const key = node.children.find((c) => c.type === "key");
  const value = node.children.find((c) => c.type === "value");
  if (key === undefined || value === undefined) return null;
  const builtKey = renderChild(run, key, width, inGlued, ownerLevel);
  const builtValue = renderChild(run, value, width, inGlued, ownerLevel);
  const keyMin = minWidth(key, run.minWidths);
  const valueMin = minWidth(value, run.minWidths);
  const gap = colGap(run.kit, key, run.theme, ownerLevel, run.spacerScope[1]);
  const fits = keyMin + valueMin + gap <= width;
  if (vote(run.fitPolls, node, !fits)) return layoutNode("col", [1, 1], [builtKey, builtValue]);
  builtValue.render_properties = { ...builtValue.render_properties, content_align: "right" };
  return layoutNode("row", [1, 1], [builtKey, builtValue]);
}

/** md2ui `_is_full_width`: a child is a long paragraph. */
function isFullWidth(node: GroupNode): boolean {
  return node.children.some((c) => lengthCategory(c) === "long_paragraph");
}

/** md2ui `_build_col`: every child stacked at the full width. */
function buildCol(
  run: Run,
  node: GroupNode,
  width: number,
  inGlued: boolean,
  ownerLevel: number,
): LayoutNode {
  const children = node.children.map((child) =>
    isGroup(child)
      ? decideGroup(run, child, width, inGlued, ownerLevel)
      : makeLeaf(run, child, width),
  );
  return layoutNode(
    "col",
    children.map(() => 1),
    children,
  );
}

/**
 * md2ui `_render_child`: one child at `width`: the cells of a `:::` row standing as one,
 * stacked; an inline spacer's leaf; a drawn row separator's cell; a group's decision; or
 * a leaf.
 */
export function renderChild(
  run: Run,
  child: GroupNode,
  width: number,
  inGlued = false,
  ownerLevel = 0,
): LayoutNode {
  if (run.stackIds.has(child)) {
    return layoutNode(
      "col",
      child.children.map(() => 1),
      child.children.map((c) => renderChild(run, c, width, inGlued, ownerLevel)),
    );
  }
  const sep = child.separator_kind;
  if (sep === "spacer") return makeLeaf(run, child, width);
  if (sep !== null) {
    return layoutNode("-", [], [], {
      render_properties: { separator: { char: child.content, kind: sep } },
    });
  }
  if (isGroup(child)) return decideGroup(run, child, width, inGlued, ownerLevel);
  return makeLeaf(run, child, width);
}

/**
 * md2ui `_build_date_chip`: a date chip as a card wrapping its two stacked text leaves
 * (`card_kind` picks the chip's own themed style), each tagged `date_role` key or day.
 * The chip is a group, so repeated adjacent chips grid. A stacking column child fills
 * its column, so the chip sits in a row that collapses to its own width.
 */
function buildDateChip(run: Run, node: GroupNode, width: number): LayoutNode {
  const leaves = node.children.slice(0, 2).map((child, i) => {
    const leaf = makeLeaf(run, child, width);
    leaf.render_properties = {
      ...leaf.render_properties,
      date_role: i === 0 ? "key" : "day",
    };
    return leaf;
  });
  const col = layoutNode(
    "col",
    leaves.map(() => 1),
    leaves,
    { content_id: node.node_id || null },
  );
  col.is_card = true;
  col.card_kind = "date_chip";
  return layoutNode("row", [1], [col]);
}

/**
 * md2ui `_build_datapoint_display`: the container-level bar replacements, keeping the
 * original text leaves beside a synthetic stretch-bar leaf: a unit ratio as one row
 * (or, from a `Key: ratio` pair, a column), a ring as its drawn card; a `kv_percent_bar`
 * as a column of the pair and its bar; a line as `lineChartCol`.
 */
function buildDatapointDisplay(
  run: Run,
  node: GroupNode,
  width: number,
  inGlued: boolean,
  ownerLevel: number,
): LayoutNode {
  const p = node.datapoint_payload ?? {};
  const dp = run.theme.datapoints;
  if (node.datapoint_display === "line_chart") {
    return lineChartCol(run, node, width, inGlued, ownerLevel);
  }
  if (node.datapoint_display === "unit_ratio") {
    if (unitRatioIsRing(run.theme)) return buildRing(run, node);
    if (p["from_kv"]) return unitRatioKvCol(run, node, p, width, inGlued, ownerLevel);
    let leaves = node.children.map((c) => renderChild(run, c, width, inGlued, ownerLevel));
    let widths = node.children.map((c) => textWidth(run, c));
    const first = node.children[0];
    if (first !== undefined && (!dp.unit_ratio_show_total || !dp.unit_ratio_show_key)) {
      const text = unitRatioText(run, p, false);
      withTextOverride(leaves[0] as LayoutNode, text);
      widths[0] = textOverrideWidth(run, first, text);
      if (!dp.unit_ratio_show_key) {
        leaves = leaves.slice(0, 1);
        widths = widths.slice(0, 1);
      }
    }
    return barTextRow(run, p, "unit", leaves, widths, width);
  }
  return kvBarCol(run, node, p, "percent", width, inGlued, ownerLevel);
}

/**
 * md2ui `_kv_bar_col`: the key / value text the bar theme shows (the pair itself is
 * `kvPairNode`'s row-or-stack), plus the full-width bar above or below it. The text and
 * its bar are one element: the text part is flagged `line_split` so its gap to the bar
 * takes element spacing.
 */
function kvBarCol(
  run: Run,
  node: GroupNode,
  payload: Record<string, unknown>,
  kind: string,
  width: number,
  inGlued: boolean,
  ownerLevel: number,
): LayoutNode {
  const { kv_bar: bar } = run.theme.datapoints;
  const showKey = kind !== "percent" || bar.show_key;
  const showValue = kind !== "percent" || bar.show_value;
  let inner: LayoutNode | null = null;
  if (showKey && showValue) {
    inner = kvPairNode(run, node, width, inGlued, ownerLevel);
  } else {
    const key = node.children.find((c) => c.type === "key");
    const value = node.children.find((c) => c.type === "value");
    if (key !== undefined && value !== undefined) {
      const visible = [
        ...(showKey ? [renderChild(run, key, width, inGlued, ownerLevel)] : []),
        ...(showValue ? [renderChild(run, value, width, inGlued, ownerLevel)] : []),
      ];
      if (visible.length === 0) return layoutNode("col", [1], [barLeaf(payload, kind)]);
      inner = visible[0] as LayoutNode;
    }
  }
  inner ??= buildCol(run, node, width, inGlued, ownerLevel);
  inner.line_split = true;
  return barStackCol(inner, payload, kind, bar.position);
}

/**
 * md2ui `_line_chart_col`: the key and the last value over the drawn line of
 * `Key: a → b → c`. Unlike a bar's, a line's text never stacks: the key stays left and
 * the last value, as written with its declared unit, right, at every width.
 */
function lineChartCol(
  run: Run,
  node: GroupNode,
  width: number,
  inGlued: boolean,
  ownerLevel: number,
): LayoutNode {
  const key = node.children.find((c) => c.type === "key");
  const value = node.children.find((c) => c.type === "value");
  let inner: LayoutNode;
  if (key === undefined || value === undefined) {
    inner = buildCol(run, node, width, inGlued, ownerLevel);
  } else {
    const builtKey = renderChild(run, key, width, inGlued, ownerLevel);
    const builtValue = renderChild(run, value, width, inGlued, ownerLevel);
    const payload = node.datapoint_payload ?? {};
    const points = payload["points"];
    const last = (Array.isArray(points) ? points.at(-1) : undefined) as
      | Readonly<Record<string, unknown>>
      | undefined;
    const unit = payload["display_unit"];
    const text = withUnit(
      String(last?.["text"] || ""),
      typeof unit === "string" ? unit : null,
      run.theme.charts.value_format,
    );
    withTextOverride(builtValue, text);
    builtValue.render_properties = { ...builtValue.render_properties, content_align: "right" };
    inner = layoutNode("row", [1, 1], [builtKey, builtValue]);
  }
  inner.line_split = true;
  return layoutNode("col", [1, 1], [inner, lineLeaf(node)]);
}

/**
 * md2ui `_unit_ratio_kv_col`: a `Key: ratio` pair's bar column honouring `Unit Ratios`'
 * show-total and show-key: the key and the value (its text overridden when the total is
 * hidden) as a row, the value pushed right, or the one that is shown.
 */
function unitRatioKvCol(
  run: Run,
  node: GroupNode,
  payload: Record<string, unknown>,
  width: number,
  inGlued: boolean,
  ownerLevel: number,
): LayoutNode {
  const dp = run.theme.datapoints;
  const position = dp.kv_bar.position;
  const key = node.children.find((c) => c.type === "key");
  const value = node.children.find((c) => c.type === "value");
  if (
    (dp.unit_ratio_show_total && dp.unit_ratio_show_key) ||
    key === undefined ||
    value === undefined
  ) {
    return kvBarCol(run, node, payload, "kv_unit", width, inGlued, ownerLevel);
  }
  const visible: LayoutNode[] = [];
  if (dp.unit_ratio_show_key) visible.push(renderChild(run, key, width, inGlued, ownerLevel));
  const builtValue = renderChild(run, value, width, inGlued, ownerLevel);
  if (!dp.unit_ratio_show_total) withTextOverride(builtValue, unitRatioText(run, payload, false));
  visible.push(builtValue);
  let textPart: LayoutNode;
  if (visible.length === 2) {
    builtValue.render_properties = { ...builtValue.render_properties, content_align: "right" };
    textPart = layoutNode("row", [1, 1], visible);
  } else {
    textPart = builtValue;
  }
  textPart.line_split = true;
  return barStackCol(textPart, payload, "kv_unit", position);
}
