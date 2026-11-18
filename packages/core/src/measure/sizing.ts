// The layout generator's measurer composed from C3: every answer is
// md2ui's closure (`layout_render.make_*_measurer`) with the theme's faces, sizes and
// chrome, over text measured by C3. Built once per document and theme; prepared texts
// are kept for that one measurer, never across calls. Built subtrees are measured
// afresh at every question, since the generator edits them after asking.
import type { ResolvedTheme, TextMeasurer } from "@md2ui/contracts";
import type { LayoutInput } from "../layout/input.ts";
import type { LayoutMeasurer } from "../layout/measurer.ts";
import { blockWidth, layoutHeight } from "./block-width.ts";
import type { EmojiFamily } from "./font-set.ts";
import { leafHeights } from "./leaf-heights.ts";
import { leafKit } from "./leaf-kit.ts";
import { leafWidths } from "./leaf-widths.ts";
import { nodeIndex } from "./node-index.ts";
import type { Sizer } from "./sizer.ts";
import { subtreeSizer } from "./subtree.ts";

export interface SizingOptions {
  /**
   * The family the host loaded for an emoji font path: the theme's emoji font
   * (`emojis.font_path`; `null` is the default emoji font) and a per-context override
   * (`emojis.text.font_path`, `emojis.inline.font_path`).
   */
  readonly emojiFamily: EmojiFamily;
}

/** The sizer of one document and theme: what the generator's measurer and placement ask. */
export function documentSizer(
  input: LayoutInput,
  theme: ResolvedTheme,
  text: TextMeasurer,
  options: SizingOptions,
): Sizer {
  const leaves = leafKit(theme, text, options.emojiFamily);
  return subtreeSizer(theme, nodeIndex(input), leaves, leafWidths(leaves), leafHeights(leaves));
}

export function sizingMeasurer(
  input: LayoutInput,
  theme: ResolvedTheme,
  text: TextMeasurer,
  options: SizingOptions,
): LayoutMeasurer {
  const sizer = documentSizer(input, theme, text, options);
  const { widths } = sizer;
  return {
    leafMinWidth: widths.leafMinWidth,
    leafLineWidth: widths.leafLineWidth,
    markerWidth: widths.markerWidth,
    blockWidth: (built, available) => blockWidth(sizer, built, available),
    layoutHeight: (built, width) => layoutHeight(sizer, built, width),
  };
}
