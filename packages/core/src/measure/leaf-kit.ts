// What every leaf answer shares (md2ui `render_style` and `render_metrics`): the text
// spans and size a text leaf resolves to, the boxes of pills, chips and badges, and the
// render hints that replace or reshape a leaf. Widths (`leaf-widths.ts`) and heights
// (`leaf-heights.ts`) are both asked of this one kit, so a pill is never measured one
// way across and another way down (md2ui ADR-400).
import type {
  FontMetrics,
  PreparedText,
  ResolvedTheme,
  TextMeasurer,
  TextSpan,
} from "@md2ui/contracts";
import { linkLabelSpans } from "../actions/inline-spans.ts";
import { pySum } from "../group/py/math.ts";
import { compile, RegexKit } from "../group/py/re.ts";
import { pyFloat, strip } from "../group/py/str.ts";
import { LINK_DESTINATION, LINK_LABEL, OVERFLOW_MARKS } from "../group/split/link-syntax.ts";
import { newTextStyle } from "../theme/model.ts";
import { paddingX, paddingY, sectionIsActive } from "../theme/query.ts";
import {
  chipFaceKey,
  type EmojiFamily,
  type EmojiKeys,
  emojiFontOf,
  type Face,
  type FontSet,
  faceKey,
  fontOf,
  fontSet,
} from "./font-set.ts";
import { type SizedNode, sizedLeaf } from "./node-index.ts";
import { applyDateRole, applyKvRole, effectiveTextFonts, type SizedFaces } from "./text-fonts.ts";
import { emojiEnds, runsAdvance, textSpans } from "./text-runs.ts";
import {
  chipStyle,
  chipTextStyle,
  emojiBadgeStyle,
  linkStyle,
  scopedTextStyle,
  tableTextStyle,
} from "./theme-styles.ts";

export type Props = Readonly<Record<string, unknown>>;

/** md2ui `render_measure.LINE_SCALE`: a text line's height over its font size. */
export const LINE_SCALE = 1.4;

// md2ui `render_measure._BREAK_LEAVES`: leaves with no text.
export const BREAK_LEAVES: readonly string[] = Object.freeze([
  "horizontal_rule",
  "content_break",
  "spacer",
]);

// md2ui `render_style._LINK_RE`.
const LINK_RE = compile(String.raw`^\[(?P<label>${LINK_LABEL})\]\(${LINK_DESTINATION}\)$`, {
  s: true,
});

