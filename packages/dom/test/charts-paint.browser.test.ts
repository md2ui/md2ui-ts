// md2ui's chart paint on a real canvas: small documents through the whole stack
// (the Pretext measurer, the core pipeline, the painter), read back as pixels. A loss on
// a bar fills from the track's right edge in `Negative color`; a line chart draws its
// line; a vertical chart cut by `### Chart Grid` draws its lines and tick labels; a code
// block on a dark panel takes the panel's replacement for its fill.
import type { DisplayList, FillEntry, Rect } from "@md2ui/contracts";
import {
  bakeLayout,
  documentSizer,
  effectiveWidth,
  generate,
  groupMarkdown,
  layoutInput,
  loadCodeHighlighter,
  paintScene,
  parseTheme,
  placeScene,
  RegexKit,
  sizingMeasurer,
} from "@md2ui/core";
import { createPainter } from "@md2ui/painter-canvas";
import { createPretextMeasurer } from "@md2ui/text-pretext";
import { expect, test } from "vitest";

const FONTS = `## Text Styles
Text
- Font Name: sans-serif
- Font size: 15
Heading1
- Font Name: sans-serif
- Font size: 26
Heading2
- Font Name: sans-serif
- Font size: 20
`;

const WIDTH = 600;

const emojiFamily = (path: string | null): string => path ?? "sans-serif";

/** The document painted on a canvas as wide as its layout. */
async function paint(markdown: string, themeText: string) {
  const kit = new RegexKit();
  const theme = parseTheme(`${FONTS}\n${themeText}`);
  const text = await createPretextMeasurer([]);
  const grouping = groupMarkdown(markdown, kit);
  const input = layoutInput(kit, grouping);
  const measurer = sizingMeasurer(input, theme, text, { emojiFamily });
  const at = effectiveWidth(input, theme, measurer, WIDTH);
  const layout = generate(input, at, theme, measurer);
  bakeLayout(layout, theme);
  const sizer = documentSizer(input, theme, text, { emojiFamily });
  const scene = placeScene(sizer, layout, grouping, at);
  const highlight = await loadCodeHighlighter(theme, ["python"]);
  const list: DisplayList = paintScene(sizer, scene, grouping, highlight).list;
  const width = Math.ceil(list.width + list.padding.left + list.padding.right);
  const height = Math.ceil(list.height + list.padding.top + list.padding.bottom);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx === null) throw new Error("no 2d context");
  createPainter(list).paint(ctx, {
    width,
    height,
    scrollX: 0,
    scrollY: 0,
    pixelRatio: 1,
    images: () => undefined,
    loading: () => undefined,
    offsets: new Map(),
  });
  const { data } = ctx.getImageData(0, 0, width, height);
  /** The `#rrggbb` at a point of the page (list coordinates). */
  const at2 = (x: number, y: number): string => {
    const i = (Math.round(y + list.padding.top) * width + Math.round(x + list.padding.left)) * 4;
    return `#${[data[i], data[i + 1], data[i + 2]].map((c) => (c ?? 0).toString(16).padStart(2, "0")).join("")}`;
  };
  /** How many pixels of the page are exactly `#rrggbb`. */
  const count = (hex: string): number => {
    let n = 0;
    for (let i = 0; i < data.length; i += 4) {
      const c = `#${[data[i], data[i + 1], data[i + 2]].map((v) => (v ?? 0).toString(16).padStart(2, "0")).join("")}`;
      if (c === hex) n++;
    }
    return n;
  };
  const fills = (color: string): Rect[] =>
    list.entries
      .filter((e): e is FillEntry => e.type === "fill")
      .filter((e) => e.paint.kind === "color" && e.paint.color.startsWith(color))
      .map((e) => e.bounds);
  return { color: at2, count, fills };
}

test("a loss fills from the track's right edge in Negative color", async () => {
  const page = await paint(
    "Revenue: 65%\n\nMargin: -40%\n",
    `## Datapoints
### Key Value Bars
Thickness: 10
Background color: #00CC58
Negative color: #E5484D
### Key Value Bar Track
Background color: #E5F9EE
`,
  );
  const tracks = page.fills("#e5f9ee");
  expect(tracks).toHaveLength(2);
  const loss = tracks[1] as Rect;
  const mid = loss.y + loss.height / 2;
  expect(page.color(loss.x + loss.width - 3, mid)).toBe("#e5484d");
  expect(page.color(loss.x + 3, mid)).toBe("#e5f9ee");
});

test("a line chart draws its line", async () => {
  const page = await paint(
    "SPY: $710 (Apr) → $713 → $720 → $737 (May) → $773 → $777 (Now)\n",
    `## Charts
### Line Chart
Height: 80
Line width: 4
Line color: #25845B
Point size: 0
`,
  );
  expect(page.count("#25845b")).toBeGreaterThan(400);
});

test("a vertical chart cut by Chart Grid draws its lines and tick labels", async () => {
  const theme = `## Charts
Bar thickness: 18
Background color: #00CC58
Negative color: #E5484D
### Chart Grid
Axis labels: yes
Ticks: 4
Horizontal lines: yes
Line color: #3366CC
Line width: 2
- Font size: 11
- Font color: #CC3366
`;
  const page = await paint(
    "# Monthly change\n\n- Jan: 4.2%\n- Feb: -1.8%\n- Mar: 2.6%\n- Apr: -3.1%\n- May: 0.9%\n- Jun: 5.4%\n",
    theme,
  );
  expect(page.count("#3366cc")).toBeGreaterThan(1000);
  expect(page.count("#e5484d")).toBeGreaterThan(100);
  // Tick labels: anti-aliased glyphs, so count anything near their colour.
  expect(page.count("#cc3366")).toBeGreaterThan(10);
});

test("a code block on a dark panel takes the panel's replacement for its fill", async () => {
  const page = await paint(
    "## Dark panel {#dark-1}\n\n```python\ndef total(items):\n    return 1\n```\n",
    `## Styling & Spacing
### Fixed styles
#### Dark
Background color: #18181B
Padding: 16

## Code Blocks
Background color: #E8F5E9
Padding: 12

## Color Replacements
On background color: #18181B
- Fill color: #E8F5E9, Replacement: #2F2F36
`,
  );
  expect(page.fills("#e8f5e9")).toEqual([]);
  const [block] = page.fills("#2f2f36");
  expect(block).toBeDefined();
  const b = block as Rect;
  expect(page.color(b.x + 4, b.y + b.height - 4)).toBe("#2f2f36");
});
