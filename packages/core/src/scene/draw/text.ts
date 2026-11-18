// Text as display-list runs (md2ui `draw_styled_text_box`, `render_text_paint`): a
// wrapped text is drawn exactly as Pretext broke it into lines, one run per fragment and
// never re-wrapped (ADR-403), with its markers' backgrounds, its inline links' colour
// and underline, its strike-throughs, and its `## Fixed colors` pins. A label (a
// button's, a chip's, a marker's) is one line of the same runs.
import type { Argb, EmojiTextStyle, FontSpec, TextLine, TextStyle } from "@md2ui/contracts";
import { type EmojiKeys, emojiFontOf, type Face, fontOf } from "../../measure/font-set.ts";
import { LINE_SCALE } from "../../measure/leaf-kit.ts";
import type { SizedFaces } from "../../measure/text-fonts.ts";
import { type FlaggedSpan, faceRuns, flaggedTextSpans } from "../../measure/text-runs.ts";
import { opaque, pushBg, replaceColor } from "../backgrounds.ts";
import type { BgStack, LayoutBox } from "../boxes.ts";
import { flagRuns, lineStart } from "../lines.ts";
import { type Pins, pinOrReplace } from "./colors.ts";
import type { Draw } from "./context.ts";
import { type Box, css, type MeasuredRun, type Pen, rectShape } from "./pen.ts";
import { bareGlyph, emojiPin } from "./pins.ts";

/** How a text paints its emoji and pinned characters (md2ui `_draw_runs`' arguments). */
export interface GlyphPaint {
  /** The emoji runs' tint; `null` keeps the text colour. */
  readonly emojiColor: Argb | null;
  /** Per-character pins (`## Emoji styles` `Fixed colors`). */
  readonly fixedColors: Readonly<Record<string, Argb>>;
  /** What the text sits on, for a pin that would vanish into it. */
  readonly bg: BgStack;
}

const NO_PINS: Readonly<Record<string, Argb>> = Object.freeze({});

/**
 * md2ui `_pinned_pieces`: `[start, end, pin]` cuts of `run` at every pinned key it holds.
 * A text run holds no variation selector, so a key is matched without its own (`⏷️` pins
 * `⏷`); a key written bare wins over one that differs by it.
 */
function pinnedPieces(
  run: string,
  fixed: Readonly<Record<string, Argb>>,
): [number, number, Argb | undefined][] {
  const pins = new Map<string, Argb>();
  for (const [key, pin] of Object.entries(fixed)) pins.set(bareGlyph(key), pin);
  for (const [key, pin] of Object.entries(fixed)) if (bareGlyph(key) === key) pins.set(key, pin);
  const keys = [...pins.keys()]
    .filter((k) => k !== "" && run.includes(k))
    .sort((a, b) => b.length - a.length);
  if (keys.length === 0) return [];
  const pieces: [number, number, Argb | undefined][] = [];
  let plain = 0;
  let i = 0;
  while (i < run.length) {
    const key = keys.find((k) => run.startsWith(k, i));
    if (key === undefined) {
      i++;
      continue;
    }
    if (plain < i) pieces.push([plain, i, undefined]);
    pieces.push([i, i + key.length, pins.get(key)]);
    i += key.length;
    plain = i;
  }
  if (plain < run.length) pieces.push([plain, run.length, undefined]);
  return pieces;
}

/** One run of a font, as `_draw_runs` is handed it. */
interface FontRun {
  readonly text: string;
  readonly x: number;
  readonly font: FontSpec;
  readonly emoji: boolean;
  /** Its advance, when the line already knows it. */
  readonly width?: number;
}

/**
 * md2ui `_draw_runs` for one run in one font: a text run cut at its pinned characters,
 * an emoji run cut into graphemes when any is pinned. Each piece sits at its offset in
 * the whole run, so colour never moves a glyph (md2ui ADR-400).
 */
