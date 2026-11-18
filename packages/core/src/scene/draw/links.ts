// Links, inline-code chips and emoji leaves (md2ui `draw_link_box`, `draw_code_box`,
// `draw_emoji_box`): a button's pill and label, a chip's pill and label, a badge or a
// bare glyph. Each is placed by the very function sizing used, so the ink fills what the
// box reserved and a click on the pill lands on it (md2ui ADR-400).
import type { Argb, GroupingNode, InlineCodeTheme } from "@md2ui/contracts";
import { strip } from "../../group/py/str.ts";
import { fontOf } from "../../measure/font-set.ts";
import { labelRunsAdvance, linkLabelFonts, resolveHAlign } from "../../measure/leaf-kit.ts";
import { chipMetrics } from "../../measure/leaf-widths.ts";
import type { SizedNode } from "../../measure/node-index.ts";
import { runsAdvance } from "../../measure/text-runs.ts";
import { chipStyle, emojiBadgeStyle, scopedTextStyle } from "../../measure/theme-styles.ts";
import { newTextStyle } from "../../theme/model.ts";
import { rotateColor, sectionIsActive } from "../../theme/query.ts";
import { BG_IMAGE, opaque, pushBg, replaceColor } from "../backgrounds.ts";
import type { BgStack, LayoutBox } from "../boxes.ts";
import { linkPillRect } from "../regions.ts";
import { paintedPins, pinOrReplace, replacedGradient, rotationSlot } from "./colors.ts";
import type { BoxDrawer, Draw } from "./context.ts";
import { layeredFill, strokeOutline } from "./fills.ts";
import { choiceStyle, resolvedLinkStyle } from "./link-styles.ts";
import { chipLabelStyle, mutedBadge, mutedChip } from "./muted.ts";
import type { MeasuredRun, Pen } from "./pen.ts";
import { elementImageOf, paintPill } from "./pill-paint.ts";
import { emojiPin } from "./pins.ts";
import { glyphRun, labelRuns } from "./text.ts";

/** The sized node a box draws, and the grouping node that carries its rotation slot. */
function nodesOfBox(
  d: Draw,
  box: LayoutBox,
): { readonly sized: SizedNode; readonly node: GroupingNode | undefined } | null {
  if (box.content_id === null) return null;
  const sized = d.sized.get(box.content_id);
  return sized === undefined ? null : { sized, node: d.nodes.get(box.content_id) };
}

/** md2ui `_rotated_code_style`: this chip's slot picked out of its colour lists. */
function rotatedCodeStyle(
  d: Draw,
  code: InlineCodeTheme,
  node: GroupingNode | undefined,
): InlineCodeTheme {
  const ts = code.text_style;
  const rotates =
    code.fill_colors.length > 0 ||
    code.stroke_colors.length > 0 ||
    (ts !== null && ts.colors.length > 0);
  if (!rotates || node === undefined) return code;
  const { theme } = d.sizer;
  const { index, chain } = rotationSlot(node, theme);
  const rotate = (colors: readonly Argb[], fallback: Argb | null) =>
    rotateColor(colors, fallback, index, theme, "chip", chain);
  return {
    ...code,
    // A transparent slot (`#00000000`) stays transparent. Never null: the fallback is not.
    fill_color: rotate(code.fill_colors, code.fill_color) ?? code.fill_color,
    stroke_color: rotate(code.stroke_colors, code.stroke_color) ?? code.stroke_color,
    text_style:
      ts !== null && ts.colors.length > 0
        ? { ...ts, color: rotate(ts.colors, ts.color) ?? ts.color }
        : ts,
  };
}

/** An emoji tint replaced against what it sits on; `null` keeps the text colour. */
function emojiTint(d: Draw, color: Argb | null, bg: BgStack): Argb | null {
  return color === null ? null : replaceColor(color, bg, d.sizer.theme);
}

/** Where a leaf of this width starts in its box, by the resolved horizontal alignment. */
function alignedX(d: Draw, box: LayoutBox, width: number): number {
  const align = resolveHAlign(box.render_properties, d.sizer.theme);
  if (align === "center") return box.x + (box.width - width) / 2;
  if (align === "right") return box.x + (box.width - width);
  return box.x;
}

/**
 * md2ui `draw_link_box`: a link as its label inside a pill at `linkPillRect`, its fill,
 * stroke and label resolved against what the card put behind it. An emoji-only label in
 * a circle-shaped variant paints an oval.
 */
