// The images a display list names, as one view reads them (the painter never
// fetches). The pictures themselves are its registration's (pictures.ts), shared by
// every view that shows the same URL; the view holds those its lists name until it goes.
//
// A picture is also in one of md2ui's two placeholder states (`render_placeholders`):
// loading, until its fetch answers, or failed, once the fetch or the decode did. Both
// are paint states only: nothing here reaches a box, a kind or a run. A fetch never
// made is not a failure. A theme's background image is a picture like any other: one
// that fails paints the broken placeholder wherever the theme puts it (md2ui
// `theme_picture`).
import type { DisplayEntry, DisplayList, ImageEntry, Paint } from "@md2ui/contracts";
import type { DecodedImage, ImageLookup } from "@md2ui/painter-canvas";
import type { Holder, Need, Pictures } from "./pictures.ts";
import { BROKEN_SVG, LOADING_SVG, rasterise } from "./placeholders.ts";

export interface ImageStore {
  /**
   * What the painter reads: an image once decoded; for one that failed, the broken
   * placeholder, once it is decoded; for a photo card's photo still loading over a
   * fallback that failed, the loading placeholder, since nothing of the card's own has
   * failed yet (md2ui `card_photo`); otherwise `undefined`, so a photo card still
   * loading paints its fallback.
   */
  readonly lookup: ImageLookup;
  /**
   * What a content image paints while `lookup` has nothing for it: the loading
   * placeholder, contained like a vector when the image is known to be an SVG;
   * `undefined` until the placeholder is decoded. For an image that failed, the broken
   * placeholder `lookup` answers too, which tells the painter to paint the theme's
   * placeholder for a failed picture in its place (md2ui ADR-406).
   */
  readonly loading: ImageLookup;
  /**
   * Holds every image `list` names, for the boxes it draws them in at `pixelRatio`
   * device pixels per CSS pixel, the page background's being `screen` (the most of the
   * view that shows at once, in CSS pixels): a new one starts loading, one drawn larger
   * than before may be decoded again.
   */
  request(list: DisplayList, pixelRatio: number, screen: Size): void;
  /** Lets go of every image and frees the placeholders. */
  dispose(): void;
}

/** A box in CSS pixels. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** A need growing as boxes are added. */
interface Growing {
  cover: { width: number; height: number };
  contain: { width: number; height: number };
}

/**
 * What a list names: every `src` (content images, image paints and their fallbacks)
 * with the largest boxes it is drawn in, each photo's fallback by the photo, and whether
 * it holds a content image, which paints the loading placeholder from its first frame.
 */
function sources(
  list: DisplayList,
  pixelRatio: number,
  screen: Size,
): { needs: Map<string, Need>; fallbacks: Map<string, string>; contentImages: boolean } {
  const needs = new Map<string, Growing>();
  const fallbacks = new Map<string, string>();
  let contentImages = false;
  const box = (src: string, fit: ImageEntry["fit"], width: number, height: number): void => {
    let need = needs.get(src);
    if (need === undefined) {
      need = { cover: { width: 0, height: 0 }, contain: { width: 0, height: 0 } };
      needs.set(src, need);
    }
    // A raster's `auto` crops to fill; only an SVG is contained by it, and an SVG is
    // never reduced.
    const grown = fit === "contain" ? need.contain : need.cover;
    grown.width = Math.max(grown.width, width * pixelRatio);
    grown.height = Math.max(grown.height, height * pixelRatio);
  };
  const paint = (p: Paint, width: number, height: number): void => {
    if (p.kind !== "image") return;
    box(p.src, "cover", width, height);
    if (p.fallbackSrc === null) return;
    box(p.fallbackSrc, "cover", width, height);
    fallbacks.set(p.src, p.fallbackSrc);
  };
  // The page background fills the view's visible part (md2ui `draw_document`).
  for (const p of list.background.paints) paint(p, screen.width, screen.height);
  const visit = (entry: DisplayEntry): void => {
    if (entry.type === "image") {
      box(entry.src, entry.fit, entry.shape.width, entry.shape.height);
      contentImages = true;
      // A theme placeholder's own image, cover-fitted in the picture's shape.
      for (const s of [entry.standIn?.loading, entry.standIn?.broken]) {
        for (const p of s?.paints ?? []) paint(p, entry.shape.width, entry.shape.height);
      }
    } else if (entry.type === "fill") paint(entry.paint, entry.shape.width, entry.shape.height);
    // A muted count button's picture is in its layer.
    else if (entry.type === "layer") entry.entries.forEach(visit);
  };
  list.entries.forEach(visit);
  needs.delete("");
  return { needs, fallbacks, contentImages };
}

