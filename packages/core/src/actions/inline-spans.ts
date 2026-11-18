// The text and links of one inline-markup run (md2ui: pipeline/render_text.py).
//
// Targets read two things from md2ui's `parse_inline_spans`: the words each span shows
// (a link card is named by them, and a button by its label's words without their
// emphasis) and the links it leaves inside a sentence, in order.
// Sizing and the button painter also read the bold and italic flags, which pick a span's
// face, or a button label piece's. The display list reads the code and strike region
// ids, which only paint.

import { compile, type Match, type RegexKit } from "../group/py/re.ts";
import { cpLen, split, strip } from "../group/py/str.ts";
import { INLINE_LINK_LABEL, LINK_DESTINATION } from "../group/split/link-syntax.ts";

const BT = "`";

// md2ui: render_text._AUTOLINK_URI
// py: r"[A-Za-z][A-Za-z0-9+.-]*:[^\s<>]+|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+"
const AUTOLINK_URI = String.raw`[A-Za-z][A-Za-z0-9+.-]*:[^\s<>]+|[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+`;

// Every alternative of md2ui's `_INLINE_RE`, in its order: link alternatives first so a
// wrapped link is consumed whole.
// py: rf"(?P<bi_link>\*\*\*\[(?P<bi_link_t>{_LINK_LABEL})\]\((?P<bi_link_h>{LINK_DESTINATION})\))\*\*\*" |
// py:   ... (see render_text._INLINE_RE for the full alternation)
const L = INLINE_LINK_LABEL;
const D = LINK_DESTINATION;
const INLINE_RE = compile(
  [
    // An escaped star is the character, not markup (`group/escapes.ts` MARKUP_ESCAPES):
    // the one place its backslash is resolved, so measuring and painting agree.
    String.raw`(?P<esc>\\\*)`,
    String.raw`(?P<bi_link>\*\*\*\[(?P<bi_link_t>${L})\]\((?P<bi_link_h>${D})\))\*\*\*`,
    String.raw`(?P<b_link>\*\*\[(?P<b_link_t>${L})\]\((?P<b_link_h>${D})\))\*\*`,
    String.raw`(?P<i_link>\*\[(?P<i_link_t>${L})\]\((?P<i_link_h>${D})\))\*`,
    String.raw`(?P<bi_link_u>___\[(?P<bi_link_u_t>${L})\]\((?P<bi_link_u_h>${D})\))___`,
    String.raw`(?P<b_link_u>__\[(?P<b_link_u_t>${L})\]\((?P<b_link_u_h>${D})\))__`,
    String.raw`(?P<i_link_u>_\[(?P<i_link_u_t>${L})\]\((?P<i_link_u_h>${D})\))_`,
    String.raw`~~(?:\*{1,3}|_{1,3})?\[(?P<d_link_t>${L})\]\(${D}\)(?:\*{1,3}|_{1,3})?~~`,
    String.raw`\[${BT}(?P<code_link_t>${L})${BT}\]\((?P<code_link_h>${D})\)`,
    String.raw`(?<!!)\[(?P<link_t>${L})\]\((?P<link_h>${D})\)`,
    String.raw`\*\*\*<(?P<bi_auto>${AUTOLINK_URI})>\*\*\*`,
    String.raw`\*\*<(?P<b_auto>${AUTOLINK_URI})>\*\*`,
    String.raw`\*<(?P<i_auto>${AUTOLINK_URI})>\*`,
    `<(?P<auto>${AUTOLINK_URI})>`,
    // A closer is never an escaped star: `*a\*` draws `*a*`, not an italic `a`.
    String.raw`\*\*\*(?P<bi_a>.+?)(?<!\\)\*\*\*`,
    `(?<![0-9A-Za-z])___(?P<bi_u>.+?)___(?![0-9A-Za-z])`,
    String.raw`\*\*(?P<b_a>.+?)(?<!\\)\*\*`,
    `(?<![0-9A-Za-z])__(?P<b_u>.+?)__(?![0-9A-Za-z])`,
    String.raw`\*(?P<i_a>.+?)(?<!\\)\*`,
    `(?<![0-9A-Za-z])_(?P<i_u>.+?)_(?![0-9A-Za-z])`,
    `~~(?P<strike>.+?)~~`,
    `${BT}(?P<code>.+?)${BT}`,
  ].join("|"),
  { s: true },
);

// md2ui: render_text._LINK_SPAN_GROUPS — label group, destination group (null: disabled),
// and the bold and italic its wrapper carries.
const LINK_SPAN_GROUPS = [
  ["bi_link_t", "bi_link_h", true, true],
  ["b_link_t", "b_link_h", true, false],
  ["i_link_t", "i_link_h", false, true],
  ["bi_link_u_t", "bi_link_u_h", true, true],
  ["b_link_u_t", "b_link_u_h", true, false],
  ["i_link_u_t", "i_link_u_h", false, true],
  ["d_link_t", null, false, false],
  ["code_link_t", "code_link_h", false, false],
  ["link_t", "link_h", false, false],
  ["bi_auto", "bi_auto", true, true],
  ["b_auto", "b_auto", true, false],
  ["i_auto", "i_auto", false, true],
  ["auto", "auto", false, false],
] as const;

