// `Layout: Auto` (md2ui `pipeline/layout_auto.py`): whether a document tiles
// (bento) or stacks, decided by how much of the page each leaves empty. The theme
// delegates the choice to the engine; the wrong layout shows as long blank spaces, so
// both are built and bento is kept only when it leaves clearly less empty (`MARGIN`).
//
// The choice belongs to a document and a width BAND, never to one width: it is made the
// first time the document is laid out in a band and kept for the document's life, so a
// resize inside a decided band builds one layout. Narrow widths stack unmeasured. md2ui
// keeps the choices in a module-level memo keyed by the document's identity; here they
// live in the `AutoLayout` a caller makes once per document, theme and measurer.
import type { ResolvedTheme } from "@md2ui/contracts";
import type { GroupNode } from "../group/node.ts";
import { tiledLevel } from "./generate.ts";
import { type LayoutInput, leafInputs } from "./input.ts";
import type { LayoutMeasurer } from "./measurer.ts";
import { bentoRuns } from "./node-units.ts";
import { WIDE_BREAKPOINT } from "./url-hints.ts";

/** md2ui `MARGIN`: bento wins when its empty area is at most this share of the stacked one. */
const MARGIN = 0.85;

/**
 * md2ui `WIDE_FROM`: where the widest band starts. Bento's advantage grows with width,
 * so a tablet-wide layout decides apart from a desktop one.
 */
const WIDE_FROM = 1280;

/** md2ui `band`: 0 narrow (under `WIDE_BREAKPOINT`), 1 up to `WIDE_FROM`, 2 beyond. */
export function widthBand(width: number): 0 | 1 | 2 {
  if (width < WIDE_BREAKPOINT) return 0;
  return width < WIDE_FROM ? 1 : 2;
}

/** What the empty area is read from: a placed scene (`placeScene`). */
interface PlacedArea {
  readonly width: number;
  readonly height: number;
  readonly boxes: readonly {
    readonly content_id: string | null;
    readonly width: number;
    readonly height: number;
  }[];
}

/** The `Layout: Auto` choices of one document under one theme and measurer. */
export interface AutoLayout {
  /**
   * md2ui `layout_auto.choose`: what `build` makes at `width` (an effective width) for
   * the arrangement `Layout: Auto` shows there. On a band's first layout it builds both
   * and keeps the winner; after that, one build. Any other `Layout:` builds once.
   */
  choose<S extends { readonly scene: PlacedArea }>(width: number, build: (tiles: boolean) => S): S;
}

function walk(root: GroupNode): GroupNode[] {
  return [root, ...root.children.flatMap(walk)];
}

/**
 * md2ui `empty_area`: the page area, in px², that neither text nor a picture covers. A
 * text leaf covers its single-line width, capped at its box, times its height; a picture
 * (or a rule) covers its whole box.
 */
function emptyArea(
  scene: PlacedArea,
  input: LayoutInput,
  nodes: ReadonlyMap<string, GroupNode>,
  measurer: LayoutMeasurer,
): number {
  let ink = 0;
  for (const box of scene.boxes) {
    const node = box.content_id === null ? undefined : nodes.get(box.content_id);
    if (node === undefined || box.width <= 0 || box.height <= 0) continue;
    // No line (`null`) for a picture or a rule: md2ui's `node.type == "image"` test is
    // the measurer's own.
    const line = measurer.leafLineWidth(leafInputs(input, node), null);
    ink += (line === null ? box.width : Math.min(line, box.width)) * box.height;
  }
  return scene.width * scene.height - ink;
}

/** The `Layout: Auto` choices for `input`; make one per document, theme and measurer. */
export function autoLayout(
  input: LayoutInput,
  theme: ResolvedTheme,
  measurer: LayoutMeasurer,
): AutoLayout {
  if (theme.root.layout !== "auto") return { choose: (_width, build) => build(false) };
  const nodes = walk(input.root);
  // A document with nothing to tile stacks in every band: its bento layout IS the
  // stacked one (md2ui builds it once and finds no run).
  const level = tiledLevel(input.root, theme);
  const tiles = new Map<number, boolean>([[0, false]]);
  if (nodes.every((node) => bentoRuns(level, node).length === 0)) {
    tiles.set(1, false);
    tiles.set(2, false);
  }
  const index = new Map(nodes.map((node) => [node.node_id, node]));
  return {
    choose(width, build) {
      const here = widthBand(width);
      const decided = tiles.get(here);
      if (decided !== undefined) return build(decided);
      const tiled = build(true);
      const stacked = build(false);
      const wins =
        emptyArea(tiled.scene, input, index, measurer) <=
        MARGIN * emptyArea(stacked.scene, input, index, measurer);
      tiles.set(here, wins);
      return wins ? tiled : stacked;
    },
  };
}