/** `bitmap` as the painter reads it; `vector` picks its `fit: "auto"`. */
const asImage = (bitmap: ImageBitmap, vector: boolean): DecodedImage => ({
  source: bitmap,
  width: bitmap.width,
  height: bitmap.height,
  vector,
});

/**
 * A view's store over `pictures`, which resolves a relative `src` against `pageBase`, as
 * an `<img>` would (ADR-006). `onLoad` is called whenever what the store answers changes
 * (an image arrives, fails, or a placeholder is decoded), `onError` when an image fails.
 */
export function createImageStore(
  pictures: Pictures,
  pageBase: string,
  onLoad: () => void,
  onError: (url: string, message: string) => void,
): ImageStore {
  /** Each `src` this view holds, to the URL its picture is held under. */
  const held = new Map<string, string>();
  /** Each photo card's photo, to the theme image it falls back to. */
  const fallbacks = new Map<string, string>();
  let disposed = false;
  /**
   * The placeholders, decoded once: with the first content image, or with the first
   * failure, before which nothing else can show one.
   */
  let placeholdersAsked = false;
  let loadingRaster: DecodedImage | undefined;
  let loadingVector: DecodedImage | undefined;
  let broken: DecodedImage | undefined;

  /** Decodes `svg` and hands it to `keep`, unless the view went first. */
  const placeholder = (svg: string, keep: (bitmap: ImageBitmap) => void): void => {
    rasterise(svg).then(
      (bitmap) => {
        if (disposed) {
          bitmap.close();
          return;
        }
        keep(bitmap);
        onLoad();
      },
      // Undecodable, a placeholder stays what md2ui draws with no asset.
      () => {},
    );
  };

  const askPlaceholders = (): void => {
    if (placeholdersAsked) return;
    placeholdersAsked = true;
    placeholder(LOADING_SVG, (bitmap) => {
      loadingRaster = asImage(bitmap, false);
      loadingVector = asImage(bitmap, true);
    });
    placeholder(BROKEN_SVG, (bitmap) => {
      broken = asImage(bitmap, false);
    });
  };

  const holder: Holder = {
    changed: onLoad,
    failed(url, message) {
      askPlaceholders();
      onError(url, message);
      onLoad();
    },
  };

  /** `src` resolved as an `<img>` would; one that is no URL is held as written, and fails. */
  const resolve = (src: string): string => {
    try {
      return new URL(src, pageBase).href;
    } catch {
      return src;
    }
  };

  const picture = (src: string) => {
    const url = held.get(src);
    return url === undefined ? undefined : pictures.picture(url);
  };

  const failed = (src: string): boolean => picture(src)?.failed === true;

  return {
    lookup: (src) => {
      const found = picture(src);
      if (found?.image !== undefined) return found.image;
      if (found?.failed === true) return broken;
      const fallback = fallbacks.get(src);
      return fallback !== undefined && failed(fallback) ? loadingRaster : undefined;
    },
    loading: (src) => {
      const found = picture(src);
      if (found?.failed === true) return broken;
      return found?.vector === true ? loadingVector : loadingRaster;
    },
    request(list, pixelRatio, screen) {
      if (disposed) return;
      const named = sources(list, pixelRatio, screen);
      for (const [photo, fallback] of named.fallbacks) fallbacks.set(photo, fallback);
      if (named.contentImages) askPlaceholders();
      for (const [src, need] of named.needs) {
        let url = held.get(src);
        if (url === undefined) {
          url = resolve(src);
          held.set(src, url);
        }
        pictures.hold(url, holder, need);
      }
    },
    dispose() {
      disposed = true;
      for (const url of new Set(held.values())) pictures.release(url, holder);
      held.clear();
      for (const image of [loadingRaster, broken]) {
        if (image?.source instanceof ImageBitmap) image.source.close();
      }
      loadingRaster = loadingVector = broken = undefined;
    },
  };
}
