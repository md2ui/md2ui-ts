// A placed scene: md2ui's `LayoutBox` (layout_script_parser.py), `SectionBox`
// (render_backgrounds.py), `HitRegion` (render_actions.py) and `Scrollable`
// (render_code_blocks.py), gathered as md2ui's `session.Scene` holds them. Field names
// are md2ui's, as `LayoutNode`'s are, so a scene is its own fixture form (`boxes/`).
// The display list is built from this; nothing outside the core sees it.
import type { Argb, PaddingBox } from "@md2ui/contracts";
import type { Action } from "../actions/targets.ts";
import type { LayerKind } from "../measure/layers.ts";
import type { DividerKind } from "../measure/list-surfaces.ts";

/** The surfaces behind a box, innermost first: colours, or `"image"` for a photo. */
export type BgStack = readonly (Argb | string)[];

/** One placed leaf: a node's content, or a synthetic label (a table key). */
export interface LayoutBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The grouping node drawn here; `null` for a synthetic box. */
  readonly content_id: string | null;
  /** The leaf's render hints with its inherited `content_align`, and bleed's radii. */
  render_properties: Record<string, unknown> | null;
  readonly bg_stack: BgStack;
}

/**
 * What a section box paints: a wrap layer, one of a themed table's surfaces, or the rule
 * between two rows of a merged list.
 */
export type SectionKind = LayerKind | "table" | "table_header" | "table_row" | DividerKind;

/**
 * A background behind content: a heading section, a list or quote surface (or a merged
 * list's shell, row or divider), a card, a chip or ring, or a table's shell or row. `x`…`height` is its outer rect; its content
 * is inset by `padding`.
 */
export interface SectionBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly level: number;
  readonly padding: PaddingBox;
  readonly kind: SectionKind;
  /** A merged table shell's rounded clip, `[x, y, width, height, radius]`, on its rows. */
  readonly clip: readonly [number, number, number, number, number] | null;
  /** A ring's value and maximum, for its arc. */
  readonly ring: unknown;
  /** An image card's photo, on its outermost layer. */
  readonly bg_image_url: string | null;
  /** Its slot in its colour cycle; `null` when no node backs it (a table row). */
  readonly rotation_index: number | null;
  /** The heading levels around it, for `Rotate <kind> colors`. */
  readonly rotation_chain: readonly (number | string)[];
  /** The slot each of those took, for `Rotate colors: sync`. */
  readonly rotation_path: readonly number[];
  /** The surfaces behind it, innermost first. */
  readonly bg_stack: BgStack;
  readonly fixed_style_key: string | null;
}

/** Where a tap lands and what it reports (md2ui `HitRegion`). */
export interface HitRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly action: Action;
  /** A link card: a tap on what it contains reports that; on the rest of it, the card. */
  readonly card: boolean;
  /** A count's ➖ (-1) or ➕ (+1): a tap steps the value shown; 0 for every other region. */
  readonly step: -1 | 0 | 1;
}

/**
 * A code block whose lines run past its right edge, or past its last shown line (`Max
 * lines`): md2ui `Scrollable`, with how wide and tall its content really is.
 */
export interface Scrollable {
  readonly node_id: string;
  readonly content_id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly content_width: number;
  readonly content_height: number;
  /** What the block sits on, for its colour replacements. */
  readonly bg_stack: BgStack;
}

/** One layout placed at one width (md2ui `Scene`, without the layout it came from). */
export interface Scene {
  readonly width: number;
  readonly height: number;
  readonly boxes: readonly LayoutBox[];
  readonly sections: readonly SectionBox[];
  readonly regions: readonly HitRegion[];
  /** Each `{#id}` heading's top, by id. */
  readonly anchors: Readonly<Record<string, number>>;
  readonly scrollables: readonly Scrollable[];
}
