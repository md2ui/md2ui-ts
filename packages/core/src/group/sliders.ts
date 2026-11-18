// `[65%]` and `[3/5]` sliders (md2ui: pipeline/grouper_sliders.py).
import { editContent, regexEdits } from "./content-edits.ts";
import {
  become,
  blockedToken,
  codeRanges,
  isLineHolder,
  mutedWrap,
  SKIP_LEAVES,
} from "./drawing-elements.ts";
import { type IdMint, inheritGlue } from "./ids.ts";
import { GroupNode } from "./node.ts";
import { compile, type RegexKit } from "./py/re.ts";
import { cpLen, formatG, rstrip, split, strip, toFloat } from "./py/str.ts";
import { LINK_DESTINATION } from "./split/link-syntax.ts";

// py: _PERCENT = r"(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%"
const PERCENT = String.raw`(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%`;
// py: _RATIO = r"\d{1,4}(?:\.\d+)?/\d{1,4}"
const RATIO = String.raw`\d{1,4}(?:\.\d+)?/\d{1,4}`;
// py: _VALUE = f"(?:{_PERCENT}|{_RATIO})"
const VALUE = `(?:${PERCENT}|${RATIO})`;
/** md2ui: `_SLIDER_RE`. */
// py: re.compile(rf"\[({_VALUE})]")
export const SLIDER_RE = compile(String.raw`\[(${VALUE})]`);

// md2ui: _ESCAPED_PREFIX — stands in for an escaped slider's `[`.
const ESCAPED_PREFIX = "\ue122";
// py: rf"\\\[(?={_VALUE}\\?])"
const ESCAPED_SLIDER = compile(String.raw`\\\[(?=${VALUE}\\?])`);

/**
 * md2ui: `protect_escaped_sliders`. Hides an escaped slider's `[` while CommonMark escapes
 * are resolved: every spelling, a percentage or a ratio, its closing bracket escaped or not.
 */
export function protectEscapedSliders(kit: RegexKit, text: string): string {
  return kit.re(ESCAPED_SLIDER).sub(ESCAPED_PREFIX, text);
}

// py: re.compile(rf"\[\[({_VALUE})]\]\(((?=[^)]){LINK_DESTINATION})\)")
const LINKED_SLIDER_RE = compile(String.raw`\[\[(${VALUE})]\]\(((?=[^)])${LINK_DESTINATION})\)`);

// py: re.compile(_ESCAPED_PREFIX)
const ESCAPED_PREFIX_RE = compile(ESCAPED_PREFIX);

/** md2ui: `restore_escaped_sliders`. An escaped slider's `[` is text again. */
export function restoreEscapedSliders(kit: RegexKit, node: GroupNode): void {
  if (node.content) editContent(node, regexEdits(kit, ESCAPED_PREFIX_RE, "[", node.content));
  for (const child of node.children) restoreEscapedSliders(kit, child);
}

// md2ui: _decimals. How precisely the author wrote the value.
function decimals(raw: string): number {
  return cpLen(split(raw, ".", 1)[1] ?? "");
}

/** md2ui: `_Hit`. One slider token and the domain the author gave it. */
interface SliderHit {
  readonly start: number;
  readonly end: number;
  readonly value: number;
  readonly maximum: number;
  readonly unit: string;
  readonly decimals: number;
  readonly url: string | null;
}

/**
 * md2ui: `_read`. `[value, maximum, unit, decimals]`, or null for a ratio whose
 * numerator exceeds its denominator: that cannot be a position on a track.
 */
function read(raw: string): [number, number, string, number] | null {
  if (raw.endsWith("%")) return [toFloat(raw.slice(0, -1)), 100, "%", decimals(raw.slice(0, -1))];
  const [top = "", bottom = ""] = split(raw, "/", 1);
  const maximum = toFloat(bottom);
  if (maximum <= 0 || toFloat(top) > maximum) return null;
  return [toFloat(top), maximum, "", decimals(top)];
}

// md2ui: _hits. The linked spelling first; `[65%](url)` stays an ordinary link.
function sliderHits(kit: RegexKit, text: string): SliderHit[] {
  const code = codeRanges(text);
  const found: SliderHit[] = [];
  const hit = (start: number, end: number, raw: string, url: string | null): void => {
    const value = read(raw);
    if (value === null || blockedToken(text, code, start, end)) return;
    const [v, maximum, unit, places] = value;
    found.push({ start, end, value: v, maximum, unit, decimals: places, url });
  };
  for (const m of kit.re(LINKED_SLIDER_RE).finditer(text))
    hit(m.start(), m.end(), m.text(1), m.text(2));
  const linked = found.map((h) => [h.start, h.end] as const);
  for (const m of kit.re(SLIDER_RE).finditer(text)) {
    if (linked.some(([a, b]) => a <= m.start() && m.end() <= b)) continue;
    if (m.end() < text.length && text[m.end()] === "(") continue;
    hit(m.start(), m.end(), m.text(1), null);
  }
  return found.sort((a, b) => a.start - b.start || a.end - b.end);
}

