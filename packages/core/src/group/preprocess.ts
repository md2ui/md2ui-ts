// The text before any tree exists (md2ui: MarkdownGrouper.preprocess and the
// construct rewriting it runs): code blocks taken out, comments and zero-width
// characters removed, inline spacers marked, escaped controls hidden, link and image
// constructs normalised (block ones planted as card sentinels), hard breaks joined
// and the early escapes resolved.
import { HEADING_PATTERN } from "./block-ast.ts";
import {
  BLOCKQUOTE_LINE_RE,
  breakNodeType,
  finishLines,
  flatLabel,
  LIST_MARKER_RE,
} from "./block-splits.ts";
import { type CodeBlockSpec, extractCodeBlocks } from "./code-blocks.ts";
import {
  type BracketConstruct,
  type CardSpec,
  isGroupLink,
  scanBracketConstructs,
} from "./constructs.ts";
import { protectEscapedTaskControls } from "./drawing-elements.ts";
import { EARLY_ESCAPES, escapesOutsideCode } from "./escapes.ts";
import { compile, type RegexKit } from "./py/re.ts";
import { dedent, strip } from "./py/str.ts";
import { protectEscapedSliders, SLIDER_RE } from "./sliders.ts";
import { markInlineSpacers } from "./spacers.ts";

/** The preprocessed text, and what it set aside: card bodies and code, by sentinel id. */
export interface Preprocessed {
  readonly text: string;
  readonly cards: CardSpec[];
  readonly code: CodeBlockSpec[];
}

// How many levels of CARDS may nest; past it a construct degrades to its label text.
// md2ui: _MAX_CARD_DEPTH
const MAX_CARD_DEPTH = 2;
// A block-content construct is swapped for this token while the document's block
// structure is built, so its own headings stay invisible to the document's.
// md2ui: _CARD_SENTINEL_FMT
const cardSentinel = (cid: number): string => `⟦md2ui-card-${cid}⟧`;
// md2ui: MarkdownGrouper.HTML_COMMENT_RE
// py: re.compile(r"<!--.*?-->", re.DOTALL)
export const HTML_COMMENT_RE = compile("<!--.*?-->", { s: true });
// CommonMark backslash escapes, less the ones resolved late (grouper_escapes).
// md2ui: MarkdownGrouper.BACKSLASH_ESCAPE_RE
// py: escapes_outside_code(EARLY_ESCAPES): a code span matches whole, to be kept
const BACKSLASH_ESCAPE_RE = escapesOutsideCode(EARLY_ESCAPES);
// md2ui: MarkdownGrouper.ZERO_WIDTH_RE
// py: re.compile("[\u200b\u200c\ufeff]")  # not U+200D, a joiner
const ZERO_WIDTH_RE = compile("[\u200b\u200c\ufeff]");
// The linked control spelling `[[X]](/url)`: a token, not a nested construct.
// py: re.fullmatch(r"\[[ xX]\]", inner)
const CONTROL_LABEL = compile(String.raw`\[[ xX]\]`);

/**
 * md2ui: `_construct_is_inline_only`. True when a link/image label holds nothing but
 * inline content; anything block-level needs a sub-document of its own.
 */
function constructIsInlineOnly(kit: RegexKit, inner: string): boolean {
  if (
    kit.re(CONTROL_LABEL).fullmatch(inner) !== null ||
    kit.re(SLIDER_RE).fullmatch(inner) !== null
  )
    return true;
  if (inner.includes("[")) return false; // a nested link or image
  // Every other block form is line-level, so a one-line label cannot be one.
  if (!inner.includes("\n")) return true;
  for (const line of inner.split("\n")) {
    const stripped = strip(line);
    if (!stripped) continue;
    if (
      kit.re(HEADING_PATTERN).match(stripped) !== null ||
      kit.re(LIST_MARKER_RE).match(stripped) !== null ||
      kit.re(BLOCKQUOTE_LINE_RE).match(line) !== null ||
      breakNodeType(kit, line) !== null ||
      stripped.includes("|")
    ) {
      return false;
    }
  }
  return true;
}

