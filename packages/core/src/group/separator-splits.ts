// Cuts a line makes at a separator the author typed (md2ui:
// pipeline/grouper_separator_splits.py).
//
// Within one block, `|` and `-` divide a line into pieces, a spaced `:`
// stacks them, and the `...` spring pushes them apart. This module only knows where
// a line divides; what a piece IS is decided afterwards and elsewhere.
import { breakNodeType } from "./block-splits.ts";
import {
  balanceMarkdownMarkers,
  detectStyleWrap,
  ELEMENT_VARIANT_WRAPPERS,
  isLoneElement,
  PASS2_SEPARATORS,
  reapplyLineWrap,
  SPLIT_WRAP_CHARS,
} from "./inline-marks.ts";
import type { NodeType } from "./node.ts";
import type { RegexKit } from "./py/re.ts";
import { lstrip, rstrip, strip } from "./py/str.ts";
import { makeIsSafe, type Range } from "./ranges.ts";

/** A separator split's piece: md2ui's `(label, text)`. */
export type SplitPiece = readonly [NodeType, string];

/** Whether `ch` is one of `seps` (a whole character, never the empty string). */
function isOneOf(ch: string | undefined, seps: string): boolean {
  return ch !== undefined && ch !== "" && seps.includes(ch);
}

/**
 * md2ui: `_spring_positions`. `[start, end)` of every `...` spring: exactly three
 * dots, a space or the edge on each side, outside every protected range.
 */
export function springPositions(content: string, sortedProtected: readonly Range[]): Range[] {
  const isSafe = makeIsSafe(sortedProtected, content);
  const n = content.length;
  const out: Range[] = [];
  let i = content.indexOf("...");
  while (i !== -1) {
    const end = i + 3;
    if (
      isSafe(i) &&
      !(i > 0 && content[i - 1] === ".") &&
      !(end < n && content[end] === ".") &&
      (i === 0 || content[i - 1] === " ") &&
      (end === n || content[end] === " ")
    ) {
      out.push([i, end]);
      i = content.indexOf("...", end);
    } else {
      i = content.indexOf("...", i + 1);
    }
  }
  return out;
}

/** A spring region's alignment, by its position among the regions. */
export type RegionAlign = "left" | "center" | "right";

/**
 * md2ui: `_split_align_regions`. `content` cut at its springs into `[text, align]`
 * regions: first left, last right, the rest centred. An empty region keeps its slot
 * but is no piece. Null when there is no spring or nothing but springs.
 */
export function splitAlignRegions(
  kit: RegexKit,
  content: string,
  sortedProtected: readonly Range[],
): [string, RegionAlign][] | null {
  const springs = springPositions(content, sortedProtected);
  if (springs.length === 0) return null;
  const bounds = [0, ...springs.map(([, e]) => e)];
  const ends = [...springs.map(([s]) => s), content.length];
  const n = bounds.length;
  const out: [string, RegionAlign][] = [];
  bounds.forEach((a, i) => {
    const text = strip(content.slice(a, ends[i]));
    if (!text) return;
    const align: RegionAlign = i === 0 ? "left" : i === n - 1 ? "right" : "center";
    out.push([balanceMarkdownMarkers(kit, text, content, a), align]);
  });
  return out.length > 0 ? out : null;
}

/**
 * md2ui: `_split_separators`. `content` cut at its safe separators, a pipe or a hyphen
 * (or an inline spacer) with a space on each side, into SEGMENTs. Null below two.
 */
export function splitSeparators(
  kit: RegexKit,
  content: string,
  sortedProtected: readonly Range[],
): SplitPiece[] | null {
  const isSafe = makeIsSafe(sortedProtected, content);
  const n = content.length;
  const splitPositions: number[] = [];
  for (let i = 1; i < n - 1; i += 1) {
    if (
      isOneOf(content[i], PASS2_SEPARATORS) &&
      isSafe(i) &&
      content[i - 1] === " " &&
      content[i + 1] === " "
    ) {
      splitPositions.push(i);
    }
  }
  return emitSplitSegments(kit, content, splitPositions);
}

