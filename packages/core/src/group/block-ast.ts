// The heading-level block structure of a document or a card body (md2ui:
// markdown_grouper._build_block_ast and the passes it runs).
//
// Headings nest sections; thematic breaks become leaves of their own kind; a run of
// lines glued to a heading travels into its section. Multi-line text is left on the
// nodes for Phase 1's blank-line and newline splits to break up.
import {
  breakNodeType,
  gluedRules,
  gluedRuns,
  PARTITION_TYPES,
  scopeItemDividers,
  stampColumnDivider,
} from "./block-splits.ts";
import { buildColumnRows, buildVerticalSprings } from "./column-rows.ts";
import type { IdMint } from "./ids.ts";
import { GroupNode, type NodeType } from "./node.ts";
import { compile, type RegexKit } from "./py/re.ts";
import { lstrip, rstrip, strip } from "./py/str.ts";

/** md2ui: `MarkdownGrouper.HEADING_PATTERN`. */
// py: re.compile(r"^(#{1,6})\s")
export const HEADING_PATTERN = compile(String.raw`^(#{1,6})\s`);
// py: re.compile(r"(?:^|\s)\{#([^{}\s]+)\}\s*$")
const HEADING_ID_PATTERN = compile(String.raw`(?:^|\s)\{#([^{}\s]+)\}\s*$`);
// py: re.compile(r"^([a-z0-9]+(?:-[a-z0-9]+)*)-([1-9][0-9]*)$")
const FIXED_STYLE_ID_PATTERN = compile("^([a-z0-9]+(?:-[a-z0-9]+)*)-([1-9][0-9]*)$");

/**
 * md2ui: `_segment_lines_with_hrs`. Ordered TEXT / BREAK children from
 * `lines[start:end]`: each run of non-break lines one TEXT node, stamped with its first
 * line's glued segment id, and each break line a leaf of its kind.
 */
function segmentLinesWithHrs(
  kit: RegexKit,
  lines: readonly string[],
  hrLines: ReadonlySet<number>,
  start: number,
  end: number,
  lineSegId: readonly (number | null)[],
): GroupNode[] {
  const out: GroupNode[] = [];
  const buf: string[] = [];
  let firstIdx: number | null = null;

  const flush = (): void => {
    const text = strip(buf.join("\n"));
    if (text) {
      const node = new GroupNode(text, "text");
      if (firstIdx !== null) node.glued_content_id = lineSegId[firstIdx] ?? null;
      out.push(node);
    }
    buf.length = 0;
    firstIdx = null;
  };

  for (let i = start; i < end; i += 1) {
    const line = lines[i] as string;
    const kind = hrLines.has(i) ? breakNodeType(kit, line) : null;
    if (kind !== null) {
      flush();
      const brk = new GroupNode(strip(line), kind);
      // `:::2`: the share the cell ABOVE this divider takes, read while the line exists.
      if (kind === "column_divider") stampColumnDivider(kit, brk, line);
      out.push(brk);
    } else {
      if (firstIdx === null && strip(line)) firstIdx = i;
      buf.push(line);
    }
  }
  flush();
  return out;
}

/**
 * md2ui: `_apply_section_stops`. Closes every heading section at its `***` and lifts
 * the tail out as the section's next siblings. A node closes its children's sections,
 * never its own, so a stop directly under a section is consumed one level up.
 */
function applySectionStops(node: GroupNode): void {
  const out: GroupNode[] = [];
  for (const child of node.children) {
    applySectionStops(child);
    out.push(child);
    if (!child.heading_group) continue;
    const i = child.children.findIndex((g) => g.type === "section_stop");
    if (i >= 0) {
      out.push(...child.children.slice(i + 1));
      child.children.splice(i); // drops the stop with the tail
    }
  }
  // A heading section leaves a stop of its own for the parent to consume.
  node.children = node.heading_group ? out : out.filter((c) => c.type !== "section_stop");
}

/**
 * md2ui: `_lift_trailing_content_breaks`. Moves a `___` that ends a heading section
 * out as its next sibling, so the break can separate that section from the next.
 */
function liftTrailingContentBreaks(node: GroupNode): void {
  for (const child of node.children) liftTrailingContentBreaks(child);
  const out: GroupNode[] = [];
  for (const child of node.children) {
    out.push(child);
    while (child.heading_group && child.children.at(-1)?.type === "content_break") {
      out.push(child.children.pop() as GroupNode);
    }
  }
  node.children = out;
}

/**
 * md2ui: `_build_block_ast`. A heading-level tree for `text`, a document or a card
 * body. Glued segment ids come from `ids`, so they stay unique across the document.
 */
