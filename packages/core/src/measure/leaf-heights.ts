// How tall a leaf is at a width, and where its first text baseline sits (md2ui
// `render_measure._leaf_height`, `_leaf_first_baseline`, `_emoji_first_baseline`). Boxes
// hug their content: text is its line count at the leaf's size, a pill or badge its own
// box, an image its width over its aspect ratio. A baseline mirrors what each drawer
// does, so a same-line row can put the glyphs of different leaves on one line.
import type { BarTheme, ResolvedTheme } from "@md2ui/contracts";
import type { RegexKit } from "../group/py/re.ts";
import { pyFloat } from "../group/py/str.ts";
import { defaultImageRatio, ratioAt } from "../layout/url-hints.ts";
import { paddingY } from "../theme/query.ts";
import { urlParams } from "../utils/image-params.ts";
import { chartHeight } from "./charts.ts";
import { codeBlockPlan } from "./code-blocks.ts";
import { drawingElementBaseline, leafSliderSize, taskControlSize } from "./drawing.ts";
import { emojiFontOf, fontOf } from "./font-set.ts";
import {
  BREAK_LEAVES,
  effectiveLeafNode,
  hint,
  imageContentWidth,
  isTextMarker,
  type LeafKit,
  LINE_SCALE,
  type Props,
  truthy,
} from "./leaf-kit.ts";
import { lineChartHeight } from "./line-charts.ts";
import type { SizedNode } from "./node-index.ts";
import { ringText } from "./ring-text.ts";
import { markerFace } from "./text-fonts.ts";
import { chipStyle, emojiBadgeStyle } from "./theme-styles.ts";

/**
 * md2ui `image_card_height`: the height an image card's own picture asks for, `width`
 * wide: that width over the `aspect_ratio` its url writes (the ladder read at that width),
 * capped by its `max_height`. 0 when it writes no ratio, so a card without one is as tall
 * as its content. Content that needs more room always gets it (the sizer's `naturalHeight`).
 */
export function imageCardHeight(kit: RegexKit, url: string | null, width: number): number {
  const params = urlParams(kit, url ?? "");
  const spec = params.get("aspect_ratio");
  const ratio = spec === undefined ? null : ratioAt(spec, width);
  if (!ratio) return 0;
  const height = width / ratio;
  const raw = params.get("max_height");
  const cap = raw === undefined ? null : pyFloat(raw);
  // Python's `min(height, cap)`: a NaN cap is never smaller, so the height stays.
  return cap !== null && cap < height ? cap : height;
}

/**
 * md2ui `_image_aspect_ratio`: the W/H an image draws at, `width` wide: 1:1 for a circle,
 * else the author's ratio for that width, else the default's.
 */
function imageAspectRatio(rp: Props | null, width: number): number {
  if (hint(rp, "shape") === "circle") return 1;
  const spec = hint(rp, "aspect_ratio");
  const authored = truthy(spec) ? ratioAt(String(spec), width) : null;
  return authored ?? defaultImageRatio(width);
}

/** md2ui `_spacer_height`: a column spacer's size; a row spacer is horizontal space. */
function spacerHeight(spacer: Props): number {
  if (spacer["axis"] === "row") return 0;
  return Math.max(0, Number(spacer["size"] || 0));
}

/** md2ui `_dp_bar_theme`: unit bars reuse Ratio Bars; `Key: value` bars use Key Value Bars. */
export function dpBarTheme(theme: ResolvedTheme, kind: unknown): BarTheme {
  const dp = theme.datapoints;
  return kind === "percent" || kind === "kv_unit" ? dp.kv_bar : dp.ratio_bar;
}

/** md2ui `_bar_track_height`: the track's height, the bar's thickness and its padding. */
export function barTrackHeight(bt: BarTheme): number {
  return bt.thickness + paddingY(bt.track.padding);
}

/** md2ui `_datapoint_bar_height`: a ratio or unit bar matches the text line it sits in. */
function datapointBarHeight(props: Props, theme: ResolvedTheme): number {
  const kind = props["kind"];
  const barH = barTrackHeight(dpBarTheme(theme, kind));
  if (kind === "ratio" || kind === "unit") {
    return Math.max(theme.text.font_size * LINE_SCALE, barH);
  }
  return barH;
}

/** What sizing answers about leaf heights. */
export interface LeafHeights {
  /** md2ui `_leaf_height`: a leaf's height at `width`. */
  leafHeight(nd: SizedNode | null, width: number, rp: Props | null): number;
  /** md2ui `_leaf_first_baseline`: from the box top to the first baseline, or `null`. */
  leafFirstBaseline(nd: SizedNode | null, rp: Props | null): number | null;
}

