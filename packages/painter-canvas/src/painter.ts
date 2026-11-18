import type {
  DisplayEntry,
  DisplayList,
  HitTarget,
  PageBackground,
  Rect,
  ScrollEntry,
  ShadowEntry,
  Shape,
} from "@md2ui/contracts";
import Flatbush from "flatbush";
import type { Context2D, DrawEnv, ImageLookup, ScrollOffset } from "./context.ts";
import { drawArc } from "./draw/arc.ts";
import { drawFill } from "./draw/fill.ts";
import { drawImage } from "./draw/image.ts";
import { createLayers, type Layers } from "./draw/layer.ts";
import { drawLine } from "./draw/line.ts";
import { drawScroll } from "./draw/scroll.ts";
import { drawStroke } from "./draw/stroke.ts";
import { drawText } from "./draw/text.ts";
import {
  createShadowCache,
  createShadowSprites,
  type ShadowCache,
  type ShadowSprites,
} from "./shadow-cache.ts";

/** Where the document is seen from: the viewport and the scroll, in CSS px. */
export interface View {
  /** The viewport's width, which the canvas fills. */
  readonly width: number;
  /** The viewport's height. */
  readonly height: number;
  /** How far the document is scrolled right; 0 shows its left edge, padding included. */
  readonly scrollX: number;
  /** How far the document is scrolled down; 0 shows its top, padding included. */
  readonly scrollY: number;
}

/** Everything one frame needs besides the list: per-frame state, never recorded. */
export interface Frame extends View {
  /** Device pixels per CSS px; the canvas is `width × pixelRatio` device px wide. */
  readonly pixelRatio: number;
  /**
   * The host's picture for each `src`: the image once decoded, or the placeholder
   * standing in for it (broken once it failed). A photo with none paints its fallback.
   */
  readonly images: ImageLookup;
  /**
   * What a content image paints while `images` has nothing for it: the host's loading
   * placeholder. With none either, the entry's own placeholder is drawn. For a `src`
   * that failed, the same broken placeholder `images` answers: the entry's
   * `standIn.broken`, when it has one, is then painted in its place.
   */
  readonly loading: ImageLookup;
  /**
   * How far the host has scrolled each code block (`scroll` entry), across and down, by
   * node id. Painted as given: past either end of a block's range (a platform's
   * overscroll bounce), its lines move on past its edge.
   */
  readonly offsets: ReadonlyMap<string, ScrollOffset>;
  /**
   * The code block under the pointer, by node id: its thumbs show, as a scrolled block's
   * do (md2ui `paint_scrolled`). Default none.
   */
  readonly hovered?: string | null | undefined;
  /**
   * The variable-font instances the host registered, family → `font-variation-settings`,
   * for an engine that applies them only from the canvas (`setCanvasFont`). Default none.
   */
  readonly variations?: ReadonlyMap<string, string> | undefined;
  /**
   * Whether the content is painted over the page background (the default), or over a
   * clear canvas, for a host that shows the background beneath it with `paintBackground`.
   */
  readonly background?: boolean | undefined;
}

/** What lies under a point. */
export interface Hit {
  /** The node of the last entry painted there, or null. */
  readonly nodeId: string | null;
  /**
   * What a tap there reports (md2ui `hit_region`): the innermost target holding the
   * point. A button or link wins, the last painted when several hold it; otherwise the
   * smallest link card. Null when none does. Host state is the view's: a pending card's
   * hold on what it contains is decided there.
   */
  readonly target: HitTarget | null;
  /** The code block there that scrolls, if any. */
  readonly scroll: ScrollEntry | null;
}

/** Paints one display list frame after frame, and answers what lies under a point. */
export interface Painter {
  /** Clears `ctx` and paints the frame. The caller sizes the canvas. */
  paint(ctx: Context2D, frame: Frame): void;
  /**
   * Paints `area` (content space) of a frame `paint` painted on `ctx` again, as `paint`
   * would: the device pixels it covers are cleared and repainted, the rest kept. For a
   * change that stays inside one entry's bounds, such as a code block's offset. Exact
   * where no other entry's edge crosses `area`'s: Skia (Chromium, Firefox) antialiases an
   * edge cut by the area's clip a little differently from the same edge drawn whole.
   */
  repaint(ctx: Context2D, frame: Frame, area: Rect): void;
  /**
   * Clears `ctx` and paints only the page background, which is fixed to the viewport:
   * what `paint` leaves out when `frame.background` is false.
   */
  paintBackground(ctx: Context2D, frame: Frame): void;
  /** What lies under viewport point `(x, y)`, CSS px. */
  hitTest(view: View, x: number, y: number): Hit;
  /**
   * The list has settled on screen, painted as a new document, theme or width, its
   * motion over: its `sprites` keep only the bitmaps it casts, at `frame`'s pixel ratio,
   * its background's at `frame`'s size, and drop those of the lists before it. It walks
   * the list, so it is called once per list a host settles on, never per frame.
   */
  settle(frame: Frame): void;
}

