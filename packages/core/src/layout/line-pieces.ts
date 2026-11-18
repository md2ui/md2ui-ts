// The pieces of one line and how wide each is on it: md2ui's `_with_separators`,
// `_piece_stacks`, `_line_item_width`, `_row_spacer_px`, `_beside_spacer` and
// `_vote_spacers`. A line's flow (`flow.ts`), an authored `:::` row (`column-row.ts`) and
// a node with spacers at its edges (`leaves.ts`) measure their pieces with these.

import { INLINE_SPACERS } from "../group/inline-marks.ts";
import { GroupNode } from "../group/node.ts";
import { dpDisplayEnabled } from "./display-gates.ts";
import { spacerRow } from "./fit-votes.ts";
import { leafInputs } from "./input.ts";
import type { LayoutNode } from "./node.ts";
import {
  batchWidth,
  flowPairGap,
  lengthCategory,
  minWidth,
  rowPairGap,
  unitPaddingX,
} from "./node-units.ts";
import type { Run } from "./run.ts";
import { holds, shortOfRoom, spacerCell, spacerProps } from "./spacers.ts";
import { IMAGE_MIN_WIDTH, LEAF_WIDTH } from "./units.ts";
import { heightSized, urlRenderDict, WIDE_BREAKPOINT } from "./url-hints.ts";

/** md2ui `_row_spacer_px`: a spacer across a line, sized at the surface being built. */
export function rowSpacerPx(run: Run, spelling: string): number {
  const [level, fixedKey, inImageCard] = run.spacerScope;
  return spacerProps(run.theme, spelling, "row", level, fixedKey, inImageCard).size;
}

/** The cell a drawn row separator becomes, or `null` when the theme draws none for `ch`. */
function separatorCell(run: Run, ch: string): GroupNode | null {
  const seps = run.theme.separators;
  let kind: string;
  if (ch === "|") {
    // `Draw` wins over `Bar`: no pipe character, just the line.
    if (run.theme.vertical_rule.draw) kind = "rule";
    else if (seps.bar) kind = "glyph";
    else return null;
  } else if (!seps.dash) {
    return null;
  } else {
    kind = "glyph";
  }
  const n = new GroupNode(ch, "text");
  n.separator_kind = kind;
  return n;
}

/**
 * md2ui `_with_separators`: a line's pieces (`node`'s children, or `items`) with the
 * drawn row separators and inline spacers put back in its gaps, and the spacers at the
 * line's own edges at its ends (a spacer cell beside the line is not the line's). `gaps` are the gaps between `items` when they are a whole
 * `:::` row read at one width. The pieces unchanged when there is nothing to put back.
 */
export function withSeparators(
  run: Run,
  node: GroupNode,
  items: readonly GroupNode[] | null = null,
  gaps: readonly string[] | null = null,
): GroupNode[] {
  const kids = items === null ? [...node.children] : [...items];
  let chars: readonly string[] = gaps === null ? node.separator_chars : gaps;
  const whole = gaps !== null;
  const has = kids.length > 0 && !node.spacer_beside && node.children.length > 0;
  const lead = has && (whole || kids[0] === node.children[0]) ? node.spacer_lead : null;
  const trail =
    has && (whole || kids[kids.length - 1] === node.children[node.children.length - 1])
      ? node.spacer_trail
      : null;
  if (chars.length === 0 && !lead && !trail) return kids;
  if (kids.length < 2) chars = [];

  const spacers: Readonly<Record<string, string>> = INLINE_SPACERS;
  const gapCells = (gap: string, i: number): GroupNode[] => {
    // A gap's spacers merge into one, their sizes summed; a drawn separator keeps its
    // own cell.
    const cells: GroupNode[] = [];
    let marks: string[] = [];
    const before = kids[i - 1] as GroupNode;
    for (const ch of gap) {
      const mark = Object.hasOwn(spacers, ch) ? spacers[ch] : undefined;
      if (mark !== undefined) {
        marks.push(mark);
        continue;
      }
      if (marks.length > 0) {
        cells.push(spacerCell(marks.join(" "), before));
        marks = [];
      }
      const c = separatorCell(run, ch);
      if (c !== null) cells.push(c);
    }
    if (marks.length > 0) cells.push(spacerCell(marks.join(" "), before));
    return cells;
  };

  const out: GroupNode[] = lead ? [spacerCell(lead, kids[0] as GroupNode, true)] : [];
  kids.forEach((child, i) => {
    if (i > 0 && chars.length > 0) {
      out.push(...gapCells(chars[Math.min(i - 1, chars.length - 1)] as string, i));
    }
    out.push(child);
  });
  if (trail) out.push(spacerCell(trail, kids[kids.length - 1] as GroupNode, true));
  return out;
}

