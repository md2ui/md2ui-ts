// The icon aside a theme level asks for with `Emoji aside` (yes/no): md2ui's
// `_theme_icon_aside`, `_icon_aside_candidate`, `_decide_group_icon_aside`,
// `_aside_cell_width`, `_aside_min_width`, `_aside_fits` and `_build_icon_aside`. An
// image goes beside text through a `:::` row, never an aside. A run's poll on the aside
// is `run-poll.ts`.
import type { GroupNode } from "../group/node.ts";
import { resolveSectionStyle } from "../theme/query.ts";
import { makeLeaf } from "./leaves.ts";
import { asideSplit } from "./marker-wrap.ts";
import { type LayoutNode, layoutNode } from "./node.ts";
import { colGap, measuredMinWidth, minWidth } from "./node-units.ts";
import type { Run } from "./run.ts";

/**
 * md2ui `_icon_aside_candidate`: `node` holds two or more children, not as one line,
 * with a lone (`alone`) emoji first or last.
 */
export function iconAsideCandidate(node: GroupNode): boolean {
  const kids = node.children;
  if (kids.length < 2 || node.line_split_group) return false;
  return [kids[0], kids[kids.length - 1]].some(
    (c) => c !== undefined && c.type === "emoji" && c.emoji_kind === "alone",
  );
}

/**
 * md2ui `_theme_icon_aside`: the level that owns `node` (or `### Elements` outside every
 * section) sets `Emoji aside`, and `node` is a candidate.
 */
export function themeAsksIconAside(run: Run, node: GroupNode, ownerLevel: number): boolean {
  const st = ownerLevel
    ? resolveSectionStyle(run.theme, ownerLevel, node.section_style_key)
    : run.theme.elements;
  if (st === undefined || !st.emoji_aside) return false;
  return iconAsideCandidate(node);
}

/**
 * md2ui `_aside_cell_width`: an emoji icon's measured badge (the theme's icon size when
 * it measures 0); anything else its min width.
 */
function asideCellWidth(run: Run, child: GroupNode): number {
  if (child.type !== "emoji") return minWidth(child, run.minWidths);
  const measured = measuredMinWidth(child, run.minWidths);
  return measured || run.theme.emojis.primary.icon_size;
}

/** md2ui `_aside_min_width`: the aside cell, the widest rest child and the gap between. */
export function asideMinWidth(
  run: Run,
  aside: GroupNode,
  children: readonly GroupNode[],
  ownerLevel: number,
): number {
  let restMin = 0;
  let first = true;
  for (const c of children) {
    if (c === aside) continue;
    const w = minWidth(c, run.minWidths);
    if (first || w > restMin) restMin = w;
    first = false;
  }
  return (
    asideCellWidth(run, aside) +
    restMin +
    colGap(run.kit, aside, run.theme, ownerLevel, run.spacerScope[1])
  );
}

/**
 * md2ui `_build_icon_aside`: the icon in a fixed gutter on the side it was written on,
 * beside the rest (one child, or a col of them).
 */
function buildIconAside(
  run: Run,
  node: GroupNode,
  width: number,
  inGlued: boolean,
  ownerLevel: number,
): LayoutNode {
  const kids = node.children;
  const head = kids[0] as GroupNode;
  const leading = head.type === "emoji" && head.emoji_kind === "alone";
  const icon = leading ? head : (kids[kids.length - 1] as GroupNode);
  const rest = leading ? kids.slice(1) : kids.slice(0, -1);
  const [ratios, iconWidth, restWidth] = asideSplit(
    asideCellWidth(run, icon),
    width,
    colGap(run.kit, icon, run.theme, ownerLevel, run.spacerScope[1]),
  );
  const iconCell = makeLeaf(run, icon, iconWidth);
  iconCell.render_properties = { ...iconCell.render_properties, aside_fixed: true };
  let restCell: LayoutNode;
  if (rest.length === 1) {
    restCell = run.renderChild(run, rest[0] as GroupNode, restWidth, inGlued, ownerLevel);
  } else {
    const built = rest.map((c) => run.renderChild(run, c, restWidth, inGlued, ownerLevel));
    restCell = layoutNode(
      "col",
      built.map(() => 1),
      built,
    );
  }
  return leading
    ? layoutNode("row", ratios, [iconCell, restCell])
    : layoutNode("row", [...ratios].reverse(), [restCell, iconCell]);
}

/**
 * The aside half of md2ui `_decide_group_icon_aside`: the aside when `node` is a
 * candidate and it fits at min widths, else `null` (the rules decide).
 */
export function iconAside(
  run: Run,
  node: GroupNode,
  width: number,
  inGlued: boolean,
  ownerLevel: number,
): LayoutNode | null {
  if (!iconAsideCandidate(node)) return null;
  const kids = node.children;
  const head = kids[0] as GroupNode;
  const icon =
    head.type === "emoji" && head.emoji_kind === "alone"
      ? head
      : (kids[kids.length - 1] as GroupNode);
  if (asideMinWidth(run, icon, kids, ownerLevel) > width) return null;
  return buildIconAside(run, node, width, inGlued, ownerLevel);
}
