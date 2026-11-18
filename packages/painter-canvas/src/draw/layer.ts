// A layer (C4 `LayerEntry`; md2ui's `saveLayer` with an alpha): its entries painted at
// full opacity on a canvas of their own, which is then drawn at the layer's opacity, so a
// part over another still hides it. Canvas 2D has no layer in every supported engine, so
// an `OffscreenCanvas` is the layer: aligned to the target's device pixels, it is copied
// one to one, and the frame's clip and alpha apply to the copy as to any drawing.
import type { LayerEntry } from "@md2ui/contracts";
import type { Context2D, DrawEnv } from "../context.ts";

/** Paints layers; one per painter, so its canvases are reused frame after frame. */
export interface Layers {
  /** Paints `entry`: `paint` draws its entries on the layer's context. */
  draw(ctx: Context2D, entry: LayerEntry, env: DrawEnv, paint: (layer: Context2D) => void): void;
}

export function createLayers(): Layers {
  // One canvas per depth, as a layer may hold another; each grows to the largest layer
  // it has held, which the canvas it is drawn on bounds.
  const canvases: OffscreenCanvas[] = [];
  let depth = 0;
  return {
    draw(ctx, entry, env, paint) {
      const m = ctx.getTransform();
      const { x, y, width, height } = entry.bounds;
      // The device pixels the layer covers on the target, whole.
      const x0 = Math.max(0, Math.floor(m.a * x + m.e));
      const y0 = Math.max(0, Math.floor(m.d * y + m.f));
      const w = Math.min(ctx.canvas.width, Math.ceil(m.a * (x + width) + m.e)) - x0;
      const h = Math.min(ctx.canvas.height, Math.ceil(m.d * (y + height) + m.f)) - y0;
      if (w <= 0 || h <= 0) return;
      let canvas = canvases[depth];
      if (canvas === undefined) {
        canvas = new OffscreenCanvas(w, h);
        canvases[depth] = canvas;
      } else if (canvas.width < w || canvas.height < h) {
        canvas.width = Math.max(canvas.width, w);
        canvas.height = Math.max(canvas.height, h);
      }
      const layer = canvas.getContext("2d");
      if (layer === null) return;
      layer.setTransform(1, 0, 0, 1, 0, 0);
      layer.clearRect(0, 0, w, h);
      layer.setTransform(m.a, m.b, m.c, m.d, m.e - x0, m.f - y0);
      // The layer's context has a font of its own.
      const font = env.font;
      env.font = null;
      depth++;
      paint(layer);
      depth--;
      env.font = font;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha *= entry.opacity;
      ctx.drawImage(canvas, 0, 0, w, h, x0, y0, w, h);
      ctx.restore();
    },
  };
}
