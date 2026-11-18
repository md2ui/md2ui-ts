// md2ui's recorded font answers (`measure/<label>/<doc>.jsonl`), asked by font: as a C3
// text measurer whose wrap is md2ui's own (the fake measurer's greedy unit wrap), which
// checks layout's sizing against md2ui's closure answers (stage B) and is md2ui's
// reference wrap in stage C; and at the canvas `measureText` boundary, where Pretext
// itself runs on them (stage C). A face is md2ui's key `family|PostScript|weight|width|slant`. A
// font resolves to one the way md2ui's `resolve_typeface` picks among loaded faces, and an
// advance is summed over the face runs md2ui measures it in (`render_glyph_faces`): the
// first family draws what it has, the second (when given) what the first lacks, and the
// system face md2ui recorded for the rest. A question md2ui never answered throws.
import type {
  FontMetrics,
  FontSpec,
  InkBounds,
  ResolvedTheme,
  TextMeasurer,
} from "@md2ui/contracts";
import { createFakeMeasurer, type EmojiVariation, emojiVariations } from "@md2ui/core";
import { questionKey } from "@md2ui/text-conformance";
import { isArray, isObject, type Json } from "./json.ts";
import type { FaceInstance } from "./manifest.ts";

interface Face {
  readonly key: string;
  readonly family: string;
  readonly weight: number;
  readonly italic: boolean;
}

function faceOf(key: string): Face {
  const [family = "", , weight = "400", , slant = "0"] = key.split("|");
  return { key, family: family.toLowerCase(), weight: Number(weight), italic: slant !== "0" };
}

/** Index of the font answers of one document and width. */
interface FontRecords {
  /** `questionKey` of every font question (`advance`, `ink`, `outline`, `metrics`, `has_glyph`, `system_face`) → md2ui's answer. */
  readonly answers: Map<string, Json>;
  /** `face|size` → `[text, advance]` of every plain advance (unstretched, unshaped) md2ui measured in it. */
  readonly plainAdvances: Map<string, [string, number][]>;
  /** Every face md2ui measured with, in first-seen order. */
  readonly faces: Map<string, Face>;
}

const FONT_QUESTIONS = new Set([
  "advance",
  "ink",
  "outline",
  "metrics",
  "has_glyph",
  "system_face",
]);

function indexFonts(records: readonly Json[]): FontRecords {
  const index: FontRecords = { answers: new Map(), plainAdvances: new Map(), faces: new Map() };
  const seeFace = (key: Json | undefined): void => {
    if (typeof key === "string" && !index.faces.has(key)) index.faces.set(key, faceOf(key));
  };
  for (const r of records) {
    if (!isObject(r) || typeof r["q"] !== "string" || !FONT_QUESTIONS.has(r["q"])) continue;
    const { q, face, size, text, a } = r;
    seeFace(face);
    if (q === "system_face") {
      seeFace(r["like"]);
      if (isObject(a)) seeFace(a["face"]);
    }
    if (a !== undefined) index.answers.set(questionKey(r), a);
    const plain = r["scale_x"] === undefined && r["shaped"] === undefined;
    if (q === "advance" && plain && typeof text === "string" && typeof a === "number") {
      const at = `${face}|${size}`;
      const known = index.plainAdvances.get(at) ?? [];
      known.push([text, a]);
      index.plainAdvances.set(at, known);
    }
  }
  return index;
}

/** A font file's name or a PostScript name, compared without case or punctuation. */
const loose = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The recorded faces in md2ui's load order: md2ui's `resolve_typeface` breaks ties, and
 * falls back to "any style of the family", in the order the theme's font files were
 * loaded. A file is matched to a face by its name against the face's PostScript name
 * (`Inter_18pt-Regular.ttf` is `Inter18pt-Regular`); the faces no file names (system
 * fonts, fallbacks) follow in the order the recording first used them.
 */
function inLoadOrder(index: FontRecords, fontPaths: readonly string[]): Face[] {
  const faces = [...index.faces.values()];
  const postscript = (f: Face): string => loose(f.key.split("|")[1] ?? "");
  const loaded = fontPaths.flatMap((path) => {
    const file = loose((path.split("/").pop() ?? "").replace(/\.[^.]*$/, ""));
    return faces.filter((f) => postscript(f) === file);
  });
  return [...loaded, ...faces.filter((f) => !loaded.includes(f))];
}

