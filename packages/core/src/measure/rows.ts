// A row laid out at a width (md2ui `render_measure._layout_row`, `_layout_grid_row`,
// `_layout_bento_row`, `_row_valign_offsets`), and what each of its cells asks for across
// (`_row_desired_widths`). Sizing reads the row's height; placement reads the cells: each
// one's x, width, the height it is given, and the downward shift alignment gives it. A
// row that fits packs its cells by alignment, which only placement asks for
// (`rowLayout`), so the height never pays for it. md2ui's gap spans feed only its debug
// overlay and are not here.
import { pySum } from "../group/py/math.ts";
import type { LayoutNode } from "../layout/node.ts";
import { IMAGE_MIN_WIDTH, LEAF_WIDTH } from "../layout/units.ts";
import { paddingX } from "../theme/query.ts";
import { childOwnerLevel, paddedChildren } from "./layers.ts";
import {
  BREAK_LEAVES,
  hint,
  imageContentWidth,
  imageFloor,
  LINE_SCALE,
  type Props,
  truthy,
} from "./leaf-kit.ts";
import { type Levels, type Sizer, wrapOf } from "./sizer.ts";
import { isImageLeaf, isPureImageBlock, siblingGap } from "./spacing.ts";
import { tableCellMinWidth } from "./tables.ts";

const rpOf = (node: LayoutNode): Props | null => node.render_properties;

const maxOf = (values: readonly number[]): number => (values.length > 0 ? Math.max(...values) : 0);

/** md2ui `_is_width_capped`: an image leaf that asks its box not to stretch. */
export function isWidthCapped(node: LayoutNode): boolean {
  return hint(rpOf(node), "max_width") !== null;
}

/** md2ui `_is_bar_marker`: a quote bar or a drawn vertical rule, which spans its row. */
function isBarMarker(child: LayoutNode): boolean {
  const rp = rpOf(child);
  if (child.type !== "-" || !truthy(rp)) return false;
  const lm = hint(rp, "list_marker") as Props | null;
  if (truthy(lm) && lm?.["mode"] === "bar" && truthy(lm["aside"] ?? true)) return true;
  const sep = hint(rp, "separator") as Props | null;
  return truthy(sep) && sep?.["kind"] === "rule";
}

/** md2ui `_is_row_spacer`: a spacer across a line (md2ui ADR-203). */
function isRowSpacer(child: LayoutNode): boolean {
  const sp = hint(rpOf(child), "spacer") as Props | null;
  return child.type === "-" && sp !== null && sp["axis"] === "row";
}

/** The gap between each pair of neighbours in a row, in order. */
function pairGaps(sizer: Sizer, node: LayoutNode, children: readonly LayoutNode[], owner: number) {
  return children
    .slice(1)
    .map(
      (c, i) =>
        siblingGap(children[i] as LayoutNode, c, sizer.theme, "row", owner, sizer.index, node).gap,
    );
}

/** A row's cells and what each asks for across. */
export interface RowWidths {
  readonly children: LayoutNode[];
  /** The generator's ratio shares of the width: the image reserve and the overflow fallback. */
  readonly ratioWidths: number[];
  readonly desired: number[];
}

/**
 * md2ui `_row_desired_widths`: an uncapped image keeps its ratio share, a cell sized to
 * fill its line keeps its share, and every other cell collapses to its natural width,
 * plus its wrap padding.
 */
