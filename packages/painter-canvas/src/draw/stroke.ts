import type { StrokeEntry } from "@md2ui/contracts";
import type { Context2D } from "../context.ts";
import { clipped, shapePath } from "../shape.ts";

/**
 * Skia's default miter limit, which md2ui strokes with. Canvas's is 10: at a corner
 * sharper than about 29° Canvas would still draw a spike where Skia bevels.
 */
const MITER_LIMIT = 4;

/**
 * Strokes the outline, centred on its edge (md2ui `render_shadows.draw_stroke`, and
 * `drawPath` with a stroke paint).
 */
export function drawStroke(ctx: Context2D, entry: StrokeEntry): void {
  clipped(ctx, entry.clip, () => {
    ctx.save();
    ctx.lineJoin = entry.join ?? "miter";
    ctx.lineCap = entry.cap ?? "butt";
    ctx.miterLimit = MITER_LIMIT;
    ctx.lineWidth = entry.width;
    ctx.strokeStyle = entry.color;
    ctx.stroke(shapePath(entry.shape));
    ctx.restore();
  });
}
