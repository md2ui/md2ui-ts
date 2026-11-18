// The layout nodes that draw data-point displays: md2ui's `generator_displays` (rings,
// the synthetic stretch-bar leaf and the rows and columns that put text beside it,
// charts). The grouper identifies display-shaped data; here the theme is applied and
// the nodes the painter draws are built. md2ui's `GeneratorContext` is `run.theme` and
// `run.measurer`. The container builders that recurse into children are in `decide.ts`.
import type { GroupNode } from "../group/node.ts";
import { pySum } from "../group/py/math.ts";
import { formatG, pyFloat } from "../group/py/str.ts";
import { dpDisplayEnabled, unitRatioIsRing } from "./display-gates.ts";
import { leafInputs } from "./input.ts";
import { type LayoutNode, layoutNode } from "./node.ts";
import { lengthCategory } from "./node-units.ts";
import type { Run } from "./run.ts";
import { LEAF_WIDTH } from "./units.ts";

type Payload = Readonly<Record<string, unknown>>;

/** Python's `dict(payload or {})` read through `float(p.get(key, 0.0))`. */
function payloadFloat(payload: Payload, key: string): number {
  const v = payload[key];
  if (v === undefined) return 0;
  const f = pyFloat(v);
  if (f === null) throw new Error(`layout: payload ${key} is not a float: ${String(v)}`);
  return f;
}

/** Python's `str(p.get("unit", "") or "")`. */
function payloadUnit(payload: Payload): string {
  const unit = payload["unit"];
  return unit ? String(unit) : "";
}

/**
 * md2ui `_build_ring`: a unit ratio drawn as a ring: a card whose background paint is
 * the arc, wrapping two centred synthetic text leaves (value, unit); the column carries
 * the arc fraction for the painter. The value and unit are baked from the payload.
 */
export function buildRing(run: Run, node: GroupNode): LayoutNode {
  const p = node.datapoint_payload ?? {};
  const value = payloadFloat(p, "value");
  const mx = payloadFloat(p, "max");
  const { unit_ratio_show_total: showTotal, unit_ratio_show_key: showKey } = run.theme.datapoints;
  const valueLeaf = layoutNode("-", [], [], {
    render_properties: {
      ring_role: "value",
      ring_text: showTotal ? `${formatG(value)}/${formatG(mx)}` : formatG(value),
    },
  });
  const unitLeaf = layoutNode("-", [], [], {
    render_properties: { ring_role: "unit", ring_text: payloadUnit(p) },
  });
  const leaves = showKey ? [valueLeaf, unitLeaf] : [valueLeaf];
  const col = layoutNode(
    "col",
    leaves.map(() => 1),
    leaves,
    { content_id: node.node_id || null, render_properties: { ring: { value, max: mx } } },
  );
  col.is_card = true;
  col.card_kind = "ring";
  return layoutNode("row", [1], [col]);
}

/** md2ui `_bar_leaf`: the synthetic stretch-bar leaf (no content id, like a gutter marker). */
export function barLeaf(payload: Payload | null, kind: string): LayoutNode {
  return layoutNode("-", [], [], { render_properties: { datapoint_bar: { ...payload, kind } } });
}

/**
 * md2ui `_with_text_override`: keeps a real leaf's type and style but replaces its
 * visible text (on the innermost node of a chain of single children).
 */
export function withTextOverride(leaf: LayoutNode, text: string): void {
  let target = leaf;
  while (target.children.length === 1) target = target.children[0] as LayoutNode;
  target.render_properties = { ...target.render_properties, text_override: text };
}

/**
 * md2ui `_text_leaf_w`: the measured single-line width of a text piece (for bar-row
 * ratios): its measured line, else its minimum width, else its length category's.
 * `content` stands in for the node's own when md2ui measures a copy with new text; the
 * Key / Value role is the original's, since md2ui looks it up by `node_id`.
 */
function textLeafW(run: Run, node: GroupNode, content: string = node.content): number {
  const role = node.node_id ? (run.kvRoles.get(node) ?? null) : null;
  const inputs = { ...leafInputs(run.input, node), content };
  const line = run.measurer.leafLineWidth(inputs, role);
  if (line !== null) return line;
  const min = run.measurer.leafMinWidth(inputs, role);
  if (min !== null) return min;
  return LEAF_WIDTH[lengthCategory(node) ?? ""] ?? 100;
}

/** md2ui `_text_leaf_w` of `node`. */
export function textWidth(run: Run, node: GroupNode): number {
  return textLeafW(run, node);
}

