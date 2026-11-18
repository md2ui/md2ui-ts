// The stand-in measurer and tree builders of the Stack-sections and bento tests. Their
// expected values were measured on md2ui by a scratch script
// outside both repositories, with this same measurer on md2ui's side:
//  - a word is 7 px a character, an emoji 24;
//  - a line is md2ui `tests/layout_flow_unique_tests.py`'s width for its block names
//    (`a` 100 … `wide` 900), else 7 px a character;
//  - a block asks for its widest leaf's line, or with `halfLine`, at most half the width
//    it was built at (so the ask depends on the width offered, as a real one does);
//  - a subtree is md2ui `tests/layout_bento_search_tests.py`'s `_measure`: distinct per
//    cell and width-sensitive, so the bento search has real trade-offs to make.
import type { GroupingNode } from "@md2ui/contracts";
import { stampLeafKinds } from "../src/group/annotate.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { generate } from "../src/layout/generate.ts";
import { type LayoutInput, layoutInput } from "../src/layout/input.ts";
import type { LayoutMeasurer } from "../src/layout/measurer.ts";
import type { LayoutNode } from "../src/layout/node.ts";
import { parseTheme } from "../src/theme/parse.ts";

export type Dict = Record<string, unknown> & { children?: Dict[] };

const BLOCKS: Readonly<Record<string, number>> = { a: 100, b: 200, c: 300, d: 400, wide: 900 };

const lineOf = (content: string): number => BLOCKS[content] ?? content.length * 7;

/** md2ui's tree-path ids (`0.1.2`), which its analyzer gives a hand-built tree. */
function withPaths(d: Dict, id = ""): GroupingNode {
  const children = (d.children ?? []).map((c, i) =>
    withPaths(c, id === "" ? `${i}` : `${id}.${i}`),
  );
  return { ...d, node_id: id, fingerprint_hash: null, children } as unknown as GroupingNode;
}

function contentsOf(node: GroupingNode, out = new Map<string, string>()): Map<string, string> {
  out.set(node.node_id, node.content);
  for (const c of node.children) contentsOf(c, out);
  return out;
}

function contentSum(n: LayoutNode): number {
  let total = 0;
  if (n.content_id) for (const ch of n.content_id) total += ch.codePointAt(0) as number;
  for (const c of n.children) total += contentSum(c);
  return total;
}

/** The stand-in measurer for one document, counting the block widths asked. */
function standIn(
  doc: GroupingNode,
  halfLine = false,
): { measurer: LayoutMeasurer; blockCalls: number[] } {
  const contents = contentsOf(doc);
  const blockCalls: number[] = [];
  const widest = (n: LayoutNode): number => {
    let w = n.type === "-" && n.content_id ? lineOf(contents.get(n.content_id) ?? "") : 0;
    for (const c of n.children) w = Math.max(w, widest(c));
    return w;
  };
  const measurer: LayoutMeasurer = {
    leafMinWidth: (node) => {
      if (node.type === "image") return null;
      if (node.type === "emoji") return 24;
      const words = node.content.split(/\s+/).filter((w) => w !== "");
      return Math.max(0, ...words.map((w) => w.length)) * 7;
    },
    leafLineWidth: (node) => (node.type === "image" ? null : lineOf(node.content)),
    markerWidth: (props) => (props["size"] as number) + 1.5,
    blockWidth: (built, available) => {
      blockCalls.push(available);
      return halfLine ? Math.min(widest(built), available / 2) : widest(built);
    },
    layoutHeight: (built, width) => 40 + (contentSum(built) % 7) * 23 + 9000 / Math.max(width, 1),
  };
  return { measurer, blockCalls };
}

/** The fields the expected values were written with. */
export function compact(n: LayoutNode): unknown[] {
  const out: unknown[] = [n.type];
  if (n.ratios.length > 0) out.push(n.ratios);
  if (n.content_id !== null) out.push(n.content_id);
  if (n.render_properties !== null && Object.keys(n.render_properties).length > 0) {
    out.push(n.render_properties);
  }
  const extra: Record<string, unknown> = {};
  for (const k of ["is_card", "grid", "spring", "line_split", "column_row", "bento"] as const) {
    if (n[k]) extra[k] = true;
  }
  if (n.grid_cols) extra["grid_cols"] = n.grid_cols;
  if (n.flow_run) extra["flow_run"] = n.flow_run;
  if (n.section_level !== null) extra["section_level"] = n.section_level;
  if (Object.keys(extra).length > 0) out.push(extra);
  if (n.children.length > 0) out.push(n.children.map(compact));
  return out;
}

/**
 * The generator's input for a hand-built tree, with the leaf-kind stamps the grouper's
 * Phase 6.26 gives a grouped one (md2ui's tests call `_stamp_leaf_kinds` the same way).
 */
function stampedInput(doc: GroupingNode): LayoutInput {
  const input = layoutInput(new RegexKit(), doc);
  stampLeafKinds(input.root);
  return input;
}

/** `doc` generated at `width` under `themeText` with the stand-in measurer. */
export function layoutOf(dict: Dict, width: number, themeText = "", halfLine = false): LayoutNode {
  const doc = withPaths(dict);
  const { measurer } = standIn(doc, halfLine);
  return generate(stampedInput(doc), width, parseTheme(themeText), measurer);
}

/** The prepared input and stand-in of `dict`, for a test that generates more than once. */
export function prepare(dict: Dict, halfLine = false) {
  const doc = withPaths(dict);
  return { input: stampedInput(doc), ...standIn(doc, halfLine) };
}
