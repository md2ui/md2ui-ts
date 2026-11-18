// "Ink stays inside bounds" (C4): real documents through the real stack (the Pretext
// measurer, the core pipeline, the canvas painter), each display-list entry painted alone, at
// two pixel ratios, on a canvas with a margin: nothing may be inked outside the entry's
// bounds (culling and the dirty rect trust them, ADR-402). Every entry type must occur,
// so the test cannot pass by painting nothing.
import type { DisplayEntry, DisplayList, Rect, ResolvedTheme } from "@md2ui/contracts";
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
import {
  createPainter,
  type DecodedImage,
  type Frame,
  type ScrollOffset,
} from "@md2ui/painter-canvas";
import { createPretextMeasurer } from "@md2ui/text-pretext";
import { beforeAll, describe, expect, test } from "vitest";

// ---------------------------------------------------------------------------------
// Test helpers (copied from the painter's tests: a test folder is not importable).

/** Room around an entry's bounds for ink that should not be there. */
const MARGIN = 40;

/** A transparent canvas `width` × `height` CSS px, drawn at `dpr`. */
function testCanvas(width: number, height: number, dpr: number) {
  const canvas = new OffscreenCanvas(Math.round(width * dpr), Math.round(height * dpr));
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (ctx === null) throw new Error("no 2d context");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, dpr };
}

/**
 * Device pixels with any ink inside `bounds` and outside it, with one device pixel of
 * slack either side for the outside count.
 */
function ink(t: ReturnType<typeof testCanvas>, bounds: Rect): { inside: number; outside: number } {
  const { ctx, dpr } = t;
  const { width, height } = ctx.canvas;
  const data = ctx.getImageData(0, 0, width, height).data;
  const x0 = Math.floor(bounds.x * dpr) - 1;
  const y0 = Math.floor(bounds.y * dpr) - 1;
  const x1 = Math.ceil((bounds.x + bounds.width) * dpr) + 1;
  const y1 = Math.ceil((bounds.y + bounds.height) * dpr) + 1;
  let inside = 0;
  let outside = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) === 0) continue;
      if (x >= x0 && x < x1 && y >= y0 && y < y1) inside++;
      else outside++;
    }
  }
  return { inside, outside };
}

/** A decoded raster image of two halves, so cover/contain crops have something to crop. */
function decodedImage(): DecodedImage {
  const canvas = new OffscreenCanvas(64, 40);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2d context");
  ctx.fillStyle = "#3366cc";
  ctx.fillRect(0, 0, 32, 40);
  ctx.fillStyle = "#cc6633";
  ctx.fillRect(32, 0, 32, 40);
  return { source: canvas, width: 64, height: 40, vector: false };
}

// ---------------------------------------------------------------------------------
// The documents. One theme per document; `sans-serif` exists in every engine.

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
Heading3
- Font Name: sans-serif
- Font size: 17
Muted
- Font Name: sans-serif
`;

const BASE = `${FONTS}
## Styling & Spacing
### Root
Background color: #F6F6F6
Padding: 16
Spacing: 16
Stack sections: yes

### Heading 2
Background color: #FDFDFD
Corner radius: 24
Padding: 16
Spacing: 12
Draw element style: yes
Stroke width: 2
Stroke color: #91B7A4
Outer shadow:
- Offset y: 3
- Radius: 7
- Color: #26263330
Outer shadow:
- Offset y: 14
- Radius: 28
- Color: #26263320
Inner shadow:
- Offset y: 2
- Radius: 6
- Color: #FFFFFFCC

### Image Cards
Background image: https://example.com/fallback.png
Corner radius: 20
Padding: 12
Spacing: 8
Draw element style: no
Background gradient:
- Type: Linear
- Colors:
  - #00000000
  - #152621E6
- Parameters:
  - Start: 0, 0.2
  - End: 0, 1

### Task Lists
#### Marker
Size: 18

## Links
Fill color: #26262B
Corner radius: 24
Padding top: 8
Padding bottom: 8
Padding left: 16
Padding right: 16
Emoji shape: circle
Disabled fill color: #EEEEF0
Disabled text color: #96969D
Disabled stroke color: #E2E2E7
Outer shadow:
- Offset y: 2
- Color: #15151A1F
- Radius: 6

## Inline Code
Fill color: #EAE5F6
Corner radius: 8
Padding: 4

## Emoji styles
### Primary
Shape: circle
Size: 22
Padding: 8
Icon color: #8870C1
Background color: #F0ECF8
Inner shadow:
- Offset y: 1
- Color: #00000022
- Radius: 3

## Code Blocks
Syntax style: monokai
Background color: #002B0A
Corner radius: 12
Padding: 12
Line spacing: 4
Copy button:
### Copy Button
Icon: copy

## Horizontal Rule
Thickness: 2

