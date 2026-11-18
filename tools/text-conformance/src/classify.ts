// Every difference between Pretext and md2ui is named by its class (ADR-403), never
// absorbed by a tolerance. A difference no rule names is "unclassified", and the
// tests fail on it.
import type { TextLine } from "@md2ui/contracts";
import type { Gap } from "./replay-canvas.ts";

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const DASH = /[-‐‑‒–—]$/u;
const PUNCTUATION = /^[\p{P}\p{S}]|[\p{P}\p{S}]$/u;

const PROBE_EMOJI = "probe: Pretext's emoji calibration (😀)";
const PROBE_HYPHEN = "probe: Pretext's soft-hyphen width (-)";
/**
 * `prepare` measures every word grapheme by grapheme, for breaking a word that
 * overflows its line; these widths are read only when a word is wider than the line.
 */
const GRAPHEME = "grapheme of a word (read only when the word overflows)";

/** The gap that explains a difference, if one does: segmentation first, graphemes last. */
export function causeOf(classes: ReadonlySet<string>): string | undefined {
  const real = [...classes].filter((c) => !c.startsWith("probe:"));
  return real.find((c) => c !== GRAPHEME) ?? real[0];
}

/** Why md2ui's recordings had no answer for a `measureText` call Pretext made. */
export function classifyGap(gap: Gap, wordsOfText: readonly string[]): string {
  if (gap.face === undefined) return "font md2ui never measured with";
  if (gap.text === "\u{1F600}") return PROBE_EMOJI;
  if (gap.text === "-" && !wordsOfText.some((word) => word.includes("-"))) return PROBE_HYPHEN;
  if (CJK.test(gap.text)) return "CJK / text without spaces";
  if (gap.text.trim() === "") return "whitespace run md2ui never measured";
  const inside = wordsOfText.find((word) => word !== gap.text && word.includes(gap.text));
  if (inside !== undefined) {
    if (/[/:]/u.test(inside)) return "segment of a URL or path (md2ui keeps one word)";
    if (/[-‐‑‒–—]/u.test(inside)) return "segment of a hyphenated word (md2ui keeps one word)";
    if (/[\p{P}\p{S}]/u.test(inside)) return "segment split at punctuation (md2ui keeps one word)";
    return GRAPHEME;
  }
  return "unclassified";
}

function lineText(line: TextLine): string {
  return line.fragments
    .map((f) => f.text)
    .join(" ")
    .replace(/\s+/gu, " ")
    .trim();
}

/** The class of the first line where Pretext and md2ui's wrap disagree, or undefined. */
export function classifyDivergence(
  pretext: readonly TextLine[],
  md2ui: readonly TextLine[],
  maxWidth: number,
  /** Pretext's line-fit epsilon for the engine: 1/64 px in Safari, 0.005 px elsewhere. */
  fitEpsilon: number,
): string | undefined {
  const count = Math.max(pretext.length, md2ui.length);
  for (let i = 0; i < count; i++) {
    const p = pretext[i];
    const r = md2ui[i];
    if (p === undefined || r === undefined) return "unclassified";
    const pt = lineText(p);
    const rt = lineText(r);
    if (pt === rt) continue;
    if (CJK.test(pt) || CJK.test(rt)) return "CJK / text without spaces";
    if (rt.startsWith(pt)) {
      const rest = rt.slice(pt.length);
      if (rest.startsWith(" ")) return "unclassified";
      const word = `${pt.split(" ").at(-1) ?? ""}${rest.split(" ")[0] ?? ""}`;
      if (DASH.test(pt)) return "break after a hyphen or dash (md2ui: spaces only)";
      if (/[/:]/u.test(word)) return "break inside a URL or path (md2ui: spaces only)";
      if (r.width > maxWidth) return "overlong word (Pretext breaks inside it; md2ui overflows)";
      if (PUNCTUATION.test(pt) || PUNCTUATION.test(rest))
        return "punctuation attachment (Pretext breaks at punctuation)";
      return "unclassified";
    }
    if (pt.startsWith(rt)) {
      if (p.width > maxWidth && p.width - maxWidth <= fitEpsilon)
        return "fit epsilon (Pretext lets a line exceed the width by its engine epsilon)";
      return "unclassified";
    }
    return "unclassified";
  }
  return undefined;
}