/** A spatial index over rects, built once per list (md2ui ADR-401's R-tree). */
function indexRects(rects: readonly Rect[]): Flatbush | null {
  if (rects.length === 0) return null;
  const index = new Flatbush(rects.length);
  for (const r of rects) index.add(r.x, r.y, r.x + r.width, r.y + r.height);
  index.finish();
  return index;
}

/** Indices of the rects meeting the query box, in list order (= paint order). */
function search(index: Flatbush | null, x0: number, y0: number, x1: number, y1: number) {
  return index === null ? [] : index.search(x0, y0, x1, y1).sort((a, b) => a - b);
}

/** Half-open, as md2ui's `HitRegion.contains`. */
function contains(r: Rect, x: number, y: number): boolean {
  return r.x <= x && x < r.x + r.width && r.y <= y && y < r.y + r.height;
}

/** Draws one entry; shadows through `shadows`' bitmaps, layers on `layers`' canvases. */
export function drawEntry(
  ctx: Context2D,
  entry: DisplayEntry,
  env: DrawEnv,
  shadows: ShadowCache,
  layers: Layers,
): void {
  switch (entry.type) {
    case "layer":
      layers.draw(ctx, entry, env, (layer) => {
        for (const e of entry.entries) drawEntry(layer, e, env, shadows, layers);
      });
      break;
    case "fill":
      drawFill(ctx, entry, env);
      break;
    case "stroke":
      drawStroke(ctx, entry);
      break;
    case "shadow":
      shadows.draw(ctx, entry, env);
      break;
    case "line":
      drawLine(ctx, entry);
      break;
    case "arc":
      drawArc(ctx, entry);
      break;
    case "text":
      drawText(ctx, entry, env);
      break;
    case "image":
      drawImage(ctx, entry, env);
      break;
    case "scroll":
      drawScroll(ctx, entry, env);
      break;
  }
}

/**
 * The root's viewport-fixed background, in md2ui's layered order: outer shadows, the
 * paints, inner shadows (`draw_scene`, `_paint_layered_fill`).
 */
export function paintBackground(
  ctx: Context2D,
  background: PageBackground,
  view: View,
  env: DrawEnv,
  cache: ShadowCache,
) {
  const bounds: Rect = { x: 0, y: 0, width: view.width, height: view.height };
  const shape: Shape = { kind: "rect", ...bounds };
  const shadows = backgroundShadows(background, view);
  for (const shadow of shadows) if (!shadow.inner) cache.draw(ctx, shadow, env);
  for (const paint of background.paints) {
    drawFill(ctx, { type: "fill", nodeId: "", bounds, shape, paint }, env);
  }
  for (const shadow of shadows) if (shadow.inner) cache.draw(ctx, shadow, env);
}

/** The page background's shadows, cast by the whole of `view`. */
function backgroundShadows(background: PageBackground, view: View): ShadowEntry[] {
  const bounds: Rect = { x: 0, y: 0, width: view.width, height: view.height };
  const shape: Shape = { kind: "rect", ...bounds };
  return background.shadows.map((shadow) => ({
    type: "shadow",
    nodeId: "",
    bounds,
    shape,
    ...shadow,
  }));
}

/** The per-frame drawing state of `frame`. */
export function drawEnv(frame: Frame): DrawEnv {
  return {
    images: frame.images,
    loading: frame.loading,
    scale: frame.pixelRatio,
    offsets: frame.offsets,
    hovered: frame.hovered ?? null,
    variations: frame.variations,
    font: null,
  };
}

/** Clears `ctx` to `frame`'s viewport, scaled to its pixel ratio; the caller restores it. */
export function startFrame(ctx: Context2D, frame: Frame): void {
  const dpr = frame.pixelRatio;
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, frame.width, frame.height);
}

/** Where content space's origin sits in the viewport, before scrolling (md2ui `_document_origin`). */
export function contentOriginX(list: DisplayList, view: View): number {
  const { padding } = list;
  const slack = Math.max(0, view.width - padding.left - padding.right - list.width);
  return padding.left + (list.centered ? slack / 2 : 0);
}