export function buildBlockAst(kit: RegexKit, text: string, ids: IdMint): GroupNode {
  const root = new GroupNode("", "root");
  if (!strip(text)) return root;

  const lines = scopeItemDividers(kit, text.split("\n"));

  // Headings and break lines. Every break cuts the document the same way; what it
  // leaves behind is decided by re-testing the line.
  const headings: [number, number, string][] = [];
  const hrLines = new Set<number>();
  lines.forEach((line, i) => {
    if (breakNodeType(kit, line) !== null) {
      hrLines.add(i);
      return;
    }
    const m = kit.re(HEADING_PATTERN).match(line);
    if (m !== null) headings.push([i, m.text(1).length, line]);
  });
  // A `---` tight inside a run of lines divides that block rather than cutting it: it
  // stays a line of its text, minted by `splitNewlines`.
  for (const i of gluedRules(kit, lines, hrLines, new Set(headings.map(([ln]) => ln)))) {
    hrLines.delete(i);
  }

  // Each glued run (two or more lines, `gluedRuns`) shares one segment id; a lone
  // line is not glued.
  const lineSegId: (number | null)[] = lines.map(() => null);
  for (const run of gluedRuns(kit, lines, hrLines)) {
    const gid = ids.nextGlued();
    for (const k of run) lineSegId[k] = gid;
  }

  if (headings.length === 0) {
    if (hrLines.size > 0) {
      root.children = segmentLinesWithHrs(kit, lines, hrLines, 0, lines.length, lineSegId);
      // No section for a `***` to close, and no heading for a `:::` to lift out of.
      applySectionStops(root);
      buildColumnRows(kit, root);
      buildVerticalSprings(root);
    } else {
      root.content = strip(lines.join("\n"));
    }
    return root;
  }

  // A run sitting directly against a heading (bounded above by a blank line, a break
  // or the document start) is absorbed into that heading's group. The partition
  // breaks, `:::` and `...`, are transparent to the peel.
  const headingLines = new Set(headings.map(([ln]) => ln));
  const peelStart = (lineNum: number): number => {
    let runStart = lineNum;
    let j = lineNum - 1;
    while (j >= 0 && strip(lines[j] as string) && !headingLines.has(j)) {
      const kind = breakNodeType(kit, lines[j] as string);
      if (hrLines.has(j) && !(kind !== null && PARTITION_TYPES.includes(kind))) break;
      runStart = j;
      j -= 1;
    }
    if (j >= 0 && headingLines.has(j)) return lineNum;
    return runStart;
  };
  const peelStarts = headings.map(([ln]) => peelStart(ln));

  // The preamble before the first heading (less any run that heading absorbs).
  root.children.push(
    ...segmentLinesWithHrs(kit, lines, hrLines, 0, peelStarts[0] as number, lineSegId),
  );

  const stack: [GroupNode, number][] = [[root, 0]];
  headings.forEach(([lineNum, level, headingText], idx) => {
    // The body ends where the next heading's absorbed run begins.
    const contentEnd = peelStarts[idx + 1] ?? lines.length;

    const group = new GroupNode("", "group");
    group.heading_group = true;
    group.heading_level = level;

    // The absorbed leading run (an image glued above the heading, say).
    group.children.push(
      ...segmentLinesWithHrs(kit, lines, hrLines, peelStarts[idx] as number, lineNum, lineSegId),
    );

    let visible = lstrip(headingText, "# ");
    let headingId: string | null = null;
    let fixedStyleKey: string | null = null;
    const attr = kit.re(HEADING_ID_PATTERN).search(visible);
    if (attr !== null) {
      headingId = attr.text(1);
      visible = rstrip(visible.slice(0, attr.start()));
      const style = kit.re(FIXED_STYLE_ID_PATTERN).fullmatch(headingId);
      if (style !== null) fixedStyleKey = style.text(1);
    }
    group.heading_id = headingId;
    group.fixed_style_key = fixedStyleKey;
    const heading = new GroupNode(visible, `heading${level}` as NodeType);
    heading.glued_content_id = lineSegId[lineNum] ?? null;
    group.children.push(heading);

    // The body, breaks in source position.
    group.children.push(
      ...segmentLinesWithHrs(kit, lines, hrLines, lineNum + 1, contentEnd, lineSegId),
    );

    for (let top = stack.at(-1); stack.length > 1 && (top?.[1] ?? 0) >= level; top = stack.at(-1)) {
      stack.pop();
    }
    stack.at(-1)?.[0].children.push(group);
    stack.push([group, level]);
  });

  applySectionStops(root);
  // After the stops, so a `:::` lifts through sections that are already final.
  buildColumnRows(kit, root);
  // After the rows, so a spring inside a `:::` cell partitions that cell.
  buildVerticalSprings(root);
  // Last, so it sees whatever shape the row build left behind.
  liftTrailingContentBreaks(root);
  return root;
}
