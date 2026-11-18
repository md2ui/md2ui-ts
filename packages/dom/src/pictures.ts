// The pictures a registration's views draw (the painter never fetches), one per URL
// however many views show it, held while any of them holds it and given back when the
// last one lets go. They live on the registration, as its faces do, never in the module.
//
// A raster is decoded at about twice the size it is drawn in device pixels, never above
// its source: most of a page's memory is its decoded pictures, and a photo 4,500 px wide
// drawn 350 px wide would otherwise hold 80 MB. md2ui makes the same choice (`image_cache`
// `_SLACK`): twice the drawn pixels, which a scaled draw brings down to the box without
// losing what an area-averaged reduction keeps. The picture's size is read from its header
// and the decode reduces with the browser's own resampler (`createImageBitmap`'s resize
// options, ADR-007); an engine that ignored them would hold the whole picture, as before.
// When a draw comes to need more than the held decode has (a wider view, a higher pixel
// ratio), the picture is decoded again, larger, and the held one is drawn scaled until the
// new one lands. The view asks for that only once a resize rests: a decode holds the
// thread that asks for it in WebKit, so a decode during a drag would cost the drag a frame,
// or delay the Worker's next layout. What a box, a kind or a run is never depends on a
// decode: layout reads no picture.
//
// A picture fetched as a blob is decoded by the registration's `decode` (sessions.ts): in
// the pipeline's Worker when the views run in one, so that neither WebKit's decode nor
// Chromium's scaling takes a frame from the page. An SVG and an `<img>`-read
// picture are decoded on the page, which alone has their decoder.
//
// Native first (ADR-007): `fetch` goes through the browser's HTTP cache, and an SVG is
// decoded by the browser's own `<img>`, kept whole, which the painter scales without
// blurring. A host that sends no CORS header answers `fetch` with a network error, while
// md2ui, which reads with no CORS, shows the picture: such a picture is asked for once
// more as a plain `<img>`, which needs no CORS to be drawn, and decoded from
// it at the same reduced size. Drawing it leaves the view's canvas origin-unclean: nothing
// in md2ui-ts reads pixels back from it.
import type { DecodedImage } from "@md2ui/painter-canvas";
import { imageDimensionsFromStream } from "image-dimensions";
import type { Decode } from "./sessions.ts";

/** A box in device pixels. */
interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * The largest boxes a view draws a picture in, in device pixels: one it crops the picture
 * to fill (`cover`), one it fits the whole picture in (`contain`).
 */
export interface Need {
  readonly cover: Size;
  readonly contain: Size;
}

/** A view holding pictures: told when one changes, and when one fails. */
export interface Holder {
  /** A picture it holds arrived, arrived larger, or is now known to be an SVG. */
  changed(): void;
  /** A picture it holds could not be fetched or decoded; `message` says why. */
  failed(url: string, message: string): void;
}

/** A picture as its holders read it. */
interface Picture {
  /** What the painter draws; `undefined` while it loads and once it failed. */
  readonly image: DecodedImage | undefined;
  /** Known to be an SVG, which `fit: "auto"` contains (md2ui `draw_image_box`). */
  readonly vector: boolean;
  readonly failed: boolean;
}

export interface Pictures {
  /**
   * `holder` holds `url` for boxes up to `need`, which replaces what it needed before:
   * the first hold loads it, a larger need decodes it again when the held decode falls
   * short. A holder that holds a failed picture is told so.
   */
  hold(url: string, holder: Holder, need: Need): void;
  /** `holder` lets `url` go; the last to let go frees it, or stops its load. */
  release(url: string, holder: Holder): void;
  /** `url`'s picture, while anyone holds it. */
  picture(url: string): Picture | undefined;
}

/**
 * Decoded pixels per drawn device pixel. Twice: md2ui's `_SLACK`, chosen against an
 * area-averaged reference (md2ui 8d4a3241).
 */
const SLACK = 2;

/**
 * The resampler a reduced decode asks for. "medium" matched an area-averaged reference
 * at least as well as "high" in all three engines, and better in WebKit, whose "high"
 * aliases fine detail (109 photo draws of the tests-render corpus).
 */
const RESIZE: ResizeQuality = "medium";

const SVG = "image/svg+xml";

/** An SVG, which `fit: "auto"` contains rather than crops (md2ui `draw_image_box`). */
function isVector(url: URL, type: string): boolean {
  return type === SVG || url.pathname.toLowerCase().endsWith(".svg");
}

/** A raster picture, kept encoded so it can be decoded again at another width. */
interface Raster {
  readonly width: number;
  readonly height: number;
  decode(width: number): Promise<ImageBitmap>;
}

