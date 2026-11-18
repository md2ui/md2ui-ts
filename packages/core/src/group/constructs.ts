// Link and image constructs located in raw Markdown, possibly spanning lines (md2ui:
// markdown_grouper._scan_bracket_constructs, grouper_types._BracketConstruct /
// _CardSpec).
import { LIST_MARKER_RE } from "./block-splits.ts";
import { compile, type RegexKit } from "./py/re.ts";
import { lstrip, strip } from "./py/str.ts";
import { LINK_DESTINATION } from "./split/link-syntax.ts";

/** md2ui: `_BracketConstruct`. A `[label](url)` / `![alt](url)` span; indices are UTF-16. */
export interface BracketConstruct {
  /** Index of the opening `[` (or of `!` for an image). */
  readonly start: number;
  /** Index just past the closing `)`. */
  readonly end: number;
  readonly is_image: boolean;
  /** Raw text between the brackets. */
  readonly inner: string;
  /** Raw text between the parens. */
  readonly url: string;
  /** The whole construct, verbatim. */
  readonly raw: string;
}

// md2ui: _ROW_LABEL_RE, a one-line link label that lays itself out: a spaced ` ... ` spring
// between two words. py: re.compile(r"\S \.\.\. \S")
const ROW_LABEL_RE = compile(String.raw`\S \.\.\. \S`);
// md2ui: _ESCAPED_MARK_RE. An escaped mark is text, as on any line. py: re.compile(r"\\.")
const ESCAPED_MARK_RE = compile(String.raw`\\.`);

/**
 * md2ui: `_BracketConstruct.is_group_link`. A link alone on its lines, or a list
 * item's whole content, whose label holds two glued lines, or one line that lays itself
 * out: a card of those lines, not a pill. A one-line label without layout stays a pill,
 * an image's alt is metadata, and a link wrapped inside a sentence is prose.
 *
 * A one-line label lays itself out when it holds a spaced ` ... ` spring: a pill is only
 * as wide as its words, so a spring can only mean a row. A ` - ` alone never makes a row:
 * names carry one (`[Amazon - Echo Show 11](…)`).
 */
export function isGroupLink(kit: RegexKit, c: BracketConstruct, text: string): boolean {
  if (c.is_image) return false;
  let before = lstrip(text.slice(text.lastIndexOf("\n", c.start - 1) + 1, c.start));
  const marker = kit.re(LIST_MARKER_RE).match(before);
  if (marker !== null) before = before.slice(marker.end()); // an item's content is a line of its own
  const after = text.slice(c.end).split("\n", 1)[0] ?? "";
  const lines = c.inner.split("\n").map((line) => strip(line));
  const glued = lines.some((line, i) => i > 0 && line !== "" && lines[i - 1] !== "");
  const row =
    lines.filter((line) => line !== "").length === 1 &&
    kit.re(ROW_LABEL_RE).test(kit.re(ESCAPED_MARK_RE).sub("", c.inner));
  return (glued || row) && !strip(before) && !strip(after);
}

/** md2ui: `_CardSpec`. A block-content construct pulled out of the source. */
export interface CardSpec {
  readonly is_image: boolean;
  readonly url: string;
  /** The body Markdown, already normalised. */
  readonly inner: string;
  /** The original construct, for the restore fallback. */
  readonly raw: string;
}

// A candidate that runs past either bound is abandoned, so a stray `[` cannot scan to
// the end of the document.
// md2ui: _MAX_CONSTRUCT_LINES, _MAX_CONSTRUCT_CHARS
const MAX_CONSTRUCT_LINES = 40;
const MAX_CONSTRUCT_CHARS = 4000;

// md2ui: LINK_DESTINATION_RE (grouper_types)
// py: re.compile(LINK_DESTINATION)
const LINK_DESTINATION_RE = compile(LINK_DESTINATION);

// The UTF-16 index `count` code points after `from`, capped at the end of `text`:
// md2ui's bound is in characters.
function advance(text: string, from: number, count: number): number {
  let i = from;
  for (let n = 0; n < count && i < text.length; n += 1) {
    i += (text.codePointAt(i) ?? 0) > 0xffff ? 2 : 1;
  }
  return Math.min(i, text.length);
}

/**
 * md2ui: `_scan_bracket_constructs`. Every TOP-LEVEL link / image construct in
 * `text`. A balanced scanner, since a label may hold brackets of its own; escaped
 * characters are skipped, and the destination must be a link's.
 */
export function scanBracketConstructs(kit: RegexKit, text: string): BracketConstruct[] {
  const out: BracketConstruct[] = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const ch = text[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    const isImage = ch === "!" && i + 1 < n && text[i + 1] === "[";
    if (!isImage && ch !== "[") {
      i += 1;
      continue;
    }

    const open = i;
    const bracket = isImage ? i + 1 : i;
    // The bound is in code points, each one or two UTF-16 units, so it lies at or past
    // the same count of units: walks test against that, and count the code points only
    // if one gets there (a long text holds many brackets, and few constructs that long).
    let limit = Math.min(n, open + MAX_CONSTRUCT_CHARS);
    let counted = limit === n;
    const within = (x: number): boolean => {
      if (x < limit) return true;
      if (counted) return false;
      limit = advance(text, open, MAX_CONSTRUCT_CHARS);
      counted = true;
      return x < limit;
    };

    // Walk the label, counting nested brackets.
    let j = bracket + 1;
    let depth = 1;
    let lines = 0;
    while (within(j)) {
      const c = text[j];
      if (c === "\\") {
        j += 2;
        continue;
      }
      if (c === "\n") {
        lines += 1;
        if (lines > MAX_CONSTRUCT_LINES) break;
      } else if (c === "[") {
        depth += 1;
      } else if (c === "]") {
        depth -= 1;
        if (depth === 0) break;
      }
      j += 1;
    }
    // "](" must be adjacent: a lone "[...]" is not a construct.
    if (depth !== 0 || j + 1 >= n || text[j] !== "]" || text[j + 1] !== "(") {
      i += 1;
      continue;
    }

    // Walk the URL, counting nested parens. A URL never spans lines.
    let k = j + 2;
    let pdepth = 1;
    while (within(k)) {
      const c = text[k];
      if (c === "\\") {
        k += 2;
        continue;
      }
      if (c === "\n") break;
      if (c === "(") {
        pdepth += 1;
      } else if (c === ")") {
        pdepth -= 1;
        if (pdepth === 0) break;
      }
      k += 1;
    }
    // py: kit.re(LINK_DESTINATION_RE).fullmatch(text, j + 2, k) — the pattern has no anchors
    // or lookarounds, so matching the slice is the same question.
    if (
      pdepth !== 0 ||
      k >= n ||
      kit.re(LINK_DESTINATION_RE).fullmatch(text.slice(j + 2, k)) === null
    ) {
      i += 1;
      continue;
    }

    out.push({
      start: open,
      end: k + 1,
      is_image: isImage,
      inner: text.slice(bracket + 1, j),
      url: text.slice(j + 2, k),
      raw: text.slice(open, k + 1),
    });
    i = k + 1;
  }
  return out;
}
