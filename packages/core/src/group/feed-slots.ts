// Feed slots: the places on a page a feed writes words into, named by the author
// (md2ui: pipeline/grouper_feed_slots.py, ADR-206).
//
// A slot is authored, never detected: `[3:53 PM](feed:arrives)` is a text slot named
// `arrives`, `` [`Preparing`](feed:status) `` a chip slot, and an `agent:` button whose
// destination carries `md2ui.feed=<name>` a label slot. A text or chip slot is drawn
// exactly as its label would be without the link: `respell` writes each one as its
// label before anything else reads the text, so every tier around it holds, and it is
// never a link and never a target. A label slot stays the button it is.
//
// After grouping, `stampFeedSlots` annotates the leaf each slot landed in (md2ui
// ADR-100) with `feed_slots`, the range of the slot's words in that node's `content`.
// Words are placed by document order, as whole words, after as many drawn copies as
// the Markdown holds between the slot before and this one. A slot that cannot be
// placed is left unannotated.
//
// md2ui's shell helpers (`feed_slots`, `with_value`, `slots_in_tree`) and the `check`
// rules are not ported: nothing here serves feeds or checks a page.

import { destinationUrl, splitMd2uiParams } from "../utils/image-params.ts";
import { extractCodeBlocks, FENCE_OPEN_RE } from "./code-blocks.ts";
import type { FeedSlotEntry, GroupNode } from "./node.ts";
import { HTML_COMMENT_RE } from "./preprocess.ts";
import { compile, type Match, type Pattern, type RegexKit, reEscape } from "./py/re.ts";
import { splitlines } from "./py/str.ts";
import { INLINE_LINK_LABEL, LINK_DESTINATION, LINK_LABEL } from "./split/link-syntax.ts";

// md2ui: FEED_SCHEME, FEED_HINT. The scheme of a text or chip slot, and the `md2ui.`
// param of a label slot.
const FEED_SCHEME = "feed:";
const FEED_HINT = "feed";

// md2ui: _SCAN_RE. One pass, left to right: an escape, a code span or a link,
// whichever starts first. A label holds no link of its own, so in a link written
// inside another's label the inner one is the link. A code span stays on its line.
// py: re.compile(
// py:     r"(?P<esc>\\.)"
// py:     r"|(?P<code>`+)(?P<code_body>[^\n]*?[^`\n])(?P=code)(?!`)"
// py:     rf"|(?<!!)\[(?P<label>(?:{_LINK_LABEL})?)\]\((?P<dest>{LINK_DESTINATION})\)"
// py: )
const SCAN_RE = compile(
  String.raw`(?P<esc>\\.)` +
    String.raw`|(?P<code>\x60+)(?P<code_body>[^\n]*?[^\x60\n])(?P=code)(?!\x60)` +
    String.raw`|(?<!!)\[(?P<label>(?:${INLINE_LINK_LABEL})?)\]\((?P<dest>${LINK_DESTINATION})\)`,
);
// md2ui: _CHIP_RE
// py: re.compile(r"`([^`]+)`")
const CHIP_RE = compile(String.raw`\x60([^\x60]+)\x60`);
// md2ui: _UNDRAWN_RE. Text a search for a slot's words must not find: where a link
// points, a picture, a code block's stand-in.
// py: re.compile(
// py:     rf"!\[(?:{LINK_LABEL})?\]\((?:{LINK_DESTINATION})\)"
// py:     rf"|(?<=\])\((?:{LINK_DESTINATION})\)"
// py:     r"|⟦md2ui-code-\d+⟧"
// py: )
const UNDRAWN_RE = compile(
  String.raw`!\[(?:${LINK_LABEL})?\]\((?:${LINK_DESTINATION})\)` +
    String.raw`|(?<=\])\((?:${LINK_DESTINATION})\)` +
    String.raw`|⟦md2ui-code-\d+⟧`,
);
// md2ui: _unescaped
// py: re.sub(r"\\(.)", r"\1", value)
const ESCAPE_RE = compile(String.raw`\\(.)`);