/**
 * md2ui `_piece_stacks`: a flowed group piece is laid out as a `col` unless it is itself
 * one line; a date chip stacks only where the theme draws chips.
 */
function pieceStacks(run: Run, item: GroupNode): boolean {
  if (item.datapoint_display === "date_chip") return dpDisplayEnabled(run.theme, item);
  return !item.line_split_group;
}

/**
 * md2ui `_line_item_width`: the width a flowed piece takes on one line: a spacer its
 * size, a drawn separator its stroke or glyph, an image its authored cap or its floor, a
 * group the width it is drawn at (its widest child when it stacks, its own flow when it
 * is a line), a leaf its measured line; each with its own wrap padding.
 */
export function lineItemWidth(run: Run, item: GroupNode, width = 0): number {
  const { theme } = run;
  if (item.type === "spacer") return rowSpacerPx(run, item.content);
  const sep = item.separator_kind;
  if (sep !== null) {
    if (sep === "rule") return theme.vertical_rule.stroke_width;
    const w = run.measurer.leafLineWidth(leafInputs(run.input, item), null);
    if (w !== null) return w;
    return LEAF_WIDTH["one_word"] as number;
  }
  if (item.type === "image") {
    const props = run.urlProps.get(item);
    const capped =
      props === undefined
        ? undefined
        : heightSized(urlRenderDict(props, width >= WIDE_BREAKPOINT), undefined)["max_width"];
    const floor = run.imageFloors.get(item) ?? 0;
    // Uncapped, an image only needs a floor: its authored `min_width`, else the default.
    const base = capped ? Number(capped) : floor || IMAGE_MIN_WIDTH;
    return base + unitPaddingX(item, theme);
  }
  const role = item.node_id ? (run.kvRoles.get(item) ?? null) : null;
  if (item.children.length > 0) {
    const pad = unitPaddingX(item, theme);
    if (pieceStacks(run, item)) {
      let widest = 0;
      let first = true;
      for (const c of item.children) {
        const w = lineItemWidth(run, c, width);
        if (first || w > widest) widest = w;
        first = false;
      }
      return widest + pad;
    }
    // Ask for exactly what the flow packs, or it wraps the line (ADR-400).
    const pieces = item.line_split_group ? withSeparators(run, item) : item.children;
    const ws = pieces.map((c) => lineItemWidth(run, c, width));
    return batchWidth(pieces, ws, theme) + pad;
  }
  const line = run.measurer.leafLineWidth(leafInputs(run.input, item), role);
  if (line !== null) return line;
  const min = run.minWidths.leafMin(item, null);
  if (min !== null) return min;
  return LEAF_WIDTH[lengthCategory(item) ?? ""] ?? 100;
}

/**
 * md2ui `_beside_spacer`: what `piece` needs beside a spacer before the spacer gives
 * way: its line, or a text's reading floor unless the `whole` line is asked. A block asks
 * its line, unless its spacers hold it (`holds`): then it floors at its minimum.
 */
function besideSpacer(run: Run, piece: GroupNode, width: number, whole: boolean): number {
  const w = lineItemWidth(run, piece, width);
  if (whole || piece.type === "image" || piece.type === "spacer") return w;
  if (piece.children.length > 0 && !holds(piece)) return w;
  return Math.min(w, minWidth(piece, run.minWidths));
}

/**
 * md2ui `_vote_spacers`: enter each of `node`'s `rows` holding spacers in its run, with
 * whether it is short of room for them (a run's spacers give way together). `weights`
 * are a weighted `:::` row's.
 */
export function voteSpacers(
  run: Run,
  node: GroupNode,
  rows: readonly LayoutNode[],
  lines: readonly (readonly GroupNode[])[],
  width: number,
  weights: readonly number[] | null = null,
): void {
  if (run.fitPolls.length === 0) return;
  const { theme, kit } = run;
  // md2ui hands `_row_pair_gap` no owner level or key here.
  const gap =
    weights !== null && weights.length > 0
      ? (a: GroupNode, b: GroupNode) => rowPairGap(kit, a, b, theme, 0, null)
      : (a: GroupNode, b: GroupNode) => flowPairGap(a, b, theme);
  const n = Math.min(rows.length, lines.length);
  for (let i = 0; i < n; i++) {
    const items = lines[i] as readonly GroupNode[];
    if (items.length > 1 && items.some((c) => c.type === "spacer")) {
      const short = shortOfRoom(
        items,
        width,
        (c) => besideSpacer(run, c, width, weights !== null),
        gap,
        weights,
      );
      spacerRow(run.fitPolls, node, rows[i] as LayoutNode, short);
    }
  }
}
