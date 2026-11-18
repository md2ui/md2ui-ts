// Cuts a line makes because part of it IS an element (md2ui:
// pipeline/grouper_element_splits.py): an emoji, a link or a backticked chip, all
// in ONE pass. Any regular text beside the elements makes the line prose, and then
// only a run the author separated with a separator peels.
import { INLINE_CODE_RE } from "./block-splits.ts";
import type { DataPoint } from "./detect/types.ts";
import {
  detectStyleWrap,
  type ElementVariant,
  linkWrapperSpan,
  mutedElementWrap,
  PASS2_SEPARATORS,
  quotedElementSpans,
  wrappedElementVariant,
} from "./inline-marks.ts";
import type { NodeType } from "./node.ts";
import type { RegexKit } from "./py/re.ts";
import { isspace, lstrip, rstrip, strip } from "./py/str.ts";
import { elementWrapperSpan, makeIsSafe, mergePq, type Range } from "./ranges.ts";
import { ruleApplicable } from "./split/criteria.ts";

/**
 * An element pass piece: md2ui's `(label, text, variant, muted)`. Text pieces are
 * never muted; `~~` mutes only an emoji or a chip.
 */
export type ElementPiece = readonly [NodeType, string, ElementVariant | null, boolean];

// md2ui: the marks `_split_emoji_clusters` folds into the emoji before them: the text
// and emoji selectors, the keycap mark and the joiner.
const CLUSTER_MARKS: readonly number[] = Object.freeze([0xfe0e, 0xfe0f, 0x20e3, 0x200d]);

/**
 * md2ui: `_split_emoji_clusters`. An EMOJI data point's run cut into one span per
 * visual emoji: a regional-indicator pair is one flag, a base absorbs any skin tone,
 * variation selector, keycap mark or tag after it, and a joiner takes the emoji after it
 * into the one before (man, joiner, laptop: one technologist). Spans are UTF-16 offsets.
 */
export function splitEmojiClusters(text: string): Range[] {
  const points = [...text];
  const at: number[] = [];
  let offset = 0;
  for (const p of points) {
    at.push(offset);
    offset += p.length;
  }
  at.push(offset);
  const code = (i: number): number => points[i]?.codePointAt(0) ?? 0;
  const isRegional = (cp: number): boolean => cp >= 0x1f1e6 && cp <= 0x1f1ff;
  const clusters: Range[] = [];
  const n = points.length;
  let i = 0;
  while (i < n) {
    if (isRegional(code(i)) && i + 1 < n && isRegional(code(i + 1))) {
      clusters.push([at[i] as number, at[i + 2] as number]);
      i += 2;
      continue;
    }
    const start = i;
    i += 1;
    while (
      i < n &&
      ((code(i) >= 0x1f3fb && code(i) <= 0x1f3ff) ||
        (code(i) >= 0xe0020 && code(i) <= 0xe007f) || // tags: 🏴 + tags is a region's flag
        CLUSTER_MARKS.includes(code(i)))
    ) {
      i += code(i) === 0x200d ? 2 : 1;
    }
    i = Math.min(i, n);
    clusters.push([at[start] as number, at[i] as number]);
  }
  return clusters;
}

/**
 * md2ui: `_has_regular_text`. Whether anything but white space is left once every
 * element span is cut out: the one question the ELEMENT criterion is asked.
 */
function hasRegularText(content: string, spans: readonly Range[]): boolean {
  let bare = content;
  for (const [start, end] of mergePq(spans).reverse())
    bare = bare.slice(0, start) + bare.slice(end);
  return strip(bare) !== "";
}

// md2ui: _ELEMENT_WRAPPER_CHARS
const ELEMENT_WRAPPER_CHARS = "*_";

/** One element occurrence: its piece label, outer span, content, variant and state. */
interface Hit {
  readonly label: NodeType;
  readonly start: number;
  readonly end: number;
  readonly text: string;
  readonly variant: ElementVariant | null;
  readonly muted: boolean;
}

