// Block-level splitting: where a document divides into blocks (md2ui:
// pipeline/grouper_block_splits.py).
//
// The coarsest cut the grouper makes, and the first: blank lines end a block, a
// newline inside one does not. A thematic break is here too: `---` / `___` / `***` /
// `:::` / `...` / `;;;` / `+++` are whole lines that mint a node, and
// `breakNodeType` is the one place that maps a break's spelling to its meaning.
// Everything here works on whole lines.
import { HARD_BREAK, resolveEscape } from "./escapes.ts";
import type { GroupNode, NodeType } from "./node.ts";
import { compile, type Pattern, type RegexKit } from "./py/re.ts";
import { first, isspace, lstrip, rstrip, split, strip, toInt } from "./py/str.ts";
import { LINK_DESTINATION } from "./split/link-syntax.ts";

/** md2ui: `ITEM_DIVIDER` (grouper_types). Stands in for a `:::` or `...` scoped to a list item. */
export const ITEM_DIVIDER = "\ue130";

/**
 * md2ui: `_LIST_MARKER_RE` (grouper_types). Any list marker at the start of a line:
 * gates continuation merging to list blocks, and lets a group link sit in an item.
 */
// py: re.compile(r"^[-*+]\s|^\d+[.)]\s")
export const LIST_MARKER_RE = compile(String.raw`^[-*+]\s|^\d+[.)]\s`);
/** md2ui: `_BLOCKQUOTE_LINE_RE`. A single blockquote line. */
// py: re.compile(r"^[ \t]*>")
export const BLOCKQUOTE_LINE_RE = compile(String.raw`^[ \t]*>`);

// A task item's box, plain `[ ]` or linked `[[ ]](url)`, then its label.
// py: re.compile(
// py:     rf"^[-*+]\s+(\[([ xX])\]|\[\[([ xX])\]\]\((?=[^)]){LINK_DESTINATION}\))(?:\s+(.*)|$)"
// py: )
const TASK_ITEM_RE = compile(
  String.raw`^[-*+]\s+(\[([ xX])\]|\[\[([ xX])\]\]\((?=[^)])${LINK_DESTINATION}\))(?:\s+(.*)|$)`,
);
// A box opening a task's label: `[ ]`, or `[[ ]](url)` — not `[x](url)`, a link.
// py: re.compile(rf"\[\[[ xX]\]\]\((?=[^)]){LINK_DESTINATION}\)|\[[ xX]\](?!\()")
const LABEL_BOX_RE = compile(
  String.raw`\[\[[ xX]\]\]\((?=[^)])${LINK_DESTINATION}\)|\[[ xX]\](?!\()`,
);
// py: re.match(r"^(\d+)[.)]\s+(.*)", line)
const ORDERED_ITEM_RE = compile(String.raw`^(\d+)[.)]\s+(.*)`);
// py: re.match(r"^[-*+]\s+(.*)", line)
const UNORDERED_ITEM_RE = compile(String.raw`^[-*+]\s+(.*)`);
// py: re.match(r"^[ \t]*>[ ]?(.*)$", line)
const QUOTE_LINE_RE = compile(String.raw`^[ \t]*>[ ]?(.*)$`);
/**
 * md2ui: `IMAGE_RE`. An `![alt](url)`; `![alt]()`, an empty source, is one with no
 * picture (md2ui ADR-406).
 */
// py: re.compile(rf"(!\[[^\]]*\]\({LINK_DESTINATION}\))")
export const IMAGE_RE = compile(String.raw`(!\[[^\]]*\]\(${LINK_DESTINATION}\))`);
/** md2ui: `INLINE_CODE_RE`. A backtick span. */
// py: re.compile(r"(`[^`]+`)")
export const INLINE_CODE_RE = compile(String.raw`(\x60[^\x60]+\x60)`);