export const drawLink: BoxDrawer = (d, box, p) => {
  const found = nodesOfBox(d, box);
  if (found === null) return;
  const { sized, node } = found;
  const { theme, leaves } = d.sizer;
  const { fonts, text, kit } = leaves;
  // A choice option's colours only (md2ui ADR-405).
  const style = choiceStyle(d, sized, node, resolvedLinkStyle(d, sized, node));
  const textStyle = style.text_style ?? newTextStyle();
  const size = textStyle.font_size;
  const { face, runs: pieces, emojiKeys } = linkLabelFonts(kit, sized, fonts);
  const textW = labelRunsAdvance(text, pieces, fonts.linkEmoji, size, emojiKeys);
  const metrics = text.fontMetrics(fontOf(face, size));
  const textH = metrics.descent + metrics.ascent;
  const [x, y, width, height] = linkPillRect(d.sizer, box, sized);
  const pill = { x, y, width, height };
  const isEmoji = sized.link_is_emoji;
  const forceCircle = isEmoji && style.emoji_shape === "circle";
  const textX = isEmoji ? x + (width - textW) / 2 : x + (style.padding?.left ?? 0);
  const textY = y + (height - textH) / 2;

  // A segment sits on its run's surface as a pill sits on a card (md2ui `segment_stack`).
  const { ink: color, stack: labelBg } = paintPill(
    p,
    theme,
    pill,
    style,
    d.pins.get(sized.node_id),
    d.segments.get(sized.node_id) ?? box.bg_stack,
    { disabled: sized.link_disabled, oval: forceCircle },
  );
  // The label's emoji take its ink, so they follow the variant and the disabled state;
  // only a `## Fixed colors` pin on the glyph outranks it.
  const paint = {
    emojiColor: null,
    fixedColors: sized.link_disabled ? {} : theme.emojis.link.fixed_colors,
    bg: labelBg,
  };
  // Each run in its own face, the next starting where the last one's advance ends. An
  // `Emoji gap` piece paints nothing: it only moves the next run by the gap sizing reserved.
  const runs: MeasuredRun[] = [];
  let at = textX;
  for (const piece of pieces) {
    if (piece.gap !== null) {
      at += piece.gap;
      continue;
    }
    const { face: f, text: t, icon } = piece;
    const drawn = labelRuns(d, t, at, f, fonts.linkEmoji, size, color, paint, emojiKeys, icon);
    runs.push(...drawn.runs);
    at += drawn.width;
  }
  if (runs.length > 0) p.text(textY + metrics.ascent, runs);
};

/**
 * md2ui `draw_code_box`: a whole-leaf inline-code node as a padded pill, its label inset
 * by the corner's share, unclipped so the padding is never cut. The pill and label are
 * sized by `chipMetrics`, which the width measurer shares.
 */
export const drawChip: BoxDrawer = (d, box, p) => {
  const found = nodesOfBox(d, box);
  if (found === null) return;
  const { sized, node } = found;
  const { theme, leaves } = d.sizer;
  const { fonts, text } = leaves;
  const variant = chipStyle(theme, sized.code_variant);
  const code = rotatedCodeStyle(d, node?.element_muted ? mutedChip(variant) : variant, node);
  const label = strip(strip(sized.content), "`");
  const ic = chipLabelStyle(code, theme.text);
  const { face, size } = leaves.chipFace(sized);
  const pins = paintedPins(d.pins.get(sized.node_id), code);
  const fill = pinOrReplace(code.fill_color, pins.fill, box.bg_stack, theme, "fill");
  const stroke = pinOrReplace(code.stroke_color, pins.stroke, box.bg_stack, theme, "stroke");
  const chipBg = pushBg(box.bg_stack, code.bg_image ? BG_IMAGE : opaque(fill));
  const color = pinOrReplace(ic.color, pins.text, chipBg, theme);
  const emoji = theme.emojis.inline;
  const family = fonts.emojiAt(emoji.font_path);
  // The pill reserves the emoji family's advance, not mono's.
  const textW = runsAdvance(text, label, face, family, size, code);
  const metrics = text.fontMetrics(fontOf(face, size));
  const m = chipMetrics(code, textW, metrics.descent + metrics.ascent);
  const bg = {
    x: alignedX(d, box, m.width),
    y: box.y + (box.height - m.height) / 2,
    width: m.width,
    height: m.height,
  };
  layeredFill(p, bg, {
    color: opaque(fill),
    image: elementImageOf(code.bg_image, code.muted),
    gradient: replacedGradient(code.gradient, box.bg_stack, theme),
    radius: m.radius,
    shadows: code.shadows,
  });
  if (code.stroke_width > 0) {
    strokeOutline(p, bg, m.radius, code.stroke_width, stroke, code.stroke_align);
  }
  const { runs } = labelRuns(
    d,
    label,
    bg.x + m.left,
    face,
    family,
    size,
    color,
    {
      emojiColor: emojiTint(d, emoji.color, chipBg),
      fixedColors: emoji.fixed_colors,
      bg: chipBg,
    },
    code,
  );
  if (runs.length > 0) p.text(bg.y + code.padding.top + metrics.ascent, runs);
};

/**
 * md2ui `draw_emoji_box`'s `text` kind: a bare glyph at the surrounding text's size,
 * tinted by the text colour or its key's, and by a per-emoji pin where one names it.
 */
