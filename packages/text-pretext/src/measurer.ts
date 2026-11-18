import { measureNaturalWidth, prepareWithSegments } from "@chenglou/pretext";
import {
  materializeRichInlineLineRange,
  measureRichInlineStats,
  type PreparedRichInline,
  prepareRichInline,
  type RichInlineItem,
  walkRichInlineLineRanges,
} from "@chenglou/pretext/rich-inline";
import type {
  FontMetrics,
  FontSource,
  FontSpec,
  InkBounds,
  PreparedText,
  TextLine,
  TextMeasurer,
  TextSpan,
} from "@md2ui/contracts";
import { authoredText, canvasText, setCanvasFont } from "./canvas-font.ts";
import { cssFont } from "./css-font.ts";
import { createFontFaces, type FontLoading, loadFonts } from "./fonts.ts";

const HARD_BREAK = String.fromCodePoint(0x2028);

/** One hard-break paragraph: a Pretext rich-inline text and where its items came from. */
interface Segment {
  readonly prepared: PreparedRichInline;
  /** Item index in `prepared` -> index in the caller's span list. */
  readonly spanOf: readonly number[];
  /** Item index in `prepared` -> whether `canvasText` respelled its text. */
  readonly respelled: readonly boolean[];
}

function advanceOf(text: string, font: FontSpec): number {
  return measureNaturalWidth(
    prepareWithSegments(canvasText(text, font), cssFont(font), { whiteSpace: "pre-wrap" }),
  );
}

function prepareSegment(
  pieces: readonly { span: number; text: string }[],
  spans: readonly TextSpan[],
): Segment | null {
  const items: RichInlineItem[] = [];
  const spanOf: number[] = [];
  const respelled: boolean[] = [];
  let hasText = false;
  for (const piece of pieces) {
    const span = spans[piece.span];
    if (span === undefined || piece.text === "") {
      continue;
    }
    hasText ||= piece.text.trim() !== "";
    const text = canvasText(piece.text, span.font);
    items.push({ text, font: cssFont(span.font) });
    spanOf.push(piece.span);
    respelled.push(text !== piece.text);
  }
  return hasText ? { prepared: prepareRichInline(items), spanOf, respelled } : null;
}

function segmentsOf(spans: readonly TextSpan[]): Segment[] {
  const segments: Segment[] = [];
  let pieces: { span: number; text: string }[] = [];
  const flush = (): void => {
    const segment = prepareSegment(pieces, spans);
    if (segment !== null) {
      segments.push(segment);
    }
    pieces = [];
  };
  spans.forEach((span, index) => {
    span.text.split(HARD_BREAK).forEach((part, partIndex) => {
      if (partIndex > 0) {
        flush();
      }
      pieces.push({ span: index, text: part });
    });
  });
  flush();
  return segments;
}

/** The widest run of text with no U+0020 space and no hard break, across spans. */
function widestUnit(spans: readonly TextSpan[]): number {
  let widest = 0;
  let unit = 0;
  for (const span of spans) {
    const parts = span.text.replaceAll(HARD_BREAK, " ").split(" ");
    parts.forEach((part, index) => {
      if (index > 0) {
        widest = Math.max(widest, unit);
        unit = 0;
      }
      if (part !== "") {
        unit += advanceOf(part, span.font);
      }
    });
  }
  return Math.max(widest, unit);
}

function prepareText(spans: readonly TextSpan[]): PreparedText {
  const segments = segmentsOf(spans);
  let lineWidthCache: number | undefined;
  let minWidthCache: number | undefined;
  return {
    lineWidth() {
      lineWidthCache ??= segments.reduce(
        (widest, segment) =>
          Math.max(
            widest,
            measureRichInlineStats(segment.prepared, Number.POSITIVE_INFINITY).maxLineWidth,
          ),
        0,
      );
      return lineWidthCache;
    },
    minWidth() {
      minWidthCache ??= widestUnit(spans);
      return minWidthCache;
    },
    lineCount(maxWidth) {
      return segments.reduce(
        (total, segment) => total + measureRichInlineStats(segment.prepared, maxWidth).lineCount,
        0,
      );
    },
    lines(maxWidth) {
      const lines: TextLine[] = [];
      for (const segment of segments) {
        walkRichInlineLineRanges(segment.prepared, maxWidth, (range) => {
          const line = materializeRichInlineLineRange(segment.prepared, range);
          let x = 0;
          const fragments = line.fragments.map((fragment) => {
            x += fragment.gapBefore;
            const placed = {
              span: segment.spanOf[fragment.itemIndex] ?? 0,
              text: segment.respelled[fragment.itemIndex]
                ? authoredText(fragment.text)
                : fragment.text,
              x,
              width: fragment.occupiedWidth,
            };
            x += fragment.occupiedWidth;
            return placed;
          });
          lines.push({ width: line.width, fragments });
        });
      }
      return lines;
    },
  };
}

/**
 * A measurer backed by Pretext. Every font is loaded before it is returned, so no
 * answer is ever taken with a fallback font (ADR-403). `loading.faces` are the thread's
 * (`FontFaces`): a face arriving through them later, for another view, drops the
 * answers this measurer keeps, as it clears Pretext's.
 */
export async function createPretextMeasurer(
  fonts: readonly FontSource[],
  loading: FontLoading = {},
): Promise<TextMeasurer> {
  const faces = loading.faces ?? createFontFaces();
  await loadFonts(fonts, { ...loading, faces });
  // One context per font, its font set once, as Pretext's own (patched): Firefox slows
  // down with every font change followed by a measurement in a Worker.
  const contexts = new Map<string, OffscreenCanvasRenderingContext2D>();
  const contextFor = (font: FontSpec): OffscreenCanvasRenderingContext2D => {
    const key = cssFont(font);
    let ctx = contexts.get(key);
    if (ctx === undefined) {
      const made = new OffscreenCanvas(1, 1).getContext("2d");
      if (made === null) throw new Error("OffscreenCanvas 2d context is unavailable");
      setCanvasFont(made, font);
      contexts.set(key, made);
      ctx = made;
    }
    return ctx;
  };
  const fontMetrics = (font: FontSpec): FontMetrics => {
    const m = contextFor(font).measureText(" ");
    return { ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent };
  };
  // A text's advance is the same at every width, and asked again at each one: Pretext
  // prepares it anew each time (10 % of a bento resize).
  const advances = new Map<string, number>();
  let cleared = faces.cleared;
  const advance = (text: string, font: FontSpec): number => {
    if (faces.cleared !== cleared) {
      advances.clear();
      cleared = faces.cleared;
    }
    const key = `${cssFont(font)}\u0000${text}`;
    let width = advances.get(key);
    if (width === undefined) {
      width = advanceOf(text, font);
      advances.set(key, width);
    }
    return width;
  };
  return {
    prepare: prepareText,
    advance,
    fontMetrics,
    // WebKit's `actualBoundingBoxLeft`/`Right` are the advance box widened by any
    // overhang, not the glyphs' ink: there, a text's horizontal extent is
    // about its advance.
    inkBounds(text, font): InkBounds {
      const { ascent } = fontMetrics(font);
      const m = contextFor(font).measureText(canvasText(text, font));
      const height = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      return height <= 0
        ? { top: ascent, height: ascent, left: 0, width: 0 }
        : {
            top: m.actualBoundingBoxAscent,
            height,
            left: -m.actualBoundingBoxLeft,
            width: m.actualBoundingBoxLeft + m.actualBoundingBoxRight,
          };
    },
  };
}
