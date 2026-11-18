// Code blocks, kept opaque while the document tree is built (md2ui:
// pipeline/grouper_code_blocks.py).
//
// Headings, separators, links and values inside code are characters, not structure:
// fenced and genuine indented blocks are swapped for inert sentinels before
// grouping, and expanded into `code_block` leaves once grouping is done.
import { type IdMint, inheritGlue } from "./ids.ts";
import { GroupNode } from "./node.ts";
import { compile, type Match, type RegexKit, reEscape } from "./py/re.ts";
import { split, splitlines, strip, toInt } from "./py/str.ts";

/** md2ui: `CodeBlockSpec`. A block's source, its language and its raw Markdown. */
export interface CodeBlockSpec {
  readonly content: string;
  readonly language: string | null;
  readonly raw: string;
}

// md2ui: _SENTINEL_FMT
const sentinel = (cid: number): string => `⟦md2ui-code-${cid}⟧`;
// py: re.compile(
// py:     r"^(?P<indent>[ \t]*)"
// py:     r"(?:(?P<marker>[-+*]|\d+[.)])(?P<marker_space>[ \t]+))?"
// py:     r"(?P<fence>`{3,}|~{3,})(?P<info>[^\r\n]*)\r?\n?$"
// py: )
export const FENCE_OPEN_RE = compile(
  String.raw`^(?P<indent>[ \t]*)` +
    String.raw`(?:(?P<marker>[-+*]|\d+[.)])(?P<marker_space>[ \t]+))?` +
    String.raw`(?P<fence>\x60{3,}|~{3,})(?P<info>[^\r\n]*)\r?\n?$`,
);
// py: re.compile(
// py:     r"(?P<lead>\A|\n[ \t]*\n)"
// py:     r"(?P<code>(?:(?: {4}|\t)(?=[^\r\n]*\S)[^\r\n]*\r?\n?)+)"
// py: )
const INDENTED_CODE_RE = compile(
  String.raw`(?P<lead>\A|\n[ \t]*\n)` +
    String.raw`(?P<code>(?:(?: {4}|\t)(?=[^\r\n]*\S)[^\r\n]*\r?\n?)+)`,
);
// py: re.compile(r"^\s*(?:[-+*]|\d+[.)])\s+")
const LIST_MARKER_RE = compile(String.raw`^\s*(?:[-+*]|\d+[.)])\s+`);
// py: re.compile(r"<!--.*?(?:-->|\Z)", re.DOTALL)
const HTML_COMMENT_RE = compile(String.raw`<!--.*?(?:-->|\Z)`, { s: true });

// md2ui: _language. The lexer alias from a fence's info string.
function language(info: string): string | null {
  let value = strip(info) ? (split(strip(info), undefined, 1)[0] ?? "") : "";
  if (value.startsWith("{.") && value.endsWith("}")) value = value.slice(2, -1);
  return value.toLowerCase() || null;
}

// md2ui: _dedent_fence_line. At most the opening fence's continuation width removed.
function dedentFenceLine(line: string, width: number): string {
  let count = 0;
  while (count < width && count < line.length && (line[count] === " " || line[count] === "\t")) {
    count += 1;
  }
  return line.slice(count);
}

/**
 * The index of the line that closes the fence `fence` opened at line `start`, or
 * `lines.length` when none does.
 */
function fenceEnd(kit: RegexKit, lines: readonly string[], start: number, fence: string): number {
  // py: re.compile(rf"^[ \t]*{re.escape(fence[0])}{{{len(fence)},}}[ \t]*\r?\n?$")
  const closing = kit.re(
    compile(String.raw`^[ \t]*${reEscape(fence.slice(0, 1))}{${fence.length},}[ \t]*\r?\n?$`),
  );
  let end = start + 1;
  while (end < lines.length && closing.match(lines[end] as string) === null) end += 1;
  return end;
}

