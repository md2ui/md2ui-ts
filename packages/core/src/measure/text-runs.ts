// A text as C3 measures it: md2ui's styled words (`_explode_words`) as `TextSpan`s, and
// the two ways md2ui measures a label or a glyph on its own (`runs_advance`,
// `glyph_advance`). md2ui draws a run of emoji characters in the emoji face first
// (`font_runs`); that choice is md2ui's, so it is made here, explicitly: an emoji run's
// font names the emoji family first and the text's family second. Anything neither
// face has falls back per glyph, which the browser does on its own (md2ui
// `render_glyph_faces`, not ported).
import type { TextMeasurer, TextSpan } from "@md2ui/contracts";
import { parseInlineSpans } from "../actions/inline-spans.ts";
import { pySum } from "../group/py/math.ts";
import type { RegexKit } from "../group/py/re.ts";
import { isspace, lstrip, rstrip, strip } from "../group/py/str.ts";
import { type EmojiKeys, emojiFontOf, type Face, fontOf, type TextFaces } from "./font-set.ts";
import { spanFace } from "./text-fonts.ts";

// md2ui `render_text._EMOJI_BY_DEFAULT`: emoji outside the ranges below, from Unicode's
// emoji-test.txt (Emoji 16.0), kept in step with `group/detect/vocabulary.ts`'s copy:
// these are emoji on their own ...
const EMOJI_BY_DEFAULT: readonly number[] = Object.freeze([
  0x1f004, 0x1f0cf, 0x1f18e, 0x1f191, 0x1f192, 0x1f193, 0x1f194, 0x1f195, 0x1f196, 0x1f197, 0x1f198,
  0x1f199, 0x1f19a, 0x1f201, 0x1f21a, 0x1f22f, 0x1f232, 0x1f233, 0x1f234, 0x1f235, 0x1f236, 0x1f238,
  0x1f239, 0x1f23a, 0x1f250, 0x1f251,
]);
// md2ui `render_text._EMOJI_WITH_SELECTOR`: ... and these only with U+FE0F after them:
// bare, they are text (`© 2026`, `™`).
const EMOJI_WITH_SELECTOR: readonly number[] = Object.freeze([
  0x00a9, 0x00ae, 0x203c, 0x2049, 0x2122, 0x2139, 0x24c2, 0x2934, 0x2935, 0x3030, 0x303d, 0x3297,
  0x3299, 0x1f170, 0x1f171, 0x1f17e, 0x1f17f, 0x1f202, 0x1f237,
]);

/** md2ui `render_text._is_emoji_char`. */
function isEmojiChar(cp: number): boolean {
  return (
    EMOJI_BY_DEFAULT.includes(cp) ||
    (cp >= 0xe0020 && cp <= 0xe007f) || // tags: England, Scotland and Wales are 🏴 + tags
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x2190 && cp <= 0x21ff) ||
    (cp >= 0x231a && cp <= 0x231b) ||
    cp === 0x2328 ||
    cp === 0x23cf ||
    (cp >= 0x23e9 && cp <= 0x23f3) ||
    (cp >= 0x23f8 && cp <= 0x23fa) ||
    (cp >= 0x2580 && cp <= 0x25ff) ||
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x2b00 && cp <= 0x2bff) ||
    (cp >= 0x1f1e0 && cp <= 0x1f1ff) ||
    cp === 0x200d ||
    (cp >= 0xfe00 && cp <= 0xfe0f)
  );
}

// md2ui `render_text._KEYCAP_RE`: a keycap (1️⃣) is a digit, `#` or `*` its font draws as
// one emoji, so the whole sequence belongs to the emoji run, though the digit alone is text.
const KEYCAP = String.raw`[0-9#*]\uFE0F?\u20E3`;

/** md2ui `render_text._split_emoji_runs`: `[text, isEmoji]` runs, in order. */
export function emojiRuns(text: string): [string, boolean][] {
  const keycap = new Set<number>();
  for (const m of text.matchAll(new RegExp(KEYCAP, "gu"))) {
    for (let at = m.index; at < m.index + m[0].length; at++) keycap.add(at);
  }
  const runs: [string, boolean][] = [];
  const chars = [...text];
  let at = 0;
  for (const [i, ch] of chars.entries()) {
    const cp = ch.codePointAt(0) ?? 0;
    const selected = EMOJI_WITH_SELECTOR.includes(cp) && chars[i + 1] === "\uFE0F";
    const emoji = keycap.has(at) || selected || isEmojiChar(cp);
    at += ch.length;
    const last = runs[runs.length - 1];
    if (last !== undefined && last[1] === emoji) last[0] += ch;
    else runs.push([ch, emoji]);
  }
  return runs;
}

