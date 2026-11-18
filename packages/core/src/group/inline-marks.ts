// The markdown-marker vocabulary the inline cuts share (md2ui:
// pipeline/grouper_inline_marks.py).
import { INLINE_CODE_RE } from "./block-splits.ts";
import type { Edit } from "./content-edits.ts";
import { EMOJI_CHAR_PATTERN } from "./detect/vocabulary.ts";
import { escaped, MARKUP_ESCAPES } from "./escapes.ts";
import { LINK_CONTENT_RE, stripWrap } from "./link-content.ts";
import { compile, type Pattern, type RegexKit, reEscape } from "./py/re.ts";
import { charAt, charBefore, cpLen, isalnum, isspace, lstrip, rstrip, strip } from "./py/str.ts";
import { elementWrapperSpan, type Range, sortedRanges } from "./ranges.ts";

/**
 * md2ui: `INLINE_SPACERS`. A spaced `+++` / `++++` / `+++++` inside a line, swapped
 * for one private character so the separator scans read one character per separator.
 */
export const INLINE_SPACERS = Object.freeze({
  "\ue140": "+++",
  "\ue141": "++++",
  "\ue142": "+++++",
} as const);

/** md2ui: `_is_lone_emoji`. Nothing but emoji glyphs, ZWJ joiners and spaces aside. */
export function isLoneEmoji(kit: RegexKit, s: string): boolean {
  const stripped = s.replaceAll("\u200d", "").replaceAll(" ", "");
  return stripped !== "" && kit.re(EMOJI_CHAR_PATTERN).fullmatch(stripped) !== null;
}

// md2ui: _LINE_SEPARATORS. ASCII only, so an author can always escape one (ADR-205).
const LINE_SEPARATORS = "|-";
/**
 * md2ui: `_PASS2_SEPARATORS`. Every row separator: space required on both sides. The
 * dots `•` `·` `∙` `‧` are text, not separators (ADR-205).
 */
export const PASS2_SEPARATORS = LINE_SEPARATORS + Object.keys(INLINE_SPACERS).join("");

/** md2ui: `_ELEMENT_VARIANT_WRAPPERS`. Markers longest-first. */
export const ELEMENT_VARIANT_WRAPPERS = ["***", "___", "**", "__", "*", "_"] as const;

/**
 * md2ui: `_SPLIT_WRAP_CHARS`. The markers the structural splitters honour when they
 * ask whether a whole line is one span.
 */
export const SPLIT_WRAP_CHARS = "*_~`";

/** md2ui: `_is_lone_element`. Nothing but ONE inline element: an emoji, a chip or a link. */
export function isLoneElement(kit: RegexKit, s: string): boolean {
  const t = strip(s);
  return (
    t !== "" &&
    (isLoneEmoji(kit, t) ||
      kit.re(INLINE_CODE_RE).fullmatch(t) !== null ||
      kit.re(LINK_CONTENT_RE).match(t) !== null)
  );
}

/**
 * md2ui: `_reapply_line_wrap`. Gives `piece` the LINE's `marker`, unless it is a lone
 * element: that wrapper belongs to the line, and a manufactured one is stripped.
 */
export function reapplyLineWrap(kit: RegexKit, marker: string, piece: string): string {
  const inner = strip(piece);
  if (inner.startsWith(marker) && inner.endsWith(marker) && cpLen(inner) > 2 * marker.length) {
    const core = inner.slice(marker.length, -marker.length);
    return isLoneElement(kit, core) ? core : piece;
  }
  if (isLoneElement(kit, inner)) return piece;
  return `${marker}${piece}${marker}`;
}

// py: re.compile(r"([*_~`])\1*")
const MARKER_RUN_RE = compile(String.raw`([*_~\x60])\1*`);

/** A maximal marker run: where it starts, its character, its length. */
type MarkerRun = readonly [number, string, number];

/**
 * md2ui: `_marker_runs`. Every maximal marker run, less the ones that are not
 * markers: a `~` run not exactly two long, an intraword `_`, and anything inside a
 * complete code span. And an escaped star (`MARKUP_ESCAPES`) is not a marker: its
 * backslash stays in the content for the drawer to resolve, so a run behind an odd number
 * of backslashes loses its first star (`\*x\*` has no runs, `\**x**` a one-star run).
 */
