// `+++` spacers (md2ui: pipeline/grouper_spacers.py, ADR-203).
//
// A spacer is blank space and must not change what the grouper builds, so a document
// that holds spacer lines is grouped twice: without them (the answer), and with them
// (only to learn where each one belongs).
import { breakNodeType, SPACER_RE } from "./block-splits.ts";
import { editContent, regexEdits } from "./content-edits.ts";
import { INLINE_SPACERS } from "./inline-marks.ts";
import { GroupNode, type NodeType } from "./node.ts";
import { compile, type RegexKit } from "./py/re.ts";
import { first, isdigit, lstrip, rstrip, split, strip } from "./py/str.ts";

// md2ui: _FENCE_PREFIXES
const FENCE_PREFIXES = ["```", "~~~"] as const;
// A spacer INSIDE a line: 3-5 `+` with white space or the line's edge on both sides.
// py: re.compile(r"(?<![^ \t])\+{3,5}(?![^ \t])")
const INLINE_TOKEN_RE = compile(String.raw`(?<![^ \t])\+{3,5}(?![^ \t])`);

// md2ui: _BY_SPELLING. The private mark of each inline spelling.
function bySpelling(spelling: string): string {
  for (const [mark, written] of Object.entries(INLINE_SPACERS)) {
    if (written === spelling) return mark;
  }
  return spelling;
}

/**
 * md2ui: `mark_inline_spacers`. Each spacer inside a line swapped for its
 * one-character mark; a line that is nothing but a spacer is left for the block split.
 */
export function markInlineSpacers(kit: RegexKit, text: string): string {
  if (!text.includes("+++")) return text;
  return text
    .split("\n")
    .map((line) =>
      line.includes("+++") && kit.re(SPACER_RE).match(line) === null
        ? kit.re(INLINE_TOKEN_RE).sub((m) => bySpelling(m.text()), line)
        : line,
    )
    .join("\n");
}

/**
 * md2ui: `strip_spacer_lines`. The text without its spacer lines, or null when it has
 * none to take. A spacer line is one the block split would read as one: up to three
 * spaces of indent at the top level, any indent inside a list item, never inside a
 * fence. A spacer that is the whole of a `:::` cell at a row's edge stays (`cellSpacers`).
 */
export function stripSpacerLines(kit: RegexKit, text: string): string | null {
  if (!text.includes("+++")) return null;
  const lines = text.split("\n");
  const spacers = new Set<number>();
  const top = new Set<number>(); // not inside a list item, whose `:::` is its own
  let fence: string | null = null;
  let inItem = false;
  lines.forEach((line, i) => {
    const stripped = lstrip(line, " \t");
    const indent = line.length - stripped.length;
    if (fence !== null) {
      if (stripped.startsWith(fence)) fence = null;
      return;
    }
    if (FENCE_PREFIXES.some((p) => stripped.startsWith(p))) {
      fence = stripped.slice(0, 3);
      return;
    }
    const head = stripped.slice(0, 2);
    if (head === "- " || head === "* " || head === "+ " || isdigit(first(stripped))) {
      inItem = true;
    } else if (stripped && indent === 0) {
      inItem = false;
    }
    if (kit.re(SPACER_RE).match(line) !== null && (indent <= 3 || inItem)) {
      spacers.add(i);
      if (!inItem) top.add(i);
    }
  });
  // The neighbours are read as the grouping will see them: comments gone.
  const shown = kit.re(COMMENT_RE).sub((m) => "\n".repeat(m.text().split("\n").length - 1), text);
  const kept = cellSpacers(kit, shown.split("\n"), spacers);
  const drop = new Set([...spacers].filter((i) => !(kept.has(i) && top.has(i))));
  if (drop.size === 0) return null;
  return lines.filter((_, i) => !drop.has(i)).join("\n");
}

// md2ui: _ROW_CUTS. What closes a `:::` cell on either side besides another divider.
const ROW_CUTS: readonly NodeType[] = Object.freeze([
  "column_divider",
  "horizontal_rule",
  "content_break",
  "section_stop",
  "row_closer",
]);
// py: re.compile(r"<!--.*?-->", re.DOTALL)
const COMMENT_RE = compile("<!--.*?-->", { s: true });
// py: re.compile(r"^#{1,6}(?:\s|$)")
const HEADING_LINE_RE = compile(String.raw`^#{1,6}(?:\s|$)`);

/**
 * md2ui: `_cell_spacers`. The spacer lines that are the whole of a `:::` cell at an
 * EDGE of its row: nothing but spacer cells between it and where the row starts or
 * ends. Taking one out would leave the row decided on an empty cell, which changes
 * what the row is, so it stays and the row build reads it as space at the row's edge
 * (`column-rows.ts` `takeEdgeSpacerCells`). One between two cells goes like any other.
 */
