import type { Color, Rect, ScrollEntry } from "@md2ui/contracts";
import type { Context2D, DrawEnv } from "../context.ts";
import { shapePath } from "../shape.ts";
import { drawText } from "./text.ts";

/** How far a fade reaches in from the edge it covers (md2ui `FADE_WIDTH`). */
const FADE_WIDTH = 32;
/** A block's thumb: thinner than a page scrollbar (md2ui `_BLOCK_THUMB_H`). */
const THUMB = 4;
/** How far in from the block's bottom and right edges its thumbs run (md2ui `_THUMB_INSET`). */
const THUMB_INSET = 8;
/** md2ui `_SCROLLBAR_COLOR`: the page scrollbars' grey, ARGB (160, 80, 80, 80). */
const THUMB_COLOR = "rgb(80 80 80 / 0.627)";

type Edge = "left" | "right" | "top" | "bottom";

/**
 * The block's background colour, transparent at the inner edge of a band and opaque at
 * `rect`'s `edge` (md2ui `_paint_fade`). `color` is `#rrggbbaa`.
 */
function paintFade(ctx: Context2D, rect: Rect, color: Color, edge: Edge): void {
  const across = edge === "left" || edge === "right";
  const start = across ? rect.x : rect.y;
  const length = across ? rect.width : rect.height;
  const band = Math.min(FADE_WIDTH, length);
  const outer = edge === "right" || edge === "bottom" ? start + length : start;
  const inner = outer === start ? outer + band : outer - band;
  const gradient = across
    ? ctx.createLinearGradient(inner, 0, outer, 0)
    : ctx.createLinearGradient(0, inner, 0, outer);
  gradient.addColorStop(0, `${color.slice(0, 7)}00`);
  gradient.addColorStop(1, color);
  ctx.fillStyle = gradient;
  const from = Math.min(inner, outer);
  if (across) ctx.fillRect(from, rect.y, band, rect.height);
  else ctx.fillRect(rect.x, from, rect.width, band);
}

/** A thumb's track: where it starts and how long it runs along its axis, and where across. */
interface Track {
  readonly start: number;
  readonly length: number;
  readonly at: number;
}

/**
 * md2ui `draw_block_thumb`: where `view` of `content` sits at `offset` along `track`,
 * across or down; none when everything shows.
 */
function thumb(
  ctx: Context2D,
  vertical: boolean,
  track: Track,
  offset: number,
  view: number,
  content: number,
): void {
  if (content <= view || track.length <= 0) return;
  const size = Math.max(20, (track.length * view) / content);
  // A block bounced past its end keeps its thumb at that end of the track.
  const at = Math.min(content - view, Math.max(0, offset));
  const along = track.start + (at / (content - view)) * (track.length - size);
  ctx.beginPath();
  if (vertical) ctx.roundRect(track.at, along, THUMB, size, THUMB / 2);
  else ctx.roundRect(along, track.at, size, THUMB, THUMB / 2);
  ctx.fillStyle = THUMB_COLOR;
  ctx.fill();
}

/**
 * A code block at the host's offsets (md2ui `render_scroll_overlay.paint_scrolled` and
 * `draw_code_block`): at rest its first `rest` lines, whole; scrolled down, the lines
 * meeting `window`, clipped to it; all shifted left and up inside the block's shape. Each
 * edge with more beyond it fades, and a scrolled or hovered block shows its thumbs. An
 * offset past either end of the range (a platform's bounce) moves the lines on past it.
 */
export function drawScroll(ctx: Context2D, entry: ScrollEntry, env: DrawEnv): void {
  const { shape, window } = entry;
  const rangeX = Math.max(0, entry.contentWidth - shape.width);
  const rangeY = Math.max(0, entry.contentHeight - shape.height);
  const { x, y } = env.offsets.get(entry.nodeId) ?? { x: 0, y: 0 };
  const windowBottom = window.y + window.height;
  ctx.save();
  ctx.clip(shapePath(shape));
  if (y !== 0) {
    // The lines pass under the space above the code, and stop at the bottom padding.
    ctx.beginPath();
    ctx.rect(window.x, window.y, window.width, window.height);
    ctx.clip();
  }
  ctx.translate(-x, -y);
  if (y !== 0) {
    for (const line of entry.entries) {
      const { bounds } = line;
      if (bounds.y + bounds.height > window.y + y && bounds.y < windowBottom + y) {
        drawText(ctx, line, env);
      }
    }
  } else {
    for (const line of entry.entries.slice(0, entry.rest)) drawText(ctx, line, env);
  }
  ctx.translate(x, y);
  if (entry.fade !== null) {
    if (x < rangeX) paintFade(ctx, shape, entry.fade, "right");
    if (x > 0) paintFade(ctx, shape, entry.fade, "left");
    const { x: left, width } = shape;
    if (y < rangeY - 0.5) {
      // Across the last lines, ending where the text does: the padding below is background.
      const text = { x: left, y: shape.y, width, height: windowBottom - shape.y };
      paintFade(ctx, text, entry.fade, "bottom");
    }
    if (y > 0) {
      const below = { x: left, y: window.y, width, height: shape.y + shape.height - window.y };
      paintFade(ctx, below, entry.fade, "top");
    }
  }
  ctx.restore();
  // `restore` brought back the font set before `save`.
  env.font = null;
  if (x !== 0 || y !== 0 || env.hovered === entry.nodeId) {
    // md2ui runs the across track inside the block's side padding, where its lines start.
    const inset = (entry.entries[0]?.runs[0]?.x ?? shape.x) - shape.x;
    const across = { start: shape.x + inset, length: shape.width - 2 * inset };
    thumb(
      ctx,
      false,
      { ...across, at: shape.y + shape.height - THUMB_INSET },
      x,
      shape.width,
      entry.contentWidth,
    );
    const down = {
      start: window.y,
      length: window.height,
      at: shape.x + shape.width - THUMB_INSET,
    };
    thumb(ctx, true, down, y, shape.height, entry.contentHeight);
  }
}