// md2ui: _slider. The drawn leaf, its value spelled `{:g}`; `muted` when it was written
// `~~[65%]~~`, which disables it.
function slider(hit: SliderHit, muted: boolean): GroupNode {
  const shown = hit.unit
    ? `${formatG(hit.value)}%`
    : `${formatG(hit.value)}/${formatG(hit.maximum)}`;
  const node = new GroupNode(`[${shown}]`, "drawing_element");
  node.drawing_element = {
    kind: "slider",
    value: hit.value,
    max: hit.maximum,
    unit: hit.unit,
    decimals: hit.decimals,
  };
  if (muted) node.drawing_element["disabled"] = true;
  node.link_url = hit.url;
  return node;
}

// md2ui: _split_leaf (grouper_sliders). A leaf cut at its sliders.
function splitLeaf(kit: RegexKit, node: GroupNode, ids: IdMint): void {
  if (SKIP_LEAVES.includes(node.type) || node.children.length > 0) return;
  const found = sliderHits(kit, node.content);
  if (found.length === 0) return;
  const children: GroupNode[] = [];
  // A line holder's type names the holder, not the pieces of its text.
  const pieceType = isLineHolder(node.type) ? "text" : node.type;
  let cursor = 0;
  for (const h of found) {
    const [start, end, muted] = mutedWrap(node.content, h.start, h.end, cursor);
    if (start > cursor) children.push(new GroupNode(node.content.slice(cursor, start), pieceType));
    children.push(slider(h, muted));
    cursor = end;
  }
  if (cursor < node.content.length)
    children.push(new GroupNode(node.content.slice(cursor), pieceType));
  const only = children[0];
  if (children.length === 1 && only !== undefined && !isLineHolder(node.type)) {
    become(node, only);
    return;
  }
  inheritGlue(node, children, ids);
  if (node.type === "text") node.type = "group";
  node.content = "";
  node.children = children;
  node.data_points = [];
  node.applicable = null;
}

/** md2ui: `split_sliders` (Phase 5.55). Every slider token, after the line has been read. */
export function splitSliders(kit: RegexKit, root: GroupNode, ids: IdMint): void {
  if (root.children.length === 0) splitLeaf(kit, root, ids);
  for (const child of [...root.children]) splitSliders(kit, child, ids);
}

// md2ui: _runs. A node's text cut at every control in it: a control's token is never
// words, and the words a control bounds are named apart.
function runs(node: GroupNode): string[] {
  if (node.type === "drawing_element") return ["", ""];
  if (node.children.length === 0) return [node.content];
  const out = [""];
  for (const child of node.children) {
    const [firstRun = "", ...rest] = runs(child);
    out[out.length - 1] += ` ${firstRun}`;
    out.push(...rest);
  }
  return out;
}

// md2ui: _clean_label. `text` as a label: one line, no colon after it, no `~~` wrapper
// around it.
function cleanLabel(text: string): string {
  const label = strip(rstrip(split(text).join(" "), ":"));
  if (cpLen(label) > 4 && label.startsWith("~~") && label.endsWith("~~"))
    return strip(label.slice(2, -2));
  return label;
}

// md2ui: _nearest. The first run of words that names anything.
function nearest(found: readonly string[]): string {
  for (const run of found) {
    const label = cleanLabel(run);
    if (label) return label;
  }
  return "";
}

// A count is a ratio slider between a minus and a plus sign: `Quantity: ➖ [2/9] ➕`. Only
// these two minus signs: an ASCII ` - ` before the figure is a dash, which divides the
// line before any slider is read. md2ui: `_MINUS`, `_PLUS`.
const MINUS = ["\u2796", "\u2212"] as const; // ➖ −
const PLUS = ["\u2795", "+"] as const; // ➕ +

// md2ui: _bare
const bare = (text: string): string => strip(text.replaceAll("\ufe0f", ""));

/** md2ui: `_is_count`. A ratio slider whose neighbours on its line end and start with the signs. */
function isCount(node: GroupNode, i: number, payload: { readonly unit?: string }): boolean {
  const children = node.children;
  if (payload.unit || !(0 < i && i < children.length - 1)) return false;
  const before = children[i - 1] as GroupNode;
  const after = children[i + 1] as GroupNode;
  const left = bare(before.content);
  const right = bare(after.content);
  return (
    before.children.length === 0 &&
    after.children.length === 0 &&
    MINUS.some((sign) => left.endsWith(sign)) &&
    PLUS.some((sign) => right.startsWith(sign))
  );
}

