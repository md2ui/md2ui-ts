// How wide a leaf wants to be (md2ui `render_measure._leaf_natural_width` and the
// generator's leaf closures `make_width_measurer`, `make_line_width_measurer`,
// `make_marker_measurer`), composed only from C3 answers: the theme decides the
// faces, sizes and chrome, C3 measures the text.
import type { InlineCodeTheme } from "@md2ui/contracts";
import { strip } from "../group/py/str.ts";
import type { KvRole, LeafInputs } from "../layout/measurer.ts";
import { paddingY } from "../theme/query.ts";
import { codeBlockPlan } from "./code-blocks.ts";
import { drawingElementMinWidth, leafSliderSize, taskControlSize } from "./drawing.ts";
import { fontOf } from "./font-set.ts";
import {
  BREAK_LEAVES,
  effectiveLeafNode,
  hint,
  imageContentWidth,
  isTextMarker,
  type LeafKit,
  type Props,
  truthy,
} from "./leaf-kit.ts";
import { type SizedNode, sizedLeaf } from "./node-index.ts";
import { ringText } from "./ring-text.ts";
import { markerFace } from "./text-fonts.ts";
import { runsAdvance } from "./text-runs.ts";
import { chipStyle } from "./theme-styles.ts";

/** What sizing answers about leaf widths. */
export interface LeafWidths {
  /** md2ui `_leaf_natural_width`: the width a leaf takes on one line, capped at `available`. */
  leafNaturalWidth(nd: SizedNode | null, available: number, renderProperties: Props | null): number;
  /** md2ui `measure_width` (`make_width_measurer`). */
  leafMinWidth(node: LeafInputs, kvRole: KvRole | null): number | null;
  /** md2ui `measure_line` (`make_line_width_measurer`). */
  leafLineWidth(node: LeafInputs, kvRole: KvRole | null): number | null;
  /** md2ui `measure_marker` (`make_marker_measurer`). */
  markerWidth(props: Props): number;
}

/**
 * md2ui `_chip_metrics`: an inline-code pill's box and its label's insets. The rounded
 * corners inset the glyphs by half the radius, clamped to the chip's own height, so a
 * huge radius gives a stadium; sizing and painting both ask here.
 */
export function chipMetrics(
  code: InlineCodeTheme,
  textW: number,
  textH: number,
): {
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly left: number;
} {
  const height = textH + paddingY(code.padding);
  const inset = Math.min(code.corner_radius, height);
  const left = code.padding.left + inset / 2;
  const right = code.padding.right + inset / 2;
  return {
    width: textW + left + right,
    height,
    radius: Math.min(code.corner_radius, height / 2),
    left,
  };
}

