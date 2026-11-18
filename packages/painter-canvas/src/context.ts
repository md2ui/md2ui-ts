import type { FontSpec } from "@md2ui/contracts";
import { type FontVariations, setCanvasFont } from "@md2ui/text-pretext";

/** Either Canvas 2D context: the painter paints on a page or in a Worker (ADR-402). */
export type Context2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** An image the host has decoded; the painter never fetches. */
export interface DecodedImage {
  /** What `drawImage` draws: an `ImageBitmap`, a loaded `<img>`, a canvas. */
  readonly source: CanvasImageSource;
  /**
   * Width of `source`, in its own pixels: the picture's, or fewer when the host decoded
   * it reduced. With `height`, the picture's aspect; layout never reads either.
   */
  readonly width: number;
  /** Height of `source`, in its own pixels. */
  readonly height: number;
  /** An SVG: `fit: "auto"` contains it whole rather than cropping it (md2ui `draw_image_box`). */
  readonly vector: boolean;
}

/**
 * How far a code block is scrolled: its lines moved left by `x` and up by `y`, CSS px.
 * Each runs from 0 to the entry's range, and past it while a platform bounces the block.
 */
export interface ScrollOffset {
  /** Across: 0 to the entry's `contentWidth - shape.width`. */
  readonly x: number;
  /** Down: 0 to the entry's `contentHeight - shape.height`. */
  readonly y: number;
}

/** A picture the host has for `src`, or `undefined` when it has none. */
export type ImageLookup = (src: string) => DecodedImage | undefined;

/** What a draw function reads besides its entry. One per frame; never module state. */
export interface DrawEnv {
  /** The decoded image, or the placeholder standing in for it (`Frame.images`). */
  readonly images: ImageLookup;
  /** The loading placeholder for a content image `images` has nothing for. */
  readonly loading: ImageLookup;
  /**
   * Device pixels per content pixel. Canvas shadow offsets and blur ignore the
   * transform, so the shadow drawer scales them itself.
   */
  readonly scale: number;
  /** How far the host has scrolled each `scroll` entry, by node id; absent is at rest. */
  readonly offsets: ReadonlyMap<string, ScrollOffset>;
  /** The `scroll` entry under the pointer, whose thumbs show (`Frame.hovered`). */
  readonly hovered: string | null;
  /** The variable-font instances the page registered (`Frame.variations`). */
  readonly variations: FontVariations | undefined;
  /** The font this frame last set on the context, so a run in the same font sets none. */
  font: FontSpec | null;
}

function sameFont(a: FontSpec, b: FontSpec): boolean {
  return (
    a.size === b.size &&
    a.weight === b.weight &&
    a.italic === b.italic &&
    a.families.length === b.families.length &&
    a.families.every((family, i) => family === b.families[i])
  );
}

/**
 * Sets `font` through the text layer's routine (ADR-403), unless it is the font this
 * frame already set: the routine's placeholder step makes every call cost two font
 * parses, and a line of text repeats one font run after run.
 */
export function useFont(ctx: Context2D, env: DrawEnv, font: FontSpec): void {
  if (env.font !== null && sameFont(env.font, font)) return;
  setCanvasFont(ctx, font, env.variations);
  env.font = font;
}
