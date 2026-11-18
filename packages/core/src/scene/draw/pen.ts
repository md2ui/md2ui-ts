// What a drawer records instead of drawing (md2ui's Skia canvas calls, as C4 entries).
// A pen writes one node's entries in paint order and computes each entry's ink bounds
// where it is created, the one place they are computed (ADR-402). Colours arrive as
// md2ui's ARGB integers and leave as C4's `#rrggbbaa`.
import type {
  Argb,
  Color,
  DisplayEntry,
  Outline,
  Paint,
  PathShape,
  Rect,
  ShadowSpec,
  Shape,
  StandIn,
  TextEntry,
  TextMeasurer,
  TextRun,
} from "@md2ui/contracts";

/** An axis-aligned box: what md2ui's `skia.Rect.MakeXYWH` holds. */
export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const hex2 = (n: number): string => n.toString(16).padStart(2, "0");

/** md2ui's ARGB integer as C4's lowercase `#rrggbbaa`. */
export function css(argb: Argb): Color {
  const a = (argb >>> 24) & 255;
  return `#${hex2((argb >>> 16) & 255)}${hex2((argb >>> 8) & 255)}${hex2(argb & 255)}${hex2(a)}`;
}

/** The rect of a box. */
export const rectShape = ({ x, y, width, height }: Box): Shape => ({
  kind: "rect",
  x,
  y,
  width,
  height,
});

/** md2ui's `drawRoundRect(rect, r, r)`: a rect when the radius is not positive. */
export function roundShape(box: Box, radius: number): Shape {
  if (radius <= 0) return rectShape(box);
  return { ...rectShape(box), kind: "roundRect", radii: [radius, radius, radius, radius] };
}

/** md2ui's `_rrect`: per-corner radii, top-left, top-right, bottom-right, bottom-left. */
export function cornerShape(box: Box, radii: readonly [number, number, number, number]): Shape {
  return { ...rectShape(box), kind: "roundRect", radii };
}

export const ovalShape = (box: Box): Shape => ({ ...rectShape(box), kind: "oval" });

/**
 * A number as C4's path data writes it: as JavaScript prints it, lossless. `Path2D` reads
 * a non-finite token as the end of the path and draws what came before, silently, so one
 * is refused here instead.
 */
export function pathNumber(n: number): string {
  if (!Number.isFinite(n)) throw new RangeError(`a path number must be finite, not ${n}`);
  return String(n);
}

/** A path in `frame`: `d`'s coordinates are relative to the frame's top-left (C4 `PathShape`). */
export const pathShape = (frame: Box, d: string): PathShape => ({
  ...rectShape(frame),
  kind: "path",
  d,
});

/** How a stroke's open ends and corners are drawn, when not C4's miter and butt. */
interface StrokeStyle {
  readonly join?: "round";
  readonly cap?: "round";
}

/** A text run with its advance, which its ink bounds are made of. */
export interface MeasuredRun extends TextRun {
  readonly width: number;
}

/** What a theme's image placeholder paints (C4 `StandIn`), its runs still measured. */
export interface StandInDraft {
  readonly paints: readonly Paint[];
  readonly label: { readonly y: number; readonly runs: readonly MeasuredRun[] } | null;
}

/** A shape's bounding rect. */
const boxOf = ({ x, y, width, height }: Outline | Box): Rect => ({ x, y, width, height });

