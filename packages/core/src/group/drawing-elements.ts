// Task controls, `[ ]` and `[x]`, drawn as elements (md2ui:
// pipeline/grouper_drawing_elements.py).
import { editContent, regexEdits } from "./content-edits.ts";
import { type IdMint, inheritGlue } from "./ids.ts";
import { GroupNode, type NodeType } from "./node.ts";
import { compile, type RegexKit } from "./py/re.ts";
import { lstrip, split } from "./py/str.ts";
import type { Range } from "./ranges.ts";
import { LINK_DESTINATION } from "./split/link-syntax.ts";

// md2ui: _ESCAPED_SPELLING, _ESCAPED_PLACEHOLDER, _ESCAPED_RE. One placeholder per
// spelling, so an escaped token draws exactly as written: `\[x]` stays `[x]`.
const ESCAPED_SPELLING: Readonly<Record<string, string>> = Object.freeze({
  "\ue120": "[ ]",
  "\ue121": "[X]",
  "\ue123": "[x]",
});
const ESCAPED_PLACEHOLDER: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(Object.entries(ESCAPED_SPELLING).map(([mark, spelling]) => [spelling, mark])),
);
// py: re.compile(f"[{''.join(_ESCAPED_SPELLING)}]")
const ESCAPED_RE = compile(`[${Object.keys(ESCAPED_SPELLING).join("")}]`);
// py: r"\\(\[[ xX])\\?\]"
const ESCAPED_CONTROL = compile(String.raw`\\(\[[ xX])\\?\]`);

/**
 * md2ui: `protect_escaped_task_controls`. Hides `\[ ]` while CommonMark escapes are
 * resolved, its closing bracket escaped or not.
 */
export function protectEscapedTaskControls(kit: RegexKit, text: string): string {
  return kit.re(ESCAPED_CONTROL).sub((m) => ESCAPED_PLACEHOLDER[`${m.text(1)}]`] as string, text);
}

// md2ui: _LIST_TYPES. The list items, whose controls are split item by item.
const LIST_TYPES: readonly NodeType[] = Object.freeze([
  "list_item",
  "ordered_item",
  "task_open",
  "task_done",
]);
/**
 * md2ui: `_LINE_HOLDERS`. Nodes that hold a line without being it: a list item, and
 * a one-line document's root. A control cut from their text is their child.
 */
export function isLineHolder(type: NodeType): boolean {
  return type === "root" || LIST_TYPES.includes(type);
}
// py: re.compile(rf"\[\[([ xX])\]\]\(((?=[^)]){LINK_DESTINATION})\)")
const LINKED_CONTROL_RE = compile(String.raw`\[\[([ xX])\]\]\(((?=[^)])${LINK_DESTINATION})\)`);
// py: re.compile(r"\[([ xX])\]")
const CONTROL_RE = compile(String.raw`\[([ xX])\]`);
/** md2ui: `_SKIP_LEAVES` (both modules). Leaves no control is cut from. */
export const SKIP_LEAVES: readonly NodeType[] = Object.freeze([
  "image",
  "link",
  "inline_code",
  "drawing_element",
]);

/** md2ui: `restore_escaped_task_controls`. An escaped control is text again, as written. */
export function restoreEscapedTaskControls(kit: RegexKit, node: GroupNode): void {
  if (node.content) editContent(node, regexEdits(kit, ESCAPED_RE, ESCAPED_SPELLING, node.content));
  for (const child of node.children) restoreEscapedTaskControls(kit, child);
}

/** md2ui: `_code_ranges`. Spans of simple backtick code in one line (an escaped one opens none). */
export function codeRanges(text: string): Range[] {
  const ranges: Range[] = [];
  let start: number | null = null;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== "`" || (i > 0 && text[i - 1] === "\\")) continue;
    if (start === null) start = i;
    else {
      ranges.push([start, i + 1]);
      start = null;
    }
  }
  return ranges;
}