function markerRuns(kit: RegexKit, s: string): MarkerRun[] {
  const spans = s.includes("`") ? [...kit.re(INLINE_CODE_RE).finditer(s)].map((m) => m.span()) : [];
  const runs: MarkerRun[] = [];
  for (const m of kit.re(MARKER_RUN_RE).finditer(s)) {
    if (spans.some(([a, b]) => a <= m.start() && m.end() <= b)) continue;
    const ch = m.text(1);
    let start = m.start();
    let length = m.end() - start;
    if (MARKUP_ESCAPES.includes(ch) && escaped(s, start)) {
      start += 1;
      length -= 1;
      if (length === 0) continue;
    }
    if (ch === "~" && length !== 2) continue;
    if (ch === "_" && isalnum(charBefore(s, m.start())) && isalnum(charAt(s, m.end()))) continue;
    runs.push([start, ch, length]);
  }
  return runs;
}

/**
 * md2ui: `_run_can_open_close`. Whether the run at `pos` can open, and whether it can
 * close: CommonMark's delimiter flanking, the text's edges counting as white space.
 */
function runCanOpenClose(s: string, pos: number, ch: string, length: number): [boolean, boolean] {
  const kind = (c: string): string => (!c || isspace(c) ? "space" : !isalnum(c) ? "punct" : "");
  const before = kind(charBefore(s, pos));
  const after = kind(charAt(s, pos + length));
  const left = after !== "space" && (after !== "punct" || before !== "");
  const right = before !== "space" && (before !== "punct" || after !== "");
  if (ch !== "_") return [left, right];
  const opens = left && (!right || before === "punct");
  const closes = right && (!left || after === "punct");
  return [opens, closes];
}

/** md2ui: `_literal_runs`. Start offsets of the marker runs `line` leaves unpaired. */
function literalRuns(kit: RegexKit, line: string): Set<number> {
  const stacks = new Map<string, number[]>();
  const literal = new Set<number>();
  for (const [pos, ch, length] of markerRuns(kit, line)) {
    const [opens, closes] = runCanOpenClose(line, pos, ch, length);
    let stack = stacks.get(ch);
    if (stack === undefined) {
      stack = [];
      stacks.set(ch, stack);
    }
    if (closes && stack.length > 0) stack.pop();
    else if (opens) stack.push(pos);
    else literal.add(pos);
  }
  for (const stack of stacks.values()) for (const pos of stack) literal.add(pos);
  return literal;
}

/**
 * md2ui: `_one_marker_family`. Every `_` marker run rewritten as the `*` run of the
 * same length: styling is not structure (ADR-201), so a reader of structure must
 * not answer differently for the two spellings.
 */
export function oneMarkerFamily(kit: RegexKit, s: string): string {
  if (!s.includes("_")) return s;
  let out = s;
  for (const [pos, ch, length] of markerRuns(kit, s)) {
    if (ch === "_") out = out.slice(0, pos) + "*".repeat(length) + out.slice(pos + length);
  }
  return out;
}

/**
 * md2ui: `_balance_markdown_markers`. Repairs the markers of a piece a split cut out
 * of a line: same-character runs pair in order and the opener's length wins; a
 * leftover run is given its partner by how it flanks, or dropped as dead text at
 * an edge. A run `source` (the line, found at or after `at`) left unpaired is text.
 */
