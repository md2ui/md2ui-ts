// What the chart tests share: a leaf kit under a THEME.md text, a
// leaf drawn straight into display-list entries on a chosen surface, and the layout the
// generator makes of a document, measured by the deterministic fake measurer.
import type { Argb, DisplayEntry, TextMeasurer } from "@md2ui/contracts";
import { groupMarkdown } from "../src/group/grouper.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { bakeLayout } from "../src/layout/bakes.ts";
import { generate } from "../src/layout/generate.ts";
import { layoutInput } from "../src/layout/input.ts";
import type { LayoutNode } from "../src/layout/node.ts";
import { effectiveWidth } from "../src/layout/width.ts";
import { type LeafKit, leafKit } from "../src/measure/leaf-kit.ts";
import { sizingMeasurer } from "../src/measure/sizing.ts";
import type { LayoutBox } from "../src/scene/boxes.ts";
import type { BoxDrawer, Draw } from "../src/scene/draw/context.ts";
import { pen } from "../src/scene/draw/pen.ts";
import { createFakeMeasurer } from "../src/text/fake-measurer.ts";
import { parseTheme } from "../src/theme/parse.ts";
import { paintMarkdown } from "./scene-kit.ts";

export const TEXT: TextMeasurer = createFakeMeasurer();

const emojiFamily = (path: string | null): string => path ?? "emoji";

/** The leaf kit a theme text (`## Charts` and the rest) measures with. */
export const kitFor = (themeText = ""): LeafKit =>
  leafKit(parseTheme(themeText), TEXT, emojiFamily);

/** The entries `draw` records for a leaf at `box`, which sits on the surface `box.bg_stack` names. */
export function drawBox(
  draw: BoxDrawer,
  themeText: string,
  properties: Record<string, unknown>,
  geometry: {
    readonly x?: number;
    readonly y?: number;
    readonly width: number;
    readonly height: number;
  },
  stack: readonly Argb[] = [],
): DisplayEntry[] {
  const { sizer } = paintMarkdown("# T\n", themeText);
  const d: Draw = {
    sizer,
    sized: sizer.index,
    nodes: new Map(),
    pins: new Map(),
    highlight: null,
    choices: new Map(),
    segments: new Map(),
  };
  const box: LayoutBox = {
    x: 0,
    y: 0,
    ...geometry,
    content_id: null,
    render_properties: properties,
    bg_stack: stack,
  };
  const out: DisplayEntry[] = [];
  draw(d, box, pen(out, "", sizer.leaves.text));
  return out;
}

/** Every node of the layout the generator makes of `markdown` at `width`, root first. */
export function layoutNodes(markdown: string, themeText = "", width = 800): LayoutNode[] {
  const kit = new RegexKit();
  const theme = parseTheme(themeText);
  const input = layoutInput(kit, groupMarkdown(markdown, kit));
  const measurer = sizingMeasurer(input, theme, TEXT, { emojiFamily });
  const at = effectiveWidth(input, theme, measurer, width);
  const layout = generate(input, at, theme, measurer);
  bakeLayout(layout, theme);
  const walk = (n: LayoutNode): LayoutNode[] => [n, ...n.children.flatMap(walk)];
  return walk(layout);
}

/** The values of render hint `key` on every layout node that has one, in tree order. */
export const hintsOf = (nodes: readonly LayoutNode[], key: string): unknown[] =>
  nodes.flatMap((n) =>
    n.render_properties?.[key] === undefined ? [] : [n.render_properties[key]],
  );