/**
 * Whether a token at `[start, end)` is declined: inside code, or escaped, or the
 * `!` of an image before it (md2ui's `blocked`, shared by both modules).
 */
export function blockedToken(
  text: string,
  code: readonly Range[],
  start: number,
  end: number,
): boolean {
  return (
    code.some(([a, b]) => a < end && start < b) ||
    (start > 0 && (text[start - 1] === "\\" || text[start - 1] === "!"))
  );
}

type ControlHit = readonly [number, number, boolean, string | null];

// md2ui: _hits. Non-overlapping control hits, the linked spelling first.
function hits(kit: RegexKit, text: string): ControlHit[] {
  const code = codeRanges(text);
  const found: ControlHit[] = [];
  for (const m of kit.re(LINKED_CONTROL_RE).finditer(text)) {
    if (!blockedToken(text, code, m.start(), m.end())) {
      found.push([m.start(), m.end(), m.text(1).toLowerCase() === "x", m.text(2)]);
    }
  }
  const linked = found.map(([s, e]) => [s, e] as const);
  for (const m of kit.re(CONTROL_RE).finditer(text)) {
    if (linked.some(([a, b]) => a <= m.start() && m.end() <= b)) continue;
    // `[X](/url)` is an ordinary link; only `[[X]](/url)` annotates a control.
    if (m.end() < text.length && text[m.end()] === "(") continue;
    if (!blockedToken(text, code, m.start(), m.end())) {
      found.push([m.start(), m.end(), m.text(1).toLowerCase() === "x", null]);
    }
  }
  // Hits never overlap, so their starts alone order them.
  return found.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/**
 * md2ui: `_control`. A task control leaf; `marker` when it is a task item's own box,
 * which marks the item as a bullet does.
 */
/**
 * md2ui: `muted_wrap`. The token at `start`:`end` of `text` with its `~~` wrapper, when
 * it has one after `floor`: `~~[ ]~~` is a muted control as `~~[Cancel](agent:c)~~` is a
 * disabled link, drawn disabled and reporting nothing, its tildes no text.
 */
export function mutedWrap(
  text: string,
  start: number,
  end: number,
  floor: number,
): [number, number, boolean] {
  if (
    start - 2 >= floor &&
    text.slice(start - 2, start) === "~~" &&
    text.slice(end, end + 2) === "~~"
  )
    return [start - 2, end + 2, true];
  return [start, end, false];
}

/**
 * md2ui: `_control`. A task control; `marker` when it is a task item's own box, and
 * `muted` when it was written `~~[ ]~~`, which disables it.
 */
function control(
  checked: boolean,
  url: string | null = null,
  marker = false,
  muted = false,
): GroupNode {
  const node = new GroupNode(checked ? "[X]" : "[ ]", "drawing_element");
  node.drawing_element = marker
    ? { kind: "task_control", checked, marker: true }
    : { kind: "task_control", checked };
  if (muted) node.drawing_element["disabled"] = true;
  node.link_url = url;
  return node;
}

/** md2ui: `_become`. A leaf that IS one token relabelled in place, keeping its line and glue. */
export function become(node: GroupNode, element: GroupNode): void {
  node.type = element.type;
  node.content = element.content;
  node.drawing_element = element.drawing_element;
  node.link_url = element.link_url;
  node.data_points = [];
  node.applicable = null;
}

/**
 * md2ui: `_split_leaf`. A leaf cut at its controls (and given its item's marker box
 * first, when `leading` says so). A lone token relabels the leaf in place.
 */
function splitLeaf(
  kit: RegexKit,
  node: GroupNode,
  ids: IdMint,
  leading: boolean | null = null,
  leadingUrl: string | null = null,
): boolean {
  if (SKIP_LEAVES.includes(node.type) || node.children.length > 0) return false;
  const found = hits(kit, node.content);
  if (leading === null && found.length === 0) return false;
  const children: GroupNode[] = [];
  const pieceType = isLineHolder(node.type) ? "text" : node.type;
  if (leading !== null) children.push(control(leading, leadingUrl, true));
  let cursor = 0;
  for (const [at, to, checked, url] of found) {
    const [start, end, muted] = mutedWrap(node.content, at, to, cursor);
    if (start > cursor) children.push(new GroupNode(node.content.slice(cursor, start), pieceType));
    children.push(control(checked, url, false, muted));
    cursor = end;
  }
  if (cursor < node.content.length)
    children.push(new GroupNode(node.content.slice(cursor), pieceType));
  const only = children[0];
  if (only === undefined) return false;
  if (children.length === 1 && !isLineHolder(node.type)) {
    become(node, only);
    return true;
  }
  inheritGlue(node, children, ids);
  if (node.type === "text") node.type = "group";
  node.content = "";
  node.children = children;
  node.data_points = [];
  node.applicable = null;
  return true;
}

// md2ui: _first_content_leaf. The first leaf outside nested items, skipped leaves aside.
function firstContentLeaf(node: GroupNode): GroupNode | null {
  if (node.children.length === 0) return SKIP_LEAVES.includes(node.type) ? null : node;
  for (const child of node.children) {
    if (LIST_TYPES.includes(child.type)) continue;
    const found = firstContentLeaf(child);
    if (found !== null) return found;
  }
  return null;
}

/**
 * md2ui: `_take_marker`. Whether a task item's text opens with its own marker box
 * (taken off the text), and that box's URL when it is linked. A spring before the
 * text means the box after it is a control, not the marker.
 */
function takeMarker(kit: RegexKit, node: GroupNode): [boolean, string | null] {
  const region =
    node.align_group && node.children.length > 0 ? (node.children[0] as GroupNode) : node;
  if (region.authored_align !== null && region.authored_align !== "left") return [false, null];
  const first = firstContentLeaf(node);
  if (first === null) return [false, null];
  const linked = kit.re(LINKED_CONTROL_RE).match(first.content);
  const plain = kit.re(CONTROL_RE).match(first.content);
  if (linked !== null) {
    first.content = lstrip(first.content.slice(linked.end()));
    return [true, linked.text(2)];
  }
  if (plain !== null && first.content.slice(plain.end(), plain.end() + 1) !== "(") {
    first.content = lstrip(first.content.slice(plain.end()));
    return [true, null];
  }
  return [false, null];
}

const isTaskControl = (node: GroupNode): boolean => node.drawing_element?.kind === "task_control";

/** md2ui: `_split_list_contents`. The controls of one list item; nested items split on their own. */
function splitListContents(kit: RegexKit, node: GroupNode, ids: IdMint): void {
  // A task box already cut means the marker was taken.
  const hasControl = (part: GroupNode): boolean =>
    isTaskControl(part) || part.children.some(hasControl);
  let marker =
    node.type === "task_open" || node.type === "task_done" ? node.type === "task_done" : null;
  if (marker !== null && hasControl(node)) marker = null;
  let markerUrl: string | null = null;
  if (marker !== null) markerUrl = takeMarker(kit, node)[1];
  if (marker !== null && node.authored_align && !node.align_group) {
    // `- [ ] ... Word` with its one region folded into the item: the content is an
    // aligned region again, beside the marker.
    const region = new GroupNode(node.content, node.children.length > 0 ? "group" : "text");
    region.children = node.children;
    region.data_points = node.data_points;
    region.paren_quote_ranges = node.paren_quote_ranges;
    region.applicable = node.applicable;
    region.separator_chars = node.separator_chars;
    region.column_split_group = node.column_split_group;
    region.authored_align = node.authored_align;
    node.content = "";
    node.data_points = [];
    node.children = [region];
    node.separator_chars = [];
    node.column_split_group = false;
    node.authored_align = null;
    node.align_group = true;
  }
  if (marker !== null && node.align_group) {
    // The marker starts the line, so it is a left region of its own.
    const box = control(marker, markerUrl, true);
    box.authored_align = "left";
    node.children.unshift(box);
    inheritGlue(node, node.children, ids);
    marker = null;
  }
  const first = marker !== null ? firstContentLeaf(node) : null;

  const walk = (part: GroupNode): void => {
    if (part !== node && LIST_TYPES.includes(part.type)) return;
    if (part.children.length === 0) {
      splitLeaf(kit, part, ids, part === first ? marker : null, part === first ? markerUrl : null);
      return;
    }
    for (const child of [...part.children]) walk(child);
  };
  walk(node);
}

/** md2ui: `split_task_controls` (Phase 5.55). Exact task controls anywhere, as leaves. */
export function splitTaskControls(kit: RegexKit, root: GroupNode, ids: IdMint): void {
  if (LIST_TYPES.includes(root.type)) splitListContents(kit, root, ids);
  else if (root.children.length === 0) splitLeaf(kit, root, ids);
  for (const child of [...root.children]) splitTaskControls(kit, child, ids);
}

// md2ui: _text_of. A node's text, its pieces joined by spaces.
function textOf(node: GroupNode): string {
  return node.children.length === 0 ? node.content : node.children.map(textOf).join(" ");
}

// md2ui: _label_after. The text a control starts: its following siblings, up to the
// next control or a nested item.
function labelAfter(siblings: readonly GroupNode[]): string {
  const parts: string[] = [];
  for (const sibling of siblings) {
    if (sibling.type === "drawing_element" || LIST_TYPES.includes(sibling.type)) break;
    parts.push(textOf(sibling));
  }
  return split(parts.join(" ")).join(" ");
}

// md2ui: _item_box. A task item's own box: the first control it holds, nested items aside.
function itemBox(item: GroupNode): GroupNode | null {
  for (const child of item.children) {
    if (LIST_TYPES.includes(child.type)) continue;
    if (isTaskControl(child)) return child;
    const found = itemBox(child);
    if (found !== null) return found;
  }
  return null;
}

/**
 * md2ui: `_item_label`. The item's words after its own box on its line, other task
 * boxes left out, up to a slider or a nested item; read across the whole item, since
 * a spring divides a line into regions without ending its name.
 */
function itemLabel(item: GroupNode, box: GroupNode): string {
  const words: string[] = [];
  let seen = false;
  const line = box.source_line_id;
  const nextLine = (node: GroupNode): boolean =>
    line !== null && node.source_line_id !== null && node.source_line_id !== line;
  const walk = (node: GroupNode): boolean => {
    for (const child of node.children) {
      if (child === box) seen = true;
      else if (LIST_TYPES.includes(child.type) || (seen && nextLine(child))) return false;
      else if (isTaskControl(child)) continue;
      else if (child.type === "drawing_element") {
        if (seen) return false;
      } else if (child.children.length > 0) {
        if (!walk(child)) return false;
      } else if (seen) {
        words.push(child.content);
      }
    }
    return true;
  };
  walk(item);
  return split(words.join(" ")).join(" ");
}

/**
 * md2ui: `stamp_task_controls` (Phase 6.246). Each task control's document ordinal
 * and the label of the item it starts, into its payload: what a click reports.
 */
export function stampTaskControls(root: GroupNode): void {
  let count = 0;
  const itemLabels = new Map<GroupNode, string>();
  const walk = (node: GroupNode): void => {
    if (node.type === "task_open" || node.type === "task_done") {
      const box = itemBox(node);
      if (box !== null) itemLabels.set(box, itemLabel(node, box));
    }
    node.children.forEach((child, i) => {
      const payload = child.drawing_element;
      if (payload !== null && payload.kind === "task_control") {
        payload.index = count;
        payload.label = itemLabels.get(child) ?? labelAfter(node.children.slice(i + 1));
        count += 1;
      }
      walk(child);
    });
  };
  walk(root);
}