export function leafHeights(leaves: LeafKit): LeafHeights {
  const { theme, text, fonts } = leaves;

  /** md2ui `_text_ink` of a text marker: where its outline's ink sits against its baseline. */
  const markerInk = (lm: Props) => {
    const [face, size] = markerFace(lm, fonts, theme);
    return text.inkBounds(String(lm["text"] || ""), fontOf(face, size));
  };

  /** md2ui `render_ring_text.ring_text` of a ring's value or unit leaf. */
  const ringOf = (role: unknown, rp: Props | null) =>
    ringText(theme, text, fonts, String(role), String(rp?.["ring_text"] ?? ""));

  /** md2ui `_emoji_first_baseline`: a peeled glyph on the text line, a badge's glyph centred. */
  const emojiFirstBaseline = (nd: SizedNode): number | null => {
    if (nd.content === "") return null;
    if (nd.emoji_kind === "text") {
      // The glyph's font is the one `emojiLeafSize` measures; only its ascent matters.
      const m = text.fontMetrics(
        emojiFontOf(fonts.textEmoji, fonts.typeface, leaves.textEmojiPx(nd)),
      );
      return m.ascent;
    }
    const style = emojiBadgeStyle(theme, nd.emoji_variant);
    const m = text.fontMetrics(emojiFontOf(fonts.emoji, fonts.typeface, style.icon_size, style));
    const glyphH = m.descent + m.ascent;
    return (leaves.emojiLeafSize(nd).height - glyphH) / 2 + m.ascent;
  };

  const leafHeight = (node: SizedNode | null, width: number, rp: Props | null): number => {
    const nd = effectiveLeafNode(node, rp);
    const sp = hint(rp, "spacer") as Props | null;
    if (sp !== null) return spacerHeight(sp);
    const lm = hint(rp, "list_marker") as Props | null;
    if (lm !== null) {
      // A marker above its content hugs its own ink or shape; an aside one is kept to
      // about the first content line, so the row's height is the content's.
      if (!truthy(lm["aside"] ?? true)) {
        if (lm["kind"] === "quote" && lm["mode"] === "bar") return Number(lm["bar_width"] ?? 0);
        if (isTextMarker(lm)) return markerInk(lm).height;
        return Number(lm["size"] ?? 0);
      }
      if (isTextMarker(lm)) return markerInk(lm).height;
      return Math.max(Number(lm["size"] ?? 0), theme.text.font_size);
    }
    const sep = hint(rp, "separator") as Props | null;
    if (sep !== null) {
      // A rule stretches to the row; a glyph is one text line.
      return sep["kind"] === "rule" ? 0 : theme.text.font_size * LINE_SCALE;
    }
    const dpb = hint(rp, "datapoint_bar") as Props | null;
    if (dpb !== null) return datapointBarHeight(dpb, theme);
    const rr = hint(rp, "ring_role");
    if (rr !== null) return ringOf(rr, rp).height;
    const chart = hint(rp, "chart") as Props | null;
    if (chart !== null) return chartHeight(chart, width, leaves);
    const line = hint(rp, "line_chart") as Props | null;
    if (line !== null) return lineChartHeight(line, width, leaves);
    if (nd === null) return theme.text.font_size;

    if (nd.type === "drawing_element") {
      if (nd.drawing_element?.["kind"] === "slider" && theme.datapoints.sliders.enabled) {
        return leafSliderSize(nd.drawing_element, theme)[1];
      }
      if (theme.datapoints.task_controls.enabled) return taskControlSize(theme)[1];
    }
    if (nd.type === "link") return leaves.linkPill(nd).height;
    if (nd.type === "emoji") return leaves.emojiLeafSize(nd).height;
    if (nd.type === "inline_code") {
      const { face, size } = leaves.chipFace(nd);
      const m = text.fontMetrics(fontOf(face, size));
      return m.descent + m.ascent + paddingY(chipStyle(theme, nd.code_variant).padding);
    }
    if (nd.type === "code_block") return codeBlockPlan(nd.content, theme, text).height;
    if (nd.type === "image") {
      const contentW = imageContentWidth(rp, width);
      return contentW / imageAspectRatio(rp, contentW);
    }
    if (BREAK_LEAVES.includes(nd.type)) return 0;
    const leaf = leaves.leafText(nd, rp, "wrap");
    const lines = Math.max(leaves.prepare(leaves.spans(leaf)).lineCount(width), 1);
    return lines * leaf.sized.size * LINE_SCALE;
  };

  const leafFirstBaseline = (node: SizedNode | null, rp: Props | null): number | null => {
    const nd = effectiveLeafNode(node, rp);
    const lm = hint(rp, "list_marker") as Props | null;
    if (lm !== null) {
      // A quote bar is stretched, not aligned; a text marker offers its drawn
      // baseline; an emoji bullet draws at its size; a shape sits on its bottom edge.
      if (!truthy(lm)) return null;
      if (lm["kind"] === "quote" && lm["mode"] === "bar") return null;
      if (isTextMarker(lm)) return markerInk(lm).top;
      const size = Number(lm["size"] ?? 0);
      if (truthy(lm["emoji"])) return size;
      const body = theme.text.font_size;
      const lineH = Math.min(Math.max(size, body), body * LINE_SCALE);
      return size + Math.max(0, (lineH - size) / 2);
    }
    const sep = hint(rp, "separator") as Props | null;
    if (sep !== null) return sep["kind"] === "rule" ? null : theme.text.font_size;
    if (["datapoint_bar", "chart", "line_chart"].some((k) => hint(rp, k) !== null)) return null;
    const rr = hint(rp, "ring_role");
    if (rr !== null) return ringOf(rr, rp).size;
    if (nd === null) return null;

    if (nd.type === "drawing_element") {
      const base = drawingElementBaseline(nd.drawing_element, theme, text, fonts.typeface);
      if (base !== null) return base;
    }
    if (nd.type === "link") {
      // The pill centres in its cell and the label in the pill.
      const pill = leaves.linkPill(nd);
      const textH = pill.metrics.descent + pill.metrics.ascent;
      return (pill.height - textH) / 2 + pill.metrics.ascent;
    }
    if (nd.type === "emoji") return emojiFirstBaseline(nd);
    if (nd.type === "inline_code") {
      const { face, size } = leaves.chipFace(nd);
      const m = text.fontMetrics(fontOf(face, size));
      return chipStyle(theme, nd.code_variant).padding.top + m.ascent;
    }
    if (nd.type === "code_block") return codeBlockPlan(nd.content, theme, text).baseline;
    if (nd.type === "image" || BREAK_LEAVES.includes(nd.type)) return null;
    return leaves.leafText(nd, rp, "wrap").sized.size;
  };

  return { leafHeight, leafFirstBaseline };
}