function cellSpacers(
  kit: RegexKit,
  lines: readonly string[],
  spacers: ReadonlySet<number>,
): Set<number> {
  const divider = (line: string | null): boolean =>
    line !== null && breakNodeType(kit, line) === "column_divider";
  // Where a row stops: the document's edge, another break, or a heading below (above,
  // only an empty `## ` marker: a title is cell content).
  const ends = (line: string | null, step: number): boolean => {
    if (line === null) return true;
    const kind = breakNodeType(kit, line);
    if (kind !== null && ROW_CUTS.includes(kind)) return true;
    return kit.re(HEADING_LINE_RE).match(line) !== null && (step > 0 || !strip(line, "# \t"));
  };
  const near = (i: number, step: number, overDividers: boolean): string | null => {
    let j = i + step;
    while (
      j >= 0 &&
      j < lines.length &&
      (spacers.has(j) ||
        !strip(lines[j] as string) ||
        (overDividers && divider(lines[j] as string)))
    ) {
      j += step;
    }
    return lines[j] ?? null;
  };
  const keep = new Set<number>();
  for (const i of spacers) {
    const sides = [-1, 1].map((step): [string | null, number] => [near(i, step, false), step]);
    if (!sides.some(([n]) => divider(n))) continue;
    if (!sides.every(([n, step]) => divider(n) || ends(n, step))) continue; // beside content
    if ([-1, 1].some((step) => ends(near(i, step, true), step))) keep.add(i);
  }
  return keep;
}

/**
 * md2ui: `carry_edge_spacers`. `dst` takes the space at `src`'s edges when a level
 * dissolves and `dst` holds what `src` held: the space belongs to the content. Space
 * that was a cell beside the content stays beside it.
 */
export function carryEdgeSpacers(src: GroupNode, dst: GroupNode): void {
  dst.spacer_lead = dst.spacer_lead || src.spacer_lead;
  dst.spacer_trail = dst.spacer_trail || src.spacer_trail;
  dst.spacer_beside = dst.spacer_beside || src.spacer_beside;
}

/**
 * md2ui: `take_edge_spacers`. `[leading, trailing, rest]`: a spacer mark at either end
 * of a line is space before or after its content, not a cut; consecutive ones keep
 * their spellings in order so their sizes add up.
 */
export function takeEdgeSpacers(content: string): [string | null, string | null, string] {
  let s = strip(content);
  const leads: string[] = [];
  const trails: string[] = [];
  const spelling = (mark: string | undefined): string | undefined =>
    mark === undefined ? undefined : (INLINE_SPACERS as Record<string, string>)[mark];
  for (
    let lead = spelling(s[0]);
    s.length > 1 && lead !== undefined && (s[1] === " " || s[1] === "\t");
    lead = spelling(s[0])
  ) {
    leads.push(lead);
    s = lstrip(s.slice(1));
  }
  for (
    let trail = spelling(s.at(-1));
    s.length > 1 && trail !== undefined && (s.at(-2) === " " || s.at(-2) === "\t");
    trail = spelling(s.at(-1))
  ) {
    trails.unshift(trail);
    s = rstrip(s.slice(0, -1));
  }
  const lead = leads.join(" ") || null;
  const trail = trails.join(" ") || null;
  return [lead, trail, lead || trail ? s : content];
}

// md2ui: _BY_SPELLING and _EDGE, read off INLINE_SPACERS.
const SPACER_MARKS = Object.keys(INLINE_SPACERS);

// py: re.compile(f"[{_EDGE}]")
const MARK_RE = compile(`[${SPACER_MARKS.join("")}]`);

/**
 * md2ui: `_row_space`. A spacer spelling recorded at cell boundary `at` of a row the
 * way a line records it: a gap mark between two cells, the row's own edge otherwise.
 */
function rowSpace(row: GroupNode, at: number, spelling: string): void {
  if (at === 0) {
    row.spacer_lead = row.spacer_lead ? `${row.spacer_lead} ${spelling}` : spelling;
  } else if (at === row.children.length) {
    row.spacer_trail = row.spacer_trail ? `${row.spacer_trail} ${spelling}` : spelling;
  } else {
    if (row.separator_chars.length === 0) {
      row.separator_chars = Array<string>(row.children.length - 1).fill("");
    }
    row.separator_chars[at - 1] += split(spelling)
      .map((s) => bySpelling(s))
      .join("");
  }
}