## Drawing elements
### Task controls
Type: checkbox
Size: 20
Padding: 5
Corner radius: 6
Space: 10
### Checked outer
Background color: #DCEEE2
### Checked inner
Background color: #4F9C6B
### Unchecked outer
Background color: #CFCFD6
### Unchecked inner
Background color: #FDFDFD

### Ratio Bars
Thickness: 10
Corner radius: 5
Text side: right
Background color: #00CC58
### Ratio Bar Track
Background color: #E5F9EE
Corner radius: 5

### Unit Ratios
Style: ring
Show total: no
### Ring
Diameter: 96
Thickness: 10
Background color: #00CC58
### Ring Track
Background color: #E5F9EE

### Sliders
Style: thick
Axis: horizontal
Length: 240
Thickness: 40
Corner radius: 20
Circle diameter: 28
Drag bar length: 22
Bar thickness: 3
### Slider Track
Background color: #F8C91C
### Slider Bar
Background color: #FFFFFF
### Slider Handle
Background color: #D8D8D8
Outer shadow:
- Offset y: 2
- Color: #00000040
- Radius: 4

### Dates
Background color: #F0EDF7
Corner radius: 14
Padding: 10
Spacing: 3

## Tables
### Table
Merge rows: yes
Background color: #FDFDFD
Corner radius: 16
Row spacing: 8
Col spacing: 6
### Header
Background color: #E5F9EE
Padding: 8
### Cells
Background colors:
- #FDFDFD
- #F4F6F5
Corner radius: 12
Padding: 8
`;

const SHEET = `# Ink report

## Overview
Some **bold** text, \`inline code\`, ~~struck~~ words and a [link](/docs) with a 🚀 rocket. Rather long prose follows so that the paragraph wraps onto a second and a third line inside its rounded, shadowed card.

[Open](/open) [~~Closed~~](/closed)

- [x] done
- [ ] todo

---

## Photos
![A photo](https://example.com/photo.png)

![

## Card on a photo
Text over an image card.

[Book](/book)

](https://example.com/card.png)

## Numbers
Progress: 68/100

750/1800 Kcal

Volume: [65%]

Jun-5 | Jun-6 | Jun-7

## Code
\`\`\`python
def add(a, b):
    return a + b  # a very long comment that runs past the right edge of the code block so it scrolls
\`\`\`

## Table
| Name | Role |
| --- | --- |
| Ada | Engineer |
| Grace | Admiral |
| Linus | Maintainer |
`;

/** A plain document under a theme with a root box, a section stroke and no card shadows. */
const PLAIN_THEME = `${FONTS}
## Styling & Spacing
### Root
Background color: #FFFFFF
Padding: 24
Box: yes
Box fill color: #F0F0F0
Box radius: 18
Outer shadow:
- Offset y: 6
- Radius: 20
- Color: #00000033
Background gradient:
- Type: Linear
- Colors:
  - #FFFFFF
  - #DDEEFF
- Parameters:
  - Start: 0, 0
  - End: 0, 1

### Heading 1
Draw element style: yes
Background color: #FFFFFF
Corner radius: 10
Padding: 8
Stroke width: 3
Stroke color: #3366CC
Stroke align: outside

### Heading 3
Padding: 4
#### Marker
Draw element style: yes
`;

const PLAIN = `# A heading with a stroke

Plain text under a root box.

### Small heading

> A quote, with **bold** text.

1. First
2. Second
`;

interface Doc {
  readonly name: string;
  readonly markdown: string;
  readonly themeText: string;
  /** Entry types this document must produce. */
  readonly produces: readonly DisplayEntry["type"][];
}

const DOCS: readonly Doc[] = [
  {
    name: "sheet (shadows, strokes, tables, rings, scroll, images)",
    markdown: SHEET,
    themeText: BASE,
    produces: ["fill", "stroke", "shadow", "line", "arc", "text", "image", "scroll"],
  },
  {
    name: "plain (root box, gradient, outside stroke)",
    markdown: PLAIN,
    themeText: PLAIN_THEME,
    produces: ["fill", "stroke", "text"],
  },
];

const WIDTH = 440;

/** The emoji family a font path loads as: the path itself, or the system's emoji face. */
const emojiFamily = (path: string | null): string => path ?? "sans-serif";

async function listOf(doc: Doc): Promise<{ list: DisplayList; theme: ResolvedTheme }> {
  const kit = new RegexKit();
  const theme = parseTheme(doc.themeText);
  const text = await createPretextMeasurer([]);
  const grouping = groupMarkdown(doc.markdown, kit);
  const input = layoutInput(kit, grouping);
  const measurer = sizingMeasurer(input, theme, text, { emojiFamily });
  const at = effectiveWidth(input, theme, measurer, WIDTH);
  const layout = generate(input, at, theme, measurer);
  bakeLayout(layout, theme);
  const sizer = documentSizer(input, theme, text, { emojiFamily });
  const scene = placeScene(sizer, layout, grouping, at);
  const highlight = await loadCodeHighlighter(theme, ["python"]);
  return { list: paintScene(sizer, scene, grouping, highlight).list, theme };
}

