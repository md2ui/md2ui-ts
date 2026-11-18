// The replay boundary (ADR-403): every canvas Pretext and the measurer create answers
// `measureText` from md2ui's recorded font answers, so Pretext itself runs on md2ui's
// numbers. A question md2ui never asked is answered by the real canvas and logged as a
// gap; nothing is invented. A source that knows md2ui's face names it as a canvas font,
// and the real canvas then answers in that face, measured as md2ui's Skia measures.
import {
  faceKeyOf,
  fontOfFace,
  plainAdvance,
  plainInk,
  plainMetrics,
  type Records,
} from "./records.ts";

export interface Gap {
  /** The canvas font string Pretext set. */
  readonly font: string;
  /** The md2ui face the font stands for; undefined when md2ui never measured with it. */
  readonly face: string | undefined;
  readonly text: string;
}

/** One `measureText` call: what it was asked and the width it answered. */
export interface Measured {
  readonly font: string;
  readonly text: string;
  readonly width: number;
  /** True when md2ui never measured it, so the real canvas answered. */
  readonly gap: boolean;
}

export interface ReplayLog {
  answered: number;
  readonly gaps: Gap[];
  /** Every call, in order. */
  readonly calls: Measured[];
}

/** md2ui's answers for one `measureText` call; an absent field is left to the real canvas. */
export interface Replayed {
  /** The md2ui face the font stands for, for the gap log. */
  readonly face: string | undefined;
  /** The advance; absent when md2ui never measured the text in that font: a gap. */
  readonly width?: number;
  /** Ascent and descent, both positive. */
  readonly metrics?: { readonly ascent: number; readonly descent: number };
  /** `[advance, left, top, right, bottom]` of the ink box. */
  readonly ink?: readonly number[];
  /**
   * md2ui's face as a canvas font, already loaded into the page: what md2ui did not
   * record is answered in it, without kerning or ligatures, as md2ui's Skia measures.
   * Absent: the font Pretext set, shaped as the browser shapes it.
   */
  readonly canvasFont?: string;
}

/** Where the replayed answers come from, asked with a canvas font string and a text. */
export type ReplaySource = (font: string, text: string) => Replayed;

const FONT = /^(italic )?(\d+) ([\d.]+)px "?([^",]+)"?/u;

/** VARIATION SELECTOR-15 and -16. */
const TEXT_PRESENTATION = "\uFE0E";
const EMOJI_PRESENTATION = "\uFE0F";

/**
 * The replay's source: the face a font string's first family stands for, in `records`, asked
 * the text as authored. The Pretext measurer hands a named face VS16 as VS15
 * (`canvasText`), which md2ui never sees; the corpus writes no VS15 of its own.
 */
export function recordsSource(records: Records): ReplaySource {
  return (font, canvas) => {
    const text = canvas.replaceAll(TEXT_PRESENTATION, EMOJI_PRESENTATION);
    const m = FONT.exec(font);
    if (m === null) return { face: undefined };
    const [, italic, weight = "", size = "", family = ""] = m;
    const face = faceKeyOf(records, {
      families: [family],
      size: Number(size),
      weight: Number(weight),
      italic: italic !== undefined,
    });
    if (face === undefined) return { face };
    const width = plainAdvance(records, face, Number(size), text);
    const metrics = plainMetrics(records, face, Number(size));
    const ink = plainInk(records, face, Number(size), text);
    return {
      face,
      ...(width === undefined ? {} : { width }),
      ...(metrics === undefined ? {} : { metrics }),
      ...(ink === undefined ? {} : { ink }),
    };
  };
}

/**
 * The CSS source of a face's file. Where the browser's font sanitizer refuses the file
 * (Apple's Courier has no OS/2 table), the system's own face by its PostScript name: the
 * face md2ui read, from this system. Throws when neither loads.
 */
async function sourceOf(face: string, data: string): Promise<string> {
  const file = `url(data:font/sfnt;base64,${data})`;
  try {
    await new FontFace(face, file).load();
    return file;
  } catch (refused) {
    const postscript = face.split("|")[1] ?? "";
    const local = `local(${JSON.stringify(postscript)})`;
    try {
      await new FontFace(face, local).load();
      return local;
    } catch {
      throw new Error(
        `the browser refuses the font file of ${face} (${String(refused)}), and this system has no ${postscript}`,
      );
    }
  }
}

/**
 * Loads md2ui's faces into the page, each twice. Under its face key as its family, with
 * the default descriptors: a `canvasFont` naming the key asks for exactly that face, and
 * the browser never synthesizes a weight, nor a slant unless the font asks italic of an
 * upright face, where md2ui slants it too. And under its own family, weight and slant,
 * as a client page loads a theme's fonts: what Pretext measures outside the canvas (its
 * emoji correction measures a DOM span) resolves to md2ui's files too. `data` is the
 * font file, base64. A face md2ui made as an instance of a variable font comes with the
 * coordinates it was made at, `axes`, and is loaded only under its key, set there: its
 * family is the font's own, which loads as itself.
 */