/** Python truthiness of a render hint: an empty string, number, list or dict is false. */
export function truthy(v: unknown): boolean {
  if (v === undefined || v === null || v === "" || v === 0 || v === false) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

/** `dict.get(key)` that tells an absent key from a present `None` no more than md2ui does. */
export const hint = (rp: Props | null, key: string): unknown => rp?.[key] ?? null;

/** A leaf with no grouping node behind it: md2ui's dict holds only what it sets. */
function bakedText(content: string, chain: readonly string[]): SizedNode {
  return sizedLeaf({
    node_id: "",
    type: "text",
    content,
    heading_ctx: 0,
    atx_level: 0,
    text_style: null,
    text_style_chain: chain,
    code_variant: null,
    code_language: null,
    emoji_kind: null,
    emoji_index: 0,
    emoji_variant: null,
    in_key: false,
    table_role: null,
    link_variant: null,
    link_label: null,
    link_is_emoji: false,
    link_disabled: false,
    drawing_element: null,
  });
}

/**
 * md2ui `_effective_leaf_node`: a `text_override` replaces a node's content; a baked
 * date with no node behind it becomes a plain text leaf.
 */
export function effectiveLeafNode(nd: SizedNode | null, rp: Props | null): SizedNode | null {
  const override = hint(rp, "text_override");
  if (override !== null && nd !== null) return { ...nd, content: String(override) };
  const text = hint(rp, "date_text");
  if (nd === null && truthy(text)) {
    const chain = hint(rp, "text_style_chain");
    return bakedText(String(text), Array.isArray(chain) ? (chain as string[]) : []);
  }
  return nd;
}

/** md2ui `image_floor`: an image's `min_width`, capped by its `max_width`. */
export function imageFloor(rp: Props | null): number | null {
  const floor = hint(rp, "min_width");
  if (!truthy(floor)) return null;
  const cap = hint(rp, "max_width");
  return truthy(cap) ? Math.min(Number(floor), Number(cap)) : Number(floor);
}

/** md2ui `_image_content_width`: an image fills its space unless the author caps it. */
export function imageContentWidth(rp: Props | null, available: number): number {
  const mw = hint(rp, "max_width");
  if (truthy(mw)) {
    const cap = pyFloat(mw);
    return cap === null ? available : Math.min(available, cap);
  }
  return available;
}

/** md2ui `render_style._resolve_link`'s label: the grouper's, else read back from the content. */
function linkLabel(kit: RegexKit, nd: SizedNode): string {
  return nd.link_label ?? kit.re(LINK_RE).match(strip(nd.content))?.text("label") ?? nd.content;
}

/**
 * md2ui `render_style._resolve_h_align`: a leaf's horizontal alignment from its render
 * hints (`text_align`, then the cascaded `content_align`), else the root's.
 */
export function resolveHAlign(rp: Props | null, theme: ResolvedTheme): string {
  for (const key of ["text_align", "content_align"]) {
    const value = hint(rp, key);
    if (truthy(value)) return String(value);
  }
  return theme.root.align || "left";
}

/** A run of a button label and the face it draws in. */
export interface LabelRun {
  readonly text: string;
  readonly face: Face;
  /**
   * An `Emoji gap`: this run is one space that paints nothing and advances by `gap`
   * pixels (md2ui's space stretched to the gap); `null` for a run of the label's text.
   */
  readonly gap: number | null;
  /**
   * A "more" button's mark (`OVERFLOW_MARKS`): the whole run in the emoji font first, so
   * an emoji font that has the mark draws it as an icon and one that lacks it leaves the
   * text dots, the browser falling back as md2ui's `unicharToGlyph` test chooses.
   */
  readonly icon: boolean;
}

/**
 * md2ui `render_text_scopes._emoji_gap`: `runs` with the spaces between a leading or
 * trailing emoji and the words, typed or not, replaced by a gap run `gap` pixels wide.
 */
function emojiGap(runs: readonly LabelRun[], gap: number): readonly LabelRun[] {
  const ends = emojiEnds(runs.map((run) => run.text).join(""));
  const first = runs[0];
  if (ends === null || first === undefined) return runs;
  const { lead, start, end, trail } = ends;
  const length = runs.reduce((total, run) => total + run.text.length, 0);
  const cut = (a: number, b: number): LabelRun[] => {
    const pieces: LabelRun[] = [];
    let at = 0;
    for (const run of runs) {
      const lo = Math.max(a, at);
      const hi = Math.min(b, at + run.text.length);
      if (lo < hi) pieces.push({ ...run, text: run.text.slice(lo - at, hi - at) });
      at += run.text.length;
    }
    return pieces;
  };
  // md2ui stretches a space of the label's own font; only its advance is read.
  const spacer: LabelRun[] = gap > 0 ? [{ text: " ", face: first.face, gap, icon: false }] : [];
  return [
    ...cut(0, lead),
    ...(lead > 0 ? spacer : []),
    ...cut(start, end),
    ...(trail < length ? spacer : []),
    ...cut(trail, length),
  ];
}

// md2ui `render_text_scopes._EMPHASIS_FACE`: where each emphasis sits among a variant's
// faces; bold adds 1, italic adds 2.
const EMPHASIS_FACE: Readonly<Record<string, number>> = Object.freeze({
  bold: 1,
  italic: 2,
  bold_italic: 3,
});

/**
 * md2ui `render_text_scopes.link_label_fonts`: a button label's own face, whose metrics
 * size the pill, and the label as the runs it draws in. Every face is one of the link
 * variant's family: the label's emphasis picks its bold or italic, and `link_emphasis`
 * (the wrapper a backtick label displaced) styles the whole label. Sizing, painting and
 * the click target all come through here, so a bold run is measured as it is painted.
 */
export function linkLabelFonts(
  kit: RegexKit,
  nd: SizedNode,
  fonts: FontSet,
): {
  readonly face: Face;
  readonly runs: readonly LabelRun[];
  /** The emoji keys of the label's variant. */
  readonly emojiKeys: EmojiKeys | null;
} {
  const variant = nd.link_variant || "primary";
  const set = fonts.links.get(variant) ?? fonts;
  const faces = [set.typeface, set.bold, set.italic, set.bold_italic] as const;
  const base = EMPHASIS_FACE[nd.link_emphasis ?? ""] ?? 0;
  const label = linkLabel(kit, nd);
  const runs = linkLabelSpans(kit, label, variant).map(({ text, bold, italic }) => ({
    text,
    face: faces[base | (bold ? 1 : 0) | (italic ? 2 : 0)] as Face,
    gap: null,
    icon: false,
  }));
  // An unknown variant resolves to Primary, as `linkStyle` does.
  const keys = fonts.linkEmojiKeys.get(variant) ?? fonts.linkEmojiKeys.get("primary");
  const gap = keys?.gap ?? null;
  const face = faces[base] as Face;
  // A "more" button draws its mark in the emoji face, as an icon.
  const icon = OVERFLOW_MARKS.includes(strip(label));
  return {
    face,
    runs: icon
      ? [{ text: label, face, gap: null, icon }]
      : gap === null
        ? runs
        : emojiGap(runs, gap),
    emojiKeys: keys?.keys ?? null,
  };
}

/**
 * md2ui `_label_runs_width`: a button label measured run by run, each in its own face, its
 * emoji as `emojiKeys` set them; a gap run adds its gap.
 */
export function labelRunsAdvance(
  text: TextMeasurer,
  runs: readonly LabelRun[],
  emoji: string,
  size: number,
  emojiKeys: EmojiKeys | null = null,
): number {
  return pySum(
    runs.map(
      (run) => run.gap ?? runsAdvance(text, run.text, run.face, emoji, size, emojiKeys, run.icon),
    ),
  );
}

/** md2ui `_is_text_marker`: a numbered ordinal or a quote character, drawn as text. */
export function isTextMarker(lm: Props): boolean {
  return lm["kind"] === "number" || lm["mode"] === "char";
}

/** md2ui `_weight_scale_and_color`'s scale: an authored tier suppresses `content_weight`. */
export function weightScale(
  theme: ResolvedTheme,
  weight: unknown,
  textStyle: string | null,
): number {
  if (textStyle) return 1;
  const cw = theme.content_weight;
  if (weight === "first") return cw.first_scale;
  if (weight === "second") return cw.second_scale;
  if (weight === "less") return cw.less_scale;
  return 1;
}

/**
 * Which of md2ui's text paths a leaf's text is resolved for. Each applies a different
 * subset of the roles:
 * - `plain`: the leaf's own style only (`_table_cell_min_width`);
 * - `min`: plus its key-value role (`make_width_measurer`);
 * - `wrap`: plus `content_weight` and a date-chip role (`_leaf_height`, `_leaf_first_baseline`);
 * - `line`: `wrap`, with a date key upper-cased as it draws (`_leaf_natural_width`).
 */
type TextPath = "plain" | "min" | "wrap" | "line";

/** A text leaf's content and the faces and size it is measured in. */
interface LeafText {
  readonly content: string;
  readonly sized: SizedFaces;
}

/** A pill's or badge's box. */
interface Box {
  readonly width: number;
  readonly height: number;
}

/** A link pill: its box, and the label font's metrics (where the label's baseline sits). */
interface LinkPill extends Box {
  readonly metrics: FontMetrics;
}

/** What leaf sizing shares, built once per theme and text measurer. */
export interface LeafKit {
  readonly theme: ResolvedTheme;
  readonly text: TextMeasurer;
  readonly fonts: FontSet;
  readonly kit: RegexKit;
  /** C3's `prepare`, kept per kit so a text asked twice is measured once. */
  prepare(spans: TextSpan[]): PreparedText;
  /** A text leaf's content and faces along one of md2ui's text paths. */
  leafText(nd: SizedNode, rp: Props | null, path: TextPath): LeafText;
  /** A leaf text as C3 spans. */
  spans(t: LeafText): TextSpan[];
  /** md2ui `_text_emoji_px`: a peeled emoji's glyph size, its surrounding text's. */
  textEmojiPx(nd: SizedNode): number;
  /** md2ui `_link_pill_size`, with the label font's metrics. */
  linkPill(nd: SizedNode): LinkPill;
  /** md2ui `_emoji_leaf_size`: a peeled glyph, or a badge (`_emoji_badge_size`). */
  emojiLeafSize(nd: SizedNode): Box;
  /** md2ui `_code_font`: the face and size an inline-code chip's label is measured in. */
  chipFace(nd: SizedNode): { readonly face: Face; readonly size: number };
}

export function leafKit(
  theme: ResolvedTheme,
  text: TextMeasurer,
  emojiFamily: EmojiFamily,
): LeafKit {
  const fonts = fontSet(theme, emojiFamily);
  const kit = new RegexKit();
  const prepared = new Map<string, PreparedText>();
  const prepare = (spans: TextSpan[]): PreparedText => {
    const key = JSON.stringify(spans);
    let found = prepared.get(key);
    if (found === undefined) {
      found = text.prepare(spans);
      prepared.set(key, found);
    }
    return found;
  };

  const leafText = (nd: SizedNode, rp: Props | null, path: TextPath): LeafText => {
    let sized = effectiveTextFonts(nd.type, nd.atx_level, fonts, theme, nd);
    if (path === "plain") return { content: nd.content, sized };
    const scaled = path === "wrap" || path === "line";
    if (scaled) {
      const scale = weightScale(theme, hint(rp, "content_weight"), nd.text_style);
      sized = { ...sized, size: sized.size * scale };
    }
    sized = applyKvRole(hint(rp, "kv_role") as string | null, sized, theme, fonts, nd);
    if (!scaled) return { content: nd.content, sized };
    const dateRole = hint(rp, "date_role") as string | null;
    sized = applyDateRole(dateRole, sized, theme, fonts);
    const upper = path === "line" && dateRole === "key";
    return { content: upper ? nd.content.toUpperCase() : nd.content, sized };
  };

  /** md2ui `_text_emoji_px`: a peeled emoji's glyph size, its surrounding text's. */
  const textEmojiPx = (nd: SizedNode): number => {
    if (nd.table_role) {
      const ts = tableTextStyle(theme, nd.table_role);
      if (ts !== null) return ts.font_size;
    }
    if (nd.in_key) return scopedTextStyle(theme, "key", nd.text_style_chain).font_size;
    return scopedTextStyle(theme, "text", nd.text_style_chain).font_size;
  };

  return {
    theme,
    text,
    fonts,
    kit,
    prepare,
    leafText,
    spans: ({ content, sized }) => textSpans(kit, content, sized.faces, sized.size, sized.emoji),
    textEmojiPx,
    linkPill: (nd) => {
      const style = linkStyle(theme, nd.link_variant || "primary");
      const size = (style.text_style ?? newTextStyle()).font_size;
      const { face, runs, emojiKeys } = linkLabelFonts(kit, nd, fonts);
      const pad = style.padding;
      const metrics = text.fontMetrics(fontOf(face, size));
      const label = labelRunsAdvance(text, runs, fonts.linkEmoji, size, emojiKeys);
      const padY = pad ? paddingY(pad) : 0;
      const textH = metrics.descent + metrics.ascent;
      // An emoji-only label is squared as tall as a text label of its variant: its
      // vertical padding on every side.
      if (nd.link_is_emoji && (style.emoji_shape === "circle" || style.emoji_shape === "square")) {
        const side = Math.max(label, textH) + padY;
        return { width: side, height: side, metrics };
      }
      return { width: label + (pad ? paddingX(pad) : 0), height: textH + padY, metrics };
    },
    emojiLeafSize: (nd) => {
      if (nd.emoji_kind === "text") {
        const font = emojiFontOf(fonts.textEmoji, fonts.typeface, textEmojiPx(nd));
        const m = text.fontMetrics(font);
        return { width: text.advance(nd.content, font), height: m.descent + m.ascent };
      }
      const style = emojiBadgeStyle(theme, nd.emoji_variant);
      const font = emojiFontOf(fonts.emoji, fonts.typeface, style.icon_size, style);
      const m = text.fontMetrics(font);
      const pad = style.fill.padding;
      const width = text.advance(nd.content, font) + paddingX(pad);
      const height = m.descent + m.ascent + paddingY(pad);
      if (sectionIsActive(style.fill) && (style.shape === "circle" || style.shape === "square")) {
        const side = Math.max(width, height);
        return { width: side, height: side };
      }
      return { width, height };
    },
    chipFace: (nd) => {
      const code = chipStyle(theme, nd.code_variant);
      const size =
        nd.code_variant && code.text_style !== null
          ? code.text_style.font_size
          : fonts.inlineCodeSize;
      let face = fonts.mono;
      if (nd.code_variant) {
        const [name, weight] = chipFaceKey(chipTextStyle(code, theme.text), theme);
        face = fonts.chips.get(faceKey(name, weight)) ?? fonts.mono;
      }
      return { face, size };
    },
  };
}