// py: re.compile(r"^[ \t]*-(?:[ \t]*-){2,}[ \t]*$")
const HORIZONTAL_RULE_RE = compile(String.raw`^[ \t]*-(?:[ \t]*-){2,}[ \t]*$`);
// py: re.compile(r"^[ \t]*_(?:[ \t]*_){2,}[ \t]*$")
const CONTENT_BREAK_RE = compile(String.raw`^[ \t]*_(?:[ \t]*_){2,}[ \t]*$`);
// py: re.compile(r"^[ \t]*\*(?:[ \t]*\*){2,}[ \t]*$")
const SECTION_STOP_RE = compile(String.raw`^[ \t]*\*(?:[ \t]*\*){2,}[ \t]*$`);
// The column divider, with its optional weight, wide weight or condition.
// py: re.compile(
// py:     r"^[ \t]*:(?:[ \t]*:){2,}[ \t]*(\d+(?:\.\d+)?)?"
// py:     r"(?:[ \t]+(\d+(?:\.\d+)?)|[ \t]*([<>]))?[ \t]*$"
// py: )
const COLUMN_DIVIDER_RE = compile(
  String.raw`^[ \t]*:(?:[ \t]*:){2,}[ \t]*(\d+(?:\.\d+)?)?` +
    String.raw`(?:[ \t]+(\d+(?:\.\d+)?)|[ \t]*([<>]))?[ \t]*$`,
);
// A divider-shaped line whose options are mistyped still reads as a bare `:::`.
// py: re.compile(r"^[ \t]*:(?:[ \t]*:){2,}[ \t\d.<>]*$")
const DIVIDER_SHAPED_RE = compile(String.raw`^[ \t]*:(?:[ \t]*:){2,}[ \t\d.<>]*$`);
// py: re.compile(r"^[ \t]*\.\.\.[ \t]*$")
const VERTICAL_SPRING_RE = compile(String.raw`^[ \t]*\.\.\.[ \t]*$`);
// py: re.compile(r"^[ \t]*;(?:[ \t]*;){2,}[ \t]*$")
const ROW_CLOSER_RE = compile(String.raw`^[ \t]*;(?:[ \t]*;){2,}[ \t]*$`);
/** md2ui: `SPACER_RE`. Three to five `+`, alone on a line (ADR-203). */
// py: re.compile(r"^[ \t]*\+{3,5}(?:[ \t]+\+{3,5})*[ \t]*$")
export const SPACER_RE = compile(String.raw`^[ \t]*\+{3,5}(?:[ \t]+\+{3,5})*[ \t]*$`);
// A list marker carrying a DIFFERENT break character: a list item holding a rule.
// py: re.compile(
// py:     r"^[ \t]*(?:[-*+]|\d+[.)])[ \t]+"
// py:     r"(?:-(?:[ \t]*-){2,}|_(?:[ \t]*_){2,}|\*(?:[ \t]*\*){2,})[ \t]*$"
// py: )
const LIST_MARKER_BREAK_RE = compile(
  String.raw`^[ \t]*(?:[-*+]|\d+[.)])[ \t]+` +
    String.raw`(?:-(?:[ \t]*-){2,}|_(?:[ \t]*_){2,}|\*(?:[ \t]*\*){2,})[ \t]*$`,
);
// py: re.compile(r"^([ \t]*)(?:[-*+]|\d+[.)])(?:[ \t]|$)")
const ITEM_MARKER_RE = compile(String.raw`^([ \t]*)(?:[-*+]|\d+[.)])(?:[ \t]|$)`);
// py: re.split(r"\n{2,}", content)
const BLANK_LINES = compile(String.raw`\n{2,}`);

/** md2ui: `_PARTITION_TYPES`. The breaks that partition a box, transparent to the heading peel. */
export const PARTITION_TYPES: readonly NodeType[] = Object.freeze([
  "column_divider",
  "vertical_spring",
]);

/** md2ui: `_BREAK_TYPES`. A leaf whose content is a spelling no splitter may read. */
export const BREAK_TYPES: readonly NodeType[] = Object.freeze([
  "horizontal_rule",
  "content_break",
  "section_stop",
  "column_divider",
  "vertical_spring",
  "row_closer",
  "spacer",
]);

/**
 * md2ui: `_KEEP_WHEN_EMPTY`. What the empty-leaf prune keeps: a break, whose spelling
 * is its content, and a table cell, whose position is its meaning.
 */
