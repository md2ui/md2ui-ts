import type { TextEntry, TextRun } from "@md2ui/contracts";
import { canvasText } from "@md2ui/text-pretext";
import type { Context2D, DrawEnv } from "../context.ts";
import { useFont } from "../context.ts";
import { shapePath } from "../shape.ts";

/**
 * Draws runs on one baseline: one `fillText` per run at its own `x`, never with
 * `maxWidth`, so the line is exactly the one Pretext broke (ADR-403; md2ui `_draw_runs`).
 * Each text is handed over as the measurer handed it (`canvasText`).
 */
export function drawRuns(ctx: Context2D, env: DrawEnv, y: number, runs: readonly TextRun[]): void {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.direction = "ltr";
  for (const run of runs) {
    useFont(ctx, env, run.font);
    ctx.fillStyle = run.color;
    ctx.fillText(canvasText(run.text, run.font), run.x, y);
  }
}

/** One line of text, clipped when the scene asks (md2ui `draw_styled_text_box`). */
export function drawText(ctx: Context2D, entry: TextEntry, env: DrawEnv): void {
  if (entry.clip === undefined) {
    drawRuns(ctx, env, entry.y, entry.runs);
    return;
  }
  ctx.save();
  ctx.clip(shapePath(entry.clip));
  drawRuns(ctx, env, entry.y, entry.runs);
  ctx.restore();
  // `restore` brought back the font set before `save`.
  env.font = null;
}
