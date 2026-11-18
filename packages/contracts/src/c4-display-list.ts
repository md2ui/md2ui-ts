// C4 — Display list, versioned.
// Internal while no published package exports it (ADR-005, ADR-006): a change to it
// updates its producers and consumers in the same change, and becomes a public API
// change, with an API report and a recorded decision, once a published entry exports it.
//
// A count's `step` on its two targets follows md2ui ADR-405; the layer entry follows
// md2ui `muted_paint`.
//
// What the core hands a painter: md2ui's `draw_document` recording (md2ui ADR-401) as
// plain, JSON-serializable data. Every colour, font, position and clip is resolved
// by the scene stage; a painter makes no layout, colour or text decision, never
// measures text, and never wraps it (ADR-402, ADR-403). Entries are in paint order:
// a later entry paints over an earlier one.
//
// Coordinates are CSS pixels in content space: the origin is the top-left of the
// layout area, inside the root padding, as md2ui's `draw_document` sees it. Ink may
// fall at negative coordinates (bleed into the padding).

import type { FontSpec } from "./font.ts";

/** A colour as CSS `#rrggbbaa`, lowercase: what Canvas 2D, SVG and a GPU painter all read. */
export type Color = string;

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Top-left, top-right, bottom-right, bottom-left (md2ui `_rrect`, Canvas `roundRect`). */
export type CornerRadii = readonly [number, number, number, number];

/**
 * The outline a primitive fills, strokes, shadows or clips to (md2ui
 * `render_shadows.shape_path`). Radii are per corner because a bleeding image and a
 * split date chip round only some corners.
 */
export type Shape =
  | ({ readonly kind: "rect" } & Rect)
  | ({ readonly kind: "roundRect"; readonly radii: CornerRadii } & Rect)
  | ({ readonly kind: "oval" } & Rect);

/**
 * An outline no box describes (md2ui `shape_path(..., outline=)` and `within=`): a line
 * chart's line, a slider bar cut at its value inside a rounded corner.
 *
 * `d` is SVG path data (SVG 2 §9.3) in the shape's own frame: (0, 0) is (`x`, `y`) in
 * content space, so moving the shape moves `x` and `y` and never `d`. Only the absolute
 * commands `M`, `L`, `A` and `Z` are written, and every number is finite. A Canvas painter
 * reads it with `new Path2D(d)`; an SVG one with `<path d transform="translate(x y)">`.
 *
 * `width` and `height` size the frame, which holds the whole path: what depends on size is
 * laid over the frame as over a box shape's rect (md2ui: "rect is then only its bounds").
 */
export interface PathShape extends Rect {
  readonly kind: "path";
  readonly d: string;
}

/** What a stroke traces or a shadow is cast by: a box shape, or a path. */
export type Outline = Shape | PathShape;

/** One stop of a gradient; `offset` is 0–1 along the gradient line. */
export interface GradientStop {
  readonly offset: number;
  readonly color: Color;
}

/**
 * What fills a shape. Each is one layer of md2ui's `_paint_layered_fill`, which
 * paints them in this order: colour, image, gradient.
 */
export type Paint =
  | { readonly kind: "color"; readonly color: Color }
  | {
      readonly kind: "linearGradient";
      /** Fractions of the shape's bounding rect, as md2ui's `Gradient` keys. */
      readonly start: readonly [number, number];
      readonly end: readonly [number, number];
      readonly stops: readonly GradientStop[];
    }
  | {
      readonly kind: "image";
      /**
       * Cover-fit and centred in the shape's bounding rect, sampled linearly. One that
       * failed, a theme's image as much as a photo, is drawn as the host's broken
       * placeholder, fitted and clipped the same way (md2ui `theme_picture`).
       */
      readonly src: string;
      /**
       * Painted while `src` is loading: an image card's photo falls back to the
       * theme's background image, so the card is never a hole (`draw_document`). A
       * fallback that failed is not the card's failure: the host's loading placeholder
       * stands in until the photo arrives or fails (md2ui `card_photo`).
       */
      readonly fallbackSrc: string | null;
      /**
       * 0–1, how opaque the picture, or whatever stands in for it, is drawn; absent is 1.
       * A muted chip or badge (`~~…~~`) fades its theme background image this way and
       * keeps its size, fit and clip (md2ui `element_picture`).
       */
      readonly opacity?: number;
    };

/**
 * One shadow layer (md2ui `render_shadows`). An outer shadow paints outside the
 * shape and never through it; an inner one paints inside the shape only.
 */
export interface Shadow {
  readonly inner: boolean;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly color: Color;
  /**
   * How far the shadow reaches past the edge, as authored: a Gaussian blur of sigma
   * `radius / 4` (md2ui `SHADOW_SIGMA_RATIO`), and an outer shadow is cropped at
   * `radius / 2` past the shape.
   */
  readonly radius: number;
}

