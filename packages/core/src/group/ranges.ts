// Character-range arithmetic: which parts of a line may not be cut (md2ui:
// pipeline/grouper_ranges.py). Pure text arithmetic: no nodes, no grouper state.
// Offsets are UTF-16 indices, like every offset in the port.
import { charAt, charBefore, isalnum, isspace, strip } from "./py/str.ts";

/** A `[start, end)` span of a node's content. */
export type Range = readonly [number, number];

/** Python's tuple order on ranges. */
function byRange(a: Range, b: Range): number {
  return a[0] - b[0] || a[1] - b[1];
}

/** `sorted(ranges)`. */
export function sortedRanges(ranges: readonly Range[]): Range[] {
  return [...ranges].sort(byRange);
}

/**
 * md2ui: `_is_intraword`. True when the run at `[start, end)` sits between two
 * alphanumerics: an underscore run flanked by word characters is not a marker.
 */
export function isIntraword(text: string, start: number, end: number): boolean {
  return isalnum(charBefore(text, start)) && isalnum(charAt(text, end));
}

/** A piece a splitter returns: md2ui's `(label, text, …)`; only the text is read here. */
type TextPiece = readonly [string, string, ...unknown[]];

/**
 * md2ui: `_partition_ranges`. Each range handed to the first piece whose text span
 * holds it whole, in that piece's coordinates; a range across a cut is dropped.
 */
export function partitionRanges(
  parentContent: string,
  ranges: readonly Range[],
  result: readonly TextPiece[],
): Range[][] {
  const partitioned: Range[][] = result.map(() => []);
  if (ranges.length === 0) return partitioned;

  const childRanges: (Range | null)[] = [];
  let searchFrom = 0;
  for (const [, text] of result) {
    if (!text) {
      childRanges.push(null);
      continue;
    }
    let idx = parentContent.indexOf(text, searchFrom);
    let length = text.length;
    if (idx === -1) {
      const stripped = strip(text);
      idx = parentContent.indexOf(stripped, searchFrom);
      length = stripped.length;
    }
    if (idx >= 0) {
      childRanges.push([idx, idx + length]);
      searchFrom = idx + length;
    } else {
      childRanges.push(null);
    }
  }
  for (const [ps, pe] of ranges) {
    for (const [i, cr] of childRanges.entries()) {
      if (cr === null) continue;
      const [cs, ce] = cr;
      if (ps >= cs && pe <= ce) {
        partitioned[i]?.push([ps - cs, pe - cs]);
        break;
      }
    }
  }
  return partitioned;
}

/**
 * md2ui: `_merge_pq`, and `_merge_ranges`, which is the same rule: overlapping
 * intervals merged (touching ones too), left to right.
 */
export function mergePq(ranges: readonly Range[]): Range[] {
  const sorted = sortedRanges(ranges);
  const merged: [number, number][] = [];
  for (const [s, e] of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && s <= last[1]) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  return merged;
}

/**
 * md2ui: `_bracket_quote_ranges`. Spans of balanced `()`, `"…"`, `` `…` `` and
 * `'…'` (a `'` after a letter is an apostrophe), skipping characters already inside
 * a data point.
 */
export function bracketQuoteRanges(content: string, dpProtected: readonly Range[]): Range[] {
  const sortedDp = sortedRanges(dpProtected);
  const inDp = (pos: number): boolean => {
    let lo = 0;
    let hi = sortedDp.length - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const [s, e] = sortedDp[mid] as Range;
      if (s <= pos) {
        if (e > pos) return true;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return false;
  };
  const ranges: Range[] = [];

  // Balanced parentheses, nesting supported.
  let depth = 0;
  let parenStart = -1;
  // Each loop tests the character before the data-point search, which most characters
  // need not reach.
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if ((ch !== "(" && ch !== ")") || inDp(i)) continue;
    if (ch === "(") {
      if (depth === 0) parenStart = i;
      depth += 1;
    } else if (ch === ")" && depth > 0) {
      depth -= 1;
      if (depth === 0) ranges.push([parenStart, i + 1]);
    }
  }
  // Straight double quotes, then backtick spans: open, close, open, close.
  for (const mark of ['"', "`"]) {
    let start = -1;
    for (let i = 0; i < content.length; i += 1) {
      if (content[i] !== mark || inDp(i)) continue;
      if (start < 0) start = i;
      else {
        ranges.push([start, i + 1]);
        start = -1;
      }
    }
  }
  // Single quotes, opened only where not attached to a letter.
  let single = -1;
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] !== "'" || inDp(i)) continue;
    if (single < 0) {
      if (i === 0 || !isalnum(charBefore(content, i))) single = i;
    } else {
      ranges.push([single, i + 1]);
      single = -1;
    }
  }
  return sortedRanges(ranges);
}

/**
 * md2ui: `_colon_is_glued`. True when the colon at `i` runs straight into the next
 * word. A key's closing markers may sit between them: `**Key:** value` is spaced,
 * `H:25°` is glued.
 */
export function colonIsGlued(content: string, i: number): boolean {
  let j = i + 1;
  while (j < content.length && "*_~`".includes(content[j] as string)) j += 1;
  return j < content.length && !isspace(content[j] as string);
}

/**
 * md2ui: `_make_is_safe`. `isSafe(pos)`: outside every protected interval (sorted,
 * non-overlapping), and not backslash-escaped.
 */
export function makeIsSafe(
  sortedProtected: readonly Range[],
  content = "",
): (pos: number) => boolean {
  return (pos) => {
    if (pos > 0 && content.slice(pos - 1, pos) === "\\") return false;
    let lo = 0;
    let hi = sortedProtected.length - 1;
    while (lo <= hi) {
      const mid = Math.floor((lo + hi) / 2);
      const [s, e] = sortedProtected[mid] as Range;
      if (s <= pos) {
        if (e > pos) return false;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return true;
  };
}

/**
 * md2ui: `_element_wrapper_span`. An element's span widened over the emphasis
 * wrapper that HUGS it: by the shorter of the two marker runs (`chars`, at most
 * `cap`), never past `[lo, hi]`.
 */
export function elementWrapperSpan(
  content: string,
  start: number,
  end: number,
  lo: number,
  hi: number,
  chars: string,
  cap: number,
): Range {
  let left = 0;
  while (
    left < cap &&
    start - left - 1 >= lo &&
    chars.includes(content[start - left - 1] ?? "\0")
  ) {
    left += 1;
  }
  let right = 0;
  while (right < cap && end + right < hi && chars.includes(content[end + right] ?? "\0")) {
    right += 1;
  }
  const k = Math.min(left, right);
  return k ? [start - k, end + k] : [start, end];
}