function pieceRuns(d: Draw, run: FontRun, color: Argb, paint: GlyphPaint): MeasuredRun[] {
  const { theme } = d.sizer;
  const { text, x, font } = run;
  const advance = (s: string): number => (s === "" ? 0 : d.sizer.leaves.text.advance(s, font));
  const piece = (t: string, at: number, c: Argb, width?: number): MeasuredRun => ({
    text: t,
    x: at,
    font,
    color: css(c),
    width: width ?? advance(t),
  });
  const pins = paint.fixedColors;
  if (!run.emoji) {
    const pieces = pinnedPieces(text, pins);
    if (pieces.length === 0) return [piece(text, x, color, run.width)];
    return pieces.map(([start, end, pin]) =>
      piece(
        text.slice(start, end),
        x + advance(text.slice(0, start)),
        pin === undefined ? color : pinOrReplace(color, pin, paint.bg, theme),
      ),
    );
  }
  const tint = paint.emojiColor ?? color;
  if (Object.keys(pins).length === 0) return [piece(text, x, tint, run.width)];
  // A pin names a whole emoji: one grapheme, variation selector and joiners included
  // (md2ui `_emoji_clusters`, which approximates what `Intl.Segmenter` answers).
  const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const out: MeasuredRun[] = [];
  let at = x;
  for (const { segment } of graphemes.segment(text)) {
    const w = advance(segment);
    out.push(piece(segment, at, pinOrReplace(tint, emojiPin(pins, segment), paint.bg, theme), w));
    at += w;
  }
  return out;
}

/**
 * md2ui `_draw_text_with_emoji` for a label on one line at `x`: its emoji runs in the
 * family `emoji` as `emojiKeys` set it (`null`: the font as loaded), each piece
 * in its colour. Returns the runs and their advance.
 */
export function labelRuns(
  d: Draw,
  label: string,
  x: number,
  face: Face,
  emoji: string,
  size: number,
  color: Argb,
  paint: GlyphPaint = { emojiColor: null, fixedColors: NO_PINS, bg: [] },
  emojiKeys: EmojiKeys | null = null,
  icon = false,
): { readonly runs: MeasuredRun[]; readonly width: number } {
  const runs: MeasuredRun[] = [];
  let at = x;
  for (const { span, emoji: isEmoji } of faceRuns(label, face, emoji, size, emojiKeys, icon)) {
    const width = d.sizer.leaves.text.advance(span.text, span.font);
    runs.push(...pieceRuns(d, { ...span, x: at, emoji: isEmoji, width }, color, paint));
    at += width;
  }
  return { runs, width: at - x };
}

/**
 * md2ui `draw_glyph_runs`: a glyph on its own, in the emoji face where it has the glyph
 * and the text face where it does not (one font naming both; the browser falls back),
 * as a badge's emoji keys set it.
 */
export function glyphRun(
  d: Draw,
  glyph: string,
  x: number,
  emoji: string,
  face: Face,
  size: number,
  color: Argb,
  emojiKeys: EmojiKeys | null = null,
): MeasuredRun {
  const font = emojiFontOf(emoji, face, size, emojiKeys);
  return {
    text: glyph,
    x,
    font,
    color: css(color),
    width: d.sizer.leaves.text.advance(glyph, font),
  };
}

/** The keyword arguments of md2ui's `draw_styled_text_box`. */
export interface TextOptions {
  /** How emoji inside the text paint (md2ui `emoji_style`); `null`: the default face and colour. */
  readonly emoji: EmojiTextStyle | null;
  /** The style whose `Marker …` keys paint inline `code` spans; `null`: none. */
  readonly marker: TextStyle | null;
  /** The leaf's `## Fixed colors` pins. */
  readonly pins: Pins | undefined;
  /**
   * Whether a style more specific than body Text set this text's colour
   * (`proseTextIsStyled`); an emoji in styled text takes the text's ink. Absent: not.
   */
  readonly styled?: boolean;
}

/**
 * md2ui `_prose_emoji_paint`: an emoji inside text takes `### Text`'s colour only in plain
 * body text; in styled text it follows the text's ink. Whether the text is styled is said
 * by whoever resolved its style, never read off the colour: the default Lead shares body
 * Text's ink. Its face is the one the text was sized with (`SizedFaces.emoji`), never the
 * style's own, so it paints where it was measured.
 */