export const KEEP_WHEN_EMPTY: readonly NodeType[] = Object.freeze([...BREAK_TYPES, "table_cell"]);

/** md2ui: `_break_node_type`. The BREAK node `line` mints, or null for ordinary text. */
export function breakNodeType(kit: RegexKit, line: string): NodeType | null {
  if (kit.re(HORIZONTAL_RULE_RE).match(line)) return "horizontal_rule";
  if (kit.re(CONTENT_BREAK_RE).match(line)) return "content_break";
  if (kit.re(SECTION_STOP_RE).match(line)) return "section_stop";
  if (kit.re(DIVIDER_SHAPED_RE).match(line)) return "column_divider";
  if (kit.re(VERTICAL_SPRING_RE).match(line)) return "vertical_spring";
  if (kit.re(ROW_CLOSER_RE).match(line)) return "row_closer";
  if (kit.re(SPACER_RE).match(line)) return "spacer";
  if (kit.re(LIST_MARKER_BREAK_RE).match(line)) return "horizontal_rule";
  return null;
}

/**
 * md2ui: `glued_rules`. The `---` lines that divide a glued block rather than cut it:
 * `---` paints and `___` cuts. A rule written tight between two body lines of one
 * block (no heading, break, list item, quote or table line on either side) stays a
 * line of that block's text, the way `- ---` divides the items of one list.
 */
export function gluedRules(
  kit: RegexKit,
  lines: readonly string[],
  breaks: ReadonlySet<number>,
  headings: ReadonlySet<number>,
): Set<number> {
  const bodyLine = (j: number): boolean => {
    const line = lines[j] ?? "";
    return (
      strip(line) !== "" &&
      !breaks.has(j) &&
      !headings.has(j) &&
      kit.re(LIST_MARKER_RE).match(lstrip(line)) === null &&
      kit.re(BLOCKQUOTE_LINE_RE).match(line) === null &&
      !lstrip(line).startsWith("|")
    );
  };
  const out = new Set<number>();
  for (const i of breaks) {
    if (
      breakNodeType(kit, lines[i] as string) === "horizontal_rule" &&
      bodyLine(i - 1) &&
      bodyLine(i + 1)
    ) {
      out.add(i);
    }
  }
  return out;
}

/**
 * md2ui: `glued_runs`. The lines of each glued block: two or more non-blank lines with
 * no blank line and no break between them. A lone `...` written tight between two
 * such lines divides the space inside that one box, the way a `+++` does, so it does
 * not end the run; it is not a member of it either.
 */
export function gluedRuns(
  kit: RegexKit,
  lines: readonly string[],
  breaks: ReadonlySet<number>,
): number[][] {
  const body = (j: number): boolean =>
    j >= 0 && j < lines.length && !breaks.has(j) && strip(lines[j] as string) !== "";
  const runs: number[][] = [];
  let run: number[] = [];
  for (let i = 0; i <= lines.length; i += 1) {
    if (body(i)) run.push(i);
    else if (
      !(
        breaks.has(i) &&
        breakNodeType(kit, lines[i] as string) === "vertical_spring" &&
        body(i - 1) &&
        body(i + 1)
      )
    ) {
      if (run.length >= 2) runs.push(run);
      run = [];
    }
  }
  return runs;
}

// md2ui: _weight. A written weight as a number; null when none was written.
function weight(text: string | undefined): number | null {
  return text === undefined ? null : Number(text);
}

// md2ui: _DIVIDER_WHEN. What a divider's condition character means.
function dividerWhen(c: string | undefined): "narrow" | "wide" | null {
  if (c === "<") return "narrow";
  if (c === ">") return "wide";
  return null;
}

/**
 * md2ui: `stamp_column_divider`. Records what a divider line says on its node: the
 * weight of the cell above, its wide weight, and the space the divider cuts in.
 */
export function stampColumnDivider(kit: RegexKit, node: GroupNode, line: string): void {
  const m = kit.re(COLUMN_DIVIDER_RE).match(line);
  if (m === null) return; // the fallback: a bare divider
  node.column_weight = weight(m.group(1));
  node.column_weight_wide = weight(m.group(2));
  node.column_when = dividerWhen(m.group(3));
}

