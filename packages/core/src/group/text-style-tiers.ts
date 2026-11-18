// Authored display tiers: `_x_` muted, `__x__` lead, `___x___` display (md2ui:
// markdown_grouper._annotate_text_style_tiers and its helpers).
//
// A tier is a whole-leaf construct: the underscore wrapper is consumed and becomes
// `text_style`. It runs twice — Phase 2.16 on whole lines, recording each line it
// leaves unstamped, and Phase 6.055 on final leaves, which tiers only a wrapper the
// author wrote, not one a cut repaired.
import { IMAGE_RE, INLINE_CODE_RE } from "./block-splits.ts";
import { keepContent } from "./content-edits.ts";
import { type IdMint, inheritGlue } from "./ids.ts";
import { isLoneEmoji } from "./inline-marks.ts";
import { LINK_CONTENT_RE } from "./link-content.ts";
import { GroupNode, type NodeType } from "./node.ts";
import { compile, type RegexKit, reEscape } from "./py/re.ts";
import { isspace, lstrip, strip } from "./py/str.ts";
import { isIntraword } from "./ranges.ts";
import { handDataPoints } from "./split-apply.ts";

type Tier = NonNullable<GroupNode["text_style"]>;

/** What the two runs share: the id mint, and the lines Phase 2.16 left unstamped. */
export interface TierContext {
  readonly ids: IdMint;
  /** md2ui `_unwrapped_lines`: each unstamped line's text, by `source_line_id`. */
  readonly unwrappedLines: Map<number, string>;
}

// md2ui: _TEXT_STYLE_TIERS. Underscore run length -> tier.
function tierOf(runLength: number): Tier | null {
  if (runLength === 3) return "display";
  if (runLength === 2) return "lead";
  if (runLength === 1) return "muted";
  return null;
}

// py: re.compile(r"_+")
const UNDERSCORE_RUN = compile("_+");
// One whole emphasis span, no white space just inside its markers.
// py: re.compile(r"([*_]{1,3})(?!\s)(.+?)(?<!\s)\1(?=\s|$)")
const EMPHASIS_SPAN_RE = compile(String.raw`([*_]{1,3})(?!\s)(.+?)(?<!\s)\1(?=\s|$)`);

// md2ui: _NO_TIER_TYPES. Leaves whose own variant scheme owns a wrapper.
const NO_TIER_TYPES: readonly NodeType[] = Object.freeze([
  "link",
  "image",
  "image_card",
  "inline_code",
]);

/**
 * md2ui: `_detect_underscore_wrap`. `[tier, inner]` when the content is ENTIRELY one
 * underscore wrap; an interior run long enough to close the opener disqualifies it.
 */
function detectUnderscoreWrap(kit: RegexKit, content: string): [Tier, string] | null {
  const s = strip(content);
  const n = s.length;
  let lead = 0;
  while (lead < n && s[lead] === "_") lead += 1;
  const tier = tierOf(lead);
  if (tier === null) return null;
  let trail = 0;
  while (trail < n && s[n - 1 - trail] === "_") trail += 1;
  if (lead !== trail || n <= 2 * lead) return null;
  const middle = s.slice(lead, n - lead);
  for (const run of kit.re(UNDERSCORE_RUN).finditer(middle)) {
    if (run.text().length >= lead && !isIntraword(middle, run.start(), run.end())) return null;
  }
  const inner = strip(middle);
  return inner ? [tier, inner] : null;
}

// For these the underscores select the ELEMENT's variant, not a text tier.
function ownsItsWrapper(kit: RegexKit, inner: string): boolean {
  return (
    kit.re(LINK_CONTENT_RE).match(inner) !== null ||
    kit.re(IMAGE_RE).fullmatch(inner) !== null ||
    kit.re(INLINE_CODE_RE).fullmatch(inner) !== null ||
    isLoneEmoji(kit, inner)
  );
}

/**
 * md2ui: `_detect_underscore_span_run`. `[tier, inner]` per span when the content is
 * nothing but 2+ whole emphasis spans separated by white space. `_` spans are tiers
 * and lose their markers; `*` spans keep theirs (tier null).
 */