/**
 * md2ui: `_drop_orphan_column_colon`. `piece` without a leading COLUMN colon whose
 * left cell something else consumed.
 */
export function dropOrphanColumnColon(piece: string): string {
  const s = lstrip(piece);
  if (s === ":") return "";
  if (s.startsWith(": ")) return lstrip(s.slice(1));
  return piece;
}

/**
 * md2ui: `_emit_split_segments`. `content` cut at `splitPositions` into SEGMENTs,
 * each slice's markers balanced and a whole-line wrap carried onto every piece.
 */
function emitSplitSegments(
  kit: RegexKit,
  content: string,
  splitPositions: readonly number[],
): SplitPiece[] | null {
  if (splitPositions.length === 0) return null;
  const wrapLead = content.length - lstrip(content).length;
  const styleWrap = detectStyleWrap(
    kit,
    content,
    wrapLead,
    rstrip(content).length,
    SPLIT_WRAP_CHARS,
  );
  const wrapMarker = styleWrap === null ? null : (content[wrapLead] ?? "").repeat(styleWrap[0]);

  // Balance a slice's markers, but never CLOSE one around a lone element: that
  // wrapper belongs to the line.
  const segment = (raw0: string, prev: number): string => {
    const raw = dropOrphanColumnColon(strip(raw0));
    const balanced = balanceMarkdownMarkers(kit, raw, content, prev);
    if (balanced === raw) return balanced;
    for (const marker of ELEMENT_VARIANT_WRAPPERS) {
      if (
        balanced.startsWith(marker) &&
        balanced.endsWith(marker) &&
        balanced.length > 2 * marker.length
      ) {
        const core = balanced.slice(marker.length, -marker.length);
        if (isLoneElement(kit, core)) return strip(core);
        break;
      }
    }
    return balanced;
  };

  let parts: SplitPiece[] = [];
  let prev = 0;
  for (const pos of splitPositions) {
    const seg = segment(content.slice(prev, pos), prev);
    if (seg) parts.push(["segment", seg]);
    prev = pos + 1;
  }
  const last = segment(content.slice(prev), prev);
  if (last) parts.push(["segment", last]);

  if (wrapMarker)
    parts = parts.map(([label, seg]) => [label, reapplyLineWrap(kit, wrapMarker, seg)]);
  return parts.length >= 2 ? parts : null;
}

/**
 * md2ui: `_split_colon_columns`. `content` cut at its spaced colons into STACKED
 * pieces; a piece that is a break spelling becomes that break (except `***` and
 * `;;;`, Phase 1 instructions long consumed). Null below two pieces.
 */
export function splitColonColumns(
  kit: RegexKit,
  content: string,
  sortedProtected: readonly Range[],
): SplitPiece[] | null {
  const isSafe = makeIsSafe(sortedProtected, content);
  const n = content.length;
  const positions: number[] = [];
  for (let i = 1; i < n - 1; i += 1) {
    if (content[i] === ":" && isSafe(i) && content[i - 1] === " " && content[i + 1] === " ") {
      positions.push(i);
    }
  }
  if (positions.length === 0) return null;

  const parts: SplitPiece[] = [];
  let prev = 0;
  for (const pos of [...positions, n]) {
    const start = prev;
    prev = pos + 1;
    const raw = dropOrphanColumnColon(strip(content.slice(start, pos)));
    const kind = raw ? breakNodeType(kit, raw) : null;
    if (kind !== null && kind !== "section_stop" && kind !== "row_closer") {
      parts.push([kind, raw]);
      continue;
    }
    const piece = balanceMarkdownMarkers(kit, raw, content, start);
    if (piece) parts.push(["segment", piece]);
  }
  return parts.length >= 2 ? parts : null;
}