export function rowDesiredWidths(
  sizer: Sizer,
  node: LayoutNode,
  available: number,
  levels: Levels,
  owner: number,
): RowWidths {
  const { theme } = sizer;
  const children = paddedChildren(node);
  const ratios = node.ratios.length > 0 ? node.ratios : children.map(() => 1);
  const zeroCells = node.column_row ? ratios.flatMap((r, i) => (r ? [] : [i])) : [];
  // A rule fills whatever width its cell is given, so it never sizes a `:::0` cell: the
  // rest of the cell does. The cell still draws it.
  const sized = children.map((c, i) => (zeroCells.includes(i) ? withoutRules(sizer, c) : c));
  let ratioWidths: number[];
  if (zeroCells.length > 0) {
    // A `:::0` cell takes no share of the surplus, which is not taking no width: every
    // cell is measured at an equal share first, the zero cells keep that honest width,
    // and the weighted ones split what is left.
    const equal = { ...node, children: sized, ratios: children.map(() => 1), column_row: false };
    const honest = rowDesiredWidths(sizer, equal, available, levels, owner).desired;
    const reserved = pySum(zeroCells.map((i) => honest[i] as number));
    const share = Math.max(0, available - reserved);
    const weighted = pySum(ratios) || 1;
    ratioWidths = ratios.map((r, i) => (r ? (share * r) / weighted : (honest[i] as number)));
  } else {
    const total = pySum(ratios) || 1;
    ratioWidths = ratios.map((r) => (available * r) / total);
  }
  const desired: number[] = [];
  const n = Math.min(children.length, ratioWidths.length);
  for (let i = 0; i < n; i++) {
    const child = sized[i] as LayoutNode;
    const rw = ratioWidths[i] as number;
    if (isImageLeaf(child, sizer.index)) {
      desired.push(imageContentWidth(rpOf(child), rw));
      continue;
    }
    if (truthy(hint(rpOf(child), "fill_row"))) {
      desired.push(rw);
      continue;
    }
    const wrap = wrapOf(child, theme, levels);
    const childOwner = childOwnerLevel(child, theme, owner);
    const nw =
      wrap === null
        ? sizer.naturalWidth(child, available, levels, childOwner)
        : sizer.naturalWidth(
            child,
            Math.max(0, available - paddingX(wrap.pad)),
            wrap.levels,
            childOwner,
          ) + paddingX(wrap.pad);
    desired.push(Math.min(nw, available));
  }
  return { children, ratioWidths, desired };
}

/** md2ui `_without_rules`: `node` with its `---` rules left out, to measure what else it holds. */
function withoutRules(sizer: Sizer, node: LayoutNode): LayoutNode {
  if (node.children.length === 0) return node;
  const keep = node.children.flatMap((c, i) =>
    sizer.leafNode(c)?.type === "horizontal_rule" ? [] : [i],
  );
  // Ratios stay aligned with the children, or the gap is padded back as a leaf.
  const ratios =
    node.ratios.length > 0 && node.ratios.length === node.children.length
      ? keep.map((i) => node.ratios[i] as number)
      : node.ratios;
  const children = keep.map((i) => withoutRules(sizer, node.children[i] as LayoutNode));
  return { ...node, children, ratios };
}

/**
 * md2ui `_cell_floor`: the least width a row may give `node` so every leaf in it keeps
 * its own floor (`leaf`'s answer, by default an image's `min_width`), plus each wrap's
 * padding on the way down. A lower bound where leaves sit side by side inside the cell.
 */
function cellFloor(
  sizer: Sizer,
  node: LayoutNode,
  levels: Levels,
  owner: number,
  leaf: ((n: LayoutNode) => number) | null = null,
): number {
  const wrap = wrapOf(node, sizer.theme, levels);
  const pad = wrap === null ? 0 : paddingX(wrap.pad);
  const inside = wrap === null ? levels : wrap.levels;
  let inner: number;
  if (leaf !== null && node.children.length === 0) {
    inner = leaf(node);
  } else if (isImageLeaf(node, sizer.index)) {
    inner = imageFloor(rpOf(node)) ?? 0;
  } else {
    const childOwner = childOwnerLevel(node, sizer.theme, owner);
    inner = maxOf(node.children.map((c) => cellFloor(sizer, c, inside, childOwner, leaf)));
  }
  return inner ? inner + pad : 0;
}

/**
 * md2ui `_give_elements_room`: each weighted cell of a `:::` row gets at least its widest
 * pill or word, in `widths`. A button's label never wraps, so the room comes out of the
 * `:::0` cells that hold only pictures: a picture flexes down to the floor the
 * generator's fit test held it at, and the row wraps only below that.
 */