const hasImage = (e: DisplayEntry): boolean =>
  e.type === "image" || (e.type === "fill" && e.paint.kind === "image");

/** `entry` alone as a one-entry list, framed so its bounds sit `MARGIN` from the corner. */
function paintAlone(
  entry: DisplayEntry,
  dpr: number,
  decoded: DecodedImage | undefined,
  offset: ScrollOffset,
): { inside: number; outside: number } {
  const alone: DisplayList = {
    version: 1,
    width: entry.bounds.width,
    height: entry.bounds.height,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    centered: false,
    background: { paints: [], shadows: [] },
    entries: [entry],
    targets: [],
    anchors: [],
  };
  const width = entry.bounds.width + 2 * MARGIN;
  const height = entry.bounds.height + 2 * MARGIN;
  const frame: Frame = {
    width,
    height,
    scrollX: entry.bounds.x - MARGIN,
    scrollY: entry.bounds.y - MARGIN,
    pixelRatio: dpr,
    images: () => decoded,
    loading: () => undefined,
    offsets: new Map([[entry.nodeId, offset]]),
  };
  const t = testCanvas(width, height, dpr);
  createPainter(alone).paint(t.ctx, frame);
  return ink(t, {
    x: MARGIN,
    y: MARGIN,
    width: entry.bounds.width,
    height: entry.bounds.height,
  });
}

const describeEntry = (e: DisplayEntry): string =>
  `${e.type} of node ${JSON.stringify(e.nodeId)} bounds ${JSON.stringify(e.bounds)}`;

describe.each(DOCS)("ink stays inside bounds: $name", (doc) => {
  let list: DisplayList;
  beforeAll(async () => {
    list = (await listOf(doc)).list;
  }, 60_000);

  test("the document produces every entry type it is meant to", () => {
    const types = new Set(list.entries.map((e) => e.type));
    for (const type of doc.produces) expect(types, `no ${type} entry`).toContain(type);
  });

  test("the sheet has clipped entries and an image-painted fill", () => {
    if (!doc.name.startsWith("sheet")) return;
    expect(list.entries.some((e) => e.type === "fill" && e.clip !== undefined)).toBe(true);
    expect(list.entries.some((e) => e.type === "text" && e.clip !== undefined)).toBe(true);
    expect(list.entries.some((e) => e.type === "fill" && e.paint.kind === "image")).toBe(true);
  });

  test("the document's text is drawn in generic families", () => {
    const families = new Set(
      list.entries.flatMap((e) =>
        e.type === "text" ? e.runs.map((r) => r.font.families.at(-1)) : [],
      ),
    );
    expect(families.size).toBeGreaterThan(0);
    for (const family of families) expect(["sans-serif", "monospace"]).toContain(family);
  });

  test("every entry, painted alone, leaves no ink outside its bounds", () => {
    const decoded = decodedImage();
    const checked: Record<string, number> = {};
    const outside: string[] = [];
    let runs = 0;
    let painted = 0;
    for (const entry of list.entries) {
      // A scroll entry at rest, and at the end of each axis and of both.
      const end = (n: number) => Math.max(0, n);
      const offsets: ScrollOffset[] =
        entry.type === "scroll"
          ? [
              { x: 0, y: 0 },
              { x: end(entry.contentWidth - entry.shape.width), y: 0 },
              { x: 0, y: end(entry.contentHeight - entry.shape.height) },
              {
                x: end(entry.contentWidth - entry.shape.width),
                y: end(entry.contentHeight - entry.shape.height),
              },
            ]
          : [{ x: 0, y: 0 }];
      const images = hasImage(entry) ? [undefined, decoded] : [undefined];
      for (const dpr of [1, 2]) {
        for (const image of images) {
          for (const offset of offsets) {
            const { inside, outside: n } = paintAlone(entry, dpr, image, offset);
            painted += inside > 0 ? 1 : 0;
            runs++;
            if (n > 0) {
              outside.push(
                `${describeEntry(entry)} at ratio ${dpr}${image === undefined ? "" : " decoded"}` +
                  `${offset.x > 0 || offset.y > 0 ? ` offset ${JSON.stringify(offset)}` : ""}: ${n} device px outside`,
              );
            }
          }
        }
      }
      checked[entry.type] = (checked[entry.type] ?? 0) + 1;
    }
    console.info(`[ink] ${doc.name}: entries checked per type ${JSON.stringify(checked)}`);
    expect(outside).toEqual([]);
    // Not vacuous: nearly every entry, alone, leaves ink on the canvas.
    expect(painted).toBeGreaterThan(runs * 0.9);
  }, 300_000);
});