/**
 * md2ui: `scope_item_dividers`. Hands every `:::` and `...` indented under a list
 * item to that item, rewritten as an `ITEM_DIVIDER` line.
 */
export function scopeItemDividers(kit: RegexKit, lines: readonly string[]): string[] {
  const out: string[] = [];
  let itemIndent: number | null = null;
  for (const raw of lines) {
    let line = raw;
    const indent = line.length - lstrip(line, " \t").length;
    const marker = kit.re(ITEM_MARKER_RE).match(line);
    if (marker !== null) {
      itemIndent = marker.text(1).length;
    } else if (strip(line) !== "" && (itemIndent === null || indent <= itemIndent)) {
      itemIndent = null;
    } else if (
      itemIndent !== null &&
      (kit.re(DIVIDER_SHAPED_RE).match(line) !== null ||
        kit.re(VERTICAL_SPRING_RE).match(line) !== null)
    ) {
      line = line.slice(0, indent) + ITEM_DIVIDER + strip(line);
    }
    out.push(line);
  }
  return out;
}

// md2ui: _is_list_continuation. Plain continuation text, not a nested list or table.
function isListContinuation(kit: RegexKit, line: string): boolean {
  const s = strip(line);
  return !(kit.re(LIST_MARKER_RE).match(s) !== null || s.startsWith("|"));
}

/**
 * md2ui: `mark_hard_breaks`. Each line ending in an odd run of backslashes is joined
 * to the next with `HARD_BREAK`, unless either line is a block of its own. A heading is
 * not one: it continues as a text does, and its joined lines are one heading of its level.
 */
