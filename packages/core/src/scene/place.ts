// Placement: a baked layout tree, sized, becomes positioned boxes (md2ui
// `render_place.place_boxes`, `_place_table_boxes`, `_col_spring_gaps`, `_note_actions`).
// A leaf gets the slot its parent gives it; a row places its cells where its layout puts
// them; a column stacks its children with the gaps between them; a table follows its
// plan. A wrapped child gets a section box per layer and is placed inside their padding,
// opening its section level for the children beneath it. Every size comes from sizing
// (`measure/`), so a box is exactly as big as the generator measured it.
import type { PaddingBox, ResolvedTheme, SectionStyle } from "@md2ui/contracts";
import { pySum } from "../group/py/math.ts";
import type { LayoutNode } from "../layout/node.ts";
import { childOwnerLevel, paddedChildren, tablesAreActive } from "../measure/layers.ts";
import { hint, type Props, truthy } from "../measure/leaf-kit.ts";
import { dividerRect } from "../measure/list-surfaces.ts";
import { isWidthCapped, rowLayout } from "../measure/rows.ts";
import type { Levels, Sizer } from "../measure/sizer.ts";
import { type Wrap, wrapOf } from "../measure/sizer.ts";
import { siblingGap } from "../measure/spacing.ts";
import { tablePlan } from "../measure/tables.ts";
import { paddingX, paddingY, sectionIsActive } from "../theme/query.ts";
import {
  emitWrapBoxes,
  pushBg,
  replaceColor,
  rootBgStack,
  sectionBox,
  tableBackgroundColor,
} from "./backgrounds.ts";
import type { BgStack, LayoutBox, SectionBox } from "./boxes.ts";

const NO_PADDING: PaddingBox = Object.freeze({ top: 0, left: 0, right: 0, bottom: 0 });

/**
 * Where a link card or a heading anchor lands: the slot a node is placed in, and again
 * the outer box a wrapped node's background fills (md2ui `_note_actions`' tuple).
 */
