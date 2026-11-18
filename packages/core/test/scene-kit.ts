// The whole pipeline in Node for display-list tests: Markdown and THEME.md text through
// grouping, layout, placement and paint, measured by the deterministic fake measurer.
import type { GroupingNode, ResolvedTheme, TextMeasurer } from "@md2ui/contracts";
import { groupMarkdown } from "../src/group/grouper.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { bakeLayout } from "../src/layout/bakes.ts";
import { generate } from "../src/layout/generate.ts";
import { layoutInput } from "../src/layout/input.ts";
import type { LayoutNode } from "../src/layout/node.ts";
import { effectiveWidth } from "../src/layout/width.ts";
import type { Sizer } from "../src/measure/sizer.ts";
import { documentSizer, sizingMeasurer } from "../src/measure/sizing.ts";
import type { Scene } from "../src/scene/boxes.ts";
import { type PaintedScene, paintScene } from "../src/scene/display-list.ts";
import type { CodeHighlighter } from "../src/scene/draw/context.ts";
import { placeScene } from "../src/scene/scene.ts";
import { createFakeMeasurer } from "../src/text/fake-measurer.ts";
import { parseTheme } from "../src/theme/parse.ts";

/** The emoji family a font path loads as: the path itself, or `emoji` for the default. */
const emojiFamily = (path: string | null): string => path ?? "emoji";

export interface Painted {
  readonly theme: ResolvedTheme;
  readonly grouping: GroupingNode;
  readonly sizer: Sizer;
  /** The baked layout the scene was placed from. */
  readonly layout: LayoutNode;
  readonly scene: Scene;
  readonly painted: PaintedScene;
}

/** `markdown` under `themeText`, laid out and placed at `width` and painted. */
export function paintMarkdown(
  markdown: string,
  themeText = "",
  width = 800,
  options: { readonly text?: TextMeasurer; readonly highlight?: CodeHighlighter | null } = {},
): Painted {
  return paintGrouping(groupMarkdown(markdown, new RegexKit()), themeText, width, options);
}

/** A grouping (md2ui's own, for a test that must not depend on this port's grouper), as `paintMarkdown`. */
export function paintGrouping(
  grouping: GroupingNode,
  themeText = "",
  width = 800,
  options: { readonly text?: TextMeasurer; readonly highlight?: CodeHighlighter | null } = {},
): Painted {
  const kit = new RegexKit();
  const theme = parseTheme(themeText);
  const text = options.text ?? createFakeMeasurer();
  const input = layoutInput(kit, grouping);
  const measurer = sizingMeasurer(input, theme, text, { emojiFamily });
  const at = effectiveWidth(input, theme, measurer, width);
  const layout = generate(input, at, theme, measurer);
  bakeLayout(layout, theme);
  const sizer = documentSizer(input, theme, text, { emojiFamily });
  const scene = placeScene(sizer, layout, grouping, at);
  const painted = paintScene(sizer, scene, grouping, options.highlight ?? null);
  return { theme, grouping, sizer, layout, scene, painted };
}