function detectUnderscoreSpanRun(kit: RegexKit, content: string): [Tier | null, string][] | null {
  const s = strip(content);
  let pos = 0;
  const out: [Tier | null, string][] = [];
  while (pos < s.length) {
    const m = kit.re(EMPHASIS_SPAN_RE).match(s, pos);
    if (m === null) return null; // text outside a span: not a pure run
    const marker = m.text(1);
    if (marker.startsWith("_")) {
      const tier = tierOf(marker.length);
      if (tier === null) return null;
      out.push([tier, strip(m.text(2))]);
    } else {
      out.push([null, strip(m.text())]);
    }
    pos = m.end();
    while (pos < s.length && isspace(s.slice(pos, pos + 1))) pos += 1;
  }
  if (out.length < 2) return null;
  for (const [, inner] of out) {
    // A tight colon is a key/value, which owns the line.
    if (!inner || inner.includes(":") || ownsItsWrapper(kit, inner)) return null;
  }
  return out;
}

/**
 * md2ui: `_wrap_is_authored`. Whether the source line itself wraps `inner` in
 * `runLen` underscores (a key's colon may sit inside the wrapper).
 */
function wrapIsAuthored(kit: RegexKit, line: string, runLen: number, inner: string): boolean {
  const run = "_".repeat(runLen);
  // py: rf"(?<!_){run}\s*{re.escape(inner)}\s*:?\s*{run}(?!_)"
  return kit
    .re(compile(String.raw`(?<!_)${run}\s*${reEscape(inner)}\s*:?\s*${run}(?!_)`))
    .test(line);
}

/** md2ui: `_push_tier_down`. Gives `tier` to every descendant text leaf that carries none. */
function pushTierDown(node: GroupNode, tier: Tier): void {
  for (const c of node.children) {
    if (c.children.length > 0) pushTierDown(c, tier);
    else if (
      c.text_style === null &&
      !NO_TIER_TYPES.includes(c.type) &&
      c.type !== "emoji" &&
      !c.type.startsWith("heading")
    ) {
      c.text_style = tier;
    }
  }
}

/**
 * md2ui: `_annotate_text_style_tiers`. Post-order: stamps `text_style` and consumes
 * the wrapper. `record` (Phase 2.16) keeps each line it leaves unstamped. Table
 * subtrees are skipped; their cells own their styling.
 */
export function annotateTextStyleTiers(
  kit: RegexKit,
  node: GroupNode,
  context: TierContext,
  record: boolean,
  inTable = false,
): void {
  const tableHere = inTable || node.table_group;
  for (const c of node.children) annotateTextStyleTiers(kit, c, context, record, tableHere);
  if (tableHere) return;
  if (node.children.length > 0) {
    // A tier stamped on a whole line is stranded once the line has split.
    if (node.text_style !== null) pushTierDown(node, node.text_style);
    return;
  }
  if (NO_TIER_TYPES.includes(node.type)) return;
  // A heading is a heading first: `# ___x___` keeps its markers.
  if (node.type.startsWith("heading")) return;
  const hit = detectUnderscoreWrap(kit, node.content);
  if (record && hit === null && node.source_line_id !== null) {
    context.unwrappedLines.set(node.source_line_id, node.content);
  }
  if (hit === null) {
    // Not ONE wrap, but perhaps a RUN of whole spans: one tiered leaf per span, in
    // a container that keeps the node's own kind.
    const run = detectUnderscoreSpanRun(kit, node.content);
    if (run === null) return;
    const children = run.map(([tier, inner]) => {
      const child = new GroupNode(inner, "text");
      if (tier !== null) child.text_style = tier;
      return child;
    });
    // Each piece takes the values inside it.
    handDataPoints(
      node,
      children,
      run.map(([, inner]) => inner),
    );
    inheritGlue(node, children, context.ids);
    node.children = children;
    node.content = "";
    if (node.type === "text" || node.type === "segment") node.type = "group";
    return;
  }
  const [tier, inner] = hit;
  if (ownsItsWrapper(kit, inner)) return;
  const lineId = node.source_line_id;
  const line = lineId === null ? undefined : context.unwrappedLines.get(lineId);
  const stripped = strip(node.content);
  const runLen = stripped.length - lstrip(stripped, "_").length;
  if (line !== undefined && !wrapIsAuthored(kit, line, runLen, inner)) return;
  node.text_style = tier;
  keepContent(node, inner);
}