function grow(r: Rect, d: number, dx = 0, dy = 0): Rect {
  return { x: r.x - d + dx, y: r.y - d + dy, width: r.width + 2 * d, height: r.height + 2 * d };
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** What ink a clip lets through: the bounds cut to the clip's rect. */
function within(bounds: Rect, clip: Shape | undefined): Rect {
  if (clip === undefined) return bounds;
  const x = Math.max(bounds.x, clip.x);
  const y = Math.max(bounds.y, clip.y);
  return {
    x,
    y,
    width: Math.max(0, Math.min(bounds.x + bounds.width, clip.x + clip.width) - x),
    height: Math.max(0, Math.min(bounds.y + bounds.height, clip.y + clip.height) - y),
  };
}

/** `{ clip }` when there is one: C4's optional field is absent, never `undefined`. */
const clipped = (clip: Shape | undefined): { readonly clip?: Shape } =>
  clip === undefined ? {} : { clip };

/**
 * Glyph ink can pass a run's advance and its font's ascent and descent (an italic
 * overhang, a side bearing, a stacked mark), and C3 answers ink only up and down. So a
 * line's bounds carry a quarter of the largest font size on every side.
 */
const GLYPH_SLACK = 0.25;

/** Where a run of text's ink can fall, `y` its baseline. */
function textInk(text: TextMeasurer, y: number, runs: readonly MeasuredRun[]): Rect | null {
  let ink: Rect | null = null;
  for (const run of runs) {
    const m = text.fontMetrics(run.font);
    const r = grow(
      { x: run.x, y: y - m.ascent, width: run.width, height: m.ascent + m.descent },
      run.font.size * GLYPH_SLACK,
    );
    ink = ink === null ? r : union(ink, r);
  }
  return ink;
}

/** The entries of one node, recorded in paint order. */
export interface Pen {
  /** The node every entry names; `""` when no node is behind it (the page, a divider). */
  readonly nodeId: string;
  fill(shape: Shape, paint: Paint, clip?: Shape): void;
  /** A stroke centred on `shape` (md2ui `drawRect`, `drawPath` and friends with a stroke paint). */
  stroke(shape: Outline, width: number, color: Argb, clip?: Shape, style?: StrokeStyle): void;
  /** One shadow layer cast by `shape` (md2ui `render_shadows`). */
  shadow(shape: Outline, spec: ShadowSpec, clip?: Shape): void;
  line(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    width: number,
    color: Argb,
    clip?: Shape,
  ): void;
  /** A ring's value arc, round-capped; angles in degrees, clockwise from 3 o'clock. */
  arc(
    cx: number,
    cy: number,
    radius: number,
    start: number,
    sweep: number,
    width: number,
    color: Argb,
  ): void;
  /** One line of runs on the baseline `y`. */
  text(y: number, runs: readonly MeasuredRun[], clip?: Shape): void;
  /** A content image, or its placeholder (md2ui `draw_image_box`). */
  image(
    src: string,
    shape: Shape,
    fit: "cover" | "contain" | "auto",
    placeholder: Argb,
    label: { readonly y: number; readonly runs: readonly MeasuredRun[] } | null,
    standIn: {
      readonly loading: StandInDraft | null;
      readonly broken: StandInDraft | null;
    } | null,
  ): void;
  /** A code block that scrolls, holding all its lines' text entries (C4 `ScrollEntry`). */
  scroll(
    shape: Shape,
    content: { readonly width: number; readonly height: number },
    window: Rect,
    fade: Argb | null,
    lines: readonly TextEntry[],
    rest: number,
  ): void;
  /**
   * What `draw` records, painted as one layer at `opacity` (C4 `LayerEntry`; md2ui
   * `saveLayer` with an alpha). Nothing when it records nothing.
   */
  layer(opacity: number, draw: (p: Pen) => void): void;
}

const bare = (runs: readonly MeasuredRun[]): TextRun[] =>
  runs.map(({ text, x, font, color }) => ({ text, x, font, color }));

/** A pen writing `nodeId`'s entries into `out`; `text` answers the fonts' metrics. */
export function pen(out: DisplayEntry[], nodeId: string, text: TextMeasurer): Pen {
  return {
    nodeId,
    fill(shape, paint, clip) {
      out.push({
        type: "fill",
        nodeId,
        bounds: within(boxOf(shape), clip),
        shape,
        paint,
        ...clipped(clip),
      });
    },
    stroke(shape, width, color, clip, style = {}) {
      // A box's corners are right angles or round, so its ink ends half the width out. A
      // path's miter joins may be sharper: a limit of 4 reaches twice the width past the
      // corner.
      const reach = shape.kind === "path" && style.join !== "round" ? 2 * width : width / 2;
      const bounds = within(grow(boxOf(shape), reach), clip);
      out.push({
        type: "stroke",
        nodeId,
        bounds,
        shape,
        width,
        color: css(color),
        ...style,
        ...clipped(clip),
      });
    },
    shadow(shape, spec, clip) {
      const { inner, offset_x: offsetX, offset_y: offsetY, radius } = spec;
      // An outer shadow is cropped at radius/2 past the moved shape; an inner one
      // paints inside the shape only.
      const ink = inner ? boxOf(shape) : grow(boxOf(shape), radius / 2, offsetX, offsetY);
      out.push({
        type: "shadow",
        nodeId,
        bounds: within(ink, clip),
        shape,
        inner,
        offsetX,
        offsetY,
        color: css(spec.color),
        radius,
        ...clipped(clip),
      });
    },
    line(x0, y0, x1, y1, width, color, clip) {
      const box = {
        x: Math.min(x0, x1),
        y: Math.min(y0, y1),
        width: Math.abs(x1 - x0),
        height: Math.abs(y1 - y0),
      };
      out.push({
        type: "line",
        nodeId,
        bounds: within(grow(box, width / 2), clip),
        x0,
        y0,
        x1,
        y1,
        width,
        color: css(color),
        ...clipped(clip),
      });
    },
    arc(cx, cy, radius, startAngle, sweepAngle, width, color) {
      const reach = radius + width / 2;
      const bounds = { x: cx - reach, y: cy - reach, width: 2 * reach, height: 2 * reach };
      out.push({
        type: "arc",
        nodeId,
        bounds,
        cx,
        cy,
        radius,
        startAngle,
        sweepAngle,
        width,
        color: css(color),
      });
    },
    text(y, runs, clip) {
      const shown = runs.filter((r) => r.text !== "");
      const ink = textInk(text, y, shown);
      if (ink === null) return;
      out.push({
        type: "text",
        nodeId,
        bounds: within(ink, clip),
        y,
        runs: bare(shown),
        ...clipped(clip),
      });
    },
    image(src, shape, fit, placeholder, label, standIn) {
      // The placeholder's 1px lines reach half a pixel past the shape; a theme's
      // placeholder paints inside it.
      let bounds = grow(boxOf(shape), 0.5);
      const labelInk = label === null ? null : textInk(text, label.y, label.runs);
      if (labelInk !== null) bounds = union(bounds, labelInk);
      const recorded = (s: StandInDraft | null): StandIn | null =>
        s === null
          ? null
          : {
              paints: s.paints,
              label: s.label === null ? null : { y: s.label.y, runs: bare(s.label.runs) },
            };
      out.push({
        type: "image",
        nodeId,
        bounds,
        src,
        shape,
        fit,
        placeholder: {
          color: css(placeholder),
          label: label === null ? null : { y: label.y, runs: bare(label.runs) },
        },
        ...(standIn === null
          ? {}
          : { standIn: { loading: recorded(standIn.loading), broken: recorded(standIn.broken) } }),
      });
    },
    scroll(shape, content, window, fade, entries, rest) {
      out.push({
        type: "scroll",
        nodeId,
        bounds: boxOf(shape),
        shape,
        contentWidth: content.width,
        contentHeight: content.height,
        window,
        rest,
        fade: fade === null ? null : css(fade),
        entries,
      });
    },
    layer(opacity, draw) {
      const entries: DisplayEntry[] = [];
      draw(pen(entries, nodeId, text));
      const [first, ...rest] = entries;
      if (first === undefined) return;
      const bounds = rest.reduce((b, e) => union(b, e.bounds), first.bounds);
      out.push({ type: "layer", nodeId, bounds, opacity, entries });
    },
  };
}
