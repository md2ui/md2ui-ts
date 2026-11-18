// Questions asked about a node's content before anything cuts it (md2ui:
// pipeline/grouper_node_reads.py). Read-only: nothing here changes a node.
import type { Edit } from "./content-edits.ts";
import type { DataPoint } from "./detect/types.ts";
import { DEFERRED_ESCAPES, escapesOutsideCode, resolveEscape } from "./escapes.ts";
import {
  balanceMarkdownMarkers,
  detectStyleWrap,
  oneMarkerFamily,
  PASS2_SEPARATORS,
  SPLIT_WRAP_CHARS,
} from "./inline-marks.ts";
import type { GroupNode } from "./node.ts";
import type { RegexKit } from "./py/re.ts";
import { isspace, lstrip, rstrip, strip } from "./py/str.ts";
import { colonIsGlued, makeIsSafe, type Range, sortedRanges } from "./ranges.ts";
import { dropOrphanColumnColon, type SplitPiece, springPositions } from "./separator-splits.ts";
import { BOUNDARY_DP_TYPES } from "./value-splits.ts";

/**
 * md2ui: `LATE_ESCAPE_RE`. Every escape resolved late: separator, value and control;
 * a code span matches whole, to be kept.
 */
const LATE_ESCAPE_RE = escapesOutsideCode(DEFERRED_ESCAPES);

/**
 * md2ui: `late_escape_edits`. The edits that resolve `node`'s late escapes. Code is
 * literal, a block or a span alike, so it keeps every backslash.
 */
export function lateEscapeEdits(kit: RegexKit, node: GroupNode): Edit[] {
  if (node.type === "code_block" || node.type === "inline_code") return [];
  return [...kit.re(LATE_ESCAPE_RE).finditer(node.content)].flatMap((m): Edit[] => {
    const ch = m.group("ch");
    return ch === undefined ? [] : [[m.start(), m.end(), ch]];
  });
}

// md2ui: the marker tuple _extract_key_from_prefix tries, longest first.
const KEY_WRAP_MARKERS = ["***", "___", "~~", "**", "__", "*", "_"] as const;

/**
 * md2ui: `_extract_key_from_prefix`. The key when `text` is a bare key prefix
 * (`**Cover:**` -> `**Cover**`, `Key:` -> `Key`), else null; an escaped colon is kept.
 */
export function extractKeyFromPrefix(kit: RegexKit, text: string): string | null {
  const s = strip(text);
  for (const m of KEY_WRAP_MARKERS) {
    if (s.endsWith(m) && s.length > m.length) {
      const inner = s.slice(0, -m.length);
      if (inner.endsWith(":")) {
        if (inner.endsWith("\\:")) return null;
        return balanceMarkdownMarkers(kit, rstrip(inner.slice(0, -1)) + m) || null;
      }
    }
  }
  if (s.endsWith(":")) {
    if (s.endsWith("\\:")) return null;
    return balanceMarkdownMarkers(kit, rstrip(s.slice(0, -1))) || null;
  }
  return null;
}

/**
 * md2ui: `_row_separator_chars`. The separators `splitSeparators` split at, grouped
 * by the gap they sit in, in gap order (display only).
 */
export function rowSeparatorChars(content: string, sortedProtected: readonly Range[]): string[] {
  const isSafe = makeIsSafe(sortedProtected, content);
  const n = content.length;
  const strict: string[] = [];
  const at: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const ch = content[i] as string;
    if (!isSafe(i) || !PASS2_SEPARATORS.includes(ch)) continue;
    if (i > 0 && content[i - 1] === " " && i < n - 1 && content[i + 1] === " ") {
      strict.push(ch);
      at.push(i);
    }
  }
  const gaps: string[] = [];
  let pending = "";
  let seen = false;
  const bounds = [-1, ...at, n];
  for (let k = 0; k < bounds.length - 1; k += 1) {
    const piece = strip(content.slice((bounds[k] as number) + 1, bounds[k + 1]));
    if (piece && piece !== ":") {
      if (seen) gaps.push(pending);
      seen = true;
      pending = "";
    }
    if (k < strict.length && seen) pending += strict[k];
  }
  return gaps;
}

/**
 * md2ui: `_protected_ranges`. A node's non-overlapping protected ranges: its data
 * points outside every paren/quote span, then those spans.
 */
export function protectedRanges(node: GroupNode): Range[] {
  return protectedOf(
    node.data_points.map((dp) => [dp.start, dp.end] as const),
    node.paren_quote_ranges,
  );
}

/** The same rule on bare ranges: data-point spans inside a paren/quote span go. */
export function protectedOf(dpRanges: readonly Range[], pq: readonly Range[]): Range[] {
  if (pq.length === 0) return [...dpRanges];
  return [...dpRanges.filter(([s, e]) => !pq.some(([ps, pe]) => ps <= s && e <= pe)), ...pq];
}

