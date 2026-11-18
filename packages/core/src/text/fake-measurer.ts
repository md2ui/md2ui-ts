// A deterministic text measurer for Node tests (C3). It has no font and no DOM: a glyph's
// advance depends only on its class, so every test answer can be worked out by hand.
// Its wrap is md2ui's own, so conformance also uses it as md2ui's reference, fed with
// md2ui's recorded advances instead of the classes below.
//
// Advance per code point, as a fraction of the font size: a space is a quarter, an
// emoji (Extended_Pictographic) is a whole, anything else is a half; weight 600 and up
// widens it by a tenth, italic changes nothing. Wrapping reproduces md2ui's greedy
// unit wrap: a unit is a run of words with no written space or hard break between
// them, a line takes the next unit while it still fits, and a unit that starts after a
// hard break always starts a line.
import type {
  FontMetrics,
  FontSpec,
  InkBounds,
  LineFragment,
  PreparedText,
  TextLine,
  TextMeasurer,
  TextSpan,
} from "@md2ui/contracts";

const HARD_BREAK = "\u2028";
const PICTOGRAPH = /\p{Extended_Pictographic}/u;

type Before = "none" | "space" | "break";

interface Word {
  readonly span: number;
  readonly text: string;
  readonly width: number;
  readonly before: Before;
}

interface Unit {
  readonly words: readonly Word[];
  readonly width: number;
  /** The space written before the unit, in the font of its first word. */
  readonly space: number;
}

function classAdvance(text: string, font: FontSpec): number {
  let total = 0;
  for (const ch of Array.from(text)) {
    const unit = ch === " " ? 0.25 : PICTOGRAPH.test(ch) ? 1 : 0.5;
    total += unit * font.size * (font.weight >= 600 ? 1.1 : 1);
  }
  return total;
}

type Advance = (text: string, font: FontSpec) => number;

/** Words as md2ui's `_exploded` finds them; a hard break outranks a space. */
function explode(spans: readonly TextSpan[], advance: Advance): Word[] {
  const words: Word[] = [];
  let before: Before = "none";
  spans.forEach((span, index) => {
    span.text.split(HARD_BREAK).forEach((chunk, j) => {
      if (j > 0) before = "break";
      chunk.split(" ").forEach((part, i) => {
        if (i > 0 && before !== "break") before = "space";
        if (part === "") return;
        words.push({ span: index, text: part, width: advance(part, span.font), before });
        before = "none";
      });
    });
  });
  return words;
}

function toUnits(words: readonly Word[], spans: readonly TextSpan[], advance: Advance): Unit[] {
  const groups: Word[][] = [];
  for (const word of words) {
    const last = groups[groups.length - 1];
    if (last !== undefined && word.before === "none") last.push(word);
    else groups.push([word]);
  }
  return groups.map((group) => {
    const head = group[0] as Word;
    const font = (spans[head.span] as TextSpan).font;
    return {
      words: group,
      width: group.reduce((sum, w) => sum + w.width, 0),
      space: advance(" ", font),
    };
  });
}

function buildLine(units: readonly Unit[], width: number): TextLine {
  const fragments: LineFragment[] = [];
  let x = 0;
  let open: { span: number; text: string; x: number } | undefined;
  const close = (): void => {
    if (open !== undefined) fragments.push({ ...open, width: x - open.x });
    open = undefined;
  };
  units.forEach((unit, u) => {
    unit.words.forEach((word, w) => {
      const spaced = w === 0 && u > 0;
      if (open !== undefined && open.span === word.span) {
        open.text += (spaced ? " " : "") + word.text;
      } else {
        close();
        open = { span: word.span, text: word.text, x: x + (spaced ? unit.space : 0) };
      }
      x += (spaced ? unit.space : 0) + word.width;
    });
  });
  close();
  return { width, fragments };
}

function wrap(units: readonly Unit[], maxWidth: number): TextLine[] {
  const lines: TextLine[] = [];
  let current: Unit[] = [];
  let currentWidth = 0;
  const flush = (): void => {
    if (current.length > 0) lines.push(buildLine(current, currentWidth));
  };
  for (const unit of units) {
    const head = unit.words[0] as Word;
    const total = currentWidth + unit.space + unit.width;
    if (current.length > 0 && (head.before === "break" || total > maxWidth)) {
      flush();
      current = [unit];
      currentWidth = unit.width;
    } else {
      currentWidth = current.length > 0 ? total : unit.width;
      current.push(unit);
    }
  }
  flush();
  return lines;
}

function prepare(spans: readonly TextSpan[], advance: Advance): PreparedText {
  const units = toUnits(explode(spans, advance), spans, advance);
  const lines = (maxWidth: number): readonly TextLine[] => wrap(units, maxWidth);
  return {
    lineWidth: () => Math.max(0, ...lines(Number.POSITIVE_INFINITY).map((l) => l.width)),
    minWidth: () => Math.max(0, ...units.map((u) => u.width)),
    lineCount: (maxWidth) => lines(maxWidth).length,
    lines,
  };
}

function fontMetrics(font: FontSpec): FontMetrics {
  return { ascent: 0.8 * font.size, descent: 0.2 * font.size };
}

/** A text's ink: 0.7 of the size above the baseline, from its pen origin across its advance. */
function inkBounds(text: string, font: FontSpec, advance: Advance): InkBounds {
  if (Array.from(text).every((ch) => ch === " ")) {
    const { ascent } = fontMetrics(font);
    return { top: ascent, height: ascent, left: 0, width: 0 };
  }
  return { top: 0.7 * font.size, height: 0.7 * font.size, left: 0, width: advance(text, font) };
}

/** `advance` replaces the per-class widths; every other answer stays the fake's. */
export function createFakeMeasurer(advance: Advance = classAdvance): TextMeasurer {
  return {
    prepare: (spans) => prepare(spans, advance),
    advance,
    fontMetrics,
    inkBounds: (text, font) => inkBounds(text, font, advance),
  };
}
