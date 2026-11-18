// Editing a node's `content` after its data points were recorded (md2ui:
// pipeline/grouper_content_edits.py).
//
// A data point names a span of its node's content: `start` / `end`, and `matched`,
// the text of that span. Several passes rewrite content after detection (the tier
// wrapper comes off, the late escapes and a declined element's quotes are consumed,
// placeholder characters are spelled again), so there is ONE way to do it: describe
// the rewrite as edits and hand them to `editContent`, which keeps every data point
// true. A split, which hands pieces to new children, keeps its own home
// (`split-apply.partitionDataPoints`).
import type { GroupNode } from "./node.ts";
import type { Pattern, RegexKit } from "./py/re.ts";

/** md2ui `Edit`: replace `content[start:end]` with `text`. */
export type Edit = readonly [number, number, string];

// md2ui: _moved. Where offset `pos` of the old content lands in the edited one: an
// offset inside a replaced span lands at that span's replacement, at its start for a
// start and at its end for an end.
function moved(pos: number, edits: readonly Edit[], isEnd: boolean): number {
  let shift = 0;
  for (const [start, end, text] of edits) {
    if (pos <= start) break;
    if (pos >= end) {
      shift += text.length - (end - start);
      continue;
    }
    return start + shift + (isEnd ? text.length : 0);
  }
  return pos + shift;
}

/**
 * md2ui: `edit_content`. `edits` (non-overlapping spans of the current content, in
 * any order) applied to `node.content`, every data point rebased onto the new content
 * and its `matched` re-read; one whose whole span was removed is dropped.
 */
export function editContent(node: GroupNode, edits: Iterable<Edit>): void {
  const ordered = [...edits].sort(
    (a, b) => a[0] - b[0] || a[1] - b[1] || (a[2] < b[2] ? -1 : a[2] > b[2] ? 1 : 0),
  );
  if (ordered.length === 0) return;
  const old = node.content;
  let content = "";
  let prev = 0;
  for (const [start, end, text] of ordered) {
    content += old.slice(prev, start) + text;
    prev = end;
  }
  content += old.slice(prev);
  node.content = content;
  if (node.data_points.length === 0) return;
  node.data_points = node.data_points.flatMap((dp) => {
    const start = moved(dp.start, ordered, false);
    const end = moved(dp.end, ordered, true);
    return start < end ? [{ ...dp, start, end, matched: content.slice(start, end) }] : [];
  });
}

/**
 * md2ui: `keep_content`. `node.content` narrowed to `piece`, a substring of it found
 * where a split finds its piece: its first occurrence.
 */
export function keepContent(node: GroupNode, piece: string): void {
  const at = node.content.indexOf(piece);
  if (at < 0)
    throw new Error(`${JSON.stringify(piece)} is not part of ${JSON.stringify(node.content)}`);
  editContent(node, [
    [0, at, ""],
    [at + piece.length, node.content.length, ""],
  ]);
}

/**
 * md2ui: `regex_edits`. The edits `pattern.sub` would make: `repl` is a Python
 * template, or a table from each matched text to its replacement.
 */
export function regexEdits(
  kit: RegexKit,
  pattern: Pattern,
  repl: string | Readonly<Record<string, string>>,
  text: string,
): Edit[] {
  return [...kit.re(pattern).finditer(text)].map((m) => [
    m.start(),
    m.end(),
    typeof repl === "string" ? m.expand(repl) : (repl[m.text()] ?? ""),
  ]);
}