export async function loadFaces(
  faces: readonly {
    readonly face: string;
    readonly data: string;
    readonly axes?: Readonly<Record<string, number>>;
  }[],
): Promise<void> {
  for (const { face, data, axes } of faces) {
    const source = await sourceOf(face, data);
    const { families, weight, italic } = fontOfFace(face, 0);
    const loading =
      axes === undefined
        ? [
            new FontFace(face, source),
            new FontFace(families[0] ?? "", source, {
              weight: String(weight),
              style: italic ? "italic" : "normal",
            }),
          ]
        : [new FontFace(face, source, { variationSettings: variationSettings(axes) })];
    for (const loaded of await Promise.all(loading.map((f) => f.load()))) {
      document.fonts.add(loaded);
    }
  }
}

/** A family of its own, made from a face's file: an instance of a variable font. */
export interface FamilyFace {
  readonly family: string;
  /** The font file, base64. */
  readonly data: string;
  readonly weight: number;
  /** CSS `font-variation-settings`; empty for none. */
  readonly variationSettings: string;
}

/** Loads each family into the page, as a client page registers an emoji font instance. */
export async function loadFamilies(families: readonly FamilyFace[]): Promise<void> {
  const loading = families.map(({ family, data, weight, variationSettings }) =>
    new FontFace(family, `url(data:font/sfnt;base64,${data})`, {
      weight: String(weight),
      ...(variationSettings === "" ? {} : { variationSettings }),
    }).load(),
  );
  for (const loaded of await Promise.all(loading)) document.fonts.add(loaded);
}

/** Coordinates as CSS `font-variation-settings`. */
function variationSettings(axes: Readonly<Record<string, number>>): string {
  return Object.entries(axes)
    .map(([tag, value]) => `${JSON.stringify(tag)} ${value}`)
    .join(", ");
}

function replayMetrics(real: TextMetrics, overrides: Partial<Record<keyof TextMetrics, number>>) {
  return new Proxy(real, {
    get: (target, key) =>
      key in overrides ? overrides[key as keyof TextMetrics] : Reflect.get(target, key),
  });
}

/**
 * Replaces `OffscreenCanvas` so every 2D context made after this call replays `source`,
 * which is asked at every call. Install it before Pretext measures anything: Pretext
 * keeps the first context it makes for the page.
 */
export function installReplayCanvas(source: ReplaySource): ReplayLog {
  const Real = globalThis.OffscreenCanvas;
  const log: ReplayLog = { answered: 0, gaps: [], calls: [] };
  const realContext = (): OffscreenCanvasRenderingContext2D => {
    const real = new Real(1, 1).getContext("2d");
    if (real === null) throw new Error("OffscreenCanvas 2d context is unavailable");
    return real;
  };
  class ReplayCanvas {
    getContext(): OffscreenCanvasRenderingContext2D {
      // The browser's own measurement of the font Pretext set, and md2ui's: Skia's
      // `measureText` neither kerns nor forms ligatures.
      const shaped = realContext();
      const unshaped = realContext();
      unshaped.fontKerning = "none";
      unshaped.textRendering = "optimizeSpeed";
      let font = shaped.font;
      const context = {
        get font() {
          return font;
        },
        set font(value: string) {
          font = value;
          shaped.font = value;
        },
        measureText(text: string): TextMetrics {
          const found = source(font, text);
          const overrides: Partial<Record<keyof TextMetrics, number>> = {};
          if (found.metrics !== undefined) {
            overrides.fontBoundingBoxAscent = found.metrics.ascent;
            overrides.fontBoundingBoxDescent = found.metrics.descent;
          }
          if (found.ink !== undefined) {
            const [, left = 0, top = 0, right = 0, bottom = 0] = found.ink;
            overrides.actualBoundingBoxLeft = -left;
            overrides.actualBoundingBoxAscent = -top;
            overrides.actualBoundingBoxRight = right;
            overrides.actualBoundingBoxDescent = bottom;
          }
          let real = shaped;
          if (found.canvasFont !== undefined) {
            real = unshaped;
            real.font = found.canvasFont;
          }
          const metrics = real.measureText(text);
          if (found.width === undefined) {
            log.gaps.push({ font, face: found.face, text });
            log.calls.push({ font, text, width: metrics.width, gap: true });
          } else {
            log.answered += 1;
            overrides.width = found.width;
            log.calls.push({ font, text, width: found.width, gap: false });
          }
          return replayMetrics(metrics, overrides);
        },
      };
      return context as unknown as OffscreenCanvasRenderingContext2D;
    }
  }
  globalThis.OffscreenCanvas = ReplayCanvas as unknown as typeof OffscreenCanvas;
  return log;
}
