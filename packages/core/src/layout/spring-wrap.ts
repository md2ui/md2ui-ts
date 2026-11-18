// Where a spring line wraps, and how its pieces sit once it has (md2ui
// `generator_spring_wrap`, ADR-304). While a `...` line fits, every piece sits where it
// was written. Once it wraps, the end wraps first (in `A ... B ... C`, C takes a line of
// its own and A and B keep the first; when they cannot share it either, every piece
// takes its own line, in order), and a right piece alone on a later line starts at the
// left. A centred piece stays centred. Both follow the run's wrap votes, so a run's
// members wrap and realign alike.
import type { GroupNode } from "../group/node.ts";
import { type FitPoll, vote } from "./fit-votes.ts";
import type { LayoutNode } from "./node.ts";

/** md2ui `_edges_and_middle`: a spring line written `A ... B ... C`. */
function edgesAndMiddle(node: GroupNode): boolean {
  const aligns = node.children.map((c) => c.authored_align);
  return (
    node.align_group &&
    aligns.length >= 3 &&
    aligns[0] === "left" &&
    aligns[aligns.length - 1] === "right" &&
    aligns.slice(1, -1).every((a) => a === "center")
  );
}

/** A line flowed again from `cells` in that order, breaking before each of `breaks`. */
export type Reflow = (
  cells: GroupNode[],
  breaks: ReadonlySet<GroupNode>,
) => { rows: LayoutNode[]; lines: GroupNode[][] };

/**
 * md2ui `rewrap`: `rows` and `lines` once `node`'s line has wrapped, as the rules above
 * place them. Whether the middle of `A ... B ... C` left the first line is one more vote
 * in the run, so a run's members take one line each together or not at all.
 */
export function rewrap(
  polls: readonly FitPoll[],
  node: GroupNode,
  rows: LayoutNode[],
  lines: GroupNode[][],
  reflow: Reflow,
): { rows: LayoutNode[]; lines: GroupNode[][] } {
  let out = { rows, lines };
  if (edgesAndMiddle(node) && lines.length > 1) {
    const kids = node.children;
    const middle = kids.slice(1, -1);
    const first = new Set(lines[0]);
    const apart = middle.some((m) => !first.has(m));
    const breaks = new Set<GroupNode>([kids[kids.length - 1] as GroupNode]);
    if (vote(polls, node, apart)) for (const m of middle) breaks.add(m);
    out = reflow([...kids], breaks);
  }
  leftWhenAlone(out.rows, out.lines);
  return out;
}

/** md2ui `left_when_alone`: a right piece that wrapped onto a line of its own starts at the left. */
export function leftWhenAlone(rows: readonly LayoutNode[], lines: readonly unknown[][]): void {
  for (let i = 1; i < Math.min(rows.length, lines.length); i++) {
    const row = rows[i] as LayoutNode;
    const props = row.render_properties ?? {};
    if ((lines[i] as unknown[]).length === 1 && props["content_align"] === "right") {
      row.render_properties = { ...props, content_align: "left" };
    }
  }
}