// md2ui: _extract_fences
function extractFences(kit: RegexKit, text: string, specs: CodeBlockSpec[]): string {
  const lines = splitlines(text, true);
  const out: string[] = [];
  let i = 0;
  let inComment = false;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (inComment) {
      out.push(line);
      inComment = !line.includes("-->");
      i += 1;
      continue;
    }
    if (line.includes("<!--") && !(split(line, "<!--", 1)[1] ?? "").includes("-->")) {
      out.push(line);
      inComment = true;
      i += 1;
      continue;
    }
    const opened = kit.re(FENCE_OPEN_RE).match(line);
    if (opened === null) {
      out.push(line);
      i += 1;
      continue;
    }
    const end = fenceEnd(kit, lines, i, opened.text("fence"));
    if (end === lines.length) {
      // An unclosed fence remains ordinary source.
      out.push(line);
      i += 1;
      continue;
    }
    const raw = lines.slice(i, end + 1).join("");
    let prefix = opened.text("indent");
    const marker = opened.group("marker");
    if (marker !== undefined) prefix += marker + opened.text("marker_space");
    const body = lines
      .slice(i + 1, end)
      .map((l) => dedentFenceLine(l, prefix.length))
      .join("");
    const cid = specs.length;
    specs.push({ content: body, language: language(opened.text("info")), raw });
    const newline = raw.endsWith("\n") || raw.endsWith("\r") ? "\n" : "";
    out.push(`${prefix}${sentinel(cid)}${newline}`);
    i = end + 1;
  }
  return out.join("");
}

// md2ui: _indented_sub. A genuine indented block, unless it continues a list item.
function indentedSub(
  kit: RegexKit,
  m: Match,
  specs: CodeBlockSpec[],
  commentSpans: readonly (readonly [number, number])[],
): string {
  if (commentSpans.some(([start, end]) => start < m.end() && m.start() < end)) return m.text();
  // The lines before the block, nearest first, read in place: a document of many
  // indented blocks would otherwise copy and split everything before each one.
  const before = m.string;
  let end = m.start();
  for (;;) {
    const start = end > 0 ? before.lastIndexOf("\n", end - 1) + 1 : 0;
    const line = before.slice(start, end);
    if (strip(line) && !line.startsWith(" ") && !line.startsWith("\t")) {
      if (kit.re(LIST_MARKER_RE).match(line) !== null) return m.text();
      break;
    }
    if (start === 0) break;
    end = start - 1;
  }
  const rawCode = m.text("code");
  const content = splitlines(rawCode, true)
    .map((line) => (line.startsWith("\t") ? line.slice(1) : line.slice(4)))
    .join("");
  const cid = specs.length;
  specs.push({ content, language: null, raw: rawCode });
  return `${m.text("lead")}${sentinel(cid)}\n`;
}

/**
 * md2ui: `extract_code_blocks`. The text with each supported code block replaced by
 * a sentinel, and the blocks' specs, indexed by sentinel id.
 */
export function extractCodeBlocks(kit: RegexKit, text: string): [string, CodeBlockSpec[]] {
  const specs: CodeBlockSpec[] = [];
  const fenced = extractFences(kit, text, specs);
  const commentSpans = [...kit.re(HTML_COMMENT_RE).finditer(fenced)].map((m) => m.span());
  const out = kit.re(INDENTED_CODE_RE).sub((m) => indentedSub(kit, m, specs, commentSpans), fenced);
  return [out, specs];
}

// py: re.compile(r"⟦md2ui-code-(\d+)⟧")
const SENTINEL_RE = compile(String.raw`⟦md2ui-code-(\d+)⟧`);
// md2ui: _SENTINEL_MARK
const SENTINEL_MARK = "⟦md2ui-code-";

