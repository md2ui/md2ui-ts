// C3 — Measurer interface. Not public.
//
// The questions ADR-403 assigns to Pretext. A change to it updates its producers and
// consumers in the same change and keeps conformance green (ADR-005).
//
// Every question the layout and sizing stages ask of text goes through this interface.
// It holds questions about text, which Pretext answers (its width on one line, the
// narrowest width before a word breaks, its lines and their number at a width), and
// three font-level questions (`advance`, `fontMetrics`, `inkBounds`). md2ui's
// generator asks about leaves and blocks (`make_width_measurer`,
// `make_line_width_measurer`, `make_block_width_measurer`); those add theme chrome to
// these answers and belong to layout.
//
// Implementations: Pretext in the browser (`@md2ui/text-pretext`), and a deterministic
// fake in `@md2ui/core` for Node tests, whose wrap is md2ui's own. Conformance runs the
// Pretext implementation itself on md2ui's recorded font answers, below this interface
// at the canvas `measureText` boundary (`tools/text-conformance`). All lengths are CSS
// pixels.

import type { FontSpec } from "./font.ts";

/**
 * One styled span of a text leaf. A text is a list of spans, in reading order.
 *
 * Spaces separate words as written; a span may begin or end with one. U+2028 (LINE
 * SEPARATOR, md2ui's hard break) forces a new line at every width.
 */
export interface TextSpan {
  readonly text: string;
  readonly font: FontSpec;
}

/** The part of one span that falls on one line: what the painter draws with one `fillText`. */
export interface LineFragment {
  /** Index of the span this text came from. */
  readonly span: number;
  readonly text: string;
  /** Left edge of the fragment, from the start of the line. */
  readonly x: number;
  readonly width: number;
}

/** One line of a wrapped text. The painter draws its fragments unchanged (ADR-403). */
export interface TextLine {
  readonly width: number;
  readonly fragments: readonly LineFragment[];
}

/** A text measured once; every question after that is asked at any width. */
export interface PreparedText {
  /** The width it takes on one line; with hard breaks, its widest segment. */
  lineWidth(): number;
  /**
   * The widest run with no written space or hard break in it: the narrowest width
   * the text renders at without breaking inside a word.
   */
  minWidth(): number;
  /**
   * How many lines it takes at `maxWidth`. An empty text takes none. At any width at
   * or above `lineWidth()` it is one line per hard-break segment that holds text.
   */
  lineCount(maxWidth: number): number;
  /**
   * The lines it takes at `maxWidth`. At any width at or above `minWidth()`, no line
   * is wider than `maxWidth`.
   */
  lines(maxWidth: number): readonly TextLine[];
}

/** A font's extent above and below the baseline, both positive. */
export interface FontMetrics {
  readonly ascent: number;
  readonly descent: number;
}

/** Where a text's glyphs actually draw, relative to its pen origin and baseline. */
export interface InkBounds {
  /** From the baseline up to the top of the ink. */
  readonly top: number;
  readonly height: number;
  /** From the pen origin to the ink's left edge; negative where a glyph overhangs it. */
  readonly left: number;
  /** The ink's width; its right edge is `left + width`. */
  readonly width: number;
}

export interface TextMeasurer {
  /** Measures a text of styled spans that wraps at spaces. */
  prepare(spans: readonly TextSpan[]): PreparedText;
  /** The width of `text` on one line, every space kept: a label, a glyph, a code line. */
  advance(text: string, font: FontSpec): number;
  fontMetrics(font: FontSpec): FontMetrics;
  /**
   * For a text with no ink (a space), the font's ascent is both `top` and `height`, and
   * `left` and `width` are 0.
   *
   * Known and accepted: a canvas measurer in WebKit cannot report the
   * horizontal ink. Its `actualBoundingBoxLeft`/`Right` are the advance box widened by any
   * overhang, so `left` and `width` there are about the advance. A fit judged on the ink
   * (a ring's label) may then differ from md2ui by one shrink step there; Chromium and
   * Firefox report the glyphs' ink.
   */
  inkBounds(text: string, font: FontSpec): InkBounds;
}