export function balanceMarkdownMarkers(kit: RegexKit, s: string, source?: string, at = 0): string {
  let runs = markerRuns(kit, s);
  const offset = source === undefined ? -1 : source.indexOf(s, at);
  if (source !== undefined && offset >= 0) {
    const literal = literalRuns(kit, source);
    runs = runs.filter(([pos]) => !literal.has(offset + pos));
  }
  if (runs.length === 0) return s;
  const byChar = new Map<string, MarkerRun[]>();
  for (const run of runs) {
    const list = byChar.get(run[1]);
    if (list === undefined) byChar.set(run[1], [run]);
    else list.push(run);
  }

  const edits: [number, number, string][] = [];
  let prepend = "";
  let append = "";
  for (const [ch, list] of byChar) {
    for (let i = 0; i + 1 < list.length; i += 2) {
      const [, , olen] = list[i] as MarkerRun;
      const [cpos, , clen] = list[i + 1] as MarkerRun;
      if (clen !== olen) edits.push([cpos, cpos + clen, ch.repeat(olen)]); // the opener wins
    }
    const last = list.at(-1);
    if (list.length % 2 === 1 && last !== undefined) {
      const [pos, , length] = last;
      const [opens, closes] = runCanOpenClose(s, pos, ch, length);
      if (closes && !opens)
        prepend = ch.repeat(length) + prepend; // a closer: open it
      else if (opens)
        append += ch.repeat(length); // an opener, or either: close it
      else if (length !== s.length && (pos === 0 || pos + length === s.length)) {
        edits.push([pos, pos + length, ""]); // dead text: drop it
      }
    }
  }
  let out = s;
  edits.sort((a, b) => b[0] - a[0] || b[1] - a[1] || (a[2] < b[2] ? 1 : a[2] > b[2] ? -1 : 0));
  for (const [start, end, rep] of edits) out = out.slice(0, start) + rep + out.slice(end);
  return edits.length > 0 ? prepend + strip(out) + append : prepend + out + append;
}