// md2ui: render_text._STYLE_SPAN_GROUPS — the groups whose inner text is parsed again,
// with the bold, italic, code and strike they add.
const STYLE_SPAN_GROUPS = [
  ["bi_a", true, true, false, false],
  ["bi_u", true, true, false, false],
  ["b_a", true, false, false, false],
  ["b_u", true, false, false, false],
  ["i_a", false, true, false, false],
  ["i_u", false, true, false, false],
  ["strike", false, false, false, true],
  ["code", false, false, true, false],
] as const;

// md2ui: render_text._MAX_SPAN_DEPTH
const MAX_SPAN_DEPTH = 6;

// md2ui: render_text._DEAD_UNDERSCORE. Stands in for an underscore no closer follows
// while `INLINE_RE` runs; never drawn. Neither a letter nor white space to the pattern,
// so a link destination keeps it.
const DEAD_UNDERSCORE = "\x7f";
// md2ui: render_text._DEAD_LIMIT. Below this many such underscores a line is parsed as
// written: each costs one scan.
const DEAD_LIMIT = 16;
// md2ui: render_text._ASCII_ALNUM, what may not follow an underscore span's closer.
const ASCII_ALNUM = /[0-9A-Za-z]/;

/**
 * md2ui: `render_text._hide_dead_underscores`. *text* with every `_` after the last one
 * that can close hidden. No underscore span opens after its last closer, yet `INLINE_RE`
 * tries each such opener to the end of the line before it fails, so a line of them was
 * quadratic. Hidden, they cost nothing, and the spans are the same. A closer is a `_` no
 * letter or digit follows, or any `_` of the run that closes a link form (`_[a](b)_`),
 * which has no such guard. A few dead openers stay as written, and so does a line
 * already holding the stand-in.
 */
function hideDeadUnderscores(text: string): string {
  let i = text.lastIndexOf("_");
  const end = i;
  while (i >= 0) {
    let start = i;
    while (start > 0 && text[start - 1] === "_") start -= 1;
    if (!ASCII_ALNUM.test(text[i + 1] ?? "") || (start > 0 && text[start - 1] === ")")) break;
    i = i === 0 ? -1 : text.lastIndexOf("_", i - 1);
  }
  const tail = text.slice(i + 1);
  if (i === end || tail.split("_").length - 1 < DEAD_LIMIT || text.includes(DEAD_UNDERSCORE)) {
    return text;
  }
  return text.slice(0, i + 1) + tail.replaceAll("_", DEAD_UNDERSCORE);
}

/**
 * One span of an inline run: the words it shows, its emphasis, and three region ids,
 * each 1-based within one top-level parse (0: none). `link` is the link's ordinal;
 * `code` and `strike` tell the next word of one marker or strike from the first word of
 * the next, so two side by side never paint as one.
 */
export interface InlineSpan {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
  readonly code: number;
  readonly strike: number;
  readonly link: number;
}

/** The counters one top-level parse shares down its recursion (md2ui's `_ids`). */
interface ParseIds {
  code: number;
  strike: number;
  readonly urls: (string | null)[];
}

/** Where a matched inline link points: null for a disabled one; an email autolink is `mailto:`. */
// md2ui: render_text._link_destination
function destinationOf(m: Match, name: string, urlName: string | null): string | null {
  if (urlName === null) return null;
  const url = m.text(urlName);
  return urlName === name && !url.includes(":") ? `mailto:${url}` : url;
}

/**
 * The spans of *written* and the destination of each link, by ordinal. A nested
 * span inherits the region its enclosing span opened (`~~**a** b~~` is one strike).
 * md2ui: `render_text.parse_inline_spans`.
 */