function giveElementsRoom(
  sizer: Sizer,
  widths: number[],
  children: readonly LayoutNode[],
  ratios: readonly number[],
  levels: Levels,
  owner: number,
): void {
  const floor = (cell: LayoutNode, leaf: (n: LayoutNode) => number): number =>
    cellFloor(sizer, cell, levels, owner, leaf);
  const element = (n: LayoutNode): number => {
    const nd = sizer.leafNode(n);
    // A code block is a surface, not an element: a line wider than its box clips and
    // scrolls, so nothing in it is kept whole here.
    const surface = nd === null || nd.type === "image" || nd.type === "code_block";
    if (surface || BREAK_LEAVES.includes(nd.type)) return 0;
    return tableCellMinWidth(sizer, n, Number.POSITIVE_INFINITY);
  };
  const picture = (n: LayoutNode): number => {
    // Anything else in the cell keeps it whole.
    if (!isImageLeaf(n, sizer.index)) return Number.POSITIVE_INFINITY;
    const rp = rpOf(n);
    const own = imageFloor(rp) || IMAGE_MIN_WIDTH;
    const cap = hint(rp, "max_width");
    return truthy(cap) ? Math.min(own, Number(cap)) : own;
  };
  const give = new Map<number, number>();
  children.forEach((c, j) => {
    if (!ratios[j]) give.set(j, floor(c, picture));
  });
  children.forEach((cell, i) => {
    let short = ratios[i] ? floor(cell, element) - (widths[i] as number) : 0;
    for (const [j, least] of give) {
      const room = Math.min(short, (widths[j] as number) - least);
      if (room > 0) {
        widths[j] = (widths[j] as number) - room;
        widths[i] = (widths[i] as number) + room;
        short -= room;
      }
    }
  });
}

/**
 * md2ui `_beside_spacer_floor`: how narrow a cell may go before the row spacers beside
 * it give way: its widest word, and for prose its length category's floor. A long
 * paragraph has no floor short of its whole line. A block held between two spacers
 * floors at the minimum the generator found for it (`held_floor`).
 */
function besideSpacerFloor(
  sizer: Sizer,
  cell: LayoutNode,
  desired: number,
  available: number,
): number {
  const held = cell.render_properties?.["held_floor"];
  if (typeof held === "number") return Math.min(desired, held);
  const word = tableCellMinWidth(sizer, cell, available);
  const category = sizer.leafNode(cell)?.content_length_category || "";
  const floor =
    category === "long_paragraph"
      ? desired
      : Object.hasOwn(LEAF_WIDTH, category)
        ? (LEAF_WIDTH[category] as number)
        : 0;
  return Math.min(desired, Math.max(word, floor));
}

/**
 * md2ui `_weighted_need`: the width a weighted row needs for every weighted cell to get
 * its ask at its share, the spacers and `:::0` cells held at theirs.
 */
function weightedNeed(
  ratios: readonly number[],
  asks: readonly number[],
  spacers: readonly number[],
): number {
  const weighted = ratios.flatMap((r, i) => (r && !spacers.includes(i) ? [i] : []));
  const total = pySum(weighted.map((i) => ratios[i] as number)) || 1;
  const held = pySum(asks.filter((_, i) => !weighted.includes(i)));
  return held + maxOf(weighted.map((i) => ((asks[i] as number) * total) / (ratios[i] as number)));
}

/** md2ui `_valign_offset` for a uniform mode: a cell's share of its row's slack. */
function valignOffset(mode: string, cellH: number, rowH: number): number {
  if (mode === "center") return Math.max(0, (rowH - cellH) / 2);
  if (mode === "bottom") return Math.max(0, rowH - cellH);
  return 0;
}

/** md2ui `_box_valign_offsets`: `center` or `bottom` box alignment; stretched cells stay. */
function boxValignOffsets(
  mode: string,
  heights: readonly number[],
  stretched: readonly boolean[],
): number[] {
  const rowH = maxOf(heights);
  return heights.map((h, i) => (stretched[i] ? 0 : valignOffset(mode, h, rowH)));
}

