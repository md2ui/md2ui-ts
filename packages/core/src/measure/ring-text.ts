// The text inside a ring (md2ui `render_ring_text`): which lines, at what size, in what
// box. A ring holds two baked leaves, its value over its unit label. The value scales down
// to fit the clear inside on one line. The label wraps onto up to two
// lines that each fit the circle's clear inside at that line's height, shrinks when two do
// not fit but never below `RING_UNIT_MIN_SCALE` of its `Ring Unit` size, and ends in an
// ellipsis when it still does not fit. Nothing is dropped silently, and nothing runs over
// the stroke.
//
// The leaf's measured box and its paint both read `ringText` (md2ui ADR-400): the label's
// lines are decided once, here, and the painter draws them as written.
import type { Argb, FontSpec, ResolvedTheme, TextMeasurer } from "@md2ui/contracts";
import { HARD_BREAK } from "../group/escapes.ts";
import { rstrip, split } from "../group/py/str.ts";
import { type FontSet, fontOf, type TextFaces, weightFromStr } from "./font-set.ts";
import { LINE_SCALE } from "./leaf-kit.ts";
import { ringTextStyle } from "./theme-styles.ts";

/** md2ui `RING_UNIT_MAX_LINES`: the most lines a ring's label wraps onto. */
const RING_UNIT_MAX_LINES = 2;
/** md2ui `RING_UNIT_MIN_SCALE`: the smallest share of its themed size a label shrinks to. */
const RING_UNIT_MIN_SCALE = 0.8;
/** md2ui `_SHRINK_STEP`: how far each shrink trial steps down, in pixels. */
const SHRINK_STEP = 0.25;
const ELLIPSIS = "…";
// md2ui `render_style._RING_TEXT_MARGIN`: air between a ring's inner edge and its text.
const RING_TEXT_MARGIN = 4;
// md2ui `_ring_fit_size`'s floor: the smallest size a value scales down to.
const VALUE_MIN_SIZE = 8;

/** md2ui `_ring_inner_diameter`: the clear region inside a ring's stroke, its text's ceiling. */
function ringInnerDiameter(theme: ResolvedTheme): number {
  const ring = theme.datapoints.ring;
  return Math.max(1, ring.diameter - 2 * ring.thickness - 2 * RING_TEXT_MARGIN);
}

/** md2ui `RingText`: one ring leaf as drawn — its faces, its lines, and the box they claim. */
export interface RingText {
  readonly faces: TextFaces;
  readonly lines: readonly string[];
  readonly size: number;
  readonly color: Argb;
  readonly width: number;
  readonly height: number;
  /** The lines as one text whose hard breaks the wrap keeps at every width. */
  readonly text: string;
}

/** Whether a text drawn as label line `i` stays inside the clear circle. */
type Fits = (text: string, i: number) => boolean;

/**
 * md2ui `ring_text`: the ring leaf of `role` (`"value"` or `"unit"`) whose baked text is
 * `text`, laid out to be drawn.
 */
export function ringText(
  theme: ResolvedTheme,
  measurer: TextMeasurer,
  fonts: FontSet,
  role: string,
  text: string,
): RingText {
  const ts = ringTextStyle(theme, role);
  // md2ui `_apply_ring_role`: a bold style swaps the regular pair for the bold one.
  const faces: TextFaces =
    weightFromStr(ts.font_weight) >= 700
      ? { ...fonts, typeface: fonts.bold, italic: fonts.bold_italic }
      : fonts;
  const nominal = ts.font_size;
  const font = (size: number): FontSpec => fontOf(faces.typeface, size);
  const plan = (lines: readonly string[], size: number, width: number, height: number) => ({
    faces,
    lines,
    size,
    color: ts.color,
    width,
    height,
    text: lines.join(HARD_BREAK),
  });
  if (role === "value") {
    // The value's box keeps its themed line; its glyphs scale to fit (md2ui `_ring_fit_size`).
    const inner = ringInnerDiameter(theme);
    const w = measurer.advance(text, font(nominal));
    const size = w > inner ? Math.max(VALUE_MIN_SIZE, (nominal * inner) / w) : nominal;
    return plan([text], size, Math.min(w, inner), nominal * LINE_SCALE);
  }
  const radius = ringInnerDiameter(theme) / 2;
  const valueH = ringTextStyle(theme, "value").font_size * LINE_SCALE;
  const spacing = theme.datapoints.ring.spacing;
  const clearInside = (count: number, size: number): Fits =>
    clearInsideCircle(measurer, font(size), count, radius, valueH, spacing);
  const [lines, size] = fitUnit(split(text), nominal, clearInside);
  const width = Math.max(...lines.map((ln) => measurer.advance(ln, font(size))));
  return plan(lines, size, width, lines.length * size * LINE_SCALE);
}