export function leafWidths(leaves: LeafKit): LeafWidths {
  const { theme, text, fonts } = leaves;

  /** md2ui's inline-code chip width (`_code_font`, `_chip_metrics`). */
  const chipWidth = (nd: SizedNode): number => {
    const label = strip(strip(nd.content), "`");
    const code = chipStyle(theme, nd.code_variant);
    const { face, size } = leaves.chipFace(nd);
    const m = text.fontMetrics(fontOf(face, size));
    const textW = runsAdvance(
      text,
      label,
      face,
      fonts.emojiAt(theme.emojis.inline.font_path),
      size,
      code,
    );
    return chipMetrics(code, textW, m.descent + m.ascent).width;
  };

  const markerWidth = (lm: Props): number => {
    const [face, size] = markerFace(lm, fonts, theme);
    return text.advance(String(lm["text"] || ""), fontOf(face, size));
  };

  const leafNaturalWidth = (
    node: SizedNode | null,
    available: number,
    rp: Props | null,
  ): number => {
    const nd = effectiveLeafNode(node, rp);
    const sp = hint(rp, "spacer") as Props | null;
    if (sp !== null) {
      // A spacer across a line is its size; one down a column asks for no width.
      if (sp["axis"] === "row") return Math.min(Math.max(0, Number(sp["size"] || 0)), available);
      return 0;
    }
    const lm = hint(rp, "list_marker") as Props | null;
    if (lm !== null) {
      if (!truthy(lm["aside"] ?? true) && lm["kind"] === "quote" && lm["mode"] === "bar") {
        return Math.min(Number(lm["bar_length"] ?? 50), available);
      }
      if (isTextMarker(lm)) return Math.min(markerWidth(lm), available);
      return Math.min(Number(lm["size"] ?? 0), available);
    }
    const sep = hint(rp, "separator") as Props | null;
    if (sep !== null) {
      if (sep["kind"] === "rule") return Math.min(theme.vertical_rule.stroke_width, available);
      const char = String(sep["char"] || "");
      return Math.min(text.advance(char, fontOf(fonts.typeface, theme.text.font_size)), available);
    }
    if (hint(rp, "datapoint_bar") !== null) return available;
    const rr = hint(rp, "ring_role");
    if (rr !== null) {
      // A ring text leaf (baked value/unit), as wide as the ring's text plan lays it out.
      const ring = ringText(theme, text, fonts, String(rr), String(rp?.["ring_text"] ?? ""));
      return Math.min(ring.width, available);
    }
    if (hint(rp, "chart") !== null || hint(rp, "line_chart") !== null) return available;
    if (nd === null) return available;

    if (nd.type === "drawing_element") {
      if (nd.drawing_element?.["kind"] === "slider" && theme.datapoints.sliders.enabled) {
        return Math.min(leafSliderSize(nd.drawing_element, theme)[0], available);
      }
      if (theme.datapoints.task_controls.enabled) {
        return Math.min(taskControlSize(theme)[0], available);
      }
    }
    if (nd.type === "image") return imageContentWidth(rp, available);
    if (nd.type === "link") return Math.min(leaves.linkPill(nd).width, available);
    if (nd.type === "emoji") return Math.min(leaves.emojiLeafSize(nd).width, available);
    if (nd.type === "inline_code") return Math.min(chipWidth(nd), available);
    // A code block spans its column; its line width is the min-width measurer's.
    if (nd.type === "code_block" || BREAK_LEAVES.includes(nd.type)) return available;
    return Math.min(
      leaves.prepare(leaves.spans(leaves.leafText(nd, rp, "line"))).lineWidth(),
      available,
    );
  };

  const kvProps = (kvRole: KvRole | null): Props | null => (kvRole ? { kv_role: kvRole } : null);

  return {
    leafNaturalWidth,
    markerWidth: (props) => (isTextMarker(props) ? markerWidth(props) : Number(props["size"] ?? 0)),
    leafLineWidth: (node, kvRole) => {
      if (node.type === "image" || BREAK_LEAVES.includes(node.type)) return null;
      if (node.type === "code_block") return codeBlockPlan(node.content, theme, text).width;
      return leafNaturalWidth(sizedLeaf(node), Number.POSITIVE_INFINITY, kvProps(kvRole));
    },
    leafMinWidth: (node, kvRole) => {
      if (node.type === "image" || BREAK_LEAVES.includes(node.type)) return null;
      if (node.type === "code_block") return codeBlockPlan(node.content, theme, text).width;
      if (node.type === "drawing_element")
        return drawingElementMinWidth(node.drawing_element, theme);
      if (node.type === "link" || node.type === "inline_code" || node.type === "emoji") {
        return leafNaturalWidth(sizedLeaf(node), Number.POSITIVE_INFINITY, kvProps(kvRole));
      }
      if (node.content === "") return null;
      // The widest run with no written space: the unit the wrap keeps whole, a word with
      // its attached punctuation (md2ui `_widest_unit`).
      const spans = leaves.spans(leaves.leafText(sizedLeaf(node), kvProps(kvRole), "min"));
      return leaves.prepare(spans).minWidth() || null;
    },
  };
}