/** The face of `faces` nearest `weight`, the first of a tie (Python's `min`). */
function nearest(faces: readonly Face[], weight: number): Face | undefined {
  let best: Face | undefined;
  for (const f of faces) {
    if (best === undefined || Math.abs(f.weight - weight) < Math.abs(best.weight - weight))
      best = f;
  }
  return best;
}

/**
 * md2ui `resolve_typeface` over the faces it loaded: exact, then the nearest weight in
 * the same style, then the nearest weight in the other style. A family with no italic
 * file answers italic with an upright face, which md2ui slants (`styled_font`).
 */
function resolveFace(
  order: readonly Face[],
  family: string,
  weight: number,
  italic: boolean,
): string {
  const name = family.toLowerCase();
  const faces = order.filter((f) => f.family === name);
  const exact = faces.find((f) => f.weight === weight && f.italic === italic);
  if (exact !== undefined) return exact.key;
  const found =
    nearest(
      faces.filter((f) => f.italic === italic),
      weight,
    ) ?? nearest(faces, weight);
  if (found === undefined) throw new Error(`no recorded face for ${family} ${weight}`);
  return found.key;
}

// md2ui `render_glyph_faces._joins_previous`: combining marks, joiners, variation
// selectors and skin tones stay in the face of the glyph before them.
const JOINS = /^(?:[\p{Mn}\p{Me}\p{Cf}\p{Zl}\p{Zp}]|[\u{FE00}-\u{FE0F}]|[\u{1F3FB}-\u{1F3FF}])$/u;

// md2ui `render_shaping._SEQUENCE`: what only a ligature joins (the zero-width joiner,
// the keycap mark, regional indicators, skin tones and tag characters).
const SEQUENCE = /[\u200D\u20E3\u{1F1E6}-\u{1F1FF}\u{1F3FB}-\u{1F3FF}\u{E0020}-\u{E007F}]/u;

// U+FE00–U+FE0F, the variation selectors.
const SELECTOR = /^[\u{FE00}-\u{FE0F}]$/u;

/** The size a Skia font has when none is given: md2ui asks the selector probe at it. */
const SKIA_DEFAULT_SIZE = 12;

function isAscii(text: string): boolean {
  return [...text].every((ch) => (ch.codePointAt(0) ?? 0) < 0x80);
}

/** Skia's advance of `text` in a face whose every glyph is `width`: a float32 running sum. */
function runningSum(text: string, width: number): number {
  let total = 0;
  for (const _ of text) total = Math.fround(total + width);
  return total;
}

/** A face md2ui loaded, and where it read the face's file (the manifest's `source`). */
export interface FaceSource {
  readonly face: string;
  readonly source: string;
  /** Set when md2ui made the face as an instance of a variable font. */
  readonly instance?: FaceInstance;
}

/**
 * md2ui `_load_emoji_typeface` over the faces it loaded: an emoji `Font:` path draws in
 * the family of the face md2ui read from that file. No path, or a file md2ui never
 * loaded, is the default emoji font, OpenMoji.
 */
function emojiFamilies(fonts: readonly FaceSource[]): (path: string | null) => string {
  return (path) => {
    const found = fonts.find((font) => font.source === path);
    return found === undefined ? "OpenMoji" : (found.face.split("|")[0] ?? "OpenMoji");
  };
}

/** md2ui's font-level answers for one document and width, asked by font. */
export interface FontAnswers {
  /** md2ui's face key for the font's first family, or undefined when md2ui never loaded the family. */
  face(font: FontSpec): string | undefined;
  /**
   * md2ui's faces for the font's families, in order: what md2ui draws a glyph in
   * before any system fallback. Throws when md2ui never loaded a family.
   */
  faces(font: FontSpec): readonly string[];
  /** md2ui's advance of `text`, summed over the face runs md2ui measures it in. Throws when md2ui never measured a run. */
  advance(text: string, font: FontSpec): number;
  /** Throws when md2ui never asked for the face's metrics at that size. */
  fontMetrics(font: FontSpec): FontMetrics;
  /**
   * `[advance, left, top, right, bottom]` of the ink box in the font's first face, as md2ui
   * recorded it: its glyph outlines (`outline`: a ring label's fit and a marker's ink,
   * in a newer recording) or its rasterized ink (`ink`, an older recording).
   * Throws when md2ui recorded both, differently.
   */
  ink(text: string, font: FontSpec): readonly number[] | undefined;
  /** Whether the font's first face is monospaced in the recording (see `monoWidth`). */
  monospaced(font: FontSpec): boolean;
}

