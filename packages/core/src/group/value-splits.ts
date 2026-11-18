// Cuts a line makes around a value (md2ui: pipeline/grouper_value_splits.py).
//
// Since md2ui's T8 a value is never cut out of its line: it stays in the leaf it was
// written in, carrying a `data_points` annotation (`_SPLIT_DP_TYPES` is empty and
// `_split_all_datapoints` always answers None, so neither is ported). What remains
// is the key-value pass: a key that labels a value.
import type { DataPointType } from "./detect/types.ts";
import { compile, type RegexKit } from "./py/re.ts";
import { lstrip, strip } from "./py/str.ts";
import { colonIsGlued, makeIsSafe, type Range, sortedRanges } from "./ranges.ts";
import { dropOrphanColumnColon, type SplitPiece } from "./separator-splits.ts";

// py: re.compile(r"^\*\*([^*:]+):([^*]*)\*\*\s*$|^__([^_:]+):([^_]*)__\s*$")
const KV_BOLD_FULL_RE = compile(
  String.raw`^\*\*([^*:]+):([^*]*)\*\*\s*$|^__([^_:]+):([^_]*)__\s*$`,
);
// py: re.compile(r"^\*\*([^*:]+):\*\*\s*(.+)$|^__([^_:]+):__\s*(.+)$", re.DOTALL)
const KV_BOLD_END_RE = compile(String.raw`^\*\*([^*:]+):\*\*\s*(.+)$|^__([^_:]+):__\s*(.+)$`, {
  s: true,
});
// py: re.compile(r"^\*\*\*([^*:]+):\*\*\*\s*(.+)$", re.DOTALL)
const KV_BOLD_ITALIC_END_RE = compile(String.raw`^\*\*\*([^*:]+):\*\*\*\s*(.+)$`, { s: true });
// py: re.compile(r"^\*([^*:]+):\*\s*(.+)$|^_([^_:]+):_\s*(.+)$", re.DOTALL)
const KV_ITALIC_RE = compile(String.raw`^\*([^*:]+):\*\s*(.+)$|^_([^_:]+):_\s*(.+)$`, { s: true });
// py: re.compile(r"^~~([^~:]+):~~\s*(.+)$", re.DOTALL)
const KV_STRIKE_END_RE = compile(String.raw`^~~([^~:]+):~~\s*(.+)$`, { s: true });

/**
 * md2ui: `_BOUNDARY_DP_TYPES`. The value types a LATER pass owns: emoji and links are
 * peeled at a line's boundary, images and drawing elements become nodes of their own.
 */
export const BOUNDARY_DP_TYPES: readonly DataPointType[] = Object.freeze([
  "emoji",
  "link",
  "image",
  "drawing_element",
]);

/**
 * md2ui: `_split_kv_styled_scan`. A styled key and its value (`**Key:** value`,
 * `*Key:* value`, `~~**Key:**~~ value`, …), markers kept, or null; a colon inside a
 * protected range, escaped or glued to what follows is no key-value colon.
 */
function splitKvStyledScan(
  kit: RegexKit,
  content: string,
  protectedRanges: readonly Range[] = [],
): SplitPiece[] | null {
  const s = strip(content);
  const offset = content.length - lstrip(content).length;
  const sortedProt = sortedRanges(protectedRanges);
  const safe = makeIsSafe(sortedProt, content);
  // Followed by a space too: `**H:25°**` is text, as `H:25°` is.
  const colonIsSafe = (colonPosInS: number): boolean =>
    safe(offset + colonPosInS) && !colonIsGlued(s, colonPosInS);
  const pair = (key: string, val: string): SplitPiece[] => [
    ["key", key],
    ["value", val],
  ];

  let m = kit.re(KV_BOLD_FULL_RE).match(s);
  if (m !== null) {
    const bold = m.group(1) !== undefined;
    const keyGrp = bold ? m.text(1) : m.text(3);
    const valRaw = strip(bold ? m.text(2) : m.text(4));
    if (valRaw && colonIsSafe(2 + keyGrp.length)) {
      const key = bold ? `**${strip(m.text(1))}**` : `__${strip(m.text(3))}__`;
      const val = bold ? `**${valRaw}**` : `__${valRaw}__`;
      if (key) return pair(key, val);
    }
  }

  m = kit.re(KV_BOLD_ITALIC_END_RE).match(s);
  if (m !== null && colonIsSafe(3 + m.text(1).length)) {
    const key = `***${strip(m.text(1))}***`;
    const val = strip(m.text(2));
    if (key && val) return pair(key, val);
  }

  m = kit.re(KV_BOLD_END_RE).match(s);
  if (m !== null) {
    const bold = m.group(1) !== undefined;
    if (colonIsSafe(2 + (bold ? m.text(1) : m.text(3)).length)) {
      const key = bold ? `**${strip(m.text(1))}**` : `__${strip(m.text(3))}__`;
      const val = strip(bold ? m.text(2) : m.text(4));
      if (key && val) return pair(key, val);
    }
  }

  m = kit.re(KV_ITALIC_RE).match(s);
  if (m !== null) {
    const star = m.group(1) !== undefined;
    if (colonIsSafe(1 + (star ? m.text(1) : m.text(3)).length)) {
      const key = star ? `*${strip(m.text(1))}*` : `_${strip(m.text(3))}_`;
      const val = strip(star ? m.text(2) : m.text(4));
      if (key && val) return pair(key, val);
    }
  }

  m = kit.re(KV_STRIKE_END_RE).match(s);
  if (m !== null && colonIsSafe(2 + m.text(1).length)) {
    const key = `~~${strip(m.text(1))}~~`;
    const val = strip(m.text(2));
    if (key && val) return pair(key, val);
  }

  // Nested wrappers, `~~**Key:**~~ value`: peel the strike, re-run, put it back.
  if (s.startsWith("~~")) {
    const close = s.indexOf("~~", 2);
    if (close > 2) {
      const whole = close + 2 === s.length;
      const innerRest = s.slice(2, close) + s.slice(close + 2);
      const shift = offset + 2;
      const nested = splitKvStyledScan(
        kit,
        innerRest,
        sortedProt.map(([a, b]) => [a - shift, b - shift] as const),
      );
      if (nested !== null && nested.length === 2) {
        const [[, k], [, v]] = nested as [SplitPiece, SplitPiece];
        return pair(`~~${k}~~`, whole ? `~~${v}~~` : v);
      }
    }
  }
  return null;
}

/**
 * md2ui: `_split_kv_styled`. `splitKvStyledScan`, with a column colon the key-value
 * cut stranded at the head of the value dropped.
 */
export function splitKvStyled(
  kit: RegexKit,
  content: string,
  protectedRanges: readonly Range[] = [],
): SplitPiece[] | null {
  const found = splitKvStyledScan(kit, content, protectedRanges);
  if (found === null || found.length !== 2) return found;
  const [[keyLabel, key], [valueLabel, value]] = found as [SplitPiece, SplitPiece];
  const kept = dropOrphanColumnColon(value);
  return kept
    ? [
        [keyLabel, key],
        [valueLabel, kept],
      ]
    : null;
}
