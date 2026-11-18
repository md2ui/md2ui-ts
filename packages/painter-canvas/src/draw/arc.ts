import type { ArcEntry } from "@md2ui/contracts";
import type { Context2D } from "../context.ts";

/**
 * A ring's value arc with round caps (md2ui `_draw_ring_arc`). Angles are degrees
 * clockwise from 3 o'clock, as Skia's `drawArc`; a negative sweep goes anticlockwise.
 */
export function drawArc(ctx: Context2D, entry: ArcEntry): void {
  const start = (entry.startAngle * Math.PI) / 180;
  const sweep = (entry.sweepAngle * Math.PI) / 180;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineWidth = entry.width;
  ctx.strokeStyle = entry.color;
  ctx.beginPath();
  ctx.arc(entry.cx, entry.cy, entry.radius, start, start + sweep, sweep < 0);
  ctx.stroke();
  ctx.restore();
}
