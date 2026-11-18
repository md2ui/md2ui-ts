// A table's geometry (md2ui `render_measure._table_plan`, `_table_cell_min_width`,
// `_table_cell_height`). In grid mode every column is as wide as its widest cell across
// all rows, and the surplus is shared out; when even the narrowest cells do not fit, the
// horizontal chrome squeezes, then the table stacks into cards (when the theme allows)
// or overflows. Sizing reads the plan's size; placement reads where every row
// background, cell and key label sits. One plan for both, so they cannot disagree.
import type { Argb, PaddingBox } from "@md2ui/contracts";
import { pySum } from "../group/py/math.ts";
import type { LayoutNode } from "../layout/node.ts";
import { paddingX, paddingY, resolveElementSpacing, sectionIsActive } from "../theme/query.ts";
import { type TextFaces, weightFromStr } from "./font-set.ts";
import { LINE_SCALE, type Props } from "./leaf-kit.ts";
import type { Sizer } from "./sizer.ts";
import { siblingGap } from "./spacing.ts";

// md2ui `TABLE_SQUEEZE_FLOOR`: how far the horizontal chrome (cell padding, column gaps)
// may compress before the grid gives up on fitting.
const TABLE_SQUEEZE_FLOOR = 0.5;

// md2ui `theme.TABLE_KEY_COL_MAX_SHARE`: the widest a stacking card's key column gets.
const TABLE_KEY_COL_MAX_SHARE = 0.4;

const ZERO: PaddingBox = Object.freeze({ top: 0, left: 0, right: 0, bottom: 0 });

/** A rectangle in table-local coordinates. */
interface TableRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A header or body row's background (in cards mode, a card's). */
interface TableRowBox extends TableRect {
  readonly kind: "table_header" | "table_row";
}

/** A cell's content, inset by its padding, and the hints it is placed with. */
interface TableCell extends TableRect {
  readonly node: LayoutNode;
  /** `table_bg_index`, and the title's `content_weight` in cards mode. */
  readonly extra: Props;
}

/** A stacking card's key label, beside its value. */
interface TableKey extends TableRect {
  readonly text: string;
  /** The body row the card stands for. */
  readonly row: number;
}

/** md2ui `TablePlan`: a table's full geometry, in table-local coordinates. */
export interface TablePlan {
  readonly mode: "grid" | "cards";
  readonly width: number;
  readonly height: number;
  /** The whole table's rect when the rows merge into one shell, else `null`. */
  readonly shell: TableRect | null;
  readonly rowBoxes: readonly TableRowBox[];
  readonly cells: readonly TableCell[];
  readonly keys: readonly TableKey[];
}

/**
 * md2ui `_table_cell_min_width`: a cell's narrowest width, a whole pill or its widest
 * unbreakable run of text in its own style (C3's narrowest width, md2ui `_widest_unit`).
 */
export function tableCellMinWidth(sizer: Sizer, cell: LayoutNode, available: number): number {
  if (cell.type !== "-") return sizer.naturalWidth(cell, available);
  const nd = sizer.leafNode(cell);
  if (nd === null) return 0;
  if (["link", "inline_code", "emoji", "image"].includes(nd.type)) {
    return sizer.widths.leafNaturalWidth(nd, available, cell.render_properties);
  }
  if (nd.content === "") return 0;
  const { leaves } = sizer;
  return leaves.prepare(leaves.spans(leaves.leafText(nd, null, "plain"))).minWidth();
}

/** md2ui `_table_cell_height`: a cell's height, with an overlay on a leaf's render hints. */
function tableCellHeight(
  sizer: Sizer,
  cell: LayoutNode,
  width: number,
  extra: Props | null = null,
): number {
  if (cell.type !== "-") return sizer.naturalHeight(cell, width);
  const rp = extra === null ? cell.render_properties : { ...cell.render_properties, ...extra };
  return sizer.heights.leafHeight(sizer.leafNode(cell), width, rp);
}

/** md2ui `_table_cell_pad`: a cell role's label padding. */
function cellPad(sizer: Sizer, role: string): PaddingBox {
  const tables = sizer.theme.tables;
  return (role === "header" ? tables.header : tables.cells).padding;
}