export interface Mark {
  readonly kind: "card" | "anchor";
  /** The card's node id, or the anchor's heading id. */
  readonly key: string;
  readonly url: string | null;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What one placement collects, in the order md2ui emits it. */
export interface Placed {
  readonly boxes: LayoutBox[];
  readonly sections: SectionBox[];
  readonly marks: Mark[];
}

interface Placing extends Placed {
  readonly sizer: Sizer;
  readonly theme: ResolvedTheme;
}

/** md2ui `_cascade_render`'s `content_align`: own value beats inherited. */
function cascadeAlign(node: LayoutNode, inherited: string | null): string | null {
  const own = node.render_properties?.["content_align"];
  return truthy(own) ? String(own) : inherited;
}

/** md2ui `_note_actions`. */
function note(ctx: Placing, node: LayoutNode, x: number, y: number, w: number, h: number): void {
  if (node.link_url !== null && node.link_node_id) {
    ctx.marks.push({
      kind: "card",
      key: node.link_node_id,
      url: node.link_url,
      x,
      y,
      width: w,
      height: h,
    });
  }
  if (node.heading_id) {
    ctx.marks.push({ kind: "anchor", key: node.heading_id, url: null, x, y, width: w, height: h });
  }
}

/** A leaf's hints with the `content_align` it inherits filled into an empty slot. */
function leafProps(own: Props | null, align: string | null, extra: Props | null): Props | null {
  const eff: Record<string, unknown> = { ...own, ...extra };
  if (!truthy(eff["content_align"]) && align) eff["content_align"] = align;
  return Object.keys(eff).length > 0 ? eff : null;
}

/** md2ui `_valign_offset`: a row cell's own `content_valign` shares its slack. */
function valignOffset(rp: Props | null, cellH: number, rowH: number): number {
  const v = hint(rp, "content_valign");
  if (v === "center") return Math.max(0, (rowH - cellH) / 2);
  if (v === "bottom") return Math.max(0, rowH - cellH);
  return 0;
}

/**
 * Place a wrapped `child` in the slot `x, y, width × height`: one section box per wrap
 * layer fills the slot, and the child goes inside their padding at `innerHeight`, with
 * its section level open.
 */
function placeWrapped(
  ctx: Placing,
  child: LayoutNode,
  wrap: Wrap,
  slot: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  innerHeight: number,
  align: string | null,
  owner: number,
  bg: BgStack,
): void {
  const { x, y, width, height } = slot;
  note(ctx, child, x, y, width, height);
  const inner = emitWrapBoxes(
    ctx.sections,
    x,
    y,
    width,
    height,
    wrap.layers,
    {
      ring: child.render_properties?.["ring"] ?? null,
      bgImageUrl: child.card_bg_url,
      rotationIndex: child.rotation_index,
      rotationChain: child.rotation_chain,
      rotationPath: child.rotation_path,
      fixedStyleKey: child.section_style_key,
    },
    ctx.theme,
    bg,
  );
  const childOwner = childOwnerLevel(child, ctx.theme, owner);
  place(
    ctx,
    child,
    inner.x,
    inner.y,
    inner.width,
    innerHeight,
    align,
    wrap.levels,
    childOwner,
    inner.bgStack,
  );
}

/** md2ui `place_boxes`. */
function place(
  ctx: Placing,
  node: LayoutNode,
  x: number,
  y: number,
  width: number,
  height: number,
  inherited: string | null,
  levels: Levels,
  owner: number,
  bg: BgStack,
): void {
  const { sizer, theme } = ctx;
  note(ctx, node, x, y, width, height);
  if (node.type === "layout") {
    const align = cascadeAlign(node, inherited);
    for (const child of node.children) {
      const childOwner = childOwnerLevel(child, theme, owner);
      const wrap = wrapOf(child, theme, levels);
      if (wrap === null) {
        const h = sizer.naturalHeight(child, width, levels, childOwner);
        place(ctx, child, x, y, width, h, align, levels, childOwner, bg);
        continue;
      }
      // The body opens a section when the whole document is one heading section.
      const innerH = sizer.naturalHeight(
        child,
        width - paddingX(wrap.pad),
        wrap.levels,
        childOwner,
      );
      const slot = { x, y, width, height: innerH + paddingY(wrap.pad) };
      placeWrapped(ctx, child, wrap, slot, innerH, align, owner, bg);
    }
    return;
  }
  if (node.type === "-") {
    ctx.boxes.push({
      x,
      y,
      width,
      height,
      content_id: node.content_id,
      render_properties: leafProps(node.render_properties, inherited, null),
      bg_stack: bg,
    });
    return;
  }
  if (node.type === "row") {
    placeRow(ctx, node, x, y, width, height, inherited, levels, owner, bg);
    return;
  }
  if (node.type === "col") {
    if (node.table) placeTable(ctx, node, x, y, width, inherited, levels, owner, bg);
    else placeCol(ctx, node, x, y, width, height, inherited, levels, owner, bg);
  }
}

/** md2ui `place_boxes`' row branch. */
function placeRow(
  ctx: Placing,
  node: LayoutNode,
  x: number,
  y: number,
  width: number,
  height: number,
  inherited: string | null,
  levels: Levels,
  owner: number,
  bg: BgStack,
): void {
  const align = cascadeAlign(node, inherited);
  const row = rowLayout(ctx.sizer, node, width, levels, owner, align);
  let rowH = row.height;
  let cells = row.cells;
  if (node.bento && height > rowH) {
    // A nested bento row in a stretched band: every cell but a capped one stretches to
    // the band, so the mosaic's edges stay aligned.
    cells = cells.map((c) => (isWidthCapped(c.node) ? c : { ...c, height }));
    rowH = height;
  }
  for (const cell of cells) {
    // The row's own alignment (a same-line or `:::` row) wins; a cell's `content_valign`
    // applies only where the row said nothing.
    const child = cell.node;
    const cy = y + (cell.dy || valignOffset(child.render_properties, cell.height, rowH));
    const slot = { x: x + cell.x, y: cy, width: cell.width, height: cell.height };
    const wrap = wrapOf(child, ctx.theme, levels);
    if (wrap === null) {
      const childOwner = childOwnerLevel(child, ctx.theme, owner);
      place(ctx, child, slot.x, cy, cell.width, cell.height, align, levels, childOwner, bg);
    } else {
      const innerH = cell.height - paddingY(wrap.pad);
      placeWrapped(ctx, child, wrap, slot, innerH, align, owner, bg);
    }
  }
}

/** The gap above each child of a column but the first: md2ui's `_sibling_gap` on the col axis. */
function colGaps(ctx: Placing, node: LayoutNode, children: readonly LayoutNode[], owner: number) {
  return children
    .slice(1)
    .map(
      (c, i) =>
        siblingGap(children[i] as LayoutNode, c, ctx.theme, "col", owner, ctx.sizer.index, node)
          .gap,
    );
}

/** md2ui `place_boxes`' col branch. */
function placeCol(
  ctx: Placing,
  node: LayoutNode,
  x: number,
  y: number,
  width: number,
  height: number,
  inherited: string | null,
  levels: Levels,
  owner: number,
  bg: BgStack,
): void {
  const { sizer, theme } = ctx;
  const children = paddedChildren(node);
  const align = cascadeAlign(node, inherited);
  const gaps = colGaps(ctx, node, children, owner);
  // A bento band given more height than its stack needs shares the surplus out in
  // proportion to each child's height (all to the last when none has any).
  const extras = children.map(() => 0);
  if (node.bento && children.length > 0) {
    const totals = sizer.cellHeights(
      children,
      children.map(() => width),
      levels,
      owner,
    ).heights;
    const surplus = Math.max(0, height - (pySum(totals) + pySum(gaps)));
    if (surplus > 0) {
      const denom = pySum(totals);
      if (denom > 0) {
        totals.forEach((t, i) => {
          extras[i] = (surplus * t) / denom;
        });
      } else {
        extras[extras.length - 1] = surplus;
      }
    }
  }
  const springs = colSpringGaps(ctx, node, children, gaps, width, height, levels, owner);
  let curY = y;
  // A ring reserves its whole diameter; its value and unit centre inside it.
  if (node.card_kind === "ring" && children.length > 0) {
    const contentH =
      pySum(
        children.map((c) =>
          sizer.naturalHeight(c, width, levels, childOwnerLevel(c, theme, owner)),
        ),
      ) + pySum(gaps);
    curY = y + Math.max(0, (height - contentH) / 2);
  }
  // The space a spring opens above the first child.
  curY += springs[0] ?? 0;
  children.forEach((child, i) => {
    if (i > 0) {
      curY += (gaps[i - 1] as number) + (springs[i] as number);
      const rule = dividerRect(children[i - 1] as LayoutNode, child, x, curY, width, theme);
      if (rule !== null) {
        ctx.sections.push(
          sectionBox(rule.x, rule.y, rule.width, rule.height, 0, NO_PADDING, rule.kind),
        );
      }
    }
    const childOwner = childOwnerLevel(child, theme, owner);
    const wrap = wrapOf(child, theme, levels);
    const extra = extras[i] as number;
    if (wrap === null) {
      const h = sizer.naturalHeight(child, width, levels, childOwner) + extra;
      place(ctx, child, x, curY, width, h, align, levels, childOwner, bg);
      curY += h;
      return;
    }
    const innerH =
      sizer.naturalHeight(child, width - paddingX(wrap.pad), wrap.levels, childOwner) + extra;
    const total = innerH + paddingY(wrap.pad);
    placeWrapped(ctx, child, wrap, { x, y: curY, width, height: total }, innerH, align, owner, bg);
    curY += total;
  });
}

/**
 * md2ui `_col_spring_gaps`: the extra space before each child of a `...` column. Regions
 * run top, centre, bottom; the surplus height opens before the centre block, which sits on
 * the box's midline, and before the bottom block, which sits on the bottom edge. All
 * zeros without a spring, with fewer than two children, or with no surplus.
 *
 * An image card that its picture's ratio made taller than its content puts the surplus
 * where its author put room, growing its first `+++++`; with none, above the content, so
 * the words sit at the bottom of the photo and a one-line row written first (a chip, a
 * button) stays on top.
 */
function colSpringGaps(
  ctx: Placing,
  node: LayoutNode,
  children: readonly LayoutNode[],
  pairGaps: readonly number[],
  width: number,
  height: number,
  levels: Levels,
  owner: number,
): number[] {
  const n = children.length;
  const zeros = children.map(() => 0);
  const card = truthy(node.render_properties?.["photo_sized"]);
  if (!(node.col_spring && n >= 2) && !(card && n > 0)) return zeros;
  // Wrap-aware, as the placement loop reserves them: a region that paints a surface of
  // its own (a quote, a list, a card) counts its padding, which is not surplus to hand out.
  const { heights } = ctx.sizer.cellHeights(
    children,
    children.map(() => width),
    levels,
    owner,
  );
  const gaps = [0, ...pairGaps];
  const surplus = height - (pySum(heights) + pySum(gaps));
  if (surplus <= 0) return zeros;
  if (!node.col_spring) {
    const out = [...zeros];
    const spacer = children.findIndex(isColSpacer);
    if (spacer >= 0) {
      // A last spacer already has the room below it.
      if (spacer + 1 < n) out[spacer + 1] = surplus;
    } else {
      out[n > 1 && children[0]?.type === "row" ? 1 : 0] = surplus;
    }
    return out;
  }
  const valigns = children.map((c) => {
    const v = hint(c.render_properties, "content_valign");
    return truthy(v) ? String(v) : "top";
  });
  const block = (name: string): [number, number] => {
    const idx = valigns.flatMap((v, i) => (v === name ? [i] : []));
    const first = idx[0];
    if (first === undefined) return [-1, 0];
    const span =
      pySum(idx.map((i) => heights[i] as number)) +
      pySum(idx.slice(1).map((i) => gaps[i] as number));
    return [first, span];
  };
  const [, topH] = block("top");
  const [midI, midH] = block("center");
  const [botI, botH] = block("bottom");
  const out = [...zeros];
  let consumed = topH + (midI > 0 ? (gaps[midI] as number) : 0);
  if (midI >= 0) {
    const want = Math.max(0, (height - midH) / 2);
    out[midI] = Math.max(0, want - consumed);
    consumed = want + midH;
  }
  if (botI >= 0) {
    const want = height - botH;
    const before = consumed + (botI > 0 ? (gaps[botI] as number) : 0);
    out[botI] = Math.max(0, want - before);
  }
  return out;
}

/** md2ui `_is_col_spacer`: a `+++++` spacer between stacked children. */
function isColSpacer(node: LayoutNode): boolean {
  const spacer = node.render_properties?.["spacer"] as { axis?: unknown } | null | undefined;
  return spacer?.axis === "col";
}

/**
 * md2ui `_place_table_boxes`: a table's shell and row backgrounds (when the theme styles
 * tables) and its cells, from its plan. A row's fill is replaced against what the table
 * sits on, as a card's is, and a cell's text resolves its colour against that fill. A
 * cell is noted like any placed node, so a link card inside one clicks where it is drawn.
 */
function placeTable(
  ctx: Placing,
  node: LayoutNode,
  x: number,
  y: number,
  width: number,
  inherited: string | null,
  levels: Levels,
  owner: number,
  bg: BgStack,
): void {
  const { sizer, theme } = ctx;
  const tt = theme.tables;
  // md2ui `_fill_bg`: the fill is a paint first, replaced against what the table sits
  // on, as a card's is (the row boxes carry the same stack to paint it); a stacked
  // card's keys sit on the cell fill too, so they read it the same way.
  const fillBg = (style: SectionStyle, row: number): BgStack => {
    const color = tableBackgroundColor(style, row, theme);
    return pushBg(bg, color === null ? null : replaceColor(color, bg, theme, "fill"));
  };
  const cellBg = (contentId: string | null, extra: Props): BgStack => {
    const role = contentId === null ? null : sizer.index.get(contentId)?.table_role;
    const style = role === "header" ? tt.header : tt.cells;
    return fillBg(style, Number(extra["table_bg_index"] ?? 0));
  };
  const plan = tablePlan(sizer, node, width);
  if (tablesAreActive(theme)) {
    let clip: SectionBox["clip"] = null;
    if (plan.shell !== null) {
      const { x: sx, y: sy, width: sw, height: sh } = plan.shell;
      ctx.sections.push(sectionBox(x + sx, y + sy, sw, sh, 0, tt.table.padding, "table"));
      if (tt.table.corner_radius > 0) {
        clip = [x + sx, y + sy, sw, sh, tt.table.corner_radius];
      }
    }
    for (const r of plan.rowBoxes) {
      const st = r.kind === "table_header" ? tt.header : tt.cells;
      if (sectionIsActive(st)) {
        ctx.sections.push(
          sectionBox(x + r.x, y + r.y, r.width, r.height, 0, st.padding, r.kind, {
            clip,
            bg_stack: bg,
          }),
        );
      }
    }
  }
  const align = cascadeAlign(node, inherited);
  for (const cell of plan.cells) {
    const cbg = cellBg(cell.node.content_id, cell.extra);
    if (cell.node.type === "-") {
      note(ctx, cell.node, x + cell.x, y + cell.y, cell.width, cell.height);
      ctx.boxes.push({
        x: x + cell.x,
        y: y + cell.y,
        width: cell.width,
        height: cell.height,
        content_id: cell.node.content_id,
        render_properties: leafProps(cell.node.render_properties, align, cell.extra),
        bg_stack: cbg,
      });
    } else {
      place(
        ctx,
        cell.node,
        x + cell.x,
        y + cell.y,
        cell.width,
        cell.height,
        align,
        levels,
        owner,
        cbg,
      );
    }
  }
  for (const key of plan.keys) {
    ctx.boxes.push({
      x: x + key.x,
      y: y + key.y,
      width: key.width,
      height: key.height,
      content_id: null,
      render_properties: { table_key: { text: key.text } },
      bg_stack: fillBg(tt.cells, key.row),
    });
  }
}

/**
 * md2ui `build_scene`'s placement: the baked `layout` placed at `width`, from the page's
 * own background down.
 */
export function placeLayout(
  sizer: Sizer,
  layout: LayoutNode,
  width: number,
  height: number,
): Placed {
  const ctx: Placing = {
    sizer,
    theme: sizer.theme,
    boxes: [],
    sections: [],
    marks: [],
  };
  place(ctx, layout, 0, 0, width, height, null, new Set(), 0, rootBgStack(sizer.theme));
  return { boxes: ctx.boxes, sections: ctx.sections, marks: ctx.marks };
}