function parse(
  kit: RegexKit,
  written: string,
  depth: number,
  allowLinks: boolean,
  codeId: number,
  strikeId: number,
  ids: ParseIds,
): InlineSpan[] {
  let spans: InlineSpan[] = [];
  const escapes = new Set<number>();
  let last = 0;
  const text = written.includes("_") ? hideDeadUnderscores(written) : written;
  for (const m of kit.re(INLINE_RE).finditer(text)) {
    if (m.start() > last) spans.push(plain(text.slice(last, m.start())));
    if (m.group("esc") !== undefined) {
      // Inside a code span an escape is literal, as in CommonMark.
      spans.push(plain(codeId ? m.text("esc") : "*"));
      escapes.add(spans.length - 1);
      last = m.end();
      continue;
    }
    const hit = LINK_SPAN_GROUPS.find(([name]) => m.group(name) !== undefined);
    if (hit !== undefined) {
      const [name, urlName, bold, italic] = hit;
      if (allowLinks) {
        let label = m.text(name);
        if (cpLen(label) >= 3 && label.startsWith(BT) && label.endsWith(BT)) {
          label = strip(label.slice(1, -1));
        } else if (name !== "code_link_t") {
          // md2ui `_ESCAPED_STAR`: a label is drawn as written, not parsed again, so its
          // escaped stars are resolved on their own; a backtick label keeps them.
          label = label.replaceAll("\\*", "*");
        }
        ids.urls.push(destinationOf(m, name, urlName));
        spans.push({ text: label, bold, italic, code: 0, strike: 0, link: ids.urls.length });
      } else {
        spans.push(plain(m.text()));
      }
    } else {
      const style = STYLE_SPAN_GROUPS.find(([name]) => m.group(name) !== undefined);
      if (style !== undefined) {
        const [name, bold, italic, code, strike] = style;
        const inner = m.text(name);
        // A flag turning on here opens a new region, unless an enclosing one owns it.
        let c = codeId;
        let s = strikeId;
        if (code && c === 0) c = ++ids.code;
        if (strike && s === 0) s = ++ids.strike;
        if (depth >= MAX_SPAN_DEPTH) {
          spans.push({ text: inner, bold, italic, code: c, strike: s, link: 0 });
        } else {
          // This level's style merges into every span the inner text parses into.
          // A link inside a styled phrase is the sentence's inline link (md2ui
          // `parse_inline_spans`); only a code span keeps it literal.
          for (const span of parse(kit, inner, depth + 1, allowLinks && !code, c, s, ids)) {
            spans.push({
              ...span,
              bold: span.bold || bold,
              italic: span.italic || italic,
              code: span.code || c,
              strike: span.strike || s,
            });
          }
        }
      }
    }
    last = m.end();
  }
  if (last < text.length) spans.push(plain(text.slice(last)));
  if (text !== written) {
    spans = spans.map((span) => ({ ...span, text: span.text.replaceAll(DEAD_UNDERSCORE, "_") }));
    for (const [k, url] of ids.urls.entries()) {
      if (url !== null) ids.urls[k] = url.replaceAll(DEAD_UNDERSCORE, "_");
    }
  }
  return escapes.size ? joinEscapes(spans, escapes) : spans;
}

const isPlain = (s: InlineSpan): boolean => !s.bold && !s.italic && !s.code && !s.strike && !s.link;

/**
 * md2ui: `render_text._join_escapes`. `spans` with each escaped star (at an index in
 * `escapes`) joined to the plain text on either side, so `a\*b` is the one span `a*b`
 * would be, and its word is measured and wrapped whole.
 */
function joinEscapes(spans: InlineSpan[], escapes: ReadonlySet<number>): InlineSpan[] {
  const out: InlineSpan[] = [];
  for (const [i, span] of spans.entries()) {
    const prev = out.at(-1);
    if ((escapes.has(i) || escapes.has(i - 1)) && prev && isPlain(prev) && isPlain(span)) {
      out[out.length - 1] = plain(prev.text + span.text);
    } else {
      out.push(span);
    }
  }
  return out;
}

const plain = (text: string): InlineSpan => ({
  text,
  bold: false,
  italic: false,
  code: 0,
  strike: 0,
  link: 0,
});

const freshIds = (): ParseIds => ({ code: 0, strike: 0, urls: [] });

/** md2ui: `render_text.parse_inline_spans`, as the words and links of each span. */
export function parseInlineSpans(kit: RegexKit, text: string): InlineSpan[] {
  return parse(kit, text, 0, true, 0, 0, freshIds());
}

/** md2ui: `render_text.inline_link_urls`. Destination `k - 1` belongs to the spans with `link === k`. */
export function inlineLinkUrls(kit: RegexKit, text: string): (string | null)[] {
  const ids = freshIds();
  parse(kit, text, 0, true, 0, 0, ids);
  return ids.urls;
}

/** A piece of a button label: its words and the emphasis that picks its face. */
export interface LabelSpan {
  readonly text: string;
  readonly bold: boolean;
  readonly italic: boolean;
}

/**
 * md2ui: `render_text.link_label_spans`. A button label's emphasis styles it and is
 * consumed (`_x_` is italic, never a text tier); a code or strike span keeps its markers
 * as text, since a label has no chip or rule to draw them with. A Text-variant label was
 * a code span, whose markers CommonMark keeps literal.
 */
export function linkLabelSpans(
  kit: RegexKit,
  label: string,
  variant: string | undefined,
): LabelSpan[] {
  if (variant === "text" || (!label.includes("*") && !label.includes("_"))) {
    return [{ text: label, bold: false, italic: false }];
  }
  return parse(kit, label, 0, false, 0, 0, freshIds()).map(
    ({ text, bold, italic, code, strike }) => {
      const shown = code ? `${BT}${text}${BT}` : text;
      return { text: strike ? `~~${shown}~~` : shown, bold, italic };
    },
  );
}

/** md2ui: `render_text.plain_link_label`. The words a button's label shows, without its emphasis markers. */
export function plainLinkLabel(kit: RegexKit, label: string, variant: string | undefined): string {
  // An author's hard break (U+2028, white space to `split`) reads as a space, as it does
  // in a link card's words.
  return split(
    linkLabelSpans(kit, label, variant)
      .map((span) => span.text)
      .join(""),
  ).join(" ");
}
