// The corpus texts the replay runs: every single-style text leaf md2ui measured on one
// line, with the font md2ui measured it in. The font is not guessed: a leaf is kept
// only when one recorded face and size reproduce md2ui's own one-line answer exactly,
// summed as md2ui sums it (`render_measure._line_width`). Leaves with inline markup
// need the inline-span parser and font resolution and are counted, not run.
import type { FontSpec } from "@md2ui/contracts";
import { faceSize, fontOfFace, type LeafLine, plainAdvance, type Records } from "./records.ts";

const HARD_BREAK = String.fromCodePoint(0x2028);
/** Characters that start inline markup, which splits a leaf into styled spans. */
const MARKUP = /[*_`[\]~\\<>]/u;
/** Leaf types that wrap as text; pills, chips, emoji and code are drawn whole. */
const TEXT_TYPES = Object.freeze([
  "text",
  "segment",
  "key",
  "value",
  "list_item",
  "bullet_point",
  "heading1",
  "heading2",
  "heading3",
  "heading4",
  "heading5",
  "heading6",
]);

export interface CorpusText {
  readonly doc: string;
  readonly text: string;
  readonly font: FontSpec;
  /** md2ui's one-line width, which the font reproduces exactly. */
  readonly width: number;
  readonly minWidth: number | undefined;
}

export interface Corpus {
  readonly texts: readonly CorpusText[];
  /** Why leaves were left out, with how many. */
  readonly skipped: ReadonlyMap<string, number>;
}

function segmentsOf(text: string): string[][] {
  return text.split(HARD_BREAK).map((segment) => segment.split(" ").filter((w) => w !== ""));
}

/** md2ui's `_line_width` for one style: words plus a space where written; widest segment. */
function lineWidthAt(
  records: Records,
  face: string,
  size: number,
  text: string,
): number | undefined {
  const space = plainAdvance(records, face, size, " ");
  let widest = 0;
  for (const words of segmentsOf(text)) {
    let total = 0;
    for (const [i, word] of words.entries()) {
      if (i > 0) {
        if (space === undefined) return undefined;
        total += space;
      }
      const w = plainAdvance(records, face, size, word);
      if (w === undefined) return undefined;
      total += w;
    }
    widest = Math.max(widest, total);
  }
  return widest;
}

function reconstruct(records: Records, leaf: LeafLine): CorpusText | string {
  if (!TEXT_TYPES.includes(leaf.type)) return `not wrapping text (${leaf.type})`;
  if (MARKUP.test(leaf.content)) return "inline markup (several spans)";
  const text = leaf.type.startsWith("heading")
    ? leaf.content.replace(/^#{1,6}\s+/u, "")
    : leaf.content;
  const first = segmentsOf(text).flat()[0];
  if (first === undefined) return "empty";
  for (const at of records.sizesOf.get(first) ?? []) {
    const cut = at.lastIndexOf("|");
    const face = at.slice(0, cut);
    const size = Number(at.slice(cut + 1));
    if (lineWidthAt(records, face, size, text) === leaf.width) {
      const font = fontOfFace(face, size);
      return { doc: leaf.doc, text, font, width: leaf.width, minWidth: leaf.minWidth };
    }
  }
  return "no single face reproduces md2ui's width (glyph fallback or emoji runs)";
}

export function corpusTexts(records: Records): Corpus {
  const texts: CorpusText[] = [];
  const seen = new Set<string>();
  const skipped = new Map<string, number>();
  for (const leaf of records.leaves) {
    const found = reconstruct(records, leaf);
    if (typeof found === "string") {
      skipped.set(found, (skipped.get(found) ?? 0) + 1);
      continue;
    }
    const key = `${found.doc}|${faceSize(found.font.families.join(","), found.font.size)}|${found.font.weight}|${found.text}`;
    if (!seen.has(key)) {
      seen.add(key);
      texts.push(found);
    }
  }
  return { texts, skipped };
}