/** Where a label's leading emoji end, its words start and end, and its trailing emoji start. */
export interface EmojiEnds {
  readonly lead: number;
  readonly start: number;
  readonly end: number;
  readonly trail: number;
}

/**
 * md2ui `render_text_scopes._emoji_ends`: the emoji at either end of `text`, which may be
 * several, apart or not, and the words between them, as UTF-16 offsets. `null` when no
 * emoji sits at either end, or no words beside them.
 */
export function emojiEnds(text: string): EmojiEnds | null {
  const slots = emojiRuns(text);
  const offsets: number[] = [];
  let at = 0;
  for (const [run] of slots) {
    offsets.push(at);
    at += run.length;
  }
  const edge = ([run, isEmoji]: [string, boolean]): boolean => isEmoji || isspace(run);
  let lead = 0;
  for (let i = 0; i < slots.length && edge(slots[i] as [string, boolean]); i++) {
    const [run, isEmoji] = slots[i] as [string, boolean];
    if (isEmoji) lead = (offsets[i] as number) + run.length;
  }
  let trail = text.length;
  for (let i = slots.length - 1; i >= 0 && edge(slots[i] as [string, boolean]); i--) {
    if ((slots[i] as [string, boolean])[1]) trail = offsets[i] as number;
  }
  const words = text.slice(lead, trail);
  if (strip(words) === "" || (lead === 0 && trail === text.length)) return null;
  return {
    lead,
    start: lead + words.length - lstrip(words).length,
    end: trail - (words.length - rstrip(words).length),
    trail,
  };
}

/** A run of text in one font, and whether it is an emoji run. */
export interface FaceRun {
  readonly span: TextSpan;
  readonly emoji: boolean;
}

/**
 * `text` cut into runs by face: emoji runs in the emoji family first (md2ui `font_runs`),
 * as the element's emoji keys set them (`emojiFontOf`).
 */
export function faceRuns(
  text: string,
  face: Face,
  emoji: string,
  size: number,
  emojiKeys: EmojiKeys | null = null,
  icon = false,
): FaceRun[] {
  // An icon button's mark is one emoji run, whatever its characters (`LabelRun.icon`).
  const runs: [string, boolean][] = icon ? [[text, true]] : emojiRuns(text);
  return runs.map(([run, isEmoji]) => ({
    span: {
      text: run,
      font: isEmoji ? emojiFontOf(emoji, face, size, emojiKeys) : fontOf(face, size),
    },
    emoji: isEmoji,
  }));
}

/** A C3 span with the region ids of the inline span it came from (each 0: none). */
export interface FlaggedSpan extends FaceRun {
  readonly link: number;
  readonly code: number;
  readonly strike: number;
}

/**
 * A leaf's content as C3 spans: md2ui's inline spans (`parse_inline_spans`), each in
 * the face its bold and italic pick (`_span_font`), cut into emoji and text runs. Each
 * span carries the link, code and strike regions it came from, so a line's fragments
 * can be traced back to them.
 */
export function flaggedTextSpans(
  kit: RegexKit,
  content: string,
  faces: TextFaces,
  size: number,
  emoji: string,
): FlaggedSpan[] {
  return parseInlineSpans(kit, content).flatMap(({ text, bold, italic, link, code, strike }) =>
    faceRuns(text, spanFace(faces, bold, italic), emoji, size).map((run) => ({
      ...run,
      link,
      code,
      strike,
    })),
  );
}

/** A leaf's content as C3 spans (`flaggedTextSpans` without the regions). */
export function textSpans(
  kit: RegexKit,
  content: string,
  faces: TextFaces,
  size: number,
  emoji: string,
): TextSpan[] {
  return flaggedTextSpans(kit, content, faces, size, emoji).map((s) => s.span);
}

/**
 * md2ui `runs_advance`: a label measured run by run, emoji runs in the emoji family (at
 * the element's emoji keys).
 */
export function runsAdvance(
  text: TextMeasurer,
  label: string,
  face: Face,
  emoji: string,
  size: number,
  emojiKeys: EmojiKeys | null = null,
  icon = false,
): number {
  if (label === "") return 0;
  return pySum(
    faceRuns(label, face, emoji, size, emojiKeys, icon).map(({ span }) =>
      text.advance(span.text, span.font),
    ),
  );
}