function proseEmoji(
  d: Draw,
  style: EmojiTextStyle | null,
  styled: boolean,
  bg: BgStack,
): GlyphPaint {
  const { theme } = d.sizer;
  if (style === null) return { emojiColor: null, fixedColors: NO_PINS, bg };
  const tint = style.color !== null && !styled ? replaceColor(style.color, bg, theme) : null;
  return { emojiColor: tint, fixedColors: style.fixed_colors, bg };
}

const advanceOf = (d: Draw, text: string, font: FontSpec): number =>
  text === "" ? 0 : d.sizer.leaves.text.advance(text, font);

/** `[start, end, pin]` of the fragment's own text. */
type LocalRange = readonly [number, number, Argb];

/**
 * md2ui `project_paint_spans` over Pretext's fragments: each range pin, cut to every
 * fragment it covers, by line and fragment. A fragment is found in its span's text from
 * where the last one ended; if one cannot be, the whole text takes the first pin, as
 * md2ui falls back.
 */
function rangesOf(
  spans: readonly FlaggedSpan[],
  lines: readonly TextLine[],
  pins: Pins["spans"],
): Map<number, LocalRange[][]> {
  const out = new Map<number, LocalRange[][]>();
  if (pins === undefined || pins.length === 0) return out;
  const starts: number[] = [];
  let offset = 0;
  for (const s of spans) {
    starts.push(offset);
    offset += s.span.text.length;
  }
  const cursor = spans.map(() => 0);
  let lost = false;
  const located = lines.map((line) =>
    line.fragments.map((f) => {
      const at = (spans[f.span] as FlaggedSpan).span.text.indexOf(f.text, cursor[f.span]);
      if (at < 0) lost = true;
      cursor[f.span] = at + f.text.length;
      return (starts[f.span] as number) + at;
    }),
  );
  lines.forEach((line, i) => {
    out.set(
      i,
      line.fragments.map((f, j) => {
        if (lost) return [[0, f.text.length, (pins[0] as (typeof pins)[number]).color]];
        const start = located[i]?.[j] as number;
        const end = start + f.text.length;
        return pins
          .filter((r) => r.start < end && start < r.end)
          .map(
            (r) =>
              [Math.max(start, r.start) - start, Math.min(end, r.end) - start, r.color] as const,
          );
      }),
    );
  });
  return out;
}

/** A rect cut to another. */
function cut(a: Box, b: Box): Box {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x),
    height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y),
  };
}

/**
 * How far past its advance a line ending in italic may lean, as a share of the size: the
 * skew of md2ui's synthetic oblique (`font_loader.SYNTHETIC_OBLIQUE_SKEW`).
 */
const ITALIC_LEAN = 0.25;

/**
 * md2ui `draw_styled_text_box`: `content` in `sized`'s faces at its size, wrapped as
 * Pretext breaks it at the box's width and clipped to the box. Per line, in md2ui's four
 * passes: the markers' flat backgrounds, the text, one underline per inline link, one
 * rule per struck region.
 */