/**
 * md2ui: `_lift_cell_edges`. A spacer at the edge of a one-line cell is at an edge of
 * the row's line: a gap between cells, or the row's own edge. A held cell (a spacer
 * on both edges) keeps them as its padding.
 */
function liftCellEdges(row: GroupNode): void {
  row.children.forEach((cell, i) => {
    if (cell.children.length > 0 && !cell.line_split_group) return;
    if (cell.spacer_lead && cell.spacer_trail) return;
    if (cell.spacer_lead) rowSpace(row, i, cell.spacer_lead);
    if (cell.spacer_trail) rowSpace(row, i + 1, cell.spacer_trail);
    cell.spacer_lead = null;
    cell.spacer_trail = null;
  });
}

/**
 * md2ui: `restore_inline_spacer_text`. Every inline spacer mark left in the text is
 * the author's `+++` again, and each line-edge spacer goes to the node that became
 * that line (for a cell of a row, the row).
 */
export function restoreInlineSpacerText(kit: RegexKit, root: GroupNode): void {
  const rows: GroupNode[] = [];
  const stack = [root];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.column_row_group) rows.push(node);
    const child = node.children[0];
    if (
      (node.spacer_lead || node.spacer_trail) &&
      node.children.length === 1 &&
      child !== undefined
    ) {
      carryEdgeSpacers(node, child);
      node.spacer_lead = null;
      node.spacer_trail = null;
      node.spacer_beside = false;
    }
    if (SPACER_MARKS.some((m) => node?.content.includes(m))) {
      editContent(node, regexEdits(kit, MARK_RE, INLINE_SPACERS, node.content));
    }
    stack.push(...node.children);
  }
  for (const row of rows) liftCellEdges(row);
}

// md2ui: _leaves (grouper_spacers). Every non-spacer leaf, in document order.
function nonSpacerLeaves(root: GroupNode): GroupNode[] {
  const out: GroupNode[] = [];
  const stack = [root];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    if (node.children.length === 0) {
      if (node.type !== "spacer" && node !== root) out.push(node);
      continue;
    }
    stack.push(...[...node.children].reverse());
  }
  return out;
}

type Span = readonly [number, number];

// md2ui: _ranges. Each node's leaves, as [first, end) leaf indices; spacers hold none.
function leafRanges(root: GroupNode): Map<GroupNode, Span> {
  const out = new Map<GroupNode, Span>();
  let count = 0;
  const walk = (node: GroupNode): void => {
    const start = count;
    if (node.children.length === 0 && node.type !== "spacer" && node !== root) count += 1;
    for (const child of node.children) walk(child);
    out.set(node, [start, count]);
  };
  walk(root);
  return out;
}

const spanOf = (ranges: ReadonlyMap<GroupNode, Span>, node: GroupNode): Span =>
  ranges.get(node) ?? [0, 0];
const sameSpan = (a: Span, b: Span): boolean => a[0] === b[0] && a[1] === b[1];

/** One spacer of the spaced tree: where its container is, and where in it it sat. */
interface SpacerPlace {
  readonly span: Span;
  readonly depth: number;
  readonly boundary: number;
  readonly spelling: string;
  readonly binds: "prev" | "next";
  readonly isCell: boolean;
  /**
   * Written among the pieces of a line or a row, not beside one: in a card holding
   * nothing but a row, the spaced grouping still keeps the card around the row.
   */
  readonly inLine: boolean;
}

// md2ui: _spacers. Each spacer: its container's leaf span and depth among containers
// of that span, how many leaves precede it, its spelling, what it binds to, and
// whether it was a `:::` cell of its own or written inside a line or a row.
function spacersOf(spaced: GroupNode): SpacerPlace[] {
  const ranges = leafRanges(spaced);
  const out: SpacerPlace[] = [];
  const walk = (node: GroupNode, same: number): void => {
    node.children.forEach((child, i) => {
      if (child.type === "spacer") {
        const before = node.children.slice(0, i).some((c) => c.type !== "spacer");
        out.push({
          span: spanOf(ranges, node),
          depth: same,
          boundary: spanOf(ranges, child)[0],
          spelling: child.content,
          binds: before ? "prev" : "next",
          isCell: node.column_row_group,
          inLine: node.column_row_group || node.line_split_group,
        });
      } else if (child.children.length > 0) {
        walk(child, sameSpan(spanOf(ranges, child), spanOf(ranges, node)) ? same + 1 : 0);
      }
    });
  };
  walk(spaced, 0);
  return out;
}