/** md2ui: `FeedSlot`, less `nested`, which only `check` reads. One slot, where the text spells it. */
interface FeedSlot {
  /** As written. */
  readonly name: string;
  readonly kind: FeedSlotEntry["kind"];
  /** The words: a chip's without its backticks, a label's whole. */
  readonly value: string;
  /** `text.slice(start, end) === value`. */
  readonly start: number;
  readonly end: number;
  /** The whole `[label](destination)`. */
  readonly construct: readonly [number, number];
}

/** md2ui: `Respelled`. What `respell` hands the grouper to stamp the finished tree. */
export interface Respelled {
  readonly slots: readonly FeedSlot[];
  /**
   * Per text or chip slot, in order: how many times its words appear drawn between
   * the slot before it and itself, in the respelled text.
   */
  readonly skips: readonly number[];
}

/**
 * md2ui: `_masked`. The spans of `text` grouping takes out before any slot is read:
 * HTML comments and code blocks, found by the grouper's own extraction.
 */
function masked(kit: RegexKit, text: string): [number, number][] {
  const spans = [...kit.re(HTML_COMMENT_RE).finditer(text)].map((m) => m.span());
  const [, specs] = extractCodeBlocks(kit, text);
  const cursor = new Map<boolean, number>([
    [true, 0],
    [false, 0],
  ]);
  for (const spec of specs) {
    const fenced = kit.re(FENCE_OPEN_RE).match(splitlines(spec.raw)[0] ?? "") !== null;
    const at = text.indexOf(spec.raw, cursor.get(fenced));
    if (at >= 0) {
      spans.push([at, at + spec.raw.length]);
      cursor.set(fenced, at + spec.raw.length);
    }
  }
  return spans;
}

/** md2ui: `_slot`. The slot a link match is, or null for any other link. */
function slotOf(kit: RegexKit, m: Match): FeedSlot | null {
  const [url, hints] = splitMd2uiParams(kit, destinationUrl(m.text("dest")));
  let kind: FeedSlotEntry["kind"];
  let name: string;
  if (url.slice(0, FEED_SCHEME.length).toLowerCase() === FEED_SCHEME) {
    kind = "text";
    name = url.slice(FEED_SCHEME.length);
  } else {
    const hint = hints.get(FEED_HINT);
    if (hint === undefined) return null;
    kind = "label";
    name = hint;
  }
  let [start, end] = m.span("label");
  if (kit.re(CHIP_RE).fullmatch(m.text("label")) !== null) {
    if (kind === "text") kind = "chip";
    start += 1;
    end -= 1;
  }
  const value = m.string.slice(start, end);
  return { name, kind, value, start, end, construct: m.span() };
}

/** md2ui: `_scan`. Every slot in `text` outside the `masked` spans, in document order. */
function scan(kit: RegexKit, text: string, hidden: readonly [number, number][]): FeedSlot[] {
  const out: FeedSlot[] = [];
  for (const m of kit.re(SCAN_RE).finditer(text)) {
    if (m.group("label") === undefined || hidden.some(([a, b]) => a <= m.start() && m.start() < b))
      continue;
    const slot = slotOf(kit, m);
    if (slot !== null) out.push(slot);
  }
  return out;
}

/**
 * md2ui: `_words`. `value` as whole words: never the inside of a longer word, so the
 * slot `x` is not found in `Text`. A letter or digit may not touch either end.
 */
function words(value: string): Pattern {
  // py: re.compile(rf"(?<![^\W_]){re.escape(value)}(?![^\W_])")
  return compile(String.raw`(?<![^\W_])${reEscape(value)}(?![^\W_])`);
}

/**
 * md2ui: `respell`. `text` with each text and chip slot written as its label (a chip
 * keeps its backticks), and what `stampFeedSlots` needs to find them in the tree. The
 * first thing the grouper does to the text, before code and comments are taken out.
 */
