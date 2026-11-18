// What a layout stage reports beside its tree: every measurer answer that differs from
// md2ui's, and the class that explains it (ADR-403, stage C).

/**
 * Why a measurer answer under Pretext differs from md2ui's (ADR-403, stage C). The
 * line-breaking rules, from Pretext against md2ui's wrap over the same font answers:
 * - `fit-epsilon`: Pretext lets a line exceed the width by its engine epsilon;
 * - `hyphen`, `url`, `punctuation-break`: Pretext breaks, and measures pieces, inside a
 *   word md2ui keeps whole (after a hyphen, inside a URL or path, at punctuation);
 * - `long-word`: Pretext breaks inside a word wider than the line, md2ui overflows;
 * - `no-spaces`: CJK and other text without spaces;
 * - `unmeasured-word`: Pretext measures a word or a space on its own that md2ui measured
 *   only inside a longer run (a label, a cell, a whole code line), so the replay has no
 *   answer for it and the browser's canvas gives one. It explains a difference only
 *   where its words are written in an entry that differs (`unmeasured.ts`);
 * - `span-space`: Pretext measures a space in the span that holds it, md2ui's wrap in the
 *   style of the word after it (the space in `⚡ **55**` is bold to md2ui).
 *
 * Sizing composed from C3 against md2ui's answers under md2ui's own font answers (stage
 * B), proved per case:
 * - `code-line-runs`: a code line's width is a sum of runs that differ: md2ui's highlighted
 *   runs; C3's whole line, or under Pretext its segments;
 * - `whole-run-sum`: a label md2ui measured as one run (a link written as code,
 *   `` [`Pink Floyd`](…) ``), in float32, where Pretext sums its words and spaces from
 *   md2ui's own answers; md2ui's answer is that sum rounded to float32, up or down.
 *   The proportional twin of `code-line-runs`;
 * - `emoji-gap`: a button label's `Emoji gap` is md2ui's stretched space, in float32, where
 *   the port adds the gap itself.
 *
 * An artifact of md2ui's engine, which the port does not reproduce (ADR-403):
 * - `float32-height`: md2ui reads a marker's ink height as Skia's float32 `Rect.height()`;
 *   the port's is the browser's double. A scene box differs only in its height, which is
 *   md2ui's recorded outline height rounded to float32, and in its `y` by no more than that
 *   rounding (`float32-height.ts`).
 *
 * A feature md2ui has and the port declines, per field of the resolved theme:
 * - `line-chart-unported`: `### Line Chart`'s area fill (`charts.line.fill`).
 *   Line charts are not ported further, so C2 has no such field.
 *
 * Where the theme's references point:
 * - `asset-beside-theme`: md2ui resolved a relative asset path to the file beside the
 *   THEME.md, which it checks exists; the port's parse keeps it as written and the host
 *   resolves it against the theme's URL (`core/src/theme/assets.ts`, ADR-001).
 *
 * `unclassified` is a difference none of these explains: the check fails on it.
 */
export type DivergenceClass =
  | "fit-epsilon"
  | "hyphen"
  | "url"
  | "punctuation-break"
  | "long-word"
  | "no-spaces"
  | "unmeasured-word"
  | "span-space"
  | "code-line-runs"
  | "whole-run-sum"
  | "emoji-gap"
  | "float32-height"
  | "line-chart-unported"
  | "asset-beside-theme"
  | "unclassified";

/** One measurer answer that differs from md2ui's, and why. */
export interface Divergence {
  readonly class: DivergenceClass;
  /** The answer: the question, md2ui's number and the port's. */
  readonly text: string;
  /**
   * The whole words Pretext measured on their own and md2ui never did, behind the answer:
   * an `unmeasured-word` divergence explains a difference only where they are written.
   */
  readonly words: readonly string[];
}
