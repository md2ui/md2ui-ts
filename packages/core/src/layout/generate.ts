// The generator's entry: md2ui's `LayoutGenerator.generate`, with `_setup_bento` and the
// per-call state it resets (here: the run context, `run.ts`). md2ui's `bento_override`
// and `pack_unique_override` (the window's toggles) are not ported; `bento_auto`, the `Layout: Auto` choice, is the `tiles` argument; and
// `_block_w_cache` lives for one call rather than across them: a layout depends only on
// its input, its theme, its width and that choice.
import type { ResolvedTheme } from "@md2ui/contracts";
import type { GroupNode } from "../group/node.ts";
import { RegexKit } from "../group/py/re.ts";
import { decideGroup, renderChild } from "./decide.ts";
import { buildKindMaps } from "./grid-fit.ts";
import { type LayoutInput, leafInputs } from "./input.ts";
import type { KvRole, LayoutMeasurer } from "./measurer.ts";
import { type LayoutNode, layoutNode } from "./node.ts";
import { autoBentoLevel, kvRoleMap } from "./node-units.ts";
import type { Run } from "./run.ts";
import { foldRowSpacers } from "./spacers.ts";
import { fillContainerLevels } from "./units.ts";
import { collectUrlProps, hasCardParams, imageFloors } from "./url-hints.ts";

/**
 * md2ui `_setup_bento`: the heading level a theme's bento tiles (its own `Heading
 * level`, else the shallowest level with a long enough run), or `null` when bento is
 * off or nothing qualifies. `Layout: Auto` tiles where `tiles` says so (md2ui
 * `bento_requested`).
 */
function bentoLevel(root: GroupNode, theme: ResolvedTheme, tiles: boolean): number | null {
  const { layout } = theme.root;
  if (layout !== "bento" && !(layout === "auto" && tiles)) return null;
  return tiledLevel(root, theme);
}

/** The level bento would tile in `root`, whatever `Layout:` asks: md2ui `_setup_bento`'s. */
export function tiledLevel(root: GroupNode, theme: ResolvedTheme): number | null {
  return theme.bento.heading_level ?? autoBentoLevel(root);
}

/**
 * md2ui `LayoutGenerator.generate`: the layout of `input` at `width` (generate at
 * `effectiveWidth`). A `layout` root whose ratios are `[width, 0]`. Under `Layout: Auto`,
 * `tiles` is the choice for the width's band (`AutoLayout`); any other `Layout:` ignores it.
 */
export function generate(
  input: LayoutInput,
  width: number,
  theme: ResolvedTheme,
  measurer: LayoutMeasurer,
  tiles = false,
): LayoutNode {
  const { root } = input;
  const kit = new RegexKit();
  const urlProps = collectUrlProps(kit, root);
  // Each image's `min_width` floor is what the min-width measurer reports for it, so
  // every fit test, the kind maps' included, counts it (md2ui `with_image_floors`).
  const floors = imageFloors(urlProps);
  const leafMin = (node: GroupNode, role: KvRole | null): number | null => {
    const floor = node.type === "image" ? floors.get(node) : undefined;
    return floor ?? measurer.leafMinWidth(leafInputs(input, node), role);
  };
  const kvRoles = kvRoleMap(root, theme);
  const minWidths = { theme, leafMin, cache: new Map<GroupNode, number>(), kvRoles };
  const run: Run = {
    input,
    theme,
    measurer,
    kit,
    kvRoles,
    urlProps,
    imageFloors: floors,
    minWidths,
    // The kind maps count the image floors too, so a grid of floored images picks its
    // columns from the floors.
    kinds: buildKindMaps(root, minWidths),
    markerProps: new Map(),
    themeAsides: [
      ...Object.values(theme.sections),
      ...Object.values(theme.fixed_sections),
      theme.elements,
    ].some((st) => st?.emoji_aside),
    bentoLevel: bentoLevel(root, theme, tiles),
    packUnique: theme.root.pack_unique,
    topHeadingLevel: root.top_heading_level,
    markerSuppressed: false,
    spacerScope: [0, null, false],
    spacersBuilt: false,
    flowSeq: 0,
    fitPolls: [],
    pinned: new Set(),
    pinnedRender: new Map(),
    cardUrls: hasCardParams(kit, root),
    pinnedCard: new Map(),
    cellHeights: new Map(),
    blockWidths: new Map(),
    columnStacks: new Map(),
    stackIds: new Set(),
    decideGroup,
    renderChild,
  };
  if (root.children.length === 0) return layoutNode("layout", [width, 0], []);
  const built = decideGroup(run, root, width);
  fillContainerLevels(built);
  if (run.spacersBuilt) foldRowSpacers(built);
  return layoutNode("layout", [width, 0], [built]);
}