/**
 * md2ui: `_wrapped_hit`. An emoji's or chip's outer span, its variant, and whether it is
 * muted. The span widens over the wrapper hugging the element, `~~` included, so `~~⭐~~`
 * is one muted badge rather than a strike around a glyph. A tilde the muted peel cannot
 * account for (`~⭐~`) is no wrapper: the span falls back to emphasis alone.
 */
function wrappedHit(
  content: string,
  start: number,
  end: number,
  lo: number,
  hi: number,
  expected: string,
  chip = false,
): Pick<Hit, "start" | "end" | "variant" | "muted"> {
  let span = elementWrapperSpan(content, start, end, lo, hi, "*_~", 5);
  let [peeled, muted] = mutedElementWrap(content.slice(...span));
  if (peeled.replace(strip(expected), "").includes("~")) {
    span = elementWrapperSpan(content, start, end, lo, hi, ELEMENT_WRAPPER_CHARS, 3);
    peeled = content.slice(...span);
    muted = false;
  }
  const [s, e] = span;
  return { start: s, end: e, variant: wrappedElementVariant(peeled, expected, chip), muted };
}

/**
 * md2ui: `_element_hits`. Every emoji, link and backtick span in authored order,
 * each widened over the wrapper hugging it; a hit inside another, or one the author
 * quoted, is dropped.
 */
function elementHits(
  kit: RegexKit,
  content: string,
  dataPoints: readonly DataPoint[],
  lo: number,
  hi: number,
): Hit[] {
  let hits: Hit[] = [];
  for (const dp of dataPoints) {
    if (dp.type === "link") {
      const [start, end] = linkWrapperSpan(content, dp.start, dp.end, lo, hi);
      hits.push({
        label: "link",
        start,
        end,
        text: strip(content.slice(start, end)),
        variant: null,
        muted: false,
      });
    } else if (dp.type === "emoji") {
      const glyph = strip(content.slice(dp.start, dp.end));
      hits.push({
        label: "emoji",
        text: glyph,
        ...wrappedHit(content, dp.start, dp.end, lo, hi, glyph),
      });
    }
  }
  if (content.includes("`")) {
    for (const m of kit.re(INLINE_CODE_RE).finditer(content)) {
      hits.push({
        label: "inline_code",
        text: strip(content.slice(m.start() + 1, m.end() - 1)),
        ...wrappedHit(content, m.start(), m.end(), lo, hi, m.text(), true),
      });
    }
  }
  // A quoted element is declined: it is text.
  const quoted = quotedElementSpans(kit, content);
  if (quoted.length > 0)
    hits = hits.filter((h) => !quoted.some(([s, e]) => s < h.start && h.end < e));
  hits.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Hit[] = [];
  for (const h of hits) {
    const last = out.at(-1);
    if (last !== undefined && h.start >= last.start && h.end <= last.end) continue;
    out.push(h);
  }
  return out;
}

/** md2ui: `_piece`. The split piece an element hit becomes; its muted state rides along. */
function piece(hit: Hit): ElementPiece {
  return [hit.label, hit.text, hit.variant, hit.muted];
}

/**
 * md2ui: `_split_elements`. `content` cut into its inline elements and the text
 * around them. A RUN (no regular text) emits every element as a peer; PROSE peels
 * only a boundary run the author separated with a separator facing the middle. A
 * whole-line wrap is looked through and put back on the text. Null when nothing peels.
 */
