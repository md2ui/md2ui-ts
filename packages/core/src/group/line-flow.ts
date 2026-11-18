// How one source line's pieces flow (md2ui: pipeline/grouper_line_flow.py).
import { markRowPieces, rowFlows } from "./column-rows.ts";
import { clearFalseGlue } from "./glue.ts";
import { type GroupNode, HEADING_TYPE_RE } from "./node.ts";
import { compile, type RegexKit } from "./py/re.ts";
import { rstrip } from "./py/str.ts";

/** A line's authored vertical alignment, as `line_valign` carries it. */
type LineValign = "top" | "center" | "baseline" | "bottom";

// md2ui: _LINE_VALIGN
const LINE_VALIGN: Readonly<Record<string, LineValign>> = Object.freeze({
  "@tp": "top",
  "@ct": "center",
  "@bs": "baseline",
  "@bm": "bottom",
});
// The token stands alone at the end of the line; `\@ct` keeps its backslash here,
// which is what declines it.
// py: re.compile(r"(?<!\S)(@tp|@ct|@bs|@bm)[ \t]*$")
const LINE_VALIGN_RE = compile(String.raw`(?<!\S)(@tp|@ct|@bs|@bm)[ \t]*$`);

/**
 * md2ui: `consume_line_valigns`. Strips every end-of-line valign token and returns
 * the value by `source_line_id`, the identity that outlives the line's splits.
 */
export function consumeLineValigns(kit: RegexKit, node: GroupNode): Map<number, LineValign> {
  const found = new Map<number, LineValign>();
  const walk = (kit: RegexKit, n: GroupNode): void => {
    if (n.content) {
      const m = kit.re(LINE_VALIGN_RE).search(n.content);
      if (m !== null) {
        n.content = rstrip(n.content.slice(0, m.start()));
        const value = LINE_VALIGN[m.text(1)];
        if (n.source_line_id !== null && value !== undefined) found.set(n.source_line_id, value);
      }
    }
    for (const child of n.children) walk(kit, child);
  };
  walk(kit, node);
  return found;
}

// md2ui: _NO_FLOW_CONTAINER_TYPES. A pair stacks its value; an image card stacks its body.
const NO_FLOW_CONTAINER_TYPES: readonly string[] = Object.freeze(["key-value", "image_card"]);

/**
 * md2ui: `line_stacks`. Whether a node STACKS its children rather than laying them
 * along the line: a titled heading section, a pair, an image card, a date chip, a
 * colon column. An empty heading marker is a grouping device and never vetoes flow.
 */
function lineStacks(kit: RegexKit, node: GroupNode): boolean {
  const titledSection = node.children.some((c) => kit.re(HEADING_TYPE_RE).match(c.type) !== null);
  return (
    (node.heading_group && kit.re(HEADING_TYPE_RE).match(node.type) === null && titledSection) ||
    NO_FLOW_CONTAINER_TYPES.includes(node.type) ||
    node.datapoint_display === "date_chip" ||
    node.column_split_group
  );
}

/**
 * md2ui: `_derive_line_split_groups` (Phase 6.1). Post-order: a container whose 2+
 * content children are the pieces of ONE source line flows them (`line_split_group`),
 * unless it stacks or they are all containers; its effective line id is stored back.
 * Glue is cleared where the line flows, and the line's authored valign applied.
 */
export function deriveLineSplitGroups(
  kit: RegexKit,
  node: GroupNode,
  valigns: ReadonlyMap<number, LineValign>,
): number | null {
  if (node.children.length === 0) return node.source_line_id;
  if (node.column_row_group && rowFlows(node)) markRowPieces(node);
  const childIds = node.children.map((c) => deriveLineSplitGroups(kit, c, valigns));
  const real = childIds.filter((id): id is number => id !== null);
  const shared = real.length > 0 && new Set(real).size === 1 ? (real[0] as number) : null;
  const kids = node.children;
  // A colon column or a spring region is a piece of this line, not a card in a run.
  const allContainers =
    kids.every((c) => c.children.length > 0) &&
    !kids.some((c) => c.column_split_group || c.authored_align);
  node.source_line_id = shared;
  const sameLine = shared !== null && real.length >= 2;
  const stacks = lineStacks(kit, node);
  node.line_split_group = sameLine && !stacks && !allContainers;
  clearFalseGlue(kit, node, sameLine && !stacks);
  const valign = shared === null ? undefined : valigns.get(shared);
  if (sameLine && !stacks && valign !== undefined) node.line_valign = valign;
  return shared;
}
