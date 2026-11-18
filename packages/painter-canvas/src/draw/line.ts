import type { LineEntry } from "@md2ui/contracts";
import type { Context2D } from "../context.ts";
import { clipped } from "../shape.ts";

/**
 * A butt-capped segment: md2ui's horizontal rule, row separator and the underline and
 * strike-through lines of styled text (`layout_render.draw_horizontal_rule` and kin).
 */
export function drawLine(ctx: Context2D, entry: LineEntry): void {
  clipped(ctx, entry.clip, () => {
    ctx.save();
    ctx.lineCap = "butt";
    ctx.lineWidth = entry.width;
    ctx.strokeStyle = entry.color;
    ctx.beginPath();
    ctx.moveTo(entry.x0, entry.y0);
    ctx.lineTo(entry.x1, entry.y1);
    ctx.stroke();
    ctx.restore();
  });
}