export function respell(kit: RegexKit, text: string): [string, Respelled] {
  if (!text.includes("](")) return [text, { slots: [], skips: [] }];
  const hidden = masked(kit, text);
  const slots = scan(kit, text, hidden);
  // What a count of drawn words must not see: code and comments, blanked.
  let blank = text;
  for (const [a, b] of hidden) blank = blank.slice(0, a) + " ".repeat(b - a) + blank.slice(b);
  const pieces: string[] = [];
  const skips: number[] = [];
  let last = 0;
  for (const slot of slots) {
    if (slot.kind === "label") continue;
    const [a, b] = slot.construct;
    // Only slots are respelled, so what lies between two is as written.
    const between = kit.re(UNDRAWN_RE).sub(" ", blank.slice(last, a));
    skips.push([...kit.re(words(slot.value)).finditer(between)].length);
    const chip = slot.kind === "chip" ? 1 : 0;
    pieces.push(text.slice(last, a), text.slice(slot.start - chip, slot.end + chip));
    last = b;
  }
  if (pieces.length === 0) return [text, { slots, skips }];
  return [pieces.join("") + text.slice(last), { slots, skips }];
}

/** md2ui: `_leaves`. Every node with drawn words, in document order. */
function leaves(node: GroupNode, out: GroupNode[]): GroupNode[] {
  if (node.content && node.type !== "code_block") out.push(node);
  for (const child of node.children) leaves(child, out);
  return out;
}

/** md2ui: `_find`. `[leaf, start, end]` of `value`'s next drawn occurrence from the cursor, after `skip` others. */
function find(
  kit: RegexKit,
  drawn: readonly string[],
  at: number,
  offset: number,
  value: string,
  skip: number,
): [number, number, number] | null {
  if (!value) return null;
  const re = kit.re(words(value));
  let left = skip;
  for (let i = at; i < drawn.length; i += 1) {
    const content = drawn[i] as string;
    // `finditer(content, pos)`: a match `value` (never empty) cannot be an empty one.
    for (
      let m = re.search(content, i === at ? offset : 0);
      m !== null;
      m = re.search(content, m.end())
    ) {
      if (left === 0) return [i, m.start(), m.end()];
      left -= 1;
    }
  }
  return null;
}

/** md2ui: `_annotate`. */
function annotate(node: GroupNode, slot: FeedSlot, start: number, end: number): void {
  node.feed_slots = [...node.feed_slots, { name: slot.name, kind: slot.kind, start, end }];
}

/** md2ui: `stamp` (Phase 6.246, after the sliders). Annotates the leaf each slot landed in. */
export function stampFeedSlots(kit: RegexKit, root: GroupNode, respelled: Respelled | null): void {
  if (respelled === null || respelled.slots.length === 0) return;
  const all = leaves(root, []);
  // md2ui: _drawn. Each leaf's content with what is not drawn as words blanked, offsets kept.
  const drawn = all.map((leaf) =>
    kit.re(UNDRAWN_RE).sub((m) => "\0".repeat(m.text().length), leaf.content),
  );
  let at = 0;
  let offset = 0;
  const placed = respelled.slots.filter((s) => s.kind !== "label");
  placed.forEach((slot, k) => {
    const skip = respelled.skips[k] ?? 0;
    let found = find(kit, drawn, at, offset, slot.value, skip);
    if (found === null && slot.value.includes("\\")) {
      found = find(kit, drawn, at, offset, kit.re(ESCAPE_RE).sub(String.raw`\1`, slot.value), skip);
    }
    if (found === null) return;
    const [leaf, start, end] = found;
    at = leaf;
    offset = end;
    annotate(all[leaf] as GroupNode, slot, start, end);
  });
  const labels = respelled.slots.filter((s) => s.kind === "label");
  if (labels.length === 0) return;
  for (const leaf of all) {
    for (const slot of scan(kit, leaf.content, [])) {
      if (slot.kind === "label" && labels.length > 0 && labels[0]?.name === slot.name) {
        labels.shift();
        annotate(leaf, slot, slot.start, slot.end);
      }
    }
  }
}