function drawTextEmoji(d: Draw, box: LayoutBox, sized: SizedNode, p: Pen) {
  const { theme, leaves } = d.sizer;
  const { fonts } = leaves;
  const style = theme.emojis.text;
  const family = fonts.textEmoji;
  const size = leaves.textEmojiPx(sized);
  const content = sized.content;
  const whole = glyphRun(d, content, 0, family, fonts.typeface, size, 0);
  const m = leaves.text.fontMetrics(whole.font);
  const gx = alignedX(d, box, whole.width);
  const gy = box.y + (box.height - (m.descent + m.ascent)) / 2 + m.ascent;
  const scopes = sized.text_style_chain;
  const base = sized.in_key
    ? scopedTextStyle(theme, "key", scopes).color
    : (style.color ?? scopedTextStyle(theme, "text", scopes).color);
  // A `## Fixed colors` pin outranks the text treatment.
  const color = pinOrReplace(base, d.pins.get(sized.node_id)?.text, box.bg_stack, theme);
  if (Object.keys(style.fixed_colors).length === 0) {
    p.text(gy, [glyphRun(d, content, gx, family, fonts.typeface, size, color)]);
    return;
  }
  let x = gx;
  const runs = [];
  for (const { segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
    content,
  )) {
    const run = glyphRun(
      d,
      segment,
      x,
      family,
      fonts.typeface,
      size,
      emojiPin(style.fixed_colors, segment) ?? color,
    );
    runs.push(run);
    x += run.width;
  }
  p.text(gy, runs);
}

/**
 * md2ui `draw_emoji_box`: an emoji leaf by its `emoji_kind` — `text` a bare glyph, any
 * other a badge in its wrapper's variant (fill, border and glyph on one rotation slot,
 * a circle or square forced by the theme, pins on fill and glyph).
 */
export const drawEmoji: BoxDrawer = (d, box, p) => {
  const found = nodesOfBox(d, box);
  if (found === null) return;
  const { sized, node } = found;
  if (sized.emoji_kind === "text") {
    drawTextEmoji(d, box, sized, p);
    return;
  }
  const { theme, leaves } = d.sizer;
  const { fonts } = leaves;
  const variant = emojiBadgeStyle(theme, sized.emoji_variant);
  const style = node?.element_muted ? mutedBadge(variant, theme.text.color) : variant;
  const { fill } = style;
  const size = style.icon_size;
  const content = sized.content;
  const whole = glyphRun(d, content, 0, fonts.emoji, fonts.typeface, size, 0, style);
  const m = leaves.text.fontMetrics(whole.font);
  const glyphH = m.descent + m.ascent;
  const { width: boxW, height: boxH } = leaves.emojiLeafSize(sized);
  const rect = {
    x: alignedX(d, box, boxW),
    y: box.y + (box.height - boxH) / 2,
    width: boxW,
    height: boxH,
  };
  const pins = d.pins.get(sized.node_id);
  const slot = node === undefined ? { index: 0, chain: [] } : rotationSlot(node, theme);
  const rotate = (colors: readonly Argb[], fallback: Argb | null) =>
    rotateColor(colors, fallback, slot.index, theme, "emoji", slot.chain);

  let bgColor: Argb | null = null;
  if (sectionIsActive(fill)) {
    bgColor = pinOrReplace(
      rotate(fill.bg_colors, null) || 0,
      pins?.fill,
      box.bg_stack,
      theme,
      "fill",
    );
    const circle = style.shape === "circle";
    layeredFill(p, rect, {
      color: bgColor,
      image: elementImageOf(fill.bg_image, style.is_muted),
      gradient: replacedGradient(fill.gradient, box.bg_stack, theme),
      radius: circle ? 0 : fill.corner_radius,
      shadows: fill.shadows,
      oval: circle,
    });
    const stroke = rotate(fill.stroke_colors, fill.stroke_color);
    if (fill.stroke_width > 0 && stroke !== null) {
      strokeOutline(
        p,
        rect,
        fill.corner_radius,
        fill.stroke_width,
        replaceColor(stroke, box.bg_stack, theme, "stroke"),
        fill.stroke_align,
        { oval: circle },
      );
    }
  }
  // The glyph sits on the badge's own fill, replacement running after rotation.
  const color = pinOrReplace(
    rotate(style.icon_colors, theme.text.color) ?? theme.text.color,
    pins?.text,
    pushBg(box.bg_stack, fill.bg_image ? BG_IMAGE : opaque(bgColor)),
    theme,
  );
  const gx = rect.x + (boxW - whole.width) / 2;
  const gy = rect.y + (boxH - glyphH) / 2 + m.ascent;
  p.text(gy, [glyphRun(d, content, gx, fonts.emoji, fonts.typeface, size, color, style)]);
};