function markHardBreaks(kit: RegexKit, text: string, headingRe: Pattern): string {
  const oneLineBlock = (line: string): boolean =>
    lstrip(line).startsWith("|") || breakNodeType(kit, line) !== null;
  const startsABlock = (line: string): boolean =>
    kit.re(headingRe).match(line) !== null ||
    oneLineBlock(line) ||
    kit.re(BLOCKQUOTE_LINE_RE).match(line) !== null ||
    kit.re(LIST_MARKER_RE).match(strip(line)) !== null;

  const out: string[] = [];
  for (const line of text.split("\n")) {
    const prev = out.at(-1);
    if (prev !== undefined) {
      const run = prev.length - rstrip(prev, "\\").length;
      if (run % 2 === 1 && strip(line) !== "" && !oneLineBlock(prev) && !startsABlock(line)) {
        out[out.length - 1] = prev.slice(0, -1) + HARD_BREAK + lstrip(line);
        continue;
      }
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * md2ui: `flat_label`. A link or image label written over several lines, as one line.
 * Its lines are joined by a space, as CommonMark joins a soft break, except where one
 * ends in a hard break, by the rule `markHardBreaks` reads: an odd run of backslashes,
 * followed by a line that is not blank. Link text is inline content, so the break holds
 * inside it, and the label keeps `HARD_BREAK` where the backslash was.
 */
export function flatLabel(inner: string): string {
  let out = "";
  let blank = false;
  for (const raw of inner.split("\n")) {
    const line = split(raw).join(" ");
    if (line === "") {
      blank = out !== "";
      continue;
    }
    const run = out.length - rstrip(out, "\\").length;
    if (out === "") out = line;
    else if (run % 2 === 1 && !blank) out = out.slice(0, -1) + HARD_BREAK + line;
    else out = `${out} ${line}`;
    blank = false;
  }
  return out;
}

/**
 * md2ui: `finish_lines`. Hard breaks joined, then the early escapes resolved — in
 * that order, so an escaped backslash never reads as a break.
 */
export function finishLines(
  kit: RegexKit,
  text: string,
  headingRe: Pattern,
  escapeRe: Pattern,
): string {
  // py: escape_re.sub(resolve_escape, ...)
  return kit.re(escapeRe).sub(resolveEscape, markHardBreaks(kit, text, headingRe));
}

/**
 * A splitter's piece: md2ui's `(label, text)`, or `(label, text, number)` for an
 * ordered item, carrying the number the author wrote.
 */
export type Piece = readonly [NodeType, string] | readonly [NodeType, string, number];

/**
 * md2ui: `_split_blank_lines`. Paragraphs; an indented part after a list block is
 * that list's loose continuation and stays with it.
 */
export function splitBlankLines(kit: RegexKit, content: string): Piece[] | null {
  const merged: string[] = [];
  for (const piece of kit.re(BLANK_LINES).split(content)) {
    const part = piece ?? ""; // the pattern has no groups: every piece is a string
    const last = merged.at(-1);
    if (
      last !== undefined &&
      isspace(first(part)) &&
      kit.re(LIST_MARKER_RE).match(split(lstrip(last), "\n", 1)[0] ?? "") !== null &&
      isListContinuation(kit, split(part, "\n", 1)[0] ?? "")
    ) {
      merged[merged.length - 1] = `${last}\n\n${part}`;
    } else {
      merged.push(part);
    }
  }
  const parts = merged.map((p) => strip(p)).filter((p) => p !== "");
  if (parts.length <= 1) return null;
  return parts.map((p): Piece => [p.includes("\n") ? "group" : "text", p]);
}

/**
 * md2ui: `_split_newlines`. One piece per line, except that a list item keeps its
 * indented continuation lines and a blockquote keeps its run of `>` lines. A `---`
 * line left in the block is minted as its rule.
 */
export function splitNewlines(kit: RegexKit, content: string): Piece[] | null {
  const pieces: string[] = [];
  for (const line of content.split("\n")) {
    const last = pieces.at(-1);
    const head = last === undefined ? null : (split(last, "\n", 1)[0] ?? "");
    const inListPiece = head !== null && kit.re(LIST_MARKER_RE).match(head) !== null;
    const inQuotePiece = head !== null && kit.re(BLOCKQUOTE_LINE_RE).match(head) !== null;
    if (strip(line) === "") {
      if (inListPiece || inQuotePiece) pieces[pieces.length - 1] = `${last}\n`;
      continue;
    }
    if (inQuotePiece && kit.re(BLOCKQUOTE_LINE_RE).match(line) !== null) {
      pieces[pieces.length - 1] = `${last}\n${line}`;
    } else if (inListPiece && isspace(first(line)) && isListContinuation(kit, line)) {
      pieces[pieces.length - 1] = `${last}\n${strip(line)}`;
    } else {
      pieces.push(strip(line));
    }
  }
  const kept = pieces.map((p) => strip(p, "\n")).filter((p) => p !== "");
  if (kept.length <= 1) return null;
  // A `---` that `gluedRules` left inside the block is its divider.
  return kept.map(
    (p): Piece => [kit.re(HORIZONTAL_RULE_RE).match(p) !== null ? "horizontal_rule" : "text", p],
  );
}

/**
 * md2ui: `_split_all_lists`. A run of list items, each with its continuation lines.
 * A task keeps its box in its text where the box is linked or the label opens with a
 * box of its own; a bare `- [ ]` is a bullet holding the box.
 */
export function splitAllLists(kit: RegexKit, content: string): Piece[] | null {
  const lines = content.split("\n");
  if (kit.re(LIST_MARKER_RE).match(lines[0] ?? "") === null) return null;

  const items: Piece[] = [];
  let current: string[] = [];
  let label: NodeType | "" = "";
  let number: number | null = null;
  let box = ""; // a task's linked box, `[[ ]](url)`, which its text keeps
  let written = ""; // a task's box as written, linked or not

  const flush = (kit: RegexKit): void => {
    let text = strip(current.join("\n"), "\n");
    const task = label === "task_open" || label === "task_done";
    if (!strip(text) && task) {
      text = box || (label === "task_done" ? "[x]" : "[ ]");
      label = "list_item";
    } else if (task && (box || kit.re(LABEL_BOX_RE).match(text) !== null)) {
      text = `${written} ${text}`;
    }
    // The first line is always a marker, so a label is set by the first flush.
    const type = label || "list_item";
    items.push(number === null ? [type, text] : [type, text, number]);
  };

  for (const line of lines) {
    const task = kit.re(TASK_ITEM_RE).match(line);
    if (task !== null) {
      if (current.length > 0) flush(kit);
      const ticked = (task.group(2) ?? task.text(3)).toLowerCase() === "x";
      label = ticked ? "task_done" : "task_open";
      box = task.group(3) !== undefined ? task.text(1) : "";
      written = task.text(1);
      current = [task.group(4) ?? ""];
      number = null;
      continue;
    }
    const ordered = kit.re(ORDERED_ITEM_RE).match(line);
    if (ordered !== null) {
      if (current.length > 0) flush(kit);
      label = "ordered_item";
      current = [ordered.text(2)];
      number = toInt(ordered.text(1));
      continue;
    }
    const unordered = kit.re(UNORDERED_ITEM_RE).match(line);
    if (unordered !== null) {
      if (current.length > 0) flush(kit);
      label = "list_item";
      current = [unordered.text(1)];
      number = null;
      continue;
    }
    // A continuation line; blank ones are kept as paragraph breaks for the body pass.
    if (label) current.push(strip(line));
  }
  if (current.length > 0) flush(kit);
  return items.length > 0 ? items : null;
}

/**
 * md2ui: `_split_blockquote`. One BLOCKQUOTE holding the run, ONE leading `>` peeled
 * from each line (a nested `>` stays as body text).
 */
export function splitBlockquote(kit: RegexKit, content: string): Piece[] | null {
  const lines = content.split("\n");
  if (kit.re(BLOCKQUOTE_LINE_RE).match(lines[0] ?? "") === null) return null;
  const peeled = lines.map((line) => kit.re(QUOTE_LINE_RE).match(line)?.text(1) ?? line);
  return [["blockquote", strip(peeled.join("\n"), "\n")]];
}

// Separator characters orphaned at the edge of a text part after an inline split.
// py: re.compile(r"\s*[|—–]\s*$|\s+-\s*$")
const ORPHAN_SEP_TRAIL = compile(String.raw`\s*[|—–]\s*$|\s+-\s*$`);
// py: re.compile(r"^\s*[|—–]\s*|^-\s+")
const ORPHAN_SEP_LEAD = compile(String.raw`^\s*[|—–]\s*|^-\s+`);

/**
 * md2ui: `_split_inline`. `content` cut around each match of `pattern` (one capture
 * group); matches become `label` pieces, the text between them TEXT with orphaned
 * separators trimmed. A match overlapping a `protected` range does not count.
 */
function splitInline(
  kit: RegexKit,
  content: string,
  pattern: Pattern,
  label: NodeType,
  protectedRanges: readonly (readonly [number, number])[] | null,
): Piece[] | null {
  let parts: (string | undefined)[];
  if (protectedRanges !== null) {
    parts = [];
    let last = 0;
    for (const m of kit.re(pattern).finditer(content)) {
      if (protectedRanges.some(([s, e]) => s < m.end() && m.start() < e)) continue;
      parts.push(content.slice(last, m.start()), m.text());
      last = m.end();
    }
    parts.push(content.slice(last));
  } else {
    parts = kit.re(pattern).split(content);
  }
  if (parts.length === 1) return null;
  const result: Piece[] = [];
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const inner = strip(part ?? "");
      if (inner) result.push([label, inner]);
    } else {
      let text = strip(part ?? "");
      text = strip(kit.re(ORPHAN_SEP_TRAIL).sub("", text));
      text = strip(kit.re(ORPHAN_SEP_LEAD).sub("", text));
      if (text) result.push(["text", text]);
    }
  });
  return result.length > 0 ? result : null;
}

/**
 * md2ui: `_split_images`. `![alt](url)` cut out as IMAGE pieces; image markup inside
 * a code span is literal text.
 */
export function splitImages(kit: RegexKit, content: string): Piece[] | null {
  const code = [...kit.re(INLINE_CODE_RE).finditer(content)].map((m) => m.span());
  return splitInline(kit, content, IMAGE_RE, "image", code.length > 0 ? code : null);
}