// md2ui: _container. The node of `plain` holding `span`: the depth-th of those holding
// exactly it (the last, when fewer), else the deepest holding it.
function container(
  plain: GroupNode,
  ranges: ReadonlyMap<GroupNode, Span>,
  span: Span,
  depth: number,
): GroupNode {
  const [first, end] = span;
  let node = plain;
  const exact = sameSpan(spanOf(ranges, plain), span) ? [plain] : [];
  for (;;) {
    const inner = node.children.find((c) => {
      const [a, b] = spanOf(ranges, c);
      return c.children.length > 0 && a <= first && end <= b;
    });
    if (inner === undefined) break;
    node = inner;
    if (sameSpan(spanOf(ranges, node), span)) exact.push(node);
  }
  return exact.length > 0 ? (exact[Math.min(depth, exact.length - 1)] as GroupNode) : node;
}

// md2ui: _into_cell. A spacer at child `index` of a `:::` row goes into the cell it
// binds to, a one-node cell being given a plain wrapper to hold it.
function intoCell(
  row: GroupNode,
  index: number,
  binds: string,
  ranges: Map<GroupNode, Span>,
): [GroupNode, number] {
  const prev = binds === "prev" && index > 0;
  const at = prev ? index - 1 : Math.min(index, row.children.length - 1);
  let cell = row.children[at] as GroupNode;
  if (cell.children.length === 0) {
    const wrapper = new GroupNode("", "group");
    wrapper.children = [cell];
    ranges.set(wrapper, spanOf(ranges, cell));
    row.children[at] = wrapper;
    cell = wrapper;
  }
  return [cell, prev ? cell.children.length : 0];
}

/**
 * md2ui: `_row_edge`. A spacer written beside a row, at boundary `k`, recorded on `node`
 * when `node` is that row merged with its card: space above or below the row, which the
 * merged level has no place for as a leaf. Whether it was recorded.
 */
function rowEdge(
  node: GroupNode,
  ranges: ReadonlyMap<GroupNode, Span>,
  k: number,
  spelling: string,
): boolean {
  if (!(node.line_split_group || node.column_row_group)) return false;
  const [first, end] = spanOf(ranges, node);
  const edge = k <= first ? "spacer_above" : k >= end ? "spacer_below" : null;
  if (edge === null) return false;
  const have = node[edge];
  node[edge] = have ? `${have} ${spelling}` : spelling;
  return true;
}

/**
 * md2ui: `stamp_spacers`. The spaced tree's spacers put into the plain tree, each in
 * the container holding the same leaves, at the boundary where it sat; spacers that
 * land in one place are one. False, changing nothing, when the leaves differ.
 */
export function stampSpacers(plain: GroupNode, spaced: GroupNode): boolean {
  const a = nonSpacerLeaves(plain).map((n) => n.content);
  const b = nonSpacerLeaves(spaced).map((n) => n.content);
  if (a.length !== b.length || a.some((c, i) => c !== b[i])) return false;
  // A spacer kept for the row build that did not become a cell is in both trees: it
  // goes back from the spaced one, like every other spacer.
  const stack = [plain];
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    node.children = node.children.filter((c) => c.type !== "spacer");
    stack.push(...node.children);
  }
  const ranges = leafRanges(plain);
  const places = new Map<GroupNode, Map<number, { spellings: string[]; binds: string }>>();
  for (const { span, depth, boundary: k, spelling, binds, isCell, inLine } of spacersOf(spaced)) {
    if (span[0] === span[1]) continue;
    let node = container(plain, ranges, span, depth);
    if (!inLine && rowEdge(node, ranges, k, spelling)) continue;
    for (;;) {
      const inside = node.children.find((c) => {
        const [s, e] = spanOf(ranges, c);
        return s < k && k < e;
      });
      if (inside === undefined || inside.children.length === 0) break;
      node = inside;
    }
    let index = node.children.filter((c) => spanOf(ranges, c)[1] <= k).length;
    // A spacer that was a cell of its own is space ACROSS its row.
    if (node.column_row_group && isCell) {
      rowSpace(node, index, spelling);
      continue;
    }
    if (node.column_row_group) [node, index] = intoCell(node, index, binds, ranges);
    let byIndex = places.get(node);
    if (byIndex === undefined) {
      byIndex = new Map();
      places.set(node, byIndex);
    }
    const at = byIndex.get(index);
    if (at === undefined) byIndex.set(index, { spellings: [spelling], binds });
    else at.spellings.push(spelling);
  }
  // Last-first per container, so each index still means what it did.
  for (const [node, byIndex] of places) {
    for (const [index, { spellings, binds }] of [...byIndex].sort((x, y) => y[0] - x[0])) {
      const spacer = new GroupNode(spellings.join(" "), "spacer");
      spacer.spacer_binds = binds === "prev" ? "prev" : "next";
      node.children.splice(index, 0, spacer);
    }
  }
  return true;
}