// md2ui: _expand_in. The sentinels in one node's content become code-block leaves.
function expandIn(
  kit: RegexKit,
  node: GroupNode,
  specs: readonly CodeBlockSpec[],
  ids: IdMint,
): void {
  const whole = kit.re(SENTINEL_RE).fullmatch(strip(node.content));
  if (whole !== null) {
    const spec = specs[toInt(whole.text(1))];
    if (spec === undefined) return;
    if (node.type === "list_item" || node.type === "ordered_item") {
      const code = new GroupNode(spec.content, "code_block");
      code.code_language = spec.language;
      inheritGlue(node, [code], ids);
      node.content = "";
      node.children.unshift(code);
      return;
    }
    node.type = "code_block";
    node.content = spec.content;
    node.code_language = spec.language;
    return;
  }
  const pieces = kit.re(SENTINEL_RE).split(node.content);
  if (pieces.length === 1) return;
  const children: GroupNode[] = [];
  pieces.forEach((raw, index) => {
    const piece = raw ?? "";
    if (index % 2 === 0) {
      if (strip(piece)) children.push(new GroupNode(strip(piece), "text"));
      return;
    }
    const spec = specs[toInt(piece)];
    if (spec === undefined) {
      children.push(new GroupNode(piece, "text"));
      return;
    }
    const code = new GroupNode(spec.content, "code_block");
    code.code_language = spec.language;
    children.push(code);
  });
  inheritGlue(node, children, ids);
  if (node.type === "text") node.type = "group";
  node.content = "";
  node.children = [...children, ...node.children];
}

/** md2ui: `expand_code_blocks` (Phase 6.08). Every code sentinel becomes an opaque code-block leaf. */
export function expandCodeBlocks(
  kit: RegexKit,
  node: GroupNode,
  specs: readonly CodeBlockSpec[],
  ids: IdMint,
): void {
  for (const child of [...node.children]) expandCodeBlocks(kit, child, specs, ids);
  if (node.content.includes(SENTINEL_MARK)) expandIn(kit, node, specs, ids);
}

/** md2ui: `restore_code_blocks`. A sentinel that survived expansion becomes its Markdown again. */
export function restoreCodeBlocks(
  kit: RegexKit,
  node: GroupNode,
  specs: readonly CodeBlockSpec[],
): void {
  if (node.content.includes(SENTINEL_MARK)) {
    node.content = kit
      .re(SENTINEL_RE)
      .sub((m) => specs[toInt(m.text(1))]?.raw ?? m.text(), node.content);
  }
  for (const child of node.children) restoreCodeBlocks(kit, child, specs);
}

/** A streamed message's closed part, and where the next scan of a longer text may start. */
export interface ClosedPrefix {
  readonly prefix: string;
  /**
   * The start of a line, outside any fence, whose blank line is complete: any text that
   * extends this one is cut there or later, so scanning it can begin here.
   */
  readonly resume: number;
}

/**
 * The part of a streamed message whose blocks are complete (C6 `streaming`; TS-first,
 * md2ui has no stream): the text up to its last blank line outside a code fence, fences
 * read as the grouper reads them. What follows is the block still arriving, held back
 * until a blank line closes it or the message ends; an unclosed fence holds back
 * everything from its opening line.
 *
 * `from` is 0, or the `resume` this returned for a text that `text` extends: a stream
 * scans each delta from its last cut, not the whole message again.
 */
export function closedPrefix(kit: RegexKit, text: string, from = 0): ClosedPrefix {
  const lines = splitlines(text.slice(from), true);
  let cut = 0;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    const opened = kit.re(FENCE_OPEN_RE).match(line);
    if (opened !== null) {
      i = fenceEnd(kit, lines, i, opened.text("fence"));
      if (i === lines.length) break;
    } else if (!strip(line)) {
      cut = i;
    }
  }
  const at = from + lines.slice(0, cut).join("").length;
  // The cut line is blank; while it is the last line and unterminated, the next delta
  // may write on it, so the scan resumes there only once a line break ends it.
  const cutLine = lines[cut] ?? "";
  const ended = cut < lines.length - 1 || splitlines(cutLine)[0] !== cutLine;
  return { prefix: text.slice(0, at), resume: cut > 0 && ended ? at : from };
}
