// The painted words as DOM text (ADR-402: selection, copy and find-in-page are a host
// layer built from the display list). Each run the core gives (`sceneText`) is a
// transparent span laid on its glyphs: at its left edge, its baseline on the run's, in the
// font string the canvas paints it in, and scaled across to the advance the canvas paints
// it at, so a selection or a find highlight covers the glyphs even where the browser lays
// text out wider or narrower than its canvas draws it (WebKit's monospace, Chromium's
// kerning: up to 2 px on a line). That advance and the font's extent are
// measured here, on the page, by the routines the painter sets a font and spells a text
// with (ADR-403), because the page's canvas is what paints: the core's measurer may run
// in a Worker, whose answers can differ. The browser then selects, copies and finds the
// words; the canvas stays the only thing painted.
//
// What a copy writes between runs (a space, a line break) is text in the flow of the
// element that holds them, at its 1px size, so it is copied and never seen. Chromium and
// WebKit write nothing between two absolutely placed elements, so each group ends in a
// line break or a space of its own (Firefox writes a paragraph's break as well).
import type { FontMetrics } from "@md2ui/contracts";
import type { LineRun, TextGroup } from "@md2ui/core";
import { canvasText, cssFont, setCanvasFont } from "@md2ui/text-pretext";

/** The class of an element whose children are a group's runs. */
export const WORDS = "words";

/**
 * A grapheme the browser draws in colour whatever the text's colour: an emoji, a flag, a
 * keycap. It is made invisible, as the text around it is by its transparent colour.
 */
const COLOURED = /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣|️/u;

/** A run's span, waiting to be placed on its baseline and fitted to its advance. */
export interface Unfitted {
  readonly span: HTMLElement;
  readonly run: LineRun;
  /** The content-space top of the element holding it. */
  readonly top: number;
}

function runSpan(run: LineRun, left: number, segmenter: Intl.Segmenter): HTMLElement {
  const span = document.createElement("span");
  span.style.left = `${run.x - left}px`;
  span.style.font = cssFont(run.font);
  if (!COLOURED.test(run.text)) {
    span.textContent = run.text;
    return span;
  }
  for (const { segment } of segmenter.segment(run.text)) {
    if (COLOURED.test(segment)) {
      const glyph = document.createElement("span");
      glyph.textContent = segment;
      span.append(glyph);
    } else {
      span.append(segment);
    }
  }
  return span;
}

/** Fills elements with runs, remembering what each holds, and fits the runs to the paint. */
export interface Words {
  /**
   * Fills `el` with `group`'s runs, placed relative to (`left`, `top`) in content space,
   * and adds each new span to `unfitted`. `from` is the scene text the group is part of:
   * an element filled from it already is left as it is, and so is one holding the same
   * runs at the same places.
   */
  fill(
    el: HTMLElement,
    from: object,
    group: TextGroup,
    left: number,
    top: number,
    unfitted: Unfitted[],
  ): void;
  /** Gives `el` plain text instead, which a later `fill` replaces. */
  plain(el: HTMLElement, text: string): void;
  /**
   * Places each span on its baseline and scales it across to the advance the canvas
   * paints it at. Every width is read before any is set, so the browser lays the spans
   * out once. `within` is an element they lie in, whose drawn size tells any zoom of the
   * page around the view.
   */
  fit(unfitted: readonly Unfitted[], within: HTMLElement): void;
}

export function createWords(): Words {
  /** What each element was filled from: the scene text, and its runs relative to it. */
  const drawn = new WeakMap<HTMLElement, { readonly from: object; readonly key: string }>();
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  let ctx: OffscreenCanvasRenderingContext2D | null = null;

  return {
    fill(el, from, group, left, top, unfitted) {
      const was = drawn.get(el);
      if (was?.from === from) return;
      const key = JSON.stringify([group.end, left, top, group.runs]);
      drawn.set(el, { from, key });
      if (was?.key === key) return;
      el.classList.add(WORDS);
      const children: (Node | string)[] = [];
      for (const run of group.runs) {
        if (run.before !== "") children.push(run.before);
        const span = runSpan(run, left, segmenter);
        children.push(span);
        unfitted.push({ span, run, top });
      }
      // A line break as an element, which a copy writes and the text content leaves out:
      // an item's text content stays the words it names.
      children.push(group.end === "\n" ? document.createElement("br") : group.end);
      el.replaceChildren(...children);
    },

    plain(el, text) {
      if (drawn.delete(el)) el.classList.remove(WORDS);
      if (el.textContent !== text) el.textContent = text;
    },

    fit(unfitted, within) {
      if (unfitted.length === 0) return;
      ctx ??= new OffscreenCanvas(1, 1).getContext("2d");
      if (ctx === null) return;
      const measuring = ctx;
      // The font is set once for each stretch of runs in it, as the painter sets it.
      let font = "";
      const extents = new Map<string, FontMetrics>();
      const advances = unfitted.map(({ span, run, top }) => {
        const key = cssFont(run.font);
        if (key !== font) {
          setCanvasFont(measuring, run.font);
          font = key;
        }
        let extent = extents.get(key);
        if (extent === undefined) {
          const m = measuring.measureText(" ");
          extent = { ascent: m.fontBoundingBoxAscent, descent: m.fontBoundingBoxDescent };
          extents.set(key, extent);
        }
        // The line box is the font's extent, so the baseline falls `ascent` below its top.
        span.style.top = `${run.baseline - extent.ascent - top}px`;
        span.style.lineHeight = `${extent.ascent + extent.descent}px`;
        return measuring.measureText(canvasText(run.text, run.font)).width;
      });
      const zoom =
        within.offsetWidth > 0 ? within.getBoundingClientRect().width / within.offsetWidth : 0;
      const laid = unfitted.map(({ span }) => span.getBoundingClientRect().width / zoom);
      unfitted.forEach(({ span }, i) => {
        const natural = laid[i] as number;
        // Not laid out (the view is hidden): left unscaled, as near as the browser lays it.
        if (natural > 0 && Number.isFinite(natural)) {
          span.style.transform = `scaleX(${(advances[i] as number) / natural})`;
        }
      });
    },
  };
}