/** What resolves a font to md2ui's faces, beside the recording. */
export interface FontContext {
  /** The theme's font files, in the order md2ui loaded them. */
  readonly fontPaths: readonly string[];
  /**
   * The faces md2ui measured the theme's documents in (the manifest's `fonts`): a family
   * this document never measured still resolves to the face md2ui loaded for it.
   */
  readonly fonts: readonly FaceSource[];
  /** The names md2ui resolved to another family's face (the manifest's `families`): `monospace` is Courier's. */
  readonly families: Readonly<Record<string, string>>;
  /** The emoji font instances the theme asks for (core `emojiVariations`), by family. */
  readonly variations: ReadonlyMap<string, EmojiVariation>;
}

/**
 * The font context of a theme's documents, from the faces md2ui loaded for it and the
 * names it resolved, with the emoji families the theme's font paths draw in.
 */
export function themeFonts(
  theme: ResolvedTheme,
  fonts: readonly FaceSource[],
  families: Readonly<Record<string, string>>,
): { readonly context: FontContext; readonly emojiFamily: (path: string | null) => string } {
  const emojiFamily = emojiFamilies(fonts);
  const variations = new Map(
    emojiVariations(theme, emojiFamily).map((variation) => [variation.family, variation]),
  );
  return { context: { fontPaths: theme.font_paths, fonts, families, variations }, emojiFamily };
}

/** md2ui's coordinates match within the 16.16 fixed point a font's coordinates are kept in. */
const COORDINATE_SLACK = 1 / 65536;