/** md2ui `_table_plan`: a `table` col measured at `available`. */
export function tablePlan(sizer: Sizer, node: LayoutNode, available: number): TablePlan {
  const { theme, index } = sizer;
  const tt = theme.tables;
  const rows = node.children.filter((c) => c.table_row !== null);
  const nCols = Math.max(0, ...rows.map((r) => r.children.length));
  if (nCols === 0) {
    return { mode: "grid", width: 0, height: 0, shell: null, rowBoxes: [], cells: [], keys: [] };
  }

  let colGap = 0;
  for (const r of rows) {
    const [a, b] = r.children;
    if (a !== undefined && b !== undefined) {
      colGap = siblingGap(a, b, theme, "row", 0, index, r).gap;
      break;
    }
  }
  const [r0, r1] = rows;
  const rowGap =
    r0 !== undefined && r1 !== undefined ? siblingGap(r0, r1, theme, "col", 0, index, node).gap : 0;
  const merged = tt.table.merge_rows && sectionIsActive(tt.table);
  const shellPad = merged ? tt.table.padding : ZERO;
  const innerW = Math.max(1, available - paddingX(shellPad));

  const nat = new Array<number>(nCols).fill(0);
  const mins = new Array<number>(nCols).fill(0);
  // Each column's narrowest width split into glyphs and squeezable chrome.
  const contentMin = new Array<number>(nCols).fill(0);
  const padCol = new Array<number>(nCols).fill(0);
  for (const r of rows) {
    const padX = paddingX(cellPad(sizer, r.table_row || "body"));
    r.children.forEach((cell, j) => {
      nat[j] = Math.max(nat[j] as number, sizer.naturalWidth(cell, innerW) + padX);
      const cMin = tableCellMinWidth(sizer, cell, innerW);
      mins[j] = Math.max(mins[j] as number, cMin + padX);
      contentMin[j] = Math.max(contentMin[j] as number, cMin);
      padCol[j] = Math.max(padCol[j] as number, padX);
    });
  }
  const gapsW = (nCols - 1) * colGap;
  const budget = Math.max(1, innerW - gapsW);
  const sumNat = pySum(nat);
  const sumMin = pySum(mins);

  let fx = 1;
  let widths: number[];
  const squeezed = (f: number): number[] => contentMin.map((c, j) => c + f * (padCol[j] as number));
  if (sumNat <= budget) {
    const extra = budget - sumNat;
    widths = nat.map((n) => n + (sumNat > 0 ? (extra * n) / sumNat : extra / nCols));
  } else if (sumMin <= budget) {
    const denom = pySum(nat.map((n, j) => n - (mins[j] as number)));
    const extra = budget - sumMin;
    widths = nat.map((n, j) => {
      const m = mins[j] as number;
      return m + (denom > 0 ? (extra * (n - m)) / denom : extra / nCols);
    });
  } else {
    // Squeeze the chrome before giving up on the grid: glyphs never shrink.
    const chrome = pySum(padCol) + gapsW;
    const content = pySum(contentMin);
    const f = chrome > 0 ? (innerW - content) / chrome : 0;
    if (f >= TABLE_SQUEEZE_FLOOR) {
      fx = Math.min(1, f);
      widths = squeezed(fx);
    } else if (tt.stacking) {
      return cardsPlan(sizer, rows, available);
    } else {
      // Overflow: a column is never narrower than its widest pill or word.
      fx = TABLE_SQUEEZE_FLOOR;
      widths = squeezed(fx);
    }
  }

  const gapEff = colGap * fx;
  const rowW = pySum(widths) + (nCols - 1) * gapEff;
  const rowBoxes: TableRowBox[] = [];
  const cells: TableCell[] = [];
  let y = shellPad.top;
  let bodyIndex = 0;
  rows.forEach((r, i) => {
    if (i > 0) y += rowGap;
    const role = r.table_row || "body";
    const pad = cellPad(sizer, role);
    let contentH = 0;
    let cx = shellPad.left;
    const placed = r.children.map((cell, j) => {
      const wIn = Math.max(1, (widths[j] as number) - fx * paddingX(pad));
      contentH = Math.max(contentH, tableCellHeight(sizer, cell, wIn));
      const at = { node: cell, x: cx + fx * pad.left, width: wIn };
      cx += (widths[j] as number) + gapEff;
      return at;
    });
    const header = role === "header";
    rowBoxes.push({
      kind: header ? "table_header" : "table_row",
      x: shellPad.left,
      y,
      width: rowW,
      height: contentH + paddingY(pad),
    });
    const extra = { table_bg_index: header ? 0 : bodyIndex };
    for (const at of placed) cells.push({ ...at, y: y + pad.top, height: contentH, extra });
    if (!header) bodyIndex += 1;
    y += contentH + paddingY(pad);
  });
  const height = y + shellPad.bottom;
  const width = rowW + paddingX(shellPad);
  const shell = merged ? { x: 0, y: 0, width, height } : null;
  return { mode: "grid", width, height, shell, rowBoxes, cells, keys: [] };
}

