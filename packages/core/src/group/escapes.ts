// The escape vocabulary: which characters an author can decline, and when each
// escape is resolved (md2ui: pipeline/grouper_escapes.py). Every character that splits
// a line can be declined, and each is ASCII punctuation, a CommonMark escape. A
// non-ASCII character (a long dash, an arrow, a dot) splits nothing, so it has nothing
// to decline and its backslash is drawn, as any Markdown renderer draws it (md2ui ADR-205).
//
// The separator, value and control escapes are resolved late, once every scan that
// reads them has run; the markup escape (`\*`) is never resolved by the grouper, since
// the drawer parses emphasis again; every other CommonMark escape is resolved in
// `preprocess`. The sets are complements, derived, so they cannot drift apart.

import { compile, type Match, type Pattern, type RegexKit, reEscape } from "./py/re.ts";
import { charAt, charBefore, isspace, strip } from "./py/str.ts";

// md2ui: ESCAPABLE_SEPARATORS — escaping one declines a split, so a separator is never
// something an author cannot decline (md2ui ADR-205). The long dashes and the dots
// (ADR-205) split nothing and are absent.
export const ESCAPABLE_SEPARATORS = "-|:,.";
// md2ui: VALUE_ESCAPES — escaping one says the token is text.
const VALUE_ESCAPES = "/%$";
// md2ui: CONTROL_ESCAPES — escaping one says it is not a control mark. `#` is the
// heading marker, read by the block parse and by Phase 6.18 (`- # Title`), so `\# x`
// is text that starts with a hash, in a paragraph and a list item alike. `>` is the
// blockquote marker, read by the block parse: `\> x` is text that starts with an angle.
const CONTROL_ESCAPES = "@+#>";
// md2ui: DEFERRED_ESCAPES
export const DEFERRED_ESCAPES = ESCAPABLE_SEPARATORS + VALUE_ESCAPES + CONTROL_ESCAPES;
// md2ui: MARKUP_ESCAPES — the characters the DRAWER reads as markup, escapable so they
// are drawn as themselves: `\*` is a star, not emphasis and not a list marker. Its
// backslash stays in the node's content and the drawer's inline parse
// (`parseInlineSpans`) is the one place it is resolved, so measuring and painting agree
// (md2ui ADR-400). Every grouper scan that reads a `*` as a marker skips one behind a
// backslash (`inline-marks.ts` `markerRuns`).
export const MARKUP_ESCAPES = "*";
// Python's `string.punctuation`: what CommonMark escapes.
const PUNCTUATION = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

/** md2ui: `EARLY_ESCAPES`, the escapes `preprocess` resolves (sorted, as md2ui builds it). */
export const EARLY_ESCAPES = [...PUNCTUATION]
  .filter((c) => !DEFERRED_ESCAPES.includes(c) && !MARKUP_ESCAPES.includes(c))
  .sort()
  .join("");

// md2ui: _CODE_SPAN. A code span is literal, as in CommonMark: no backslash escape works
// inside one, so `` `\` `` is a backslash in code and `` `a\-b` `` keeps its backslash. A
// span opens on a whole backtick run and closes on the next run of the same length, on the
// same line, since every source line is its own text here.
// py: r"(?<!`)(?P<ticks>`++)[^\n]*?[^`\n](?P=ticks)(?!`)"
// JavaScript has no possessive `++`; an atomic lookahead that captures the run is the same.
const CODE_SPAN = "(?<!`)(?=(?P<ticks>`+))(?P=ticks)[^\\n]*?[^`\\n](?P=ticks)(?!`)";

/**
 * md2ui: `escapes_outside_code`. Matches each backslash escape of one of `chars`, and each
 * code span whole, for {@link resolveEscape} to keep. One scan, left to right, so an
 * escaped backtick never opens a span, as in CommonMark.
 */
export function escapesOutsideCode(chars: string): Pattern {
  // py: re.compile(rf"(?P<code>{_CODE_SPAN})|\\(?P<ch>[{re.escape(chars)}])")
  return compile(String.raw`(?P<code>${CODE_SPAN})|\\(?P<ch>[${reEscape(chars)}])`);
}

/** md2ui: `resolve_escape`. The escaped character, or the code span unchanged. */
export function resolveEscape(m: Match): string {
  return m.group("code") === undefined ? m.text("ch") : m.text();
}

/**
 * md2ui: `escaped`. Whether the character at `i` in `s` is escaped: an odd run of
 * backslashes sits right before it, so `\*` is escaped and `\\*` is a backslash
 * and then a star.
 */
export function escaped(s: string, i: number): boolean {
  let j = i;
  while (j > 0 && s[j - 1] === "\\") j -= 1;
  return (i - j) % 2 === 1;
}

// py: re.compile(_CODE_SPAN)
const CODE_SPAN_RE = compile(CODE_SPAN);

/**
 * md2ui: `row_cells`. A table row's cells: its text cut at each pipe that is not escaped.
 * GFM keeps an escaped `\|` in its cell as a literal pipe, in a code span too, where it is
 * the pipe alone. Anywhere else its backslash stays, a declined separator like `a \| b`
 * outside a table, for Phase 6.17 to drop.
 */
export function rowCells(kit: RegexKit, line: string): string[] {
  const row = strip(line);
  const cuts: number[] = [];
  for (let i = 0; i < row.length; i++) if (row[i] === "|" && !escaped(row, i)) cuts.push(i);
  const bounds = [-1, ...cuts, row.length];
  let cells = bounds.slice(1).map((b, k) => row.slice((bounds[k] as number) + 1, b));
  if (row.startsWith("|")) cells = cells.slice(1);
  if (cells.length > 1 && cuts.at(-1) === row.length - 1) cells = cells.slice(0, -1);
  return cells.map((c) =>
    strip(kit.re(CODE_SPAN_RE).sub((m) => m.text().replaceAll("\\|", "|"), c)),
  );
}

/** md2ui: `HARD_BREAK` — a trailing backslash's break inside one text (U+2028). */
export const HARD_BREAK = "\u2028";

// md2ui: _declines_the_reading. The escape at `backslash` declines its TOKEN's
// reading: a value escape anywhere, or a separator escape tight between non-spaces.
function declinesTheReading(content: string, backslash: number): boolean {
  const ch = charAt(content, backslash + 1);
  if (VALUE_ESCAPES.includes(ch)) return true;
  if (!ESCAPABLE_SEPARATORS.includes(ch)) return false;
  const before = backslash > 0 ? charBefore(content, backslash) : " ";
  const after = backslash + 2 < content.length ? charAt(content, backslash + 2) : " ";
  return !isspace(before) && !isspace(after);
}

/**
 * md2ui: `_value_escape_spans`. The white-space-delimited tokens holding a value
 * escape: a data point overlapping one is dropped, since the author declined it.
 */
export function valueEscapeSpans(content: string): [number, number][] {
  const spans: [number, number][] = [];
  const n = content.length;
  let i = 0;
  while (i < n) {
    if (content[i] === "\\" && i + 1 < n && declinesTheReading(content, i)) {
      let start = i;
      while (start > 0 && !isspace(charBefore(content, start))) start -= 1;
      let end = i + 2;
      while (end < n && !isspace(charAt(content, end))) end += 1;
      const last = spans.at(-1);
      if (last !== undefined && last[0] === start) last[1] = end;
      else spans.push([start, end]);
      i = end;
      continue;
    }
    i += 1;
  }
  return spans;
}