/**
 * md2ui `_row_valign_offsets`: the downward shift that aligns a same-line row's cells
 * (one source line, an authored `:::` row, or a marker row). `baseline` puts every
 * leaf's and row's first baseline on the row's deepest one and centres a stacking col on
 * the band they make; `top` hangs every cell from the top; `center` / `bottom` share
 * each cell's slack. Stretched cells (images, wrapped cells, bar markers, `...` cells)
 * never shift.
 */
function rowValignOffsets(
  sizer: Sizer,
  node: LayoutNode,
  children: readonly LayoutNode[],
  heights: readonly number[],
  wrapped: readonly boolean[],
): number[] {
  const n = children.length;
  const zeros = (): number[] => children.map(() => 0);
  const markerMode = hint(rpOf(node), "marker_align");
  const markerRow = markerMode !== null;
  if (n < 2 || !(node.line_split || node.column_row || markerRow)) return zeros();
  const mode = String(
    (truthy(markerMode) ? markerMode : null) ??
      (truthy(hint(rpOf(node), "line_align")) ? hint(rpOf(node), "line_align") : null) ??
      (sizer.theme.root.line_align || "baseline"),
  );
  if (node.column_row && mode === "baseline") return zeros();
  if (mode === "top") return zeros();
  const image = children.map((c) => isImageLeaf(c, sizer.index));
  // A `...` cell is given the row's full height and places its own content inside it;
  // shifting it as well would place that content twice.
  const stretched = children.map(
    (c, i) => !!wrapped[i] || !!image[i] || isBarMarker(c) || c.col_spring,
  );
  if (mode === "center" || mode === "bottom") {
    // A capped image has slack (its height is its own), so it aligns; an uncapped one
    // fills the row and stays.
    const boxed = stretched.map(
      (s, i) => s && !(image[i] && isWidthCapped(children[i] as LayoutNode)),
    );
    return boxValignOffsets(mode, heights, boxed);
  }

  const bases: (number | null)[] = children.map((child, i) => {
    if (stretched[i] || (child.type === "col" && !markerRow)) return null;
    const base = sizer.firstBaseline(child);
    return base === null ? (heights[i] as number) / LINE_SCALE : base;
  });
  const hasStacked = bases.some((b, i) => b === null && !stretched[i]);
  const real = bases.filter((b): b is number => b !== null);
  if (real.length === 0) {
    return hasStacked ? boxValignOffsets("center", heights, stretched) : zeros();
  }
  if (real.length < 2 && !hasStacked) return zeros();
  const top = Math.max(...real);
  const lo = Math.min(...real.map((b) => top - b));
  const hi = Math.max(
    ...bases.flatMap((b, i) => (b === null ? [] : [top - b + (heights[i] as number)])),
  );
  const bandCenter = (lo + hi) / 2;
  const raw = bases.map((b, i) => {
    if (stretched[i]) return null;
    const h = heights[i] as number;
    return b === null ? bandCenter - h / 2 : top - b;
  });
  const shift = -Math.min(...raw.filter((r): r is number => r !== null), 0);
  return raw.map((r) => (r === null ? 0 : r + shift));
}

/** md2ui `_is_code_block_leaf`: a code block is a surface, which fills its row. */
function isCodeBlockLeaf(node: LayoutNode, sizer: Sizer): boolean {
  return node.type === "-" && sizer.leafNode(node)?.type === "code_block";
}

/**
 * A row's cells at a width (md2ui `_layout_row`'s placements without their x when the
 * row packs): what sizing and placement share.
 */
interface RowCells {
  readonly children: readonly LayoutNode[];
  readonly widths: readonly number[];
  /** Each cell's x; `null` when the row fits and packs by alignment (placement's). */
  readonly offsets: readonly number[] | null;
  /** The height each cell is given: the row's for a cell that fills it, else its own. */
  readonly given: readonly number[];
  /** Each cell's downward shift on the row's line. */
  readonly dys: readonly number[];
  readonly height: number;
}