/**
 * md2ui `_table_plan`'s stacking-cards mode: each body row a card of key-value pairs
 * (the header's cells are the keys), its first cell a title in `title` layout.
 */
function cardsPlan(sizer: Sizer, rows: readonly LayoutNode[], available: number): TablePlan {
  const { theme, leaves } = sizer;
  const tt = theme.tables;
  const header = rows.find((r) => r.table_row === "header");
  const keyTexts = (header?.children ?? []).map((cell) => sizer.leafNode(cell)?.content ?? "");
  const bodyRows = rows.filter((r) => r.table_row !== "header");
  const cardPad = tt.cells.padding;
  const innerCw = Math.max(1, available - paddingX(cardPad));
  const { faces: keyFaces, size: keySize } = tableKeyFonts(sizer);
  const keyH = keySize * LINE_SCALE;
  const keyLines = keyTexts
    .filter((t) => t !== "")
    .map((t) =>
      leaves
        .prepare(
          leaves.spans({
            content: t,
            sized: { faces: keyFaces, size: keySize, emoji: leaves.fonts.emoji },
          }),
        )
        .lineWidth(),
    );
  const keyW = Math.min(
    keyLines.length > 0 ? Math.max(...keyLines) : 0,
    TABLE_KEY_COL_MAX_SHARE * innerCw,
  );
  const cardGap = tt.table.col_spacing ?? resolveElementSpacing("col", theme);
  const pairGap = resolveElementSpacing("col", theme);
  const titleMode = tt.card_layout === "title";

  const rowBoxes: TableRowBox[] = [];
  const cells: TableCell[] = [];
  const keys: TableKey[] = [];
  let y = 0;
  bodyRows.forEach((r, bi) => {
    if (bi > 0) y += cardGap;
    const cardY = y;
    let cy = cardY + cardPad.top;
    const row = r.children;
    let start = 0;
    const first = row[0];
    if (titleMode && first !== undefined) {
      const extra = { content_weight: "first", table_bg_index: bi };
      const th = tableCellHeight(sizer, first, innerCw, extra);
      cells.push({ node: first, x: cardPad.left, y: cy, width: innerCw, height: th, extra });
      cy += th;
      start = 1;
    }
    const valX = cardPad.left + keyW + tt.key_spacing;
    const valW = Math.max(1, innerCw - keyW - tt.key_spacing);
    for (let j = start; j < row.length; j++) {
      if (j > start || start === 1) cy += pairGap;
      const cell = row[j] as LayoutNode;
      const vh = tableCellHeight(sizer, cell, valW);
      const keyText = keyTexts[j] ?? "";
      if (keyText !== "") {
        keys.push({ text: keyText, x: cardPad.left, y: cy, width: keyW, height: keyH, row: bi });
      }
      cells.push({
        node: cell,
        x: valX,
        y: cy,
        width: valW,
        height: vh,
        extra: { table_bg_index: bi },
      });
      cy += Math.max(keyH, vh);
    }
    const cardH = cy - cardY + cardPad.bottom;
    rowBoxes.push({ kind: "table_row", x: 0, y: cardY, width: available, height: cardH });
    y = cardY + cardH;
  });
  return { mode: "cards", width: available, height: y, shell: null, rowBoxes, cells, keys };
}

/**
 * md2ui `_table_key_fonts`: a stacking card's key labels in the Card Keys style, in the
 * table's own key faces when it names a family, else the base pair at its weight.
 */
export function tableKeyFonts(sizer: Sizer): {
  readonly faces: TextFaces;
  readonly size: number;
  readonly color: Argb;
} {
  const { theme } = sizer;
  const { fonts } = sizer.leaves;
  const ts = theme.tables.keys_text ?? theme.labels;
  const own = fonts.tables.get("keys");
  let faces: TextFaces;
  if (own !== undefined) faces = { ...fonts, typeface: own[0], italic: own[1] };
  else if (weightFromStr(ts.font_weight) >= 700) {
    faces = { ...fonts, typeface: fonts.bold, italic: fonts.bold_italic };
  } else faces = { ...fonts, typeface: fonts.typeface, italic: fonts.italic };
  return { faces, size: ts.font_size, color: ts.color };
}
