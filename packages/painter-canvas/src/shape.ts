import type { Outline, Shape } from "@md2ui/contracts";
import type { Context2D } from "./context.ts";

/**
 * Adds `shape`, moved by `(dx, dy)`, to `path`: the outline md2ui's `shape_path` gives
 * a fill, its clip and its shadows alike. Canvas scales radii that overlap down, as
 * Skia does; a negative radius would throw, so it is floored at 0. A path's data is the
 * platform's to read, placed at its frame.
 */
export function addShape(path: Path2D, shape: Outline, dx = 0, dy = 0): void {
  const x = shape.x + dx;
  const y = shape.y + dy;
  if (shape.kind === "path") {
    path.addPath(new Path2D(shape.d), { e: x, f: y });
  } else if (shape.kind === "oval") {
    const rx = shape.width / 2;
    const ry = shape.height / 2;
    path.ellipse(x + rx, y + ry, Math.max(0, rx), Math.max(0, ry), 0, 0, 2 * Math.PI);
  } else if (shape.kind === "roundRect") {
    path.roundRect(
      x,
      y,
      shape.width,
      shape.height,
      shape.radii.map((r) => Math.max(0, r)),
    );
  } else {
    path.rect(x, y, shape.width, shape.height);
  }
}

export function shapePath(shape: Outline, dx = 0, dy = 0): Path2D {
  const path = new Path2D();
  addShape(path, shape, dx, dy);
  return path;
}

/** Runs `paint` clipped to `clip`, when there is one. */
export function clipped(ctx: Context2D, clip: Shape | undefined, paint: () => void): void {
  if (clip === undefined) {
    paint();
    return;
  }
  ctx.save();
  ctx.clip(shapePath(clip));
  paint();
  ctx.restore();
}