export function fontAnswers(
  records: readonly Json[],
  { fontPaths, fonts, families, variations }: FontContext,
): FontAnswers {
  const index = indexFonts(records);
  for (const { face } of fonts) if (!index.faces.has(face)) index.faces.set(face, faceOf(face));
  // An instance is found by the coordinates it was made at, never by its family's name.
  const instances = fonts.flatMap(({ face, instance }) =>
    instance === undefined ? [] : [{ face, family: faceOf(face).family, instance }],
  );
  const made = new Set(instances.map(({ face }) => face));
  const order = inLoadOrder(index, fontPaths).filter((f) => !made.has(f.key));

  /**
   * md2ui `font_loader.varied_face`: the instance of the variation's font md2ui made at
   * the coordinates its keys ask, each clamped to the font's range and those the font
   * lacks left out; with none left, or a font md2ui never varied, the font's own face.
   */
  const variedFace = (variation: EmojiVariation, font: FontSpec): string => {
    const base = variation.base.toLowerCase();
    const own = instances.filter((i) => i.family === base);
    const ranges = own[0]?.instance.ranges ?? {};
    const { fill, grade, optical_size: opsz } = variation.axes;
    const asked: [string, number | null][] = [
      ["wght", variation.weight],
      ["FILL", fill],
      ["GRAD", grade],
      ["opsz", opsz === "auto" ? font.size : opsz],
    ];
    const coordinates = asked.flatMap(([tag, value]) => {
      const range = ranges[tag];
      return value === null || range === undefined
        ? []
        : [[tag, Math.min(Math.max(value, range[0]), range[1])] as const];
    });
    if (coordinates.length === 0)
      return resolveFace(order, variation.base, font.weight, font.italic);
    const found = own.filter(({ instance }) =>
      coordinates.every(
        ([tag, value]) =>
          Math.abs((instance.coordinates[tag] ?? Number.NaN) - value) <= COORDINATE_SLACK,
      ),
    );
    const at = coordinates.map(([tag, value]) => `${tag} ${value}`).join(" ");
    if (found.length !== 1) {
      throw new Error(`${found.length} recorded instances of ${variation.base} at ${at}`);
    }
    return (found[0] as (typeof found)[number]).face;
  };

  /** The face of a font's `i`-th family, resolved only when asked for: md2ui never resolves a fallback it does not reach. */
  const faceAt = (font: FontSpec, i: number): string | undefined => {
    const family = font.families[i];
    if (family === undefined) return undefined;
    const variation = variations.get(family);
    if (variation !== undefined) return variedFace(variation, font);
    const named = Object.hasOwn(families, family) ? (families[family] as string) : family;
    return resolveFace(order, named, font.weight, font.italic);
  };

  const monospaced = new Map<string, number | null>();
  /**
   * The one glyph advance of a monospaced face at a size, or null when the face is not
   * one. md2ui measures a code line as the sum of its syntax-highlighted runs, so the
   * whole line the port measures was never recorded. Skia's advance of a text in a face
   * without kerning is the float32 running sum of its glyph advances; when every
   * recorded advance of the face at that size is exactly that sum of one width, the
   * face is monospaced in the recording, and an unrecorded ASCII text's advance is that
   * same sum: what md2ui's Skia would have answered, had it been asked.
   */
  const monoWidth = (face: string, size: number): number | null => {
    const key = `${face}|${size}`;
    const known = monospaced.get(key);
    if (known !== undefined) return known;
    const texts = index.plainAdvances.get(key) ?? [];
    const single = texts.find(([text]) => [...text].length === 1)?.[1];
    const width =
      single !== undefined && texts.every(([text, a]) => runningSum(text, single) === a)
        ? single
        : null;
    monospaced.set(key, width);
    return width;
  };

  /**
   * md2ui's advance of a text it measured only as runs, or undefined: md2ui measures a
   * code line as the sum of its syntax-highlighted runs, so in a face that is not
   * monospaced the whole line the port measures was never recorded. The runs md2ui
   * recorded that spell it, two or more summed in order, are md2ui's answer, when every
   * way of spelling it gives that one sum.
   */
  const runSum = (face: string, size: number, text: string): number | undefined => {
    const runs = index.plainAdvances.get(`${face}|${size}`) ?? [];
    // By end offset: each sum that reaches it, and whether it took two or more runs.
    const reached: Map<number, boolean>[] = [new Map([[0, false]])];
    for (let at = 0; at < text.length; at += 1) {
      for (const [sum] of reached[at] ?? []) {
        for (const [run, a] of runs) {
          if (run === "" || !text.startsWith(run, at)) continue;
          const end = at + run.length;
          const sums = reached[end] ?? new Map<number, boolean>();
          sums.set(sum + a, at > 0 || (sums.get(sum + a) ?? false));
          reached[end] = sums;
        }
      }
    }
    const sums = [...(reached[text.length] ?? [])].filter(([, many]) => many);
    return sums.length === 1 ? sums[0]?.[0] : undefined;
  };

  /** md2ui's recorded answer to `question`, or undefined when it never asked it. */
  const answer = (question: Readonly<Record<string, Json>>): Json | undefined =>
    index.answers.get(questionKey(question));

  /**
   * md2ui's ink box of `text`: its glyph outlines (`render_metrics._outline_ink`: a ring
   * label's fit, and through `_text_ink` a list marker's or quote character's ink in a
   * newer recording), or its rasterized ink (`ink`) in an older one. The
   * port asks one question, C3 `inkBounds`, for both, and a browser's `actualBoundingBox*`
   * is the outline; whichever md2ui recorded answers. A text recorded both ways,
   * differently, cannot be told apart here and throws.
   */
  const inkAt = (face: string, size: number, text: string): readonly number[] | undefined => {
    const ink = answer({ q: "ink", face, size, text });
    const outline = answer({ q: "outline", face, size, text });
    if (isArray(ink) && isArray(outline) && JSON.stringify(ink) !== JSON.stringify(outline)) {
      throw new Error(`md2ui recorded both an ink and an outline for ${face}|${size}|${text}`);
    }
    const found = isArray(ink) ? ink : outline;
    return isArray(found) ? (found as number[]) : undefined;
  };

  /**
   * md2ui's advance of one face run. A `shaped` run (an emoji run holding a sequence)
   * is answered only by md2ui's shaped measurement of it, never by its characters.
   */
  const lookup = (face: string, size: number, text: string, shaped = false): number => {
    if (shaped) {
      const found = answer({ q: "advance", face, size, text, shaped: true });
      if (typeof found !== "number") {
        throw new Error(`no recorded shaped advance for ${face}|${size}|${text}`);
      }
      return found;
    }
    const found = answer({ q: "advance", face, size, text });
    if (typeof found === "number") return found;
    const ink = inkAt(face, size, text);
    if (ink !== undefined && typeof ink[0] === "number") return ink[0];
    const mono = /^[\x20-\x7e]+$/.test(text) ? monoWidth(face, size) : null;
    if (mono !== null) return runningSum(text, mono);
    const runs = runSum(face, size, text);
    if (runs !== undefined) return runs;
    // The fake measurer asks for the space before every unit, the first one included,
    // and never adds that one; md2ui never measured it. NaN stands in, so a width that
    // did use it could never equal md2ui's.
    if (text === " ") return Number.NaN;
    throw new Error(`no recorded advance for ${face}|${size}|${text}`);
  };

  /** Whether md2ui recorded `text`'s advance or ink in `face` at `size`. */
  const measuredWhole = (face: string, size: number, text: string): boolean =>
    answer({ q: "advance", face, size, text }) !== undefined ||
    inkAt(face, size, text) !== undefined;

  /**
   * Whether an emoji face holds a character md2ui asked about without recording it: a
   * "more" button's mark (`render_text_scopes.link_label_fonts` asks the emoji face's
   * `unicharToGlyph` directly), which md2ui then measures alone in the
   * emoji face when the face has it, and in the label's own face when it does not. So
   * the face holds it exactly when md2ui recorded the mark's advance in it; `undefined`
   * for any other character, which stays a question md2ui must have answered.
   */
  const soloIn = (face: string, cp: number): boolean | undefined => {
    if (!MORE_MARKS.includes(cp)) return undefined;
    const mark = String.fromCodePoint(cp);
    for (const [key, texts] of index.plainAdvances) {
      if (key.startsWith(`${face}|`) && texts.some(([text]) => text === mark)) return true;
    }
    return false;
  };

  /**
   * md2ui `_glyph_face`. md2ui draws an all-ASCII run in its first face without asking
   * (`glyph_runs`), so a printable ASCII character it never asked the first face about is
   * that face's: a line of code the port measures whole holds such runs.
   */
  const glyphFace = (cp: number, primary: string, font: FontSpec): string => {
    // Only an emoji run's font names a face before the text's: a more button's mark.
    const emojiFirst = font.families.length > 1;
    const has = (face: string): boolean => {
      const found = answer({ q: "has_glyph", face, cp });
      if (found === undefined && face === primary && cp >= 0x20 && cp <= 0x7e) return true;
      if (found === undefined && face === primary && emojiFirst && soloIn(face, cp) !== undefined) {
        return soloIn(face, cp) as boolean;
      }
      if (typeof found !== "boolean") throw new Error(`no recorded has_glyph for ${face}|${cp}`);
      return found;
    };
    if (has(primary)) return primary;
    const secondary = faceAt(font, 1);
    if (secondary !== undefined && has(secondary)) return secondary;
    const like = secondary ?? primary;
    const system = answer({ q: "system_face", like, cp });
    if (system === undefined) throw new Error(`no recorded system_face for ${like}|${cp}`);
    return isObject(system) && typeof system["face"] === "string" ? system["face"] : primary;
  };

  /**
   * md2ui `_selector_draws_box`: whether a variation selector after `prev` adds width in
   * `face`, from the two advances md2ui asked of the face at Skia's default size.
   */
  const selectorDrawsBox = (face: string, prev: string, selector: string): boolean =>
    lookup(face, SKIA_DEFAULT_SIZE, prev + selector) !== lookup(face, SKIA_DEFAULT_SIZE, prev);

  /**
   * md2ui `_split_by_face`, summed as `runs_advance` / `glyph_advance` sum it, without the
   * variation selectors a face would draw as a box. An emoji run's piece holding a
   * sequence is shaped whole (`render_shaping.run_advance`).
   */
  const advance = (text: string, font: FontSpec): number => {
    const primary = faceAt(font, 0);
    if (primary === undefined) throw new Error("a font with no family");
    const fallback = font.families.length > 1;
    // md2ui measures the space between words in the text style's face, never in the
    // emoji face. Here a space reaches an emoji run's font only because the fake files
    // the space before a unit under the font of the unit's first span.
    if (fallback && text.trim() === "") {
      return lookup(faceAt(font, 1) as string, font.size, text);
    }
    if (!fallback && isAscii(text)) return lookup(primary, font.size, text);
    // md2ui measures a ring's text whole in its one face (`render_ring_text`), asking no
    // glyph of it: a text recorded whole in the primary face is that face's advance.
    if (!fallback && measuredWhole(primary, font.size, text)) {
      return lookup(primary, font.size, text);
    }
    let total = 0;
    let run = "";
    let current: string | undefined;
    let prev = "";
    for (const ch of text) {
      const before = prev;
      prev = ch;
      if (current !== undefined && JOINS.test(ch)) {
        if (!(SELECTOR.test(ch) && selectorDrawsBox(current, before, ch))) run += ch;
        continue;
      }
      const face = glyphFace(ch.codePointAt(0) ?? 0, primary, font);
      if (face !== current && current !== undefined) {
        total += lookup(current, font.size, run, fallback && SEQUENCE.test(run));
        run = "";
      }
      current = face;
      run += ch;
    }
    if (current !== undefined) {
      total += lookup(current, font.size, run, fallback && SEQUENCE.test(run));
    }
    return total;
  };

  const fontMetrics = (font: FontSpec): FontMetrics => {
    const primary = faceAt(font, 0);
    const found = answer({ q: "metrics", face: primary ?? "", size: font.size });
    if (!isObject(found)) throw new Error(`no recorded metrics for ${primary}|${font.size}`);
    return { ascent: -(found["fAscent"] as number), descent: found["fDescent"] as number };
  };

  const ink = (text: string, font: FontSpec): readonly number[] | undefined =>
    inkAt(faceAt(font, 0) ?? "", font.size, text);

  const face = (font: FontSpec): string | undefined => {
    try {
      return faceAt(font, 0);
    } catch {
      return undefined;
    }
  };

  const isMonospaced = (font: FontSpec): boolean => {
    const primary = face(font);
    return primary !== undefined && monoWidth(primary, font.size) !== null;
  };

  const faces = (font: FontSpec): readonly string[] =>
    font.families.map((_, i) => faceAt(font, i) as string);

  /**
   * A code-block font as md2ui asks for it. The port ends every code font in `monospace`
   * (core `inMonospace`), a fallback the browser takes per glyph; md2ui picks one face
   * instead (`font_loader.resolve_code_typeface`): the family's own where it loaded or
   * found the family, else its monospace. A family md2ui found neither way is one the
   * manifest's `families` resolves to another family's face.
   */
  const asMd2ui = (font: FontSpec): FontSpec => {
    const own = font.families.slice(0, -1);
    const code = own.at(-1);
    if (font.families.at(-1) !== MONOSPACE || code === undefined) return font;
    const found = !Object.hasOwn(families, code) || code === MONOSPACE;
    return { ...font, families: found ? own : [...own.slice(0, -1), MONOSPACE] };
  };

  return {
    face: (font) => face(asMd2ui(font)),
    faces: (font) => faces(asMd2ui(font)),
    advance: (text, font) => advance(text, asMd2ui(font)),
    fontMetrics: (font) => fontMetrics(asMd2ui(font)),
    ink: (text, font) => ink(text, asMd2ui(font)),
    monospaced: (font) => isMonospaced(asMd2ui(font)),
  };
}