/** x of each cell placed left to right, `gaps[i]` before cell `i`. */
function sequential(widths: readonly number[], gaps: readonly number[]): number[] {
  const offsets: number[] = [];
  let x = 0;
  widths.forEach((w, i) => {
    x += gaps[i] as number;
    offsets.push(x);
    x += w;
  });
  return offsets;
}

/**
 * md2ui `_layout_grid_row`: K equal columns stretched to fill the space; a ragged last
 * row stays grid-aligned left, or is centred when the theme says `Orphan row: Center`.
 * Cells hang from the top.
 */
function gridRow(
  sizer: Sizer,
  node: LayoutNode,
  available: number,
  levels: Levels,
  owner: number,
): RowCells {
  const children = node.children;
  const first = children[0] as LayoutNode;
  const k = node.grid_cols || children.length;
  // The cell against itself resolves its own kind of gap without a real neighbour. A
  // picture cell asked about itself answers with the image gap, which only a
  // pictures-only grid has earned: beside any other cell the real neighbours decide, so
  // one picture cannot pull a mixed grid flush.
  const pairGap = (a: LayoutNode, b: LayoutNode): number =>
    siblingGap(a, b, sizer.theme, "row", owner, sizer.index, node).gap;
  const pictures = children.map((c) => isPureImageBlock(c, sizer.index, sizer.theme));
  const gap =
    pictures[0] && !pictures.every(Boolean)
      ? Math.max(...children.slice(1).map((c, i) => pairGap(children[i] as LayoutNode, c)))
      : pairGap(first, first);
  const colW = Math.max(0, (available - (k - 1) * gap) / k);
  const widths = children.map(() => colW);
  let offsets = children.map((_, i) => i * (colW + gap));
  if (hint(rpOf(node), "orphan_row") === "center") {
    const used = children.length * colW + (children.length - 1) * gap;
    const shift = Math.max(0, (available - used) / 2);
    offsets = offsets.map((o) => o + shift);
  }
  const measure = () => sizer.cellHeights(children, widths, levels, owner);
  // Matching pieces of the row's cards share one height (ADR-410).
  sizer.slots.share(children, measure, (c) => isImageLeaf(c, sizer.index));
  const { heights, wrapped } = measure();
  const height = maxOf(heights);
  const given = children.map((c, i) =>
    (isImageLeaf(c, sizer.index) && !isWidthCapped(c)) || wrapped[i] || isBarMarker(c)
      ? height
      : (heights[i] as number),
  );
  return { children, widths, offsets, given, dys: children.map(() => 0), height };
}

/**
 * md2ui `_layout_bento_row`: span-weighted widths on the generator's grid model
 * (`w(t) = t·u + (t−1)·g`), a capped image giving its released span to the other cells.
 * Every cell but a capped image stretches to the band's height.
 */
function bentoRow(
  sizer: Sizer,
  node: LayoutNode,
  available: number,
  levels: Levels,
  owner: number,
): RowCells {
  const children = node.children;
  const ratios = node.ratios.length > 0 ? node.ratios : children.map(() => 1);
  const total = pySum(ratios) || 1;
  const gap = maxOf(pairGaps(sizer, node, children, owner));
  const unit = Math.max(0, (available - (total - 1) * gap) / total);
  const widths = ratios.map((r) => r * unit + (r - 1) * gap);
  const capped = children.flatMap((c, i) =>
    isImageLeaf(c, sizer.index) && isWidthCapped(c) ? [i] : [],
  );
  const loose = children.flatMap((_, i) => (capped.includes(i) ? [] : [i]));
  for (const i of capped) {
    const cappedW = imageContentWidth(rpOf(children[i] as LayoutNode), widths[i] as number);
    const slack = (widths[i] as number) - cappedW;
    widths[i] = cappedW;
    if (slack > 0 && loose.length > 0) {
      const share = pySum(loose.map((j) => widths[j] as number));
      for (const j of loose) {
        widths[j] =
          (widths[j] as number) +
          (share > 0 ? (slack * (widths[j] as number)) / share : slack / loose.length);
      }
    }
  }
  const offsets = sequential(
    widths,
    widths.map((_, i) => (i === 0 ? 0 : gap)),
  );
  const { heights } = sizer.cellHeights(children, widths, levels, owner);
  const height = maxOf(heights);
  const given = children.map((_, i) => (capped.includes(i) ? (heights[i] as number) : height));
  return { children, widths, offsets, given, dys: children.map(() => 0), height };
}

