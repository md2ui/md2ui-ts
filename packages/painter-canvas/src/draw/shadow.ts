import type { ShadowEntry } from "@md2ui/contracts";
import type { Context2D, DrawEnv } from "../context.ts";
import { addShape, shapePath } from "../shape.ts";

/**
 * Slack added to a rect an inner shadow subtracts its shape from, so the blur of that
 * rect's own outer edge cannot reach back into the clipped region (md2ui `_INNER_MARGIN`).
 */
const INNER_MARGIN = 8;

/**
 * Draws one shadow layer (md2ui `render_shadows._paint_outer` / `_paint_inner`).
 *
 * Canvas has no blur mask filter that works in every engine, only the shadow of a
 * fill. So the silhouette is drawn `k` content px left of where its shadow is wanted,
 * with the shadow offset pushed back right by `k`: the shadow lands in place and the
 * silhouette itself falls outside the clip. Shadow offset and blur ignore the
 * transform, so both are scaled by `env.scale`; `shadowBlur` is 2 sigma and sigma is
 * `radius / 4` (md2ui `SHADOW_SIGMA_RATIO`).
 */
export function drawShadow(ctx: Context2D, entry: ShadowEntry, env: DrawEnv): void {
  const { shape, radius, offsetX, offsetY } = entry;
  if (shape.width <= 0 || shape.height <= 0) return;

  ctx.save();
  if (entry.clip !== undefined) ctx.clip(shapePath(entry.clip));

  // A rect holding the grown box, the moved shape and the blur's reach alike.
  const margin = radius + Math.abs(offsetX) + Math.abs(offsetY) + INNER_MARGIN;
  const field = new Path2D();
  field.rect(
    shape.x - margin,
    shape.y - margin,
    shape.width + 2 * margin,
    shape.height + 2 * margin,
  );
  // Far enough left that the drawn silhouette clears everything the clip lets through.
  const k = shape.width + 2 * margin + radius;

  if (entry.inner) {
    // Blur the outside of the moved shape, seen only through the shape itself.
    ctx.clip(shapePath(shape));
    addShape(field, shape, offsetX, offsetY);
  } else {
    // Blur the moved shape, seen only in the grown box and never through the shape.
    const reach = radius / 2;
    const box = new Path2D();
    box.rect(
      shape.x - reach + offsetX,
      shape.y - reach + offsetY,
      shape.width + radius,
      shape.height + radius,
    );
    ctx.clip(box);
    const cutOut = new Path2D(field);
    addShape(cutOut, shape);
    ctx.clip(cutOut, "evenodd");
  }

  ctx.shadowColor = entry.color;
  ctx.shadowBlur = (radius / 2) * env.scale;
  ctx.fillStyle = "#000000";
  ctx.setTransform(ctx.getTransform().translate(-k, 0));
  if (entry.inner) {
    ctx.shadowOffsetX = k * env.scale;
    ctx.shadowOffsetY = 0;
    ctx.fill(field, "evenodd");
  } else {
    ctx.shadowOffsetX = (k + offsetX) * env.scale;
    ctx.shadowOffsetY = offsetY * env.scale;
    ctx.fill(shapePath(shape));
  }
  ctx.restore();
}
