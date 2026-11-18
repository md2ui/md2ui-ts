import type { FillEntry } from "@md2ui/contracts";
import type { Context2D, DecodedImage, DrawEnv } from "../context.ts";
import { clipped, shapePath } from "../shape.ts";

/**
 * The photo (or the placeholder the host shows for it), or the fallback while it
 * loads; none when neither is usable.
 */
function pickImage(
  entry: FillEntry,
  paint: { readonly src: string; readonly fallbackSrc: string | null },
  env: DrawEnv,
): DecodedImage | undefined {
  const image =
    env.images(paint.src) ??
    (paint.fallbackSrc === null ? undefined : env.images(paint.fallbackSrc));
  if (image === undefined || image.width <= 0 || image.height <= 0) return undefined;
  return entry.shape.width > 0 && entry.shape.height > 0 ? image : undefined;
}

/**
 * Paints one layer of md2ui's `_paint_layered_fill` into the shape: a colour, a
 * linear gradient over the shape's bounding rect, or an image cover-fit and centred
 * in it and clipped to the shape.
 */
export function drawFill(ctx: Context2D, entry: FillEntry, env: DrawEnv): void {
  const { shape, paint } = entry;
  clipped(ctx, entry.clip, () => {
    if (paint.kind === "color") {
      ctx.fillStyle = paint.color;
      ctx.fill(shapePath(shape));
    } else if (paint.kind === "linearGradient") {
      const gradient = ctx.createLinearGradient(
        shape.x + paint.start[0] * shape.width,
        shape.y + paint.start[1] * shape.height,
        shape.x + paint.end[0] * shape.width,
        shape.y + paint.end[1] * shape.height,
      );
      for (const stop of paint.stops) {
        gradient.addColorStop(Math.min(1, Math.max(0, stop.offset)), stop.color);
      }
      ctx.fillStyle = gradient;
      ctx.fill(shapePath(shape));
    } else {
      const image = pickImage(entry, paint, env);
      if (image === undefined) return;
      const scale = Math.max(shape.width / image.width, shape.height / image.height);
      const sw = shape.width / scale;
      const sh = shape.height / scale;
      ctx.save();
      ctx.clip(shapePath(shape));
      ctx.globalAlpha *= paint.opacity ?? 1;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(
        image.source,
        (image.width - sw) / 2,
        (image.height - sh) / 2,
        sw,
        sh,
        shape.x,
        shape.y,
        shape.width,
        shape.height,
      );
      ctx.restore();
    }
  });
}