/** What every entry carries. */
interface EntryBase {
  /**
   * The node it paints, by content id (ADR-104). A section's or card's background (its
   * fill, shadow, stroke and photo) names the node it is the background of, the
   * innermost holding all it holds, so it moves with that node. `""` for paint with no
   * node: the page's own box, a divider between merged rows, a synthetic box.
   */
  readonly nodeId: string;
  /** Everything the entry paints, shadow and bleed included; culling trusts it (ADR-402). */
  readonly bounds: Rect;
}

/** Fills a shape with one paint layer. */
export interface FillEntry extends EntryBase {
  readonly type: "fill";
  readonly shape: Shape;
  readonly paint: Paint;
  readonly clip?: Shape;
}

/**
 * Strokes an outline, centred on it: the scene has already moved it for `Stroke align`.
 * Joins are mitred with a limit of 4 (Skia's default, md2ui's) unless `join` says round;
 * open ends are butt unless `cap` says round.
 */
export interface StrokeEntry extends EntryBase {
  readonly type: "stroke";
  readonly shape: Outline;
  readonly width: number;
  readonly color: Color;
  /** A line chart's line (md2ui `kRound_Join`); absent is a miter with a limit of 4. */
  readonly join?: "round";
  /** A line chart's line (md2ui `kRound_Cap`); absent is butt. */
  readonly cap?: "round";
  readonly clip?: Shape;
}

/** One shadow cast by an outline; outer ones come before its fill, inner ones after. */
export interface ShadowEntry extends EntryBase, Shadow {
  readonly type: "shadow";
  readonly shape: Outline;
  readonly clip?: Shape;
}

/** A straight line with butt caps: rules, row separators, underlines, strike-throughs. */
export interface LineEntry extends EntryBase {
  readonly type: "line";
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly width: number;
  readonly color: Color;
  readonly clip?: Shape;
}

/** A ring's value arc: a circle's stroke from `startAngle`, with round caps. */
export interface ArcEntry extends EntryBase {
  readonly type: "arc";
  readonly cx: number;
  readonly cy: number;
  readonly radius: number;
  /** Degrees, clockwise from 3 o'clock, as Skia's `drawArc`. */
  readonly startAngle: number;
  readonly sweepAngle: number;
  readonly width: number;
  readonly color: Color;
}

/** One styled piece of a line: one `fillText`, never with `maxWidth` (ADR-403). */
export interface TextRun {
  readonly text: string;
  /** Left edge of the run. */
  readonly x: number;
  readonly font: FontSpec;
  readonly color: Color;
}

/** One line of text: Pretext's line fragments, placed and coloured. */
export interface TextEntry extends EntryBase {
  readonly type: "text";
  /** The baseline every run sits on. */
  readonly y: number;
  readonly runs: readonly TextRun[];
  readonly clip?: Shape;
}

/** A content image (md2ui `draw_image_box`). */
export interface ImageEntry extends EntryBase {
  readonly type: "image";
  /**
   * Never empty: an image with no picture (`![alt]()`, md2ui ADR-406) is no image
   * entry, only a colour fill of the shape it would have had.
   */
  readonly src: string;
  /** The region layout gave the image; also its clip (a rect, rounded rect or circle). */
  readonly shape: Shape;
  /**
   * `cover` crops to fill the shape; `contain` letterboxes the whole image inside it;
   * `auto` is md2ui's default by kind: a vector image is contained, a raster covered.
   */
  readonly fit: "cover" | "contain" | "auto";
  /**
   * md2ui's placeholder with no asset: while `src` is loading, a host that has no
   * loading placeholder picture paints a 1px outline of an oval shape, or both
   * diagonals of any other, and the alt text, placed by the scene, when it fits. A
   * host with one paints that picture, fitted as `src` would be; a `src` that failed
   * is drawn as the host's broken placeholder.
   */
  readonly placeholder: {
    readonly color: Color;
    readonly label: { readonly y: number; readonly runs: readonly TextRun[] } | null;
  };
  /**
   * The theme's placeholder (md2ui ADR-406), painted inside `shape` in place of the
   * host's: `loading` while `src` loads, `broken` once it failed. A named placeholder is
   * the same in both; a default (`#### Loading`, `#### Broken`) may restyle either. `null`, or the field absent,
   * keeps the host's own.
   */
  readonly standIn?: {
    readonly loading: StandIn | null;
    readonly broken: StandIn | null;
  };
}

/** What a theme's image placeholder paints, clipped to its image's shape. */
export interface StandIn {
  /** Filled over the shape in order: its colour, then its `Image:`, cover-fitted. */
  readonly paints: readonly Paint[];
  /** The image's text or the placeholder's icon, centred on top; `null` when neither. */
  readonly label: { readonly y: number; readonly runs: readonly TextRun[] } | null;
}