export function styledText(
  d: Draw,
  p: Pen,
  box: LayoutBox,
  content: string,
  sized: SizedFaces,
  textColor: Argb,
  align: string,
  options: TextOptions,
): void {
  const { theme, leaves } = d.sizer;
  const { kit } = leaves;
  const { faces, size } = sized;
  // The spans sizing measured, so these are the lines the box was sized for.
  const spans = flaggedTextSpans(kit, content, faces, size, sized.emoji);
  if (!spans.some((s) => /[^ \u2028]/u.test(s.span.text))) return;
  const lines = leaves.prepare(spans.map((s) => s.span)).lines(box.width);
  const bg = box.bg_stack;
  const color = pinOrReplace(textColor, options.pins?.text, bg, theme);
  // A `## Fixed colors` text pin styles the text as much as a declared style does.
  const styled = options.styled === true || options.pins?.text !== undefined;
  const emojiPaint = proseEmoji(d, options.emoji, styled, bg);
  const inline = theme.links.inline;
  const linkColor = inline.text_color !== null ? replaceColor(inline.text_color, bg, theme) : color;
  let markerBg = options.marker?.marker_bg_color ?? null;
  let markerColor = options.marker?.marker_text_color ?? null;
  if (markerBg !== null) markerBg = replaceColor(markerBg, bg, theme, "fill");
  if (markerColor !== null) {
    // A marker's text sits on its own background when it has one.
    markerColor = replaceColor(markerColor, pushBg(bg, opaque(markerBg)), theme);
  }
  const metrics = leaves.text.fontMetrics(fontOf(faces.typeface, size));
  const flags = (f: { readonly span: number }) => spans[f.span] as (typeof spans)[number];
  // A line ending in italic leans past its advance where the browser synthesizes the
  // oblique: the clip makes room for that ink, and the box never widens. The platform
  // does not say whether a slant was synthesized, so every italic ending gets the room.
  const leans = lines.some((line) => {
    const last = line.fragments.at(-1);
    return last !== undefined && flags(last).span.font.italic;
  });
  const area: Box = leans ? { ...box, width: box.width + size * ITALIC_LEAN } : box;
  const clip = rectShape(area);
  const ranges = rangesOf(spans, lines, options.pins?.spans);
  const lineHeight = size * LINE_SCALE;

  lines.forEach((line, i) => {
    const y = box.y + size + i * lineHeight;
    const start = lineStart(box.x, box.width, line.width, align);

    if (markerBg !== null) {
      for (const run of flagRuns(line, start, (f) => flags(f).code)) {
        const rect = {
          x: run.x0,
          y: y - metrics.ascent,
          width: run.x1 - run.x0,
          height: metrics.ascent + metrics.descent,
        };
        p.fill(rectShape(rect), { kind: "color", color: css(markerBg) }, clip);
      }
    }

    const runs: MeasuredRun[] = [];
    const overlays: { runs: MeasuredRun[]; clip: Box }[] = [];
    line.fragments.forEach((fragment, j) => {
      const span = flags(fragment);
      const wordColor =
        span.link !== 0 ? linkColor : span.code !== 0 ? (markerColor ?? color) : color;
      const font = span.span.font;
      const run: FontRun = {
        text: fragment.text,
        x: start + fragment.x,
        font,
        emoji: span.emoji,
        width: fragment.width,
      };
      runs.push(...pieceRuns(d, run, wordColor, emojiPaint));
      for (const [a, b, pin] of ranges.get(i)?.[j] ?? []) {
        // Paint-only, at the same origin: the word again in the pin's colour, clipped
        // to the range, so colour never moves or rewraps a glyph (md2ui ADR-400).
        const pinned = pinOrReplace(wordColor, pin, bg, theme);
        const m = leaves.text.fontMetrics(font);
        const left = run.x + advanceOf(d, fragment.text.slice(0, a), font);
        const right = run.x + advanceOf(d, fragment.text.slice(0, b), font);
        const range = {
          x: left,
          y: y - m.ascent,
          width: right - left,
          height: m.ascent + m.descent,
        };
        overlays.push({
          runs: pieceRuns(d, run, pinned, { ...emojiPaint, emojiColor: pinned }),
          clip: cut(range, area),
        });
      }
    });
    p.text(y, runs, clip);
    for (const o of overlays) p.text(y, o.runs, rectShape(o.clip));

    if (inline.underline) {
      const under = y + size * 0.12;
      for (const run of flagRuns(line, start, (f) => flags(f).link)) {
        p.line(run.x0, under, run.x1, under, 1, linkColor, clip);
      }
    }
    // One rule per struck region, in its first word's colour, over the text.
    for (const run of flagRuns(line, start, (f) => flags(f).strike)) {
      const first = flags(line.fragments[run.first] as { span: number });
      const ruleColor =
        first.link !== 0
          ? linkColor
          : first.code !== 0 && markerColor !== null
            ? markerColor
            : color;
      const mid = y - size * 0.35;
      p.line(run.x0, mid, run.x1, mid, 1, ruleColor, clip);
    }
  });
}