/**
 * md2ui `_layout_row`. A grid or bento row has its own model. Otherwise every cell
 * collapses to what it asks for; a row that does not fit gives up its spacers first
 * (ADR-203), then falls back to the generator's ratios with fixed cells pinned and image
 * floors kept, and an authored `:::` row always splits by weight. The row is as tall as
 * its tallest cell once alignment has shifted each one down.
 */
function rowCells(
  sizer: Sizer,
  node: LayoutNode,
  available: number,
  levels: Levels,
  owner: number,
): RowCells {
  if (node.grid && node.children.length > 0) return gridRow(sizer, node, available, levels, owner);
  if (node.bento && node.children.length > 0) {
    return bentoRow(sizer, node, available, levels, owner);
  }
  const row = rowDesiredWidths(sizer, node, available, levels, owner);
  let { children, ratioWidths, desired } = row;
  if (children.length === 0) {
    return { children, widths: [], offsets: [], given: [], dys: [], height: 0 };
  }

  let gapsTotal = pySum(pairGaps(sizer, node, children, owner));
  let contentWidth = pySum(desired) + gapsTotal;

  // Spacers give way first, together, down to nothing, before any content is narrowed.
  // "Does not fit" counts prose at its length category's floor; in a weighted row a
  // cell is narrowed as soon as its share is under its line; a run's rows follow the
  // pin their run settled.
  const spacers = children.flatMap((c, i) => (isRowSpacer(c) ? [i] : []));
  let rowRatios = node.ratios.length > 0 ? [...node.ratios] : children.map(() => 1);
  const pin = hint(rpOf(node), "spacers");
  const weighted = node.column_row;
  if (
    spacers.length > 0 &&
    pin !== "keep" &&
    (truthy(pin) || weighted || contentWidth > available)
  ) {
    const floors = children.map((c, i) =>
      spacers.includes(i) || weighted
        ? (desired[i] as number)
        : besideSpacerFloor(sizer, c, desired[i] as number, available),
    );
    let need = gapsTotal + (weighted ? weightedNeed(rowRatios, floors, spacers) : pySum(floors));
    if (pin === "give_way") need = Number.POSITIVE_INFINITY;
    desired = [...desired];
    const room = pySum(spacers.map((i) => desired[i] as number));
    const cut = Math.min(Math.max(0, need - available), room);
    for (const i of spacers) {
      desired[i] = (desired[i] as number) - (room > 0 ? ((desired[i] as number) * cut) / room : 0);
    }
    contentWidth -= cut;
    if (need - cut > available) {
      // Given way entirely and still too wide: the spacers leave the row, and the gaps
      // they stood between with them.
      const keep = children.flatMap((_, i) => (spacers.includes(i) ? [] : [i]));
      children = keep.map((i) => children[i] as LayoutNode);
      desired = keep.map((i) => desired[i] as number);
      ratioWidths = keep.map((i) => ratioWidths[i] as number);
      rowRatios = keep.map((i) => rowRatios[i] as number);
      gapsTotal = pySum(pairGaps(sizer, node, children, owner));
      contentWidth = pySum(desired) + gapsTotal;
    }
  }

  let widths: number[];
  let offsets: number[] | null = null;
  if (contentWidth <= available && !node.column_row) {
    widths = desired;
  } else {
    // Overflow: the cells are placed in order with every pair gap between them.
    const gaps = [0, ...pairGaps(sizer, node, children, owner)];
    widths = overflowWidths(
      sizer,
      node,
      children,
      ratioWidths,
      desired,
      rowRatios,
      levels,
      owner,
      available,
      gaps,
    );
    offsets = sequential(widths, gaps);
  }

  const { heights, wrapped } = sizer.cellHeights(children, widths, levels, owner);
  const dys = rowValignOffsets(sizer, node, children.slice(0, heights.length), heights, wrapped);
  // A cell pushed down onto the row's baseline needs room for the shift.
  const height = maxOf(heights.map((h, i) => (dys[i] as number) + h));
  const given = heights.map((h, i) => {
    const c = children[i] as LayoutNode;
    // A code block is a surface, and a `...` cell asked for the row's full height: the
    // surplus its spring opens.
    const fills =
      (isImageLeaf(c, sizer.index) && !isWidthCapped(c)) ||
      wrapped[i] ||
      isBarMarker(c) ||
      isCodeBlockLeaf(c, sizer) ||
      c.col_spring;
    return fills ? height : h;
  });
  return { children, widths, offsets, given, dys, height };
}