/**
 * md2ui: `preprocess` (the `_extract_cards` branch). Code taken out, comments and
 * zero-width characters removed, inline spacers marked, escaped controls hidden,
 * link/image constructs normalised, then hard breaks joined and early escapes resolved.
 */
export function preprocess(kit: RegexKit, source: string): Preprocessed {
  // Code is opaque: protect it before removing comments, which code may contain.
  const [withoutCode, code] = extractCodeBlocks(kit, source);
  const cards: CardSpec[] = [];
  let text = kit.re(HTML_COMMENT_RE).sub("", withoutCode);
  text = kit.re(ZERO_WIDTH_RE).sub("", text);
  // A spacer inside a line becomes one separator character (ADR-203).
  text = markInlineSpacers(kit, text);
  text = protectEscapedSliders(kit, protectEscapedTaskControls(kit, text));
  // Before the escape pass, so the scanner still sees "\[" as escaped.
  text = rewriteConstructs(kit, cards, text, 0, false, false);
  // Before the escape pass, which would make an escaped backslash look like a break.
  return { text: finishLines(kit, text, HEADING_PATTERN, BACKSLASH_ESCAPE_RE), cards, code };
}

/**
 * md2ui: `_rewrite_constructs`. Every link / image construct normalised: an
 * inline label spread over lines is flattened onto one, a block label (or a lone
 * link's glued lines) becomes a card sentinel, and a construct its own kind already encloses (or one past the
 * card depth) degrades to its label text, or disappears if it is an image.
 */
function rewriteConstructs(
  kit: RegexKit,
  cards: CardSpec[],
  text: string,
  depth: number,
  inLink: boolean,
  inImage: boolean,
): string {
  const constructs = scanBracketConstructs(kit, text);
  if (constructs.length === 0) return text;

  const out: string[] = [];
  let prev = 0;
  for (const c of constructs) {
    out.push(text.slice(prev, c.start));
    prev = c.end;

    const sameKind = c.is_image ? inImage : inLink;
    const block = !constructIsInlineOnly(kit, c.inner) || isGroupLink(kit, c, text);

    if ((sameKind && block) || (block && depth >= MAX_CARD_DEPTH)) {
      // Prohibited or too deep: keep a link's visible label, drop an image.
      if (!c.is_image) out.push(rewriteConstructs(kit, cards, c.inner, depth, inLink, inImage));
      continue;
    }
    if (block) {
      out.push(plantCard(kit, cards, c, depth, inLink, inImage));
      continue;
    }
    if (text.slice(c.start, c.end).includes("\n")) {
      out.push(`${c.is_image ? "!" : ""}[${flatLabel(c.inner)}](${c.url})`);
    } else {
      out.push(text.slice(c.start, c.end));
    }
  }
  out.push(text.slice(prev));
  return out.join("");
}

/**
 * md2ui: `_plant_card`. Stashes a block-content construct and returns its sentinel.
 * The body is dedented (a card inside a list item carries the item's indent) and
 * normalised like the document, with this construct's kind added to the enclosing set.
 */
function plantCard(
  kit: RegexKit,
  cards: CardSpec[],
  c: BracketConstruct,
  depth: number,
  inLink: boolean,
  inImage: boolean,
): string {
  let inner = rewriteConstructs(
    kit,
    cards,
    dedent(kit, c.inner),
    depth + 1,
    inLink || !c.is_image,
    inImage || c.is_image,
  );
  inner = finishLines(kit, inner, HEADING_PATTERN, BACKSLASH_ESCAPE_RE);
  const cid = cards.length;
  cards.push({ is_image: c.is_image, url: c.url, inner, raw: c.raw });
  return cardSentinel(cid);
}