// The run of each wrap marker, for `detectStyleWrap`'s interior test, built once.
// py: re.escape(ch) + "+"
const MARKER_RUNS = Object.freeze({
  "*": compile(`${reEscape("*")}+`),
  _: compile(`${reEscape("_")}+`),
  "~": compile(`${reEscape("~")}+`),
  "`": compile(`${reEscape("`")}+`),
});

// The run pattern of a wrap marker (one of `SPLIT_WRAP_CHARS`).
function markerRun(ch: string): Pattern {
  return MARKER_RUNS[ch as keyof typeof MARKER_RUNS] ?? compile(`${reEscape(ch)}+`);
}

// md2ui: _WRAP_RUN_LENGTHS. Run lengths that can OPEN a wrap, per marker character.
function wrapRunLengths(ch: string): readonly number[] {
  if (ch === "*" || ch === "_") return [1, 2, 3];
  if (ch === "~") return [2];
  if (ch === "`") return [1];
  return [];
}

/**
 * md2ui: `_detect_style_wrap`. `[markerLen, innerStart, innerEnd]` when
 * `content[leadOffset:trailEnd]` is wrapped in ONE marker span (an interior run long
 * enough to close the opener disqualifies it), else null.
 */
export function detectStyleWrap(
  kit: RegexKit,
  content: string,
  leadOffset: number,
  trailEnd: number,
  chars = "*",
): [number, number, number] | null {
  const inner = content.slice(leadOffset, trailEnd);
  const n = inner.length;
  const ch = inner[0];
  if (ch === undefined || !chars.includes(ch)) return null;
  let lead = 0;
  while (lead < n && inner[lead] === ch) lead += 1;
  if (!wrapRunLengths(ch).includes(lead)) return null;
  let trail = 0;
  while (trail < n && inner[n - 1 - trail] === ch) trail += 1;
  if (lead !== trail || n <= 2 * lead) return null;
  const middle = inner.slice(lead, n - lead);
  // py: re.finditer(re.escape(ch) + "+", middle)
  for (const run of kit.re(markerRun(ch)).finditer(middle)) {
    if (run.text().length >= lead) return null;
  }
  return [lead, leadOffset + lead, trailEnd - lead];
}

/** An element's variant, selected by the length of the wrapper hugging it. */
export type ElementVariant =
  | "secondary"
  | "tertiary"
  | "quaternary"
  | "quinary"
  | "senary"
  | "septenary";

// md2ui: _ELEMENT_VARIANT_BY_LEN and _CHIP_UNDERSCORE_VARIANT_BY_LEN (grouper_types).
function variantByLength(length: number, chipUnderscore: boolean): ElementVariant | null {
  const ladder = chipUnderscore
    ? (["quinary", "senary", "septenary"] as const)
    : (["secondary", "tertiary", "quaternary"] as const);
  return ladder[length - 1] ?? null;
}

/**
 * md2ui: `_wrapped_element_variant`. The variant a whole-content wrapper selects when
 * it wraps exactly `expected`, else null; a chip reads `_` as its own family.
 */
export function wrappedElementVariant(
  original: string,
  expected: string,
  chip = false,
): ElementVariant | null {
  const s = strip(original);
  const want = strip(expected);
  for (const marker of ELEMENT_VARIANT_WRAPPERS) {
    const inner = stripWrap(s, marker);
    if (inner !== null && strip(inner) === want) {
      return variantByLength(marker.length, chip && marker.startsWith("_"));
    }
  }
  return null;
}

/**
 * md2ui: `_muted_element_wrap`. `original` without the `~~` that mutes an element, and
 * whether it had one. `~~` is the one muted state of every element, never a strike on
 * it, and may sit outside the variant's wrapper or inside it (`~~*⭐*~~` and `*~~⭐~~*`
 * are both a muted Secondary), as a link reads `~~*[x](/y)*~~`. What comes back keeps
 * the variant's wrapper for `wrappedElementVariant` to read.
 */
export function mutedElementWrap(original: string): [string, boolean] {
  const s = strip(original);
  const inner = stripWrap(s, "~~");
  if (inner !== null) return [inner, true];
  for (const marker of ELEMENT_VARIANT_WRAPPERS) {
    const mid = stripWrap(s, marker);
    const core = mid === null ? null : stripWrap(mid, "~~");
    if (core !== null) return [`${marker}${core}${marker}`, true];
  }
  return [s, false];
}

// md2ui: _LINK_WRAPPER_CHARS. Emphasis, its `_` synonym, and the `~~` disabled state.
const LINK_WRAPPER_CHARS = "*_~";

/** md2ui: `_link_wrapper_span`. A LINK span widened over its own (up to five) wrapper markers. */
export function linkWrapperSpan(
  content: string,
  start: number,
  end: number,
  lo: number,
  hi: number,
): Range {
  return elementWrapperSpan(content, start, end, lo, hi, LINK_WRAPPER_CHARS, 5);
}

// md2ui: _QUOTE_CHARS and _BOUNDARY_SKIP.
const QUOTE_CHARS = ['"', "'"] as const;
const BOUNDARY_SKIP = " \t*_~";

// md2ui: _element_text_span. The bounds inside every whole-content wrapper.
function elementTextSpan(kit: RegexKit, content: string): Range {
  let lo = content.length - lstrip(content).length;
  let hi = rstrip(content).length;
  for (let wrap = detectStyleWrap(kit, content, lo, hi, "*_~"); wrap !== null; ) {
    [, lo, hi] = wrap;
    wrap = detectStyleWrap(kit, content, lo, hi, "*_~");
  }
  return [lo, hi];
}

/**
 * md2ui: `_quoted_element_spans`. Every quote pair wrapping exactly one bare element
 * at a boundary of the text (only white space and markers beyond it): the author
 * declining the element reading. Outer spans, sorted.
 */
export function quotedElementSpans(kit: RegexKit, content: string): Range[] {
  if (!content.includes('"') && !content.includes("'")) return [];
  const [lo, hi] = elementTextSpan(kit, content);
  const found: Range[] = [];
  for (const quote of QUOTE_CHARS) {
    let start = -1;
    for (let i = lo; i < hi; i += 1) {
      if (content[i] !== quote) continue;
      if (start < 0) {
        if (quote === '"' || i === 0 || !isalnum(charBefore(content, i))) start = i;
        continue;
      }
      if (isLoneElement(kit, content.slice(start + 1, i))) found.push([start, i + 1]);
      start = -1;
    }
  }
  if (found.length === 0) return [];
  const sorted = sortedRanges(found);
  let scratch = content;
  for (const [start, end] of sorted) {
    scratch = scratch.slice(0, start) + " ".repeat(end - start) + scratch.slice(end);
  }
  return sorted.filter(
    ([start, end]) =>
      !strip(scratch.slice(lo, start), BOUNDARY_SKIP) ||
      !strip(scratch.slice(end, hi), BOUNDARY_SKIP),
  );
}

/**
 * md2ui: `quoted_element_edits` (Phase 6.17). The quote pair around each
 * boundary-quoted bare element, as edits that remove it, now that nothing can peel
 * the element any more.
 */
export function quotedElementEdits(kit: RegexKit, content: string): Edit[] {
  return quotedElementSpans(kit, content).flatMap(([start, end]): Edit[] => [
    [start, start + 1, ""],
    [end - 1, end, ""],
  ]);
}