/** How tall a row is at `available`: md2ui `_layout_row`'s row height. */
export function rowHeight(
  sizer: Sizer,
  node: LayoutNode,
  available: number,
  levels: Levels,
  owner: number,
): number {
  return rowCells(sizer, node, available, levels, owner).height;
}

/** One cell of a placed row (md2ui's placement tuple). */
interface RowCell {
  readonly node: LayoutNode;
  /** From the row's left edge. */
  readonly x: number;
  readonly width: number;
  /** The height the cell is given. */
  readonly height: number;
  /** Its downward shift on the row's line. */
  readonly dy: number;
}

export interface RowLayout {
  readonly cells: readonly RowCell[];
  readonly height: number;
}

/**
 * md2ui `_layout_row` for placement: every cell's place. A row that fits packs its cells
 * by alignment: the left bucket from the left edge, the right bucket from the right, the
 * centre bucket centred but never over its neighbours. A cell's alignment is its own
 * `content_align`, else `align` (what it inherits), else the theme's.
 */
export function rowLayout(
  sizer: Sizer,
  node: LayoutNode,
  available: number,
  levels: Levels,
  owner: number,
  align: string | null,
): RowLayout {
  const row = rowCells(sizer, node, available, levels, owner);
  const offsets =
    row.offsets ?? packedOffsets(sizer, node, row.children, row.widths, available, owner, align);
  return {
    cells: row.given.map((height, i) => ({
      node: row.children[i] as LayoutNode,
      x: offsets[i] as number,
      width: row.widths[i] as number,
      height,
      dy: row.dys[i] as number,
    })),
    height: row.height,
  };
}

/** md2ui `_layout_row`'s fitting branch: each cell's x, packed by its alignment. */
function packedOffsets(
  sizer: Sizer,
  node: LayoutNode,
  children: readonly LayoutNode[],
  widths: readonly number[],
  available: number,
  owner: number,
  inherited: string | null,
): number[] {
  const buckets: Record<"left" | "center" | "right", number[]> = {
    left: [],
    center: [],
    right: [],
  };
  children.forEach((child, i) => {
    const own = hint(rpOf(child), "content_align");
    const align = String(
      (truthy(own) ? own : null) ?? (inherited || null) ?? (sizer.theme.root.align || "left"),
    );
    (align === "center" || align === "right" ? buckets[align] : buckets.left).push(i);
  });
  const gap = (a: number, b: number): number =>
    siblingGap(
      children[a] as LayoutNode,
      children[b] as LayoutNode,
      sizer.theme,
      "row",
      owner,
      sizer.index,
      node,
    ).gap;
  const width = (i: number): number => widths[i] as number;
  const offsets = children.map(() => 0);
  let x = 0;
  buckets.left.forEach((i, k) => {
    if (k > 0) x += gap(buckets.left[k - 1] as number, i);
    offsets[i] = x;
    x += width(i);
  });
  let rx = available;
  const right = buckets.right;
  for (let k = right.length - 1; k >= 0; k--) {
    const i = right[k] as number;
    if (k < right.length - 1) rx -= gap(i, right[k + 1] as number);
    rx -= width(i);
    offsets[i] = rx;
  }
  const center = buckets.center;
  const head = center[0];
  const tail = center[center.length - 1];
  if (head !== undefined && tail !== undefined) {
    const block =
      pySum(center.map(width)) + pySum(center.slice(1).map((i, k) => gap(center[k] as number, i)));
    let cx = (available - block) / 2;
    // Centred, but never over its neighbours: the block keeps a gap clear of the left
    // bucket's end and of the right bucket's start.
    const firstRight = right[0];
    if (firstRight !== undefined) {
      cx = Math.min(cx, (offsets[firstRight] as number) - gap(tail, firstRight) - block);
    }
    const lastLeft = buckets.left[buckets.left.length - 1];
    if (lastLeft !== undefined) {
      cx = Math.max(cx, (offsets[lastLeft] as number) + width(lastLeft) + gap(lastLeft, head));
    }
    center.forEach((i, k) => {
      if (k > 0) cx += gap(center[k - 1] as number, i);
      offsets[i] = cx;
      cx += width(i);
    });
  }
  return offsets;
}