/** How wide `need` draws a `width` × `height` picture whole, in device pixels. */
function drawnWidth(need: Need, width: number, height: number): number {
  const cover = Math.max(need.cover.width / width, need.cover.height / height);
  const contain = Math.min(need.contain.width / width, need.contain.height / height);
  return Math.max(cover, contain) * width;
}

/**
 * The width a raster is decoded at for `drawn` device pixels across: `SLACK` times, or its
 * own when that would keep half its pixels or more. Chromium scales a reduced decode on
 * the thread that asks for it, which only a real saving pays for, and decodes a whole one
 * off it: a 4,500 px photo reduced to 4,416 held the page for a 167 ms frame, and in the
 * Worker holds its layouts for 140 ms against none whole.
 */
function decodeWidth(raster: Raster, drawn: number): number {
  const width = Math.max(1, Math.ceil(SLACK * drawn));
  return width >= raster.width * Math.SQRT1_2 ? raster.width : width;
}

/** `image`'s pixels given back now, not when it is collected. */
function free(image: DecodedImage): void {
  if (image.source instanceof ImageBitmap) image.source.close();
  else if (image.source instanceof HTMLImageElement) image.source.removeAttribute("src");
}

const asImage = (bitmap: ImageBitmap): DecodedImage => ({
  source: bitmap,
  width: bitmap.width,
  height: bitmap.height,
  vector: false,
});

/** One URL's picture and who holds it. */
class Entry implements Picture {
  readonly url: string;
  image: DecodedImage | undefined = undefined;
  vector = false;
  failed = false;
  failure = "";
  /** What each holder last asked for. */
  readonly holders = new Map<Holder, Need>();
  readonly abort = new AbortController();
  /** The `<img>`s loading this picture: an `<img>` takes no abort signal. */
  readonly opening = new Set<HTMLImageElement>();
  /** The object URL an SVG is drawn from: an `<img>` keeps reading its source. */
  objectUrl = "";
  /**
   * The encoded raster while it may be decoded larger; `null` for an SVG, a failure, a
   * decode that failed, or one decoded whole.
   */
  raster: Raster | null = null;
  /** A decode is on its way. */
  decoding = false;

  constructor(url: string) {
    this.url = url;
  }

  get gone(): boolean {
    return this.abort.signal.aborted;
  }

  /** How wide its holders draw it, in device pixels, at most. */
  drawn(raster: Raster): number {
    let widest = 0;
    for (const need of this.holders.values()) {
      widest = Math.max(widest, drawnWidth(need, raster.width, raster.height));
    }
    return widest;
  }

  changed(): void {
    for (const holder of this.holders.keys()) holder.changed();
  }

  /** `img` loaded from `src`, kept in `opening` until it answers. */
  async load(img: HTMLImageElement, src: string): Promise<void> {
    this.opening.add(img);
    try {
      img.src = src;
      await img.decode();
    } finally {
      this.opening.delete(img);
    }
  }

  dispose(): void {
    this.abort.abort();
    for (const img of this.opening) img.removeAttribute("src");
    if (this.image !== undefined) free(this.image);
    this.image = undefined;
    if (this.objectUrl !== "") URL.revokeObjectURL(this.objectUrl);
  }
}

