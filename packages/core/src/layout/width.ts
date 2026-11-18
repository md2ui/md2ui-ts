// The width a layout is really built at: md2ui's `session.effective_width`, which hands
// `layout_render._content_width` the document's own floor
// (`generator_units.document_min_width`). md2ui's `VIEW.content_width_cap` is not
// ported: only the gold authoring mode set it. Neither is its module-level memo of the
// floor: a caller that generates one document at many widths may hold the floor itself.
import type { ResolvedTheme } from "@md2ui/contracts";
import type { GroupNode } from "../group/node.ts";
import { CONTENT_WIDTH_MIN } from "../theme/model.ts";
import { type LayoutInput, leafInputs } from "./input.ts";
import type { LayoutMeasurer } from "./measurer.ts";
import { kvRoleMap, measuredMinWidth } from "./node-units.ts";

/** md2ui `CONTENT_WIDTH_MAX`: the widest a layout grows when the theme names no `Max width`. */
const CONTENT_WIDTH_MAX = 1280;

/**
 * md2ui `document_min_width`: the narrowest width the document lays out at without
 * clipping (its widest pill, word or table; a stacking table counts as cards), in
 * content space.
 */
function documentMinWidth(
  input: LayoutInput,
  theme: ResolvedTheme,
  measurer: LayoutMeasurer,
): number {
  return measuredMinWidth(
    input.root,
    {
      theme,
      leafMin: (node: GroupNode, role) => measurer.leafMinWidth(leafInputs(input, node), role),
      cache: new Map(),
      kvRoles: kvRoleMap(input.root, theme),
    },
    true,
  );
}

/**
 * md2ui `session.effective_width`: the asked width clamped between the document's
 * floor (which wins, so the page scrolls instead of clipping) and the theme's
 * `Max width`, never under `CONTENT_WIDTH_MIN`. Generate at this width.
 */
export function effectiveWidth(
  input: LayoutInput,
  theme: ResolvedTheme,
  measurer: LayoutMeasurer,
  asked: number,
): number {
  const cap = theme.root.max_width || CONTENT_WIDTH_MAX;
  return Math.max(
    CONTENT_WIDTH_MIN,
    documentMinWidth(input, theme, measurer),
    Math.min(cap, asked),
  );
}