/** md2ui `_text_override_w`: replacement text measured with the original leaf's type and style. */
export function textOverrideWidth(run: Run, node: GroupNode, replacement: string): number {
  return textLeafW(run, node, replacement);
}

/**
 * md2ui `_bar_text_row`: a same-line row of the text leaves beside a stretch bar leaf.
 * The bar is the flex member, so the ratios are the layout: each text piece gets its
 * measured width (plus a guard against a wrapped trailing word) and the bar the
 * remainder. `Ratio Bars -> Text side` puts the text left or right of the bar.
 */
export function barTextRow(
  run: Run,
  payload: Payload | null,
  kind: string,
  textLeaves: LayoutNode[],
  textWidths: number[],
  availableWidth: number,
): LayoutNode {
  const textSide = run.theme.datapoints.ratio_bar.text_side;
  const gap = run.theme.elements.row_spacing || 0;
  const widths = textWidths.map((w) => w + 3);
  const remainder = Math.max(availableWidth - pySum(widths) - gap * widths.length, 60);
  const bar = barLeaf(payload, kind);
  const row =
    textSide === "left"
      ? layoutNode("row", [...widths, remainder], [...textLeaves, bar])
      : layoutNode("row", [remainder, ...widths], [bar, ...textLeaves]);
  row.line_split = true;
  return row;
}

/** md2ui `_bar_stack_col`: a column of the text part and a full-width bar leaf, above or below. */
export function barStackCol(
  textPart: LayoutNode,
  payload: Payload | null,
  kind: string,
  position: string,
): LayoutNode {
  const bar = barLeaf(payload, kind);
  return layoutNode("col", [1, 1], position === "above" ? [bar, textPart] : [textPart, bar]);
}

/** The text a unit ratio shows under `Unit Ratios`' show-total and show-key switches. */
export function unitRatioText(run: Run, payload: Payload, withKey: boolean): string {
  const dp = run.theme.datapoints;
  let text = formatG(payloadFloat(payload, "value"));
  if (dp.unit_ratio_show_total) text += `/${formatG(payloadFloat(payload, "max"))}`;
  const unit = payloadUnit(payload);
  if (withKey && dp.unit_ratio_show_key && unit) text += ` ${unit}`;
  return text;
}

/**
 * md2ui `_leaf_bar_display`: the bar layout around a bar-family leaf (a bare `4/8`,
 * `25/100 progress`, a single-leaf `A of B`), keeping `leaf`, the untouched text leaf
 * with its content id, as the text member. `null` when `node` is no bar-family leaf the
 * theme draws (disabled, or the ring style).
 */
export function leafBarDisplay(
  run: Run,
  node: GroupNode,
  leaf: LayoutNode,
  availableWidth: number,
): LayoutNode | null {
  if (!dpDisplayEnabled(run.theme, node)) return null;
  const d = node.datapoint_display;
  if (d !== "ratio_bar" && !(d === "unit_ratio" && !unitRatioIsRing(run.theme))) return null;
  const dp = run.theme.datapoints;
  const payload = node.datapoint_payload ?? {};
  let textWidthPx = textWidth(run, node);
  if (d === "ratio_bar") {
    if (!dp.unit_ratio_show_total) {
      const text = formatG(payloadFloat(payload, "value"));
      withTextOverride(leaf, text);
      textWidthPx = textOverrideWidth(run, node, text);
    }
  } else if (!dp.unit_ratio_show_total || !dp.unit_ratio_show_key) {
    const text = unitRatioText(run, payload, true);
    withTextOverride(leaf, text);
    textWidthPx = textOverrideWidth(run, node, text);
  }
  return barTextRow(
    run,
    node.datapoint_payload,
    d === "ratio_bar" ? "ratio" : "unit",
    [leaf],
    [textWidthPx],
    availableWidth,
  );
}

/** md2ui `_line_leaf`: the synthetic leaf a `Key: a → b → c` line is drawn in, carrying its points. */
export function lineLeaf(node: GroupNode): LayoutNode {
  return layoutNode("-", [], [], {
    render_properties: { line_chart: { ...node.datapoint_payload } },
  });
}

/**
 * md2ui `_build_chart` and `_build_line_group`: a chart container as one synthetic leaf
 * carrying the chart's data, bars or every series of a group of lines; sizing and the
 * painter work out the whole geometry at the real width.
 */
export function buildChart(node: GroupNode): LayoutNode {
  return layoutNode("-", [], [], {
    content_id: node.node_id || null,
    render_properties: node.line_group
      ? { line_chart: { ...node.line_data } }
      : { chart: node.chart_data },
  });
}
