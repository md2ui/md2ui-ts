// md2ui ADR-409: a card is laid out, never painted. `### Elements` keeps its
// padding and spacing; its fill, gradient, radius, stroke, shadows and rotation are not
// read; `Draw element style` is gone, so the card padding applies wherever a card is
// wrapped. md2ui's tests/element_card_tests.py, plus the paint and padding read off the
// display list (fake measurer).
import type { FillEntry, TextEntry } from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { parseTheme } from "../src/theme/parse.ts";
import { paintMarkdown } from "./scene-kit.ts";

const ELEMENTS = `## Styling & Spacing

### Elements
Padding: 12
Row spacing: 6
Col spacing: 4
Group spacing: 20
Background color: #FFFFFF
Background gradient:
- Type: Linear
- Colors:
  - #00000000
  - #000000FF
Corner radius: 16
Stroke width: 1
Stroke color: #222222
Outer shadow:
- Radius: 8
- Color: #00000040
Rotate colors: yes

### Heading 2
Background color: #EEEEEE
`;

describe("### Elements (md2ui element_card_tests)", () => {
  it("keeps its padding and every spacing key", () => {
    const el = parseTheme(ELEMENTS).elements;
    expect([el.padding.top, el.padding.left]).toEqual([12, 12]);
    expect([el.row_spacing, el.col_spacing]).toEqual([6, 4]);
    expect([el.group_row_spacing, el.group_col_spacing]).toEqual([20, 20]);
  });

  it("reads no fill, gradient, radius, stroke, shadow or rotation", () => {
    const el = parseTheme(ELEMENTS).elements;
    expect([el.bg_colors, el.gradient, el.bg_image]).toEqual([[], null, null]);
    expect([el.corner_radius, el.stroke_width, el.stroke_color]).toEqual([0, 0, null]);
    expect([el.shadows, el.rotate]).toEqual([[], {}]);
  });

  it("drops the paint keys on ### Elements only", () => {
    expect(parseTheme(ELEMENTS).sections[2]?.bg_colors).toEqual([0xffeeeeee]);
  });
});

// Two consecutive lines glue into one card.
const CARD = "Title of the card\nIts second line\n";
const textX = (theme: string): number | undefined =>
  paintMarkdown(CARD, theme, 500)
    .painted.list.entries.filter((e): e is TextEntry => e.type === "text")
    .flatMap((e) => e.runs)
    .find((r) => r.text.startsWith("Title"))?.x;

describe("a card on the page", () => {
  it("paints nothing of ### Elements", () => {
    const fills = paintMarkdown(CARD, ELEMENTS, 500)
      .painted.list.entries.filter((e): e is FillEntry => e.type === "fill")
      .filter((e) => e.paint.kind === "color" && e.paint.color === "#ffffffff");
    expect(fills).toEqual([]);
  });

  it("is padded even where a theme once said `Draw element style: no`", () => {
    const bare = textX("");
    const off = `${ELEMENTS}\n### Root\nDraw element style: no\n`;
    expect(textX(off)).toBe((bare ?? 0) + 12);
  });
});