/**
 * md2ui: `_caption`. The words that name a count drawn alone in its `holder`: the key, the
 * glued caption above it, the `:` caption after it or the cell before it — a sibling of
 * the holder that its line, card or table row keeps with it.
 */
function caption(holder: GroupNode, parent: GroupNode | null): string {
  if (parent === null) return "";
  const at = parent.children.indexOf(holder);
  // A row's first cell names it.
  const kept = parent.line_split_group || parent.glued_content_group || parent.type === "table_row";
  for (const [k, reverse] of [
    [at - 1, true],
    [at + 1, false],
  ] as const) {
    const sibling = parent.children[k];
    if (sibling === undefined) continue;
    if (kept || sibling.source_line_id === holder.source_line_id) {
      const found = runs(sibling);
      const label = nearest(reverse ? found.reverse() : found);
      if (label) return label;
    }
  }
  return "";
}

/**
 * md2ui: `stamp_sliders` (Phase 6.246). Each slider's ordinal, and the words nearest it on
 * its line as its label (else `Slider N`).
 *
 * A count (a ratio slider between `➖` and `➕`) is stamped `count` and named by the words
 * before its minus sign, else by its key or caption, never by the sign. Its two signs then
 * become part of it: they are its buttons, so the words beside it lose them and one leaf
 * is drawn whole, never wrapped between a sign and its digits.
 */
export function stampSliders(kit: RegexKit, root: GroupNode): void {
  let count = 0;
  const counts: [GroupNode, GroupNode][] = [];
  const walk = (node: GroupNode, parent: GroupNode | null): void => {
    node.children.forEach((child, i) => {
      const payload = child.drawing_element;
      if (payload !== null && payload.kind === "slider") {
        const line = child.source_line_id;
        const sameContext = node.line_split_group || node.glued_content_group;
        const prev = node.children[i - 1];
        const next = node.children[i + 1];
        let before =
          i > 0 && prev !== undefined && (sameContext || prev.source_line_id === line)
            ? nearest(runs(prev).reverse())
            : "";
        let after =
          next !== undefined && (sameContext || next.source_line_id === line)
            ? nearest(runs(next))
            : "";
        if (isCount(node, i, payload)) {
          payload.count = true;
          if (mutedSigns(kit, prev as GroupNode, next as GroupNode)) {
            payload["disabled"] = true;
            before = kit.re(MUTED_MINUS).sub("", before);
          }
          before = cleanLabel(rstrip(bare(before), MINUS.join("")));
          after = "";
          before = before || caption(node, parent);
          counts.push([node, child]);
        }
        payload.index = count;
        payload.label = before || after || `Slider ${count + 1}`;
        count += 1;
      }
      walk(child, node);
    });
  };
  walk(root, null);
  for (const [node, child] of counts) takeSigns(kit, node, child);
}

// py: re.compile(r"^\s*[\u2795+]\ufe0f?")
const LEADING_PLUS = compile(String.raw`^\s*[\u2795+]\ufe0f?`);
// py: re.compile(r"\s*[\u2796\u2212]\ufe0f?\s*$")
const TRAILING_MINUS = compile(String.raw`\s*[\u2796\u2212]\ufe0f?\s*$`);

// A count muted whole, `~~➖ [2/9] ➕~~`: its signs inside the tildes, which go with them,
// as `➖ ~~[2/9]~~ ➕`'s go with the slider (`mutedWrap`).
// py: re.compile(r"^\s*[\u2795+]\ufe0f?~~")
const MUTED_PLUS = compile(String.raw`^\s*[\u2795+]\ufe0f?~~`);
// py: re.compile(r"\s*~~[\u2796\u2212]\ufe0f?\s*$")
const MUTED_MINUS = compile(String.raw`\s*~~[\u2796\u2212]\ufe0f?\s*$`);

// md2ui: _muted_signs
const mutedSigns = (kit: RegexKit, before: GroupNode, after: GroupNode): boolean =>
  kit.re(MUTED_MINUS).search(before.content) !== null &&
  kit.re(MUTED_PLUS).match(after.content) !== null;

/** md2ui: `_take_signs`. Cut the count's signs from the words beside it, and drop a piece left empty. */
function takeSigns(kit: RegexKit, node: GroupNode, count: GroupNode): void {
  const at = node.children.indexOf(count);
  const before = node.children[at - 1] as GroupNode;
  const after = node.children[at + 1] as GroupNode;
  const [minus, plus] = mutedSigns(kit, before, after)
    ? [MUTED_MINUS, MUTED_PLUS]
    : [TRAILING_MINUS, LEADING_PLUS];
  editContent(before, regexEdits(kit, minus, "", before.content));
  editContent(after, regexEdits(kit, plus, "", after.content));
  node.children = node.children.filter(
    (c) => c.children.length > 0 || strip(c.content) !== "" || c === count,
  );
}