/**
 * A painter for `list`. Its spatial indexes are built here, once per list, which the
 * core makes once per width; every frame and tap after that only queries them. A host
 * that paints one list after another passes the same `sprites` to each painter, so a
 * shadow the last list cast is not blurred again.
 */
export function createPainter(
  list: DisplayList,
  sprites: ShadowSprites = createShadowSprites(),
): Painter {
  if (list.version !== 1) {
    throw new RangeError(`display list version ${String(list.version)} is not supported (1 is)`);
  }
  const entries = list.entries;
  const entryIndex = indexRects(entries.map((entry) => entry.bounds));
  const targetIndex = indexRects(list.targets.map((target) => target.rect));
  const { padding } = list;
  sprites.nextList();
  const shadows = createShadowCache(sprites);
  const layers = createLayers();

  const originX = (view: View): number => contentOriginX(list, view);
  /** How far content space is moved in `view`: its origin, less the scroll. */
  const shift = (view: View) => ({
    dx: originX(view) - view.scrollX,
    dy: padding.top - view.scrollY,
  });

  /**
   * Paints `frame`'s part from `(x0, y0)` to `(x1, y1)` (viewport CSS px) on `ctx`, set
   * to the frame's scale and saved, and restores it.
   */
  const paintPart = (
    ctx: Context2D,
    frame: Frame,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ): void => {
    const env = drawEnv(frame);
    if (frame.background !== false) paintBackground(ctx, list.background, frame, env, shadows);
    const { dx, dy } = shift(frame);
    ctx.translate(dx, dy);
    // Culling: only the entries whose ink meets the part (ADR-402).
    for (const i of search(entryIndex, x0 - dx, y0 - dy, x1 - dx, y1 - dy)) {
      const entry = entries[i];
      if (entry !== undefined) drawEntry(ctx, entry, env, shadows, layers);
    }
    ctx.restore();
  };

  return {
    paint(ctx, frame) {
      startFrame(ctx, frame);
      paintPart(ctx, frame, 0, 0, frame.width, frame.height);
    },

    repaint(ctx, frame, area) {
      const dpr = frame.pixelRatio;
      const { dx, dy } = shift(frame);
      // Out to whole device pixels, so no edge pixel is left half old and half new.
      const out = (v: number, round: (n: number) => number) => round(v * dpr) / dpr;
      const x0 = out(area.x + dx, Math.floor);
      const y0 = out(area.y + dy, Math.floor);
      const x1 = out(area.x + area.width + dx, Math.ceil);
      const y1 = out(area.y + area.height + dy, Math.ceil);
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
      ctx.clearRect(x0, y0, x1 - x0, y1 - y0);
      paintPart(ctx, frame, x0, y0, x1, y1);
    },

    paintBackground(ctx, frame) {
      startFrame(ctx, frame);
      paintBackground(ctx, list.background, frame, drawEnv(frame), shadows);
      ctx.restore();
    },

    hitTest(view, x, y) {
      const cx = x - originX(view) + view.scrollX;
      const cy = y - padding.top + view.scrollY;
      let nodeId: string | null = null;
      let scroll: ScrollEntry | null = null;
      for (const i of search(entryIndex, cx, cy, cx, cy)) {
        const entry = entries[i];
        if (entry === undefined || !contains(entry.bounds, cx, cy)) continue;
        nodeId = entry.nodeId;
        if (entry.type === "scroll" && contains(entry.shape, cx, cy)) scroll = entry;
      }
      let card: HitTarget | null = null;
      let last: HitTarget | null = null;
      for (const i of search(targetIndex, cx, cy, cx, cy)) {
        const target = list.targets[i];
        if (target === undefined || !contains(target.rect, cx, cy)) continue;
        if ("card" in target && target.card) {
          const area = target.rect.width * target.rect.height;
          if (card === null || area < card.rect.width * card.rect.height) card = target;
        } else {
          last = target;
        }
      }
      return { nodeId, target: last ?? card, scroll };
    },

    settle(frame) {
      const flat = (all: readonly DisplayEntry[]): DisplayEntry[] =>
        all.flatMap((e) => (e.type === "layer" ? flat(e.entries) : [e]));
      const cast = flat(entries).filter((entry): entry is ShadowEntry => entry.type === "shadow");
      shadows.keepOnly([...cast, ...backgroundShadows(list.background, frame)], frame.pixelRatio);
    },
  };
}