/**
 * md2ui: `_classification_text`. The text the split criteria judge: the boundary
 * runs trimmed, late escapes resolved, a whole-content wrap dropped, and `_` markers
 * read as `*` (styling is not structure).
 */
export function classificationText(
  kit: RegexKit,
  content: string,
  dataPoints: readonly DataPoint[],
): string {
  const text = kit
    .re(LATE_ESCAPE_RE)
    .sub(resolveEscape, boundaryTrimmedText(kit, content, dataPoints));
  const stripped = strip(text);
  const wrap = detectStyleWrap(kit, stripped, 0, stripped.length, SPLIT_WRAP_CHARS);
  if (wrap !== null) {
    const inner = strip(stripped.slice(wrap[1], wrap[2]));
    if (inner) return oneMarkerFamily(kit, inner);
  }
  return oneMarkerFamily(kit, text);
}

const isBoundary = (dp: DataPoint | undefined): boolean =>
  dp !== undefined && BOUNDARY_DP_TYPES.includes(dp.type);

/**
 * md2ui: `_boundary_trimmed_text`. `content` without its leading and trailing runs
 * of boundary data points (emoji, links, …, joined by white space only), which say
 * little about the prose beside them; the whole content where trimming would
 * strand a key colon, a separator or a spring.
 */
function boundaryTrimmedText(
  kit: RegexKit,
  content: string,
  dataPoints: readonly DataPoint[],
): string {
  if (dataPoints.length === 0) return content;
  const lead = content.length - lstrip(content).length;
  const trail = rstrip(content).length;
  const style = detectStyleWrap(kit, content, lead, trail);
  const [markerLen, lo, hi] = style ?? [0, lead, trail];
  const n = dataPoints.length;
  let i = 0;
  let pos = lo;
  while (i < n && isBoundary(dataPoints[i]) && dataPoints[i]?.start === pos) {
    pos = (dataPoints[i] as DataPoint).end;
    while (pos < hi && isspace(content[pos] ?? "")) pos += 1;
    i += 1;
  }
  const newLo = i > 0 ? (dataPoints[i - 1] as DataPoint).end : lo;
  let j = n - 1;
  pos = hi;
  while (j >= i && isBoundary(dataPoints[j]) && dataPoints[j]?.end === pos) {
    pos = (dataPoints[j] as DataPoint).start;
    while (pos > newLo && isspace(content[pos - 1] ?? "")) pos -= 1;
    j -= 1;
  }
  const newHi = j < n - 1 ? (dataPoints[j + 1] as DataPoint).start : hi;
  if (newLo === lo && newHi === hi) return content;
  const inner = strip(content.slice(newLo, newHi));
  if (!inner) return content;
  // A trailing run right after a key colon is the KV value, not decoration.
  if (newHi !== hi && rstrip(rstrip(inner, "*")).endsWith(":")) return content;
  // A run behind an explicit separator is a segment, not decoration.
  const core = strip(strip(inner, "*"));
  if (
    core &&
    (PASS2_SEPARATORS.includes(core[0] ?? "") || PASS2_SEPARATORS.includes(core.at(-1) ?? ""))
  ) {
    return content;
  }
  // So is a run the author pushed away with a spring.
  const edgeSprings = springPositions(inner, []);
  const firstSpring = edgeSprings[0];
  const lastSpring = edgeSprings.at(-1);
  if (firstSpring !== undefined && (firstSpring[0] === 0 || lastSpring?.[1] === inner.length)) {
    return content;
  }
  return markerLen ? `${"*".repeat(markerLen)}${inner}${"*".repeat(markerLen)}` : inner;
}

/**
 * md2ui: `_plain_colon_kv`. `content` cut at its first safe colon TIGHT to its key
 * into KEY / VALUE (a spaced colon is a column separator), or null. The colon is
 * also followed by a space: a glued `key:value` is text like `10:30`, `H:25°` and
 * `3:1`, so `Key:value` and `Key :value` are neither.
 */
export function plainColonKv(
  kit: RegexKit,
  content: string,
  protectedRanges: readonly Range[] = [],
): SplitPiece[] | null {
  const isSafe = makeIsSafe(sortedRanges(protectedRanges), content);
  for (let i = 0; i < content.length; i += 1) {
    if (content[i] === ":" && isSafe(i) && !(i > 0 && content[i - 1] === " ")) {
      if (colonIsGlued(content, i)) break; // glued to what follows: text, not a key's colon
      const left = balanceMarkdownMarkers(kit, strip(content.slice(0, i)), content);
      const right = balanceMarkdownMarkers(
        kit,
        dropOrphanColumnColon(strip(content.slice(i + 1))),
        content,
        i + 1,
      );
      if (left && right && strip(right, "*_`")) {
        return [
          ["key", left],
          ["value", right],
        ];
      }
      break; // a safe colon with an empty side: no split
    }
  }
  return null;
}
