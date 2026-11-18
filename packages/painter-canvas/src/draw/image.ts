import type { ImageEntry, Shape, StandIn } from "@md2ui/contracts";
import type { Context2D, DecodedImage, DrawEnv } from "../context.ts";
import { addShape, clipped, shapePath } from "../shape.ts";
import { drawFill } from "./fill.ts";
import { drawRuns } from "./text.ts";

const drawable = (image: DecodedImage | undefined): DecodedImage | undefined =>
  image !== undefined && image.width > 0 && image.height > 0 ? image : undefined;

/** A theme's placeholder (md2ui `render_image_placeholder`), inside the picture's clip. */
function drawStandIn(ctx: Context2D, entry: ImageEntry, standIn: StandIn, env: DrawEnv): void {
  const { shape, nodeId, bounds } = entry;
  for (const paint of standIn.paints) {
    drawFill(ctx, { type: "fill", nodeId, bounds, shape, paint }, env);
  }
  const { label } = standIn;
  if (label !== null) clipped(ctx, shape, () => drawRuns(ctx, env, label.y, label.runs));
}

/**
 * A content image (md2ui `draw_image_box`): its picture, or the host's loading
 * placeholder, fitted as the picture would be; with neither, the entry's own
 * placeholder. The shape is the region layout reserved and the clip: `cover` crops the
 * image to fill it, `contain` letterboxes the whole image inside it. The theme's
 * placeholder, when the entry has one, stands in for the host's: while the picture
 * loads, and once it failed, which the host tells by answering `loading` with the very
 * broken placeholder `images` answers.
 */
export function drawImage(ctx: Context2D, entry: ImageEntry, env: DrawEnv): void {
  const found = env.images(entry.src);
  const standing = env.loading(entry.src);
  const theirs =
    found === undefined
      ? entry.standIn?.loading
      : found === standing
        ? entry.standIn?.broken
        : null;
  if (theirs) {
    drawStandIn(ctx, entry, theirs, env);
    return;
  }
  const decoded = drawable(found) ?? drawable(standing);
  const { shape } = entry;
  if (decoded !== undefined) {
    const { source, width: iw, height: ih } = decoded;
    const fit = entry.fit === "auto" ? (decoded.vector ? "contain" : "cover") : entry.fit;
    ctx.save();
    ctx.clip(shapePath(shape));
    ctx.imageSmoothingEnabled = true;
    if (fit === "cover") {
      const scale = Math.max(shape.width / iw, shape.height / ih);
      const sw = shape.width / scale;
      const sh = shape.height / scale;
      ctx.drawImage(
        source,
        (iw - sw) / 2,
        (ih - sh) / 2,
        sw,
        sh,
        shape.x,
        shape.y,
        shape.width,
        shape.height,
      );
    } else {
      const scale = Math.min(shape.width / iw, shape.height / ih);
      const dw = iw * scale;
      const dh = ih * scale;
      ctx.drawImage(
        source,
        shape.x + (shape.width - dw) / 2,
        shape.y + (shape.height - dh) / 2,
        dw,
        dh,
      );
    }
    ctx.restore();
    return;
  }
  drawPlaceholder(ctx, shape, entry.placeholder.color);
  const { label } = entry.placeholder;
  if (label !== null) drawRuns(ctx, env, label.y, label.runs);
}

/**
 * md2ui's placeholder with no asset: a 1px outline of an oval, or both diagonals of any
 * other shape; unclipped, as md2ui draws it.
 */
function drawPlaceholder(ctx: Context2D, shape: Shape, color: string): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  const path = new Path2D();
  if (shape.kind === "oval") {
    addShape(path, shape);
  } else {
    path.moveTo(shape.x, shape.y);
    path.lineTo(shape.x + shape.width, shape.y + shape.height);
    path.moveTo(shape.x + shape.width, shape.y);
    path.lineTo(shape.x, shape.y + shape.height);
  }
  ctx.stroke(path);
}