/** md2ui `_fit_unit`: wrap, then shrink to the floor, then ellipsize (module comment). */
function fitUnit(
  words: readonly string[],
  nominal: number,
  clearInside: (count: number, size: number) => Fits,
): [readonly string[], number] {
  if (words.length === 0) return [[""], nominal];
  const floor = nominal * RING_UNIT_MIN_SCALE;
  for (let size = nominal; ; size = Math.max(floor, size - SHRINK_STEP)) {
    for (let count = 1; count <= RING_UNIT_MAX_LINES; count += 1) {
      const fits = clearInside(count, size);
      const lines = wrap(words, count, fits);
      if (lines.length === count && lines.every((ln, i) => fits(ln, i))) return [lines, size];
    }
    if (size <= floor) break;
  }
  const fits = clearInside(RING_UNIT_MAX_LINES, floor);
  const lines = wrap(words, RING_UNIT_MAX_LINES, fits);
  return [lines.map((ln, i) => ellipsize(ln, i, fits)), floor];
}

/**
 * md2ui `_clear_inside`: whether a text drawn as label line `i` of `count` stays inside the
 * clear circle. The value and the label lines are centred in the circle together, and the
 * painter puts a line's baseline one font size below its top and centres it on its advance,
 * so each line's glyphs land at a known place. The test is their ink: its corner farthest
 * from the centre must lie inside the circle, so the chord narrows for a line away from the
 * centre, and a line's leading is free to run over the stroke where its glyphs do not.
 */
function clearInsideCircle(
  measurer: TextMeasurer,
  font: FontSpec,
  count: number,
  radius: number,
  valueH: number,
  spacing: number,
): Fits {
  const lineH = font.size * LINE_SCALE;
  const top = -(valueH + spacing + count * lineH) / 2 + valueH + spacing;
  return (text, i) => {
    const ink = measurer.inkBounds(text, font);
    const baseline = top + i * lineH + font.size;
    const dy = Math.max(Math.abs(baseline - ink.top), Math.abs(baseline - ink.top + ink.height));
    const half = measurer.advance(text, font) / 2;
    const dx = Math.max(half - ink.left, ink.left + ink.width - half);
    return dx * dx + dy * dy <= radius * radius;
  };
}

/**
 * md2ui `_wrap`: `words` greedily onto at most `count` lines; the last takes the rest. A
 * line always takes its first word, so a line may not fit: the caller decides whether that
 * is a miss or an ellipsis.
 */
function wrap(words: readonly string[], count: number, fits: Fits): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < count - 1 && start < words.length; i += 1) {
    let end = start + 1;
    while (end < words.length && fits(words.slice(start, end + 1).join(" "), i)) end += 1;
    lines.push(words.slice(start, end).join(" "));
    start = end;
  }
  if (start < words.length) lines.push(words.slice(start).join(" "));
  return lines;
}

/** md2ui `_ellipsize`: `line` cut to end in an ellipsis that fits as line `i`, or unchanged. */
function ellipsize(line: string, i: number, fits: Fits): string {
  if (fits(line, i)) return line;
  const points = [...line];
  while (points.length > 0 && !fits(rstrip(points.join("")) + ELLIPSIS, i)) points.pop();
  return rstrip(points.join("")) + ELLIPSIS;
}
