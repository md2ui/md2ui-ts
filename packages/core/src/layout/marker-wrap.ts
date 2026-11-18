// A marked item (list item, task, quote) as `row[marker | content]`, and the fixed
// aside split it shares with the icon aside: md2ui's `_marker_props`, `_marker_width`,
// `_marker_space`, `_marker_split`, `_wrap_marker` and `_aside_split`.
import { structuralKind } from "../group/annotate.ts";
import type { GroupNode } from "../group/node.ts";
import { buildMarkerProps } from "./markers.ts";
import { type LayoutNode, layoutNode } from "./node.ts";
import type { Run } from "./run.ts";

/**
 * md2ui `_aside_split`: `[ratios, asideW, restW]` for `row[fixed aside | rest]`. The gap
 * is carved out first, the aside keeps its own width (never more than is left), and
 * the rest takes the remainder.
 */
export function asideSplit(
  asideWidth: number,
  available: number,
  gap: number,
): [number[], number, number] {
  const usable = Math.max(0, available - gap);
  const aside = Math.min(asideWidth, usable);
  const rest = usable - aside;
  return [[aside, Math.max(1, rest)], aside, rest];
}

/**
 * md2ui `_marker_props`: `node`'s baked gutter marker with its measured glyph width
 * (`advance`) added, or `null`; memoised per node for the call.
 */
export function markerProps(run: Run, node: GroupNode): Record<string, unknown> | null {
  const hit = run.markerProps.get(node);
  if (hit !== undefined) return hit;
  const props = buildMarkerProps(node, run.theme);
  if (props !== null) props["advance"] = run.measurer.markerWidth(props);
  run.markerProps.set(node, props);
  return props;
}

/** md2ui `_marker_split`: `[ratios, markerW, contentW]` for `node`'s marker row. */
export function markerSplit(
  run: Run,
  node: GroupNode,
  available: number,
): [number[], number, number] {
  const props = markerProps(run, node);
  if (props === null || !(props["aside"] ?? true)) return [[1], 0, available];
  return asideSplit(props["advance"] as number, available, props["space"] as number);
}

/** A content key that marks a drawn data-point display, which takes no gutter marker. */
const DRAWN_KEYS = Object.freeze([
  "datapoint_bar",
  "datapoint_ring",
  "date_chip",
  "chart",
  "line_chart",
]);

/**
 * md2ui `_wrap_marker`: `content` wrapped with `node`'s gutter marker, beside it
 * (`row`, split by `markerSplit`) or above it (`col`); the structural background and a
 * card move onto the wrapper. Unwrapped when an ancestor owns the marker, the content
 * is a drawn display, or the node has no active marker.
 */
export function wrapMarker(
  run: Run,
  node: GroupNode,
  content: LayoutNode,
  available: number,
): LayoutNode {
  content.background_kind = structuralKind(node.type) || content.background_kind;
  if (run.markerSuppressed) return content;
  const drawn = content.render_properties ?? {};
  if (
    content.card_kind === "date_chip" ||
    content.card_kind === "ring" ||
    DRAWN_KEYS.some((k) => k in drawn)
  ) {
    return content;
  }
  const props = markerProps(run, node);
  if (props === null) return content;
  const marker = layoutNode("-", [], [], { render_properties: { list_marker: props } });
  let wrapper: LayoutNode;
  if (props["aside"] ?? true) {
    const [ratios] = markerSplit(run, node, available);
    wrapper = layoutNode("row", ratios, [marker, content], {
      render_properties: { marker_align: props["alignment"] ?? "top" },
    });
  } else {
    wrapper = layoutNode("col", [1, 1], [marker, content]);
  }
  wrapper.background_kind = content.background_kind;
  content.background_kind = null;
  if (content.is_card) {
    wrapper.is_card = true;
    content.is_card = false;
  }
  return wrapper;
}
