// What makes two siblings the same KIND (md2ui: pipeline/grouper_kinds.py): the
// normalized signature behind `kind_hash`, and the bounded tree difference two cards
// may still share a kind across. The layout generator only consumes the result.
import { imageParams } from "../utils/image-params.ts";
import { rowFlows } from "./column-rows.ts";
import { isDatapointSplitGroup } from "./glue.ts";
import { classifyLinkContent } from "./link-content.ts";
import type { GroupNode } from "./node.ts";
import type { RegexKit } from "./py/re.ts";
import { strip } from "./py/str.ts";

/**
 * md2ui: `_fnv1a_64`. Deterministic 64-bit FNV-1a of the UTF-8 bytes of `s`, signed,
 * as md2ui stores it.
 *
 * The hash is kept in two 32-bit halves, numbers rather than BigInts, because it runs
 * for every node of every grouping; only the result is made a BigInt.
 */
export function fnv1a64(s: string): bigint {
  // The offset basis 0xcbf29ce484222325, high and low half.
  let hi = 0xcbf29ce4;
  let lo = 0x84222325;
  // h * PRIME (mod 2^64), where PRIME = 2^40 + 0x1b3: h * 0x1b3, plus lo shifted by 40.
  const mix = (byte: number): void => {
    lo = (lo ^ byte) >>> 0;
    const low = lo * 0x1b3;
    const carry = Math.floor(low / 0x100000000);
    hi = (Math.imul(hi, 0x1b3) + carry + (lo << 8)) >>> 0;
    lo = low >>> 0;
  };
  for (let i = 0; i < s.length; i += 1) {
    const cp = s.codePointAt(i) ?? 0;
    if (cp > 0xffff) i += 1;
    if (cp < 0x80) mix(cp);
    else if (cp < 0x800) {
      mix(0xc0 | (cp >> 6));
      mix(0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      mix(0xe0 | (cp >> 12));
      mix(0x80 | ((cp >> 6) & 0x3f));
      mix(0x80 | (cp & 0x3f));
    } else {
      mix(0xf0 | (cp >> 18));
      mix(0x80 | ((cp >> 12) & 0x3f));
      mix(0x80 | ((cp >> 6) & 0x3f));
      mix(0x80 | (cp & 0x3f));
    }
  }
  return BigInt.asIntN(64, (BigInt(hi) << 32n) | BigInt(lo));
}

// md2ui: _KIND_COLLAPSE_TYPES. Inline micro-structure reduced to a bare type token.
const KIND_COLLAPSE_TYPES: readonly string[] = Object.freeze([
  "key",
  "value",
  "key-value",
  "segment",
  "list_item",
  "ordered_item",
  "task_open",
  "task_done",
]);
// md2ui: _KIND_TOLERANCE_EDITS, _KIND_TOLERANCE_MIN_CORE
const KIND_TOLERANCE_EDITS = 1;
const KIND_TOLERANCE_MIN_CORE = 3;
// md2ui: _SWAP_ELEMENT_TYPES. One of these swapped for another in place is one edit.
const SWAP_ELEMENT_TYPES: readonly string[] = Object.freeze([
  "link",
  "inline_code",
  "emoji",
  "drawing_element",
]);
// md2ui: _SAME_LINE_TEXT_TYPES and _SAME_LINE_CORE_TYPES.
const SAME_LINE_TEXT_TYPES: readonly string[] = Object.freeze([
  "text",
  "segment",
  "datapoint",
  "inline_code",
  "emoji",
]);
const SAME_LINE_CORE_TYPES: readonly string[] = Object.freeze(["text", "segment", "datapoint"]);
// md2ui: _LINK_DECORATION_TYPES
const LINK_DECORATION_TYPES: readonly string[] = Object.freeze(["inline_code", "emoji"]);
// md2ui: _ORIGIN_FLAGS. How a container came to be, as a token in its kind.
const ORIGIN_FLAGS = [
  ["glued_content_group", "glue"],
  ["column_row_group", "row"],
  ["line_split_group", "line"],
  ["column_split_group", "cols"],
  ["align_group", "spring"],
  ["valign_group", "vspring"],
  ["table_group", "table"],
  ["chart_group", "chart"],
  ["line_group", "lines"],
] as const;
// md2ui: _IMAGE_KIND_PARAMS. The image params that size or shape it.
const IMAGE_KIND_PARAMS = [
  "max_width",
  "min_width",
  "max_height",
  "aspect_ratio",
  "shape",
] as const;

/** The memo of `lineKindHash` for one fingerprint pass, by node. */
export type LineKindMemo = Map<GroupNode, bigint | null>;

// md2ui: _leaves (grouper_kinds). Every leaf under a node.
function leaves(n: GroupNode): GroupNode[] {
  const out: GroupNode[] = [];
  const stack = [...n.children];
  for (let c = stack.pop(); c !== undefined; c = stack.pop()) {
    if (c.children.length > 0) stack.push(...c.children);
    else out.push(c);
  }
  return out;
}

// md2ui: _is_decorated_link_line. One line holding ONE link and only chips or icons.
function isDecoratedLinkLine(n: GroupNode): boolean {
  if (n.type !== "group" || n.children.length === 0 || n.source_line_id === null) return false;
  let links = 0;
  let decorations = 0;
  for (const c of leaves(n)) {
    if (c.type === "link") links += 1;
    else if (LINK_DECORATION_TYPES.includes(c.type)) decorations += 1;
    else return false;
  }
  return links === 1 && decorations > 0;
}

// md2ui: _CHIP_LINE_KIND. The kind every chip-only line reads as to the tolerance.
const CHIP_LINE_KIND = fnv1a64("chips");

/**
 * md2ui: `_is_chip_line`. One source line of nothing but chips: a lone chip, or a line
 * group whose every piece is one. How many labels a card carries is a fact about that
 * card, not its kind; icon rows are not chips and keep their kind.
 */
function isChipLine(n: GroupNode): boolean {
  if (n.children.length === 0) return n.type === "inline_code";
  if (n.type !== "group" || n.source_line_id === null) return false;
  return leaves(n).every((c) => c.type === "inline_code");
}

// md2ui: _BUTTON_LINE_KIND. The kind every line of buttons reads as to the tolerance.
const BUTTON_LINE_KIND = fnv1a64("buttons");

// md2ui: _COLUMN_LINE_KIND. A one-line colon column (`_Wind_ : NNE 6 km/h`) stacks label
// over value, so it never reads as the row a plain or split line lays out as.
const COLUMN_LINE_KIND = fnv1a64("column-line");

/**
 * md2ui: `_is_button_line`. A line of two or more links and nothing else. How many
 * buttons a card ends in is a fact about that card, not its kind;
 * like a pill run the line is variant-free. A lone link is not a button line: it keeps
 * its own kind, so it still matches a link badged by a chip, and only costs nothing
 * against a button line (`treeEditWithin`).
 */
function isButtonLine(n: GroupNode): boolean {
  return (
    n.line_split_group === true &&
    n.children.length >= 2 &&
    n.children.every((c) => c.type === "link" && c.children.length === 0)
  );
}

// md2ui: _is_lone_link
function isLoneLink(n: GroupNode): boolean {
  return n.type === "link" && n.children.length === 0;
}

// md2ui: _RATING_RE. A rating as written: full stars, at most one half star, then empty
// stars. Nothing else may share the line, so a star beside words stays an icon.
// py: re.compile(r"[⭐★]*[½⯨⯪]?☆*").fullmatch
const RATING_RE = /^[⭐★]*[½⯨⯪]?☆*$/u;
// md2ui: _RATING_KIND, _RATING_LINE_KIND. The kind of a rating line, to the signature
// and the tolerance alike.
const RATING_KIND = "rating";
const RATING_LINE_KIND = fnv1a64(RATING_KIND);
// md2ui: _RATING_TEXT_TYPES. A rating written as one leaf holding the glyphs.
const RATING_TEXT_TYPES: readonly string[] = Object.freeze(["text", "datapoint"]);

/**
 * md2ui: `_is_rating_line`. One source line of nothing but rating glyphs: a text leaf,
 * or a line of two or more star emoji. A rating is a card's score, like a chip its
 * label: its own kind of line. A lone star emoji is how an icon or a
 * badge is written, and keeps the emoji's kind. Emphasis and the emoji presentation
 * selector are spelling, not glyphs.
 */
function isRatingLine(n: GroupNode): boolean {
  let pieces: GroupNode[];
  if (n.children.length === 0) {
    if (!RATING_TEXT_TYPES.includes(n.type)) return false;
    pieces = [n];
  } else if (n.type !== "group" || n.source_line_id === null) {
    return false;
  } else {
    pieces = leaves(n);
    if (pieces.length < 2 || pieces.some((p) => p.type !== "emoji")) return false;
  }
  const glyphs = pieces
    .map((p) => p.content)
    .join("")
    .replaceAll("\ufe0f", "");
  const text = strip(strip(strip(glyphs), "*_"));
  return text !== "" && RATING_RE.test(text);
}

// md2ui: _is_one_source_line_text. One physical line whose pieces all read as text.
function isOneSourceLineText(n: GroupNode): boolean {
  if (n.children.length === 0 || n.source_line_id === null) return false;
  let sawCore = false;
  for (const c of leaves(n)) {
    if (c.type === n.type || SAME_LINE_CORE_TYPES.includes(c.type)) sawCore = true;
    else if (!SAME_LINE_TEXT_TYPES.includes(c.type)) return false;
  }
  return sawCore;
}

// md2ui: _PAIR_KIND, _PAIR_LEAF_TYPES, _PAIR_PIECE_TYPES. A glued block of two text
// lines is its own kind, never a plain group's: a date over its
// weekday and a three-line agenda both fold to group(text){glue}, and would twin as grid
// cards. A value and its unit (`___1,204___ - tems`) are still one line.
const PAIR_KIND = "pair";
const PAIR_LEAF_TYPES: readonly string[] = Object.freeze(["text", "datapoint"]);
const PAIR_PIECE_TYPES: readonly string[] = Object.freeze([...PAIR_LEAF_TYPES, "segment"]);

/**
 * md2ui: `_is_pair`. A glued block of exactly two text lines written on two different
 * source lines. The shape alone decides, so a run of identical-looking two-line tiles
 * stays one run; a spacer is blank space (ADR-203), not a line.
 */
function isPair(n: GroupNode): boolean {
  if (!n.glued_content_group) return false;
  const lines = n.children.filter((c) => c.type !== "spacer");
  if (lines.length !== 2) return false;
  const [a, b] = lines.map(pairLine);
  return a !== null && b !== null && a !== b;
}

/**
 * md2ui: `_pair_line`. The source line `n` is when it is one text line of a pair: a text
 * leaf, or a plain group of the text pieces one source line split into. A key-value
 * line or a list item is no text line.
 */
function pairLine(n: GroupNode): number | null {
  if (n.children.length === 0) return PAIR_LEAF_TYPES.includes(n.type) ? n.source_line_id : null;
  if (n.type !== "group") return null;
  const pieces = leaves(n);
  if (pieces.some((p) => !PAIR_PIECE_TYPES.includes(p.type))) return null;
  const lines = new Set(pieces.map((p) => p.source_line_id));
  return lines.size === 1 ? ([...lines][0] as number | null) : null;
}

/**
 * md2ui: `kind_type`. A node's type as the kind reads it: a task is a task, checked or
 * not, a rating line is a rating, and a two-line glued block is a pair.
 */
function kindType(n: GroupNode): string {
  if (n.type === "task_open" || n.type === "task_done") return "task";
  if (isRatingLine(n)) return RATING_KIND;
  return isPair(n) ? PAIR_KIND : n.type;
}

/**
 * md2ui: `_line_kind_hash`. `kind_hash` seen through the source: a node that IS one
 * text line reads as the leaf it would have been unsplit, every chip-only line reads
 * alike, whatever its count, as does every line of buttons, and every rating line,
 * however its stars were split; a one-line colon column reads as a column line, never
 * the row a split line is. For the tolerance, and for telling a card from one short of its picture.
 */
export function lineKindHash(n: GroupNode, memo: LineKindMemo): bigint | null {
  const cached = memo.get(n);
  if (cached !== undefined) return cached;
  let kind: bigint | null;
  if (isChipLine(n)) kind = CHIP_LINE_KIND;
  else if (isButtonLine(n)) kind = BUTTON_LINE_KIND;
  else if (isRatingLine(n)) kind = RATING_LINE_KIND;
  else if (!isOneSourceLineText(n)) kind = n.kind_hash;
  else if (n.type === "group") kind = n.column_split_group ? COLUMN_LINE_KIND : fnv1a64("text");
  else kind = fnv1a64(kindType(n));
  memo.set(n, kind);
  return kind;
}

// md2ui: _subtree_size
function subtreeSize(n: GroupNode): number {
  return 1 + n.children.reduce((sum, c) => sum + subtreeSize(c), 0);
}

// md2ui: _link_shape. A Text link is drawn as text; every other variant is a button.
function linkShape(kit: RegexKit, n: GroupNode): string {
  return classifyLinkContent(kit, n.content).variant === "text" ? "txt" : "btn";
}

// md2ui: _element_token. What an image (its size params) or a link (its shape) adds.
function elementToken(kit: RegexKit, n: GroupNode): string {
  if (n.type === "image") {
    const params = imageParams(kit, n.content);
    return IMAGE_KIND_PARAMS.flatMap((name) => [name, `${name}_wide`])
      .filter((key) => params.has(key))
      .map((key) => `${key}=${params.get(key)}`)
      .join(",");
  }
  return n.type === "link" ? linkShape(kit, n) : "";
}

// md2ui: _is_element_swap. Both inline elements, drawn differently.
function isElementSwap(kit: RegexKit, a: GroupNode, b: GroupNode): boolean {
  if (!SWAP_ELEMENT_TYPES.includes(a.type) || !SWAP_ELEMENT_TYPES.includes(b.type)) return false;
  return a.type !== b.type || elementToken(kit, a) !== elementToken(kit, b);
}

// md2ui: _PICTURE_TYPES. What reads as a picture on the page: an image card is one too.
const PICTURE_TYPES: readonly string[] = Object.freeze(["image", "image_card"]);

/**
 * md2ui: `_is_pair_and_picture`. One of `a` and `b` is a pair and the other a glued
 * block of the same type holding two lines and one picture: a card whose picture is
 * missing is left a pair, and is compared with its pictured siblings piece by piece, so
 * only the picture counts. A two-line block still never matches a three-line one.
 */
function isPairAndPicture(a: GroupNode, b: GroupNode): boolean {
  if (a.type !== b.type) return false;
  for (const [pair, card] of [
    [a, b],
    [b, a],
  ] as const) {
    if (kindType(pair) === PAIR_KIND && kindType(card) !== PAIR_KIND) {
      const solid = card.children.filter((c) => c.type !== "spacer");
      const pictures = solid.filter((c) => PICTURE_TYPES.includes(c.type));
      return card.glued_content_group && solid.length === 3 && pictures.length === 1;
    }
  }
  return false;
}

/**
 * md2ui: `_beside_content`. Whether `nodes` hold something other than pictures, so a
 * picture among them is a card's content rather than the item of a gallery.
 */
function besideContent(nodes: readonly GroupNode[]): boolean {
  return nodes.some((c) => !PICTURE_TYPES.includes(c.type) && c.type !== "spacer");
}

/**
 * md2ui: `_indel_cost`. Inserting or deleting a node is one edit, except a picture among
 * pictures only: a gallery one picture short is another gallery. A picture beside other
 * content is the card's content, not its kind.
 */
function indelCost(n: GroupNode, cap: number, besideOthers: boolean): number {
  return PICTURE_TYPES.includes(n.type) && !besideOthers ? cap + 1 : 1;
}

// md2ui: _tree_edit_within. Min insert/delete edits from a to b, clamped to cap + 1. A
// lone link against a line of buttons costs nothing.
function treeEditWithin(
  kit: RegexKit,
  a: GroupNode,
  b: GroupNode,
  cap: number,
  memo: LineKindMemo,
): number {
  if (isElementSwap(kit, a, b)) return 1;
  if ((isLoneLink(a) && isButtonLine(b)) || (isLoneLink(b) && isButtonLine(a))) return 0;
  if (lineKindHash(a, memo) === lineKindHash(b, memo)) return 0;
  if (cap <= 0 || (kindType(a) !== kindType(b) && !isPairAndPicture(a, b))) return cap + 1;
  return seqEditWithin(kit, a.children, b.children, cap, memo);
}

// md2ui: _seq_edit_within. Banded edit distance of two child lists, clamped to cap + 1.
function seqEditWithin(
  kit: RegexKit,
  as: readonly GroupNode[],
  bs: readonly GroupNode[],
  cap: number,
  memo: LineKindMemo,
): number {
  const m = as.length;
  const n = bs.length;
  const over = cap + 1;
  if (Math.abs(m - n) > cap) return over;
  const aMixed = besideContent(as);
  const bMixed = besideContent(bs);
  let prev = Array<number>(n + 1).fill(over);
  prev[0] = 0;
  for (let j = 1; j <= Math.min(n, cap); j += 1) {
    prev[j] = Math.min(
      over,
      (prev[j - 1] as number) + indelCost(bs[j - 1] as GroupNode, cap, bMixed),
    );
  }
  for (let i = 1; i <= m; i += 1) {
    const cur = Array<number>(n + 1).fill(over);
    const a = as[i - 1] as GroupNode;
    if (i <= cap) cur[0] = Math.min(over, (prev[0] as number) + indelCost(a, cap, aMixed));
    for (let j = Math.max(1, i - cap); j <= Math.min(n, i + cap); j += 1) {
      const b = bs[j - 1] as GroupNode;
      const sub = (prev[j - 1] as number) + treeEditWithin(kit, a, b, cap, memo);
      const del = (prev[j] as number) + indelCost(a, cap, aMixed);
      const ins = (cur[j - 1] as number) + indelCost(b, cap, bMixed);
      cur[j] = Math.min(over, sub, del, ins);
    }
    prev = cur;
  }
  return prev[n] as number;
}

/**
 * md2ui: `_tree_similar`. Two card subtrees are one kind within the tolerance: at
 * most one tree edit (see `indelCost` for what a picture costs) and at least three
 * nodes in the smaller. Spacer cells on different sides (`beside`) are no tolerated
 * difference: the exact kind decides, as it would between the leaf cells they stand for.
 */
export function treeSimilar(
  kit: RegexKit,
  a: GroupNode,
  b: GroupNode,
  memo: LineKindMemo,
): boolean {
  if (beside(a) !== beside(b)) return a.kind_hash === b.kind_hash;
  if (Math.min(subtreeSize(a), subtreeSize(b)) < KIND_TOLERANCE_MIN_CORE) return false;
  return treeEditWithin(kit, a, b, KIND_TOLERANCE_EDITS, memo) <= KIND_TOLERANCE_EDITS;
}

// md2ui: _origin_token. A flowing ::: row is a line: one arrangement, one kind.
function originToken(n: GroupNode): string {
  const tokens = n.heading_group ? [`h${n.heading_level ?? "None"}`] : [];
  for (const [flag, name] of ORIGIN_FLAGS) {
    if (!n[flag]) continue;
    const token = name === "row" && rowFlows(n) ? "line" : name;
    if (!tokens.includes(token)) tokens.push(token);
  }
  return tokens.join(",");
}

/**
 * md2ui: `_beside`. Which sides of `n` a spacer cell stands beside among its siblings
 * (`spacer_beside`). A section's cell is inside its card, beside its content: it is no
 * cell among the cards.
 */
function beside(n: GroupNode): string {
  if (!n.spacer_beside || n.heading_group) return "";
  return `|${n.spacer_lead ? "<" : ""}${n.spacer_trail ? ">" : ""}`;
}

/**
 * md2ui: `kind_signatures`. `node`'s same-kind signature with the sides a spacer cell
 * stands beside it on. A spacer cell is placed as the leaf cell it stands for:
 * cells on different sides make two kinds, on the same side they run. Only
 * the node's own kind: a card holding a spacer cell still twins one without.
 */
export function kindSignatures(
  kit: RegexKit,
  node: GroupNode,
  childKinds: readonly string[],
): [string, string] {
  const [own, up] = plainKindSignatures(kit, node, childKinds);
  return [own + beside(node), up];
}

/**
 * md2ui: `_kind_signatures`. A node's same-kind signature: `[own, forParent]`. A rating
 * line reads as a rating, however its stars were split; value splits read as text, a decorated link line as its link, micro-structure as its bare
 * type, a two-line glued block as `pair(k1,k2)` unfolded (a line split into pieces of
 * one source line still one line); otherwise `type(children…)`
 * with consecutive equal kinds folded and the
 * container's origin appended. An image's size and a link's shape go to the parent.
 */
function plainKindSignatures(
  kit: RegexKit,
  node: GroupNode,
  childKinds: readonly string[],
): [string, string] {
  if (isRatingLine(node)) return [RATING_KIND, RATING_KIND];
  if (node.type === "datapoint" || isDatapointSplitGroup(node)) return ["text", "text"];
  if (isDecoratedLinkLine(node)) {
    const link = leaves(node).find((c) => c.type === "link") as GroupNode;
    return ["link", `link{${linkShape(kit, link)}}`];
  }
  if (KIND_COLLAPSE_TYPES.includes(node.type)) {
    const own = kindType(node);
    return [own, own];
  }
  let own: string;
  if (node.children.length === 0) {
    own = node.type;
  } else if (isPair(node)) {
    // Not folded: two lines never read as the three of a plain glued block.
    own = `${PAIR_KIND}(${childKinds.join(",")})`;
  } else {
    const folded: string[] = [];
    for (const k of childKinds) if (folded.at(-1) !== k) folded.push(k);
    own = `${node.type}(${folded.join(",")})`;
    const origin = originToken(node);
    if (origin) own += `{${origin}}`;
  }
  const element = elementToken(kit, node);
  return [own, element ? `${own}{${element}}` : own];
}