/** The pictures of one registration's views, whose fetched rasters `decode` decodes. */
export function createPictures(decode: Decode): Pictures {
  const entries = new Map<string, Entry>();

  /** An SVG `blob`, decoded whole by an `<img>`. */
  const vector = async (entry: Entry, blob: Blob): Promise<DecodedImage> => {
    // Not every engine's `createImageBitmap` takes an SVG blob; the `<img>` decoder does.
    const svg = blob.type === SVG ? blob : new Blob([blob], { type: SVG });
    entry.objectUrl = URL.createObjectURL(svg);
    const img = new Image();
    await entry.load(img, entry.objectUrl);
    return { source: img, width: img.naturalWidth, height: img.naturalHeight, vector: true };
  };

  /**
   * `url` as a plain `<img>`, with no `crossorigin`, for a host `fetch` may not read. A
   * vector, told by its URL alone, stays the `<img>`; a raster is decoded from an `<img>`
   * at the size asked, the first time from the one that read its size.
   */
  const opaque = async (entry: Entry, url: URL): Promise<DecodedImage | Raster> => {
    if (isVector(url, "")) {
      entry.vector = true;
      entry.changed();
    }
    let img: HTMLImageElement | null = new Image();
    await entry.load(img, url.href);
    if (entry.vector) {
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, vector: true };
    }
    const { naturalWidth: width, naturalHeight: height } = img;
    return {
      width,
      height,
      decode: async (w) => {
        const from = img ?? new Image();
        img = null;
        try {
          if (from.getAttribute("src") === null) await entry.load(from, url.href);
          return await createImageBitmap(from, resizing(width, w));
        } finally {
          // The bitmap is what is kept and drawn; the `<img>` lets go of its own copy.
          from.removeAttribute("src");
        }
      },
    };
  };

  /**
   * `url`'s picture through `fetch` and the HTTP cache. A `fetch` that rejects failed on
   * the network, which is what a host sending no CORS header gives (an HTTP status is an
   * answer, not this): the picture is then asked for once as an `<img>`, and if that fails
   * too, the fetch's own cause is what is reported.
   */
  const open = async (entry: Entry, url: URL): Promise<DecodedImage | Raster> => {
    let response: Response;
    try {
      response = await fetch(url, { signal: entry.abort.signal });
    } catch (cause) {
      if (entry.gone) throw cause;
      return opaque(entry, url).catch(() => Promise.reject(cause));
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (isVector(url, response.headers.get("content-type") ?? "")) {
      entry.vector = true;
      entry.changed();
    }
    const blob = await response.blob();
    if (isVector(url, blob.type)) return vector(entry, blob);
    // The size its header names, read without decoding it (ADR-007: `image-dimensions`);
    // a format it does not read is decoded whole, as every picture was before.
    const size = await imageDimensionsFromStream(blob.stream());
    if (size === undefined) return asImage(await decode(blob, {}));
    return {
      width: size.width,
      height: size.height,
      decode: (w) => decode(blob, resizing(size.width, w)),
    };
  };

  /**
   * Decodes `entry`'s raster for what its holders draw now, when the held decode is
   * smaller than that and smaller than the raster; swaps it in once decoded.
   */
  const fit = (entry: Entry): void => {
    const { raster } = entry;
    if (raster === null || entry.decoding) return;
    const drawn = entry.drawn(raster);
    const held = entry.image?.width ?? 0;
    if (held >= raster.width || (held > 0 && held >= drawn)) return;
    entry.decoding = true;
    raster.decode(decodeWidth(raster, drawn)).then(
      (bitmap) => {
        entry.decoding = false;
        if (entry.gone) {
          bitmap.close();
          return;
        }
        const old = entry.image;
        entry.image = asImage(bitmap);
        if (old !== undefined) free(old);
        // A header names the stored size; a picture its EXIF data turns decodes turned.
        if (bitmap.width > bitmap.height !== raster.width > raster.height) {
          entry.raster = { ...raster, width: raster.height, height: raster.width };
        }
        // Decoded whole, it is never decoded again: its encoded bytes can go.
        if (bitmap.width >= (entry.raster?.width ?? 0)) entry.raster = null;
        entry.changed();
        fit(entry);
      },
      (cause: unknown) => {
        entry.decoding = false;
        entry.raster = null;
        // A larger decode that fails keeps the one held; a first one is a failure.
        if (!entry.gone && entry.image === undefined) fail(entry, cause);
      },
    );
  };

  const fail = (entry: Entry, cause: unknown): void => {
    entry.failed = true;
    entry.failure = cause instanceof Error ? cause.message : String(cause);
    for (const holder of entry.holders.keys()) holder.failed(entry.url, entry.failure);
  };

  const start = async (entry: Entry): Promise<void> => {
    let opened: DecodedImage | Raster;
    try {
      opened = await open(entry, new URL(entry.url));
    } catch (cause) {
      if (!entry.gone) fail(entry, cause);
      return;
    }
    if (entry.gone) {
      if ("source" in opened) free(opened);
      return;
    }
    if ("source" in opened) {
      entry.image = opened;
      entry.changed();
      return;
    }
    entry.raster = opened;
    fit(entry);
  };

  return {
    hold(url, holder, need) {
      let entry = entries.get(url);
      if (entry === undefined) {
        entry = new Entry(url);
        entries.set(url, entry);
        entry.holders.set(holder, need);
        void start(entry);
        return;
      }
      const fresh = !entry.holders.has(holder);
      entry.holders.set(holder, need);
      if (fresh && entry.failed) holder.failed(url, entry.failure);
      else if (fresh && entry.image !== undefined) holder.changed();
      fit(entry);
    },
    release(url, holder) {
      const entry = entries.get(url);
      if (entry === undefined || !entry.holders.delete(holder)) return;
      if (entry.holders.size > 0) return;
      entries.delete(url);
      entry.dispose();
    },
    picture: (url) => entries.get(url),
  };
}

/**
 * `createImageBitmap`'s options for a raster `width` wide decoded `w` wide. Only the width
 * is named: the browser keeps the aspect of the picture as it decodes it, so a decode that
 * turns it by its EXIF orientation differently from the `<img>` that measured it is never
 * stretched.
 */
function resizing(width: number, w: number): ImageBitmapOptions {
  return w >= width ? {} : { resizeWidth: w, resizeQuality: RESIZE };
}