/**
 * md2ui `_layout_row`'s overflow branch: the ratio widths scaled to leave room for the
 * gaps (an authored row resolves its weights after the gaps instead), fixed aside cells
 * pinned to what they measured, and, in an authored row, image floors raised and each
 * weighted cell given its widest element out of its `:::0` pictures.
 */
function overflowWidths(
  sizer: Sizer,
  node: LayoutNode,
  children: readonly LayoutNode[],
  ratioWidths: readonly number[],
  desired: readonly number[],
  rowRatios: readonly number[],
  levels: Levels,
  owner: number,
  available: number,
  gaps: readonly number[],
): number[] {
  const totalGaps = pySum(gaps);
  const scale = available > 0 ? Math.max(0, available - totalGaps) / available : 0;
  let widths = ratioWidths.map((w) => w * scale);
  if (node.column_row) {
    // A cell weighted 0 is pinned to what its content measured.
    const room = Math.max(0, available - totalGaps);
    const zero = rowRatios.flatMap((r, i) => (r ? [] : [i]));
    const share = Math.max(0, room - pySum(zero.map((i) => desired[i] as number)));
    const weighted = pySum(rowRatios.filter((r) => r)) || 1;
    widths = rowRatios.map((r, i) => (r ? (share * r) / weighted : (desired[i] as number)));
  }
  // A fixed aside cell (a gutter marker, an aside icon, a spacer, a width-capped image)
  // is a column, not a share: pinned to its measured width, its slack to the others.
  const fixed = children.flatMap((c, i) => {
    const rp = rpOf(c);
    const isFixed =
      truthy(hint(rp, "list_marker")) ||
      truthy(hint(rp, "aside_fixed")) ||
      isRowSpacer(c) ||
      (isImageLeaf(c, sizer.index) && isWidthCapped(c));
    return isFixed ? [i] : [];
  });
  const loose = children.flatMap((_, i) => (fixed.includes(i) ? [] : [i]));
  for (const i of fixed) {
    const slack = (widths[i] as number) - (desired[i] as number);
    if (slack <= 0 || loose.length === 0) continue;
    widths[i] = desired[i] as number;
    const share = pySum(loose.map((j) => widths[j] as number));
    for (const j of loose) {
      widths[j] =
        (widths[j] as number) +
        (share > 0 ? (slack * (widths[j] as number)) / share : slack / loose.length);
    }
  }
  // An image's `min_width` is a floor; only an authored row splits by weight, so only
  // it can undercut one.
  if (node.column_row) {
    children.forEach((c, i) => {
      const floor = cellFloor(sizer, c, levels, owner);
      const rest = loose.filter((j) => j !== i);
      const short = floor - (widths[i] as number);
      if (!floor || short <= 0 || rest.length === 0) return;
      widths[i] = floor;
      const share = pySum(rest.map((j) => widths[j] as number));
      for (const j of rest) {
        widths[j] =
          (widths[j] as number) -
          (share > 0 ? (short * (widths[j] as number)) / share : short / rest.length);
      }
    });
    giveElementsRoom(sizer, widths, children, rowRatios, levels, owner);
  }
  return widths;
}