/**
 * A code block whose lines run past its right edge, or past its last shown line
 * (`Max lines`): md2ui's `Scrollable`. It holds **all** its lines, painted clipped to
 * `shape` and moved by the host's offsets, across (0 to `contentWidth - shape.width`) and
 * down (0 to `contentHeight - shape.height`), which are per-frame state and never part of
 * the list (md2ui ADR-401, `render_scroll_overlay`).
 *
 * At rest (down offset 0) the first `rest` entries show, whole, as md2ui cuts the block
 * between two lines; scrolled down, the lines pass through `window` only, under the space
 * above the code. With `fade`, each edge that hides more code fades to that colour over
 * 32px (md2ui `_paint_fade`): the right and bottom while more lies beyond them, the left
 * and top once scrolled past them; the bottom and top bands end at `window`'s edges.
 */
export interface ScrollEntry extends EntryBase {
  readonly type: "scroll";
  readonly shape: Shape;
  readonly contentWidth: number;
  /** The block's height with every line shown (md2ui `Scrollable.content_height`). */
  readonly contentHeight: number;
  /**
   * The band the lines move in once scrolled down: from below the copy button's row and
   * the top padding to above the bottom padding (md2ui `draw_code_block`'s window).
   */
  readonly window: Rect;
  /**
   * How many of `entries`, in line order, show at rest: the lines that fit whole (md2ui
   * `lines_that_fit`). A blank line has no entry.
   */
  readonly rest: number;
  readonly fade: Color | null;
  /** Every line of the block, one text entry per line that has text, in line order. */
  readonly entries: readonly TextEntry[];
}

/**
 * Entries painted together and then composited at `opacity`, as one (md2ui's `saveLayer`
 * with an alpha): where they overlap, the one over hides the one under, as at full
 * opacity, and the whole fades. A muted control (`~~`, md2ui `muted_paint`) and a count's
 * button that cannot step. Its entries are in paint order and name its node; its bounds
 * hold theirs.
 */
export interface LayerEntry extends EntryBase {
  readonly type: "layer";
  /** 0–1. */
  readonly opacity: number;
  readonly entries: readonly DisplayEntry[];
}

export type DisplayEntry =
  | LayerEntry
  | FillEntry
  | StrokeEntry
  | ShadowEntry
  | LineEntry
  | ArcEntry
  | TextEntry
  | ImageEntry
  | ScrollEntry;

/** An actionable target the user can tap (ADR-003; md2ui `render_actions.HitRegion`). */
interface TargetBase {
  /** The node whose action it is; host state is keyed by it (ADR-003). */
  readonly nodeId: string;
  /** Where a tap lands. Not the ink bounds: a tap on a shadow clicks nothing. */
  readonly rect: Rect;
}

/**
 * A count's ➖ (`-1`) or ➕ (`1`) button (md2ui ADR-405, `HitRegion.step`): a count is one
 * target with two such entries, each by its ordinal, and a tap on one steps the value
 * shown by one inside 0 to its maximum. Absent on every other target.
 */
type Step = { readonly step?: -1 | 1 };

/**
 * A target the wire knows. Its `ordinal` is md2ui's (`render_actions.action_targets`)
 * and is all an event names; the action itself is the core's to look up. A disabled
 * target has no entry here, but keeps its ordinal.
 */
export interface ActionTarget extends TargetBase, Step {
  readonly kind: "link" | "anchor" | "agent" | "checkbox";
  readonly ordinal: number;
  /** A link card: a tap on what it contains reports that; on the rest of it, the card. */
  readonly card: boolean;
}

/** A slider: a tap or drag maps along `rect` on `axis` to a value; a count's button steps it. */
export interface SliderTarget extends TargetBase, Step {
  readonly kind: "slider";
  readonly ordinal: number;
  readonly axis: "horizontal" | "vertical";
}

/** A code block's copy button. Local to the client: it has no ordinal. */
export interface CopyTarget extends TargetBase {
  readonly kind: "copy";
  /** What goes on the clipboard (md2ui `copied_text`). */
  readonly text: string;
}

export type HitTarget = ActionTarget | SliderTarget | CopyTarget;

/** Where a `{#id}` heading sits, for an `#anchor` link to scroll to. */
export interface Anchor {
  readonly id: string;
  readonly y: number;
}

/** The root's viewport-fixed background (md2ui `draw_scene`), painted under the scroll. */
export interface PageBackground {
  /** Painted in order across the whole viewport. */
  readonly paints: readonly Paint[];
  readonly shadows: readonly Shadow[];
}

export interface DisplayList {
  readonly version: 1;
  /** The layout's size, without the root padding. */
  readonly width: number;
  readonly height: number;
  /** The root padding: where content space starts, and what the scroll adds around it. */
  readonly padding: {
    readonly top: number;
    readonly right: number;
    readonly bottom: number;
    readonly left: number;
  };
  /** In a viewport wider than the layout, the slack is split either side. */
  readonly centered: boolean;
  readonly background: PageBackground;
  readonly entries: readonly DisplayEntry[];
  /** In paint order: the last target holding a point wins; a card only where nothing else does. */
  readonly targets: readonly HitTarget[];
  readonly anchors: readonly Anchor[];
}