/** md2ui `render_text.OVERFLOW_MARKS` (… ⋯ ⋮), as code points. */
const MORE_MARKS: readonly number[] = Object.freeze([0x2026, 0x22ef, 0x22ee]);

/** The generic family core's `inMonospace` ends a code-block font in. */
const MONOSPACE = "monospace";

/**
 * md2ui's answers as a C3 measurer: md2ui's greedy unit wrap (the fake measurer) over
 * md2ui's recorded advances. A question md2ui never answered throws.
 */
export function fontReplay(answers: FontAnswers): TextMeasurer {
  const inkBounds = (text: string, font: FontSpec): InkBounds => {
    const found = answers.ink(text, font);
    if (found === undefined) throw new Error(`no recorded ink for "${text}"`);
    const [, left = 0, top = 0, right = 0, bottom = 0] = found;
    if (right <= left || bottom <= top) {
      const { ascent } = answers.fontMetrics(font);
      return { top: ascent, height: ascent, left: 0, width: 0 };
    }
    // The recorded edges, as a browser's `actualBoundingBox*` gives them. md2ui's marker
    // rounds the height to float32 (Skia's `Rect.height()`) where it reads it, and its
    // ring label reads the edges unrounded: the comparison classifies that rounding
    // (`float32-height.ts`), so the answer here stays the outline's.
    return { top: -top, height: bottom - top, left, width: right - left };
  };
  return {
    ...createFakeMeasurer(answers.advance),
    fontMetrics: answers.fontMetrics,
    inkBounds,
  };
}