export function splitElements(
  kit: RegexKit,
  content: string,
  nodeLabel: NodeType,
  dataPoints: readonly DataPoint[],
): ElementPiece[] | null {
  const leadOffset = content.length - lstrip(content).length;
  const trailEnd = rstrip(content).length;
  const styleWrap = detectStyleWrap(kit, content, leadOffset, trailEnd, "*_");
  const [markerLen, innerLead, innerTrail] = styleWrap ?? [0, leadOffset, trailEnd];
  const markerChar = markerLen ? (content[leadOffset] ?? "*") : "*";

  const hits = elementHits(kit, content, dataPoints, innerLead, innerTrail).filter(
    (h) => h.start >= innerLead && h.end <= innerTrail,
  );
  const first = hits[0];
  if (first === undefined) return null;

  const wrapped = (text: string): string => {
    const m = markerChar.repeat(markerLen);
    return markerLen ? `${m}${text}${m}` : text;
  };

  // One element IS the whole content: relabel in place. A link keeps its style
  // wrap; an emoji or chip consumes it as its variant.
  if (hits.length === 1 && first.start === innerLead && first.end === innerTrail) {
    if (first.label === "link") return [[first.label, wrapped(first.text), null, false]];
    const variant =
      first.variant ??
      (markerLen
        ? wrappedElementVariant(
            content.slice(leadOffset, trailEnd),
            content.slice(innerLead, innerTrail),
            first.label === "inline_code",
          )
        : null);
    return [[first.label, first.text, variant, first.muted]];
  }

  const inner = content.slice(innerLead, innerTrail);
  const spans = hits.map((h): Range => [h.start - innerLead, h.end - innerLead]);
  if (ruleApplicable(hasRegularText(inner, spans)).has("ELEMENT")) {
    // A RUN: every element, plus any non-white gap between them as text.
    const result: ElementPiece[] = [];
    let cursor = innerLead;
    for (const hit of hits) {
      const gap = strip(content.slice(cursor, hit.start));
      if (gap) result.push([nodeLabel, wrapped(gap), null, false]);
      result.push(piece(hit));
      cursor = hit.end;
    }
    const tail = strip(content.slice(cursor, innerTrail));
    if (tail) result.push([nodeLabel, wrapped(tail), null, false]);
    return result.length > 1 ? result : null;
  }

  // PROSE: only an explicitly separated boundary run peels.
  const n = hits.length;
  let leading: Hit[] = [];
  let cursor = innerLead;
  let i = 0;
  while (i < n && hits[i]?.start === cursor) {
    const hit = hits[i] as Hit;
    leading.push(hit);
    cursor = hit.end;
    while (cursor < innerTrail && isspace(content[cursor] ?? "")) cursor += 1;
    i += 1;
  }
  let trailing: Hit[] = [];
  let tcursor = innerTrail;
  let j = n - 1;
  while (j >= i && hits[j]?.end === tcursor) {
    const hit = hits[j] as Hit;
    trailing.push(hit);
    tcursor = hit.start;
    while (tcursor > innerLead && isspace(content[tcursor - 1] ?? "")) tcursor -= 1;
    j -= 1;
  }
  trailing.reverse();
  if (leading.length === 0 && trailing.length === 0) return null;

  const middleOf = (): string =>
    strip(content.slice(leading.at(-1)?.end ?? innerLead, trailing[0]?.start ?? innerTrail));
  const midStart = leading.at(-1)?.end ?? innerLead;
  const raw = content.slice(midStart, trailing[0]?.start ?? innerTrail);
  let middle = strip(raw);
  // An escaped separator (`\-`) declines the division, read through the same
  // predicate every separator scan uses.
  const isSafe = makeIsSafe([], content);
  const firstSep = midStart + raw.length - lstrip(raw).length;
  const lastSep = midStart + rstrip(raw).length - 1;
  if (!middle || !PASS2_SEPARATORS.includes(middle[0] ?? "\0") || !isSafe(firstSep)) leading = [];
  if (!middle || !PASS2_SEPARATORS.includes(middle.at(-1) ?? "\0") || !isSafe(lastSep))
    trailing = [];
  if (leading.length === 0 && trailing.length === 0) return null;
  middle = middleOf();

  const result: ElementPiece[] = leading.map(piece);
  if (middle) result.push([nodeLabel, wrapped(middle), null, false]);
  for (const h of trailing) result.push(piece(h));
  return result.length > 0 ? result : null;
}
