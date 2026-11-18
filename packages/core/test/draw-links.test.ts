// Links, inline-code chips and emoji leaves, painted through the whole pipeline with the
// fake measurer (advance: space 0.25, emoji 1, other 0.5 of the size; ascent+descent 1).
import type { DisplayEntry, FillEntry, StrokeEntry, TextEntry } from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { createFakeMeasurer } from "../src/text/fake-measurer.ts";
import { paintMarkdown } from "./scene-kit.ts";

const THEME = `## Links
Fill color: #26262B
Corner radius: 24
Padding top: 10
Padding bottom: 10
Padding left: 18
Padding right: 18
Emoji shape: circle
Disabled fill color: #EEEEF0
Disabled text color: #96969D

## Inline Code
Fill color: #EAE5F6
Corner radius: 12
Padding: 5

## Emoji styles
### Primary
Shape: circle
Size: 26
Padding: 9
Icon color: #8870C1
Background color: #F0ECF8
`;

const entries = (md: string, theme = THEME) => paintMarkdown(md, theme, 400).painted.list.entries;
const fills = (list: readonly DisplayEntry[]) =>
  list.filter((e): e is FillEntry => e.type === "fill");
const texts = (list: readonly DisplayEntry[]) =>
  list.filter((e): e is TextEntry => e.type === "text");

describe("drawLink", () => {
  it("paints a primary button as a rounded pill with its label inset by the padding", () => {
    const [pill, ...rest] = fills(entries("[Go](/x)"));
    expect(rest).toEqual([]);
    // label 2 x 6.5 + padding 36 wide; ascent+descent 13 + padding 20 high.
    expect(pill?.shape).toEqual({
      kind: "roundRect",
      x: 0,
      y: 0,
      width: 49,
      height: 33,
      radii: [24, 24, 24, 24],
    });
    expect(pill?.paint).toEqual({ kind: "color", color: "#26262bff" });
    const [label] = texts(entries("[Go](/x)"));
    expect(label?.runs[0]?.x).toBe(18);
    // centred in the pill: (33 - 13) / 2 from its top, then the ascent (0.8 of the size).
    expect(label?.y).toBeCloseTo(10 + 10.4, 5);
  });

  it("paints the pill exactly where its click target is", () => {
    const { list } = paintMarkdown("[Go](/x)", THEME, 400).painted;
    const [pill] = fills(list.entries);
    const [target] = list.targets;
    expect(pill?.shape.x).toBe(target?.rect.x);
    expect(pill?.shape.y).toBe(target?.rect.y);
    expect(pill?.shape.width).toBe(target?.rect.width);
    expect(pill?.shape.height).toBe(target?.rect.height);
  });

  it("takes the disabled colours for ~~[x](/y)~~ and keeps the size", () => {
    const live = fills(entries("[Go](/x)"))[0];
    const [pill] = fills(entries("~~[Go](/y)~~"));
    expect(pill?.paint).toEqual({ kind: "color", color: "#eeeef0ff" });
    expect(pill?.shape.width).toBe(live?.shape.width);
    expect(texts(entries("~~[Go](/y)~~"))[0]?.runs[0]?.color).toBe("#96969dff");
  });

  it("squares an emoji-only label into an oval when the theme says circle", () => {
    const [pill] = fills(entries("[➕](/add)"));
    // As tall as a text label: 13 + 2 x 10, the vertical padding.
    expect(pill?.shape).toEqual({ kind: "oval", x: 0, y: 0, width: 33, height: 33 });
    const [label] = texts(entries("[➕](/add)"));
    // centred in the square: (33 - 13) / 2.
    expect(label?.runs[0]?.x).toBe(10);
    expect(label?.runs[0]?.font.families[0]).toBe("emoji");
  });

  it("centres an emoji label measured in the `### Link` emoji face (md2ui 60d35b0f)", () => {
    // The override's glyphs are three times as wide as the default's.
    const base = createFakeMeasurer();
    const text = createFakeMeasurer(
      (t, f) => base.advance(t, f) * (f.families[0] === "wide.ttf" ? 3 : 1),
    );
    const theme = `${THEME}\n### Link\nFont: wide.ttf\n`;
    const list = paintMarkdown("[➕](/add)", theme, 400, { text }).painted.list.entries;
    const [pill] = fills(list);
    const run = texts(list)[0]?.runs[0];
    expect(run?.font.families[0]).toBe("wide.ttf");
    // side: 3 x 13 + 2 x 10 = 59 (the vertical padding); the label's 39 centred in it.
    expect(pill?.shape.width).toBe(59);
    expect(run?.x).toBe((59 - 39) / 2);
  });

  it("paints a label in its variant's face, and a Text label's italic emphasis slanted", () => {
    const theme = `${THEME}\n## Text Styles\nLinks Secondary\n- Font Name: IBM Plex Mono\n`;
    const secondary = texts(entries("*[Go](/x)*", theme))[0]?.runs[0];
    expect(secondary?.font).toMatchObject({ families: ["IBM Plex Mono"], italic: false });
    // A backtick label makes a Text link; the wrapper's emphasis picks its face.
    const text = texts(entries("*[`Go`](/x)*", theme))[0]?.runs[0];
    expect(text?.font.italic).toBe(true);
  });

  it("paints a label's inner emphasis in the variant's own faces, its markers gone (md2ui 06b4fcc9)", () => {
    const list = entries("[**Bold** label](/x)");
    const runs = texts(list)[0]?.runs ?? [];
    expect(runs.map((r) => r.text)).toEqual(["Bold", " label"]);
    expect(runs.map((r) => r.font.weight)).toEqual([700, 400]);
    // The plain run starts where the bold one's advance ends (the fake widens bold by 1.1):
    // 18 + 4 x 6.5 x 1.1.
    expect(runs[1]?.x).toBeCloseTo(46.6, 9);
    // The pill holds both runs as measured: 28.6 + 3.25 + 5 x 6.5, plus the padding 36.
    expect(fills(list)[0]?.shape.width).toBeCloseTo(100.35, 9);
    // `_x_` is italic in the link's face, never the Muted tier.
    const italic = texts(entries("[_Go_](/x)"))[0]?.runs[0];
    expect(italic).toMatchObject({ text: "Go", font: { italic: true, size: 13 } });
    // Emphasis around the link picks Secondary; inside, it bolds Secondary's own family.
    const theme = `${THEME}\n## Text Styles\nLinks Secondary\n- Font Name: IBM Plex Mono\n`;
    const wrapped = texts(entries("*[**Go**](/x)*", theme))[0]?.runs[0];
    expect(wrapped).toMatchObject({
      text: "Go",
      font: { families: ["IBM Plex Mono"], weight: 700 },
    });
    // A Text-variant label was a code span: its markers stay literal.
    expect(texts(entries("[`**Go**`](/x)"))[0]?.runs[0]?.text).toBe("**Go**");
  });

  it("keeps a rounded rect for Emoji shape: square", () => {
    const theme = THEME.replace("Emoji shape: circle", "Emoji shape: square");
    const [pill] = fills(entries("[➕](/add)", theme));
    expect(pill?.shape.kind).toBe("roundRect");
    expect(pill?.shape.width).toBe(pill?.shape.height);
  });
});

describe("drawChip", () => {
  it("paints an inline-code leaf as a pill with its label inset by padding and corner", () => {
    const list = entries("`code`");
    const [pill] = fills(list);
    // label 4 x 7 = 28; left/right padding 5 + 12 / 2 = 11; height 14 + 10.
    expect(pill?.shape).toEqual({
      kind: "roundRect",
      x: 0,
      y: 0,
      width: 50,
      height: 24,
      radii: [12, 12, 12, 12],
    });
    expect(pill?.paint).toEqual({ kind: "color", color: "#eae5f6ff" });
    const [label] = texts(list);
    expect(label?.runs[0]?.text).toBe("code");
    expect(label?.runs[0]?.x).toBe(11);
    expect(label?.runs[0]?.font.size).toBe(14);
  });

  it("keeps a transparent rotation slot transparent (md2ui d07d6999)", () => {
    const theme =
      "## Inline Code\nFill color:\n- #FFCC00\n- #00000000\n" +
      "Stroke color:\n- #333333\n- #00000000\nStroke width: 1\nPadding: 8\n";
    // md2ui data/markdown/tests/chip-transparent-rotation-slot.
    const list = entries("`first`\n\n`second`", theme);
    const yellow = fills(list).filter((f) => f.paint.kind === "color");
    expect(yellow.map((f) => f.paint)).toEqual([{ kind: "color", color: "#ffcc00ff" }]);
    const strokes = list.filter((e): e is StrokeEntry => e.type === "stroke");
    expect(strokes.map((e) => e.color)).toEqual(["#333333ff", "#00000000"]);
  });
});

describe("drawEmoji", () => {
  it("paints a bare glyph at the text size for a text-kind emoji", () => {
    const list = entries("| a | b |\n|---|---|\n| 🚀 | x |");
    const glyph = texts(list).find((t) => t.runs[0]?.text === "🚀");
    expect(glyph?.runs).toHaveLength(1);
    expect(glyph?.runs[0]?.font.size).toBe(13);
    expect(glyph?.runs[0]?.color).toBe("#3c3c3cff");
    expect(fills(list)).toEqual([]);
  });

  it("paints a standalone emoji as a badge: an oval fill, then the glyph centred in it", () => {
    const list = entries("🚀");
    const [badge] = fills(list);
    // glyph 26 wide and 26 high; padding 9 each side; circle: side = 44.
    expect(badge?.shape).toEqual({ kind: "oval", x: 0, y: 0, width: 44, height: 44 });
    expect(badge?.paint).toEqual({ kind: "color", color: "#f0ecf8ff" });
    const [glyph] = texts(list);
    expect(glyph?.runs[0]?.font.size).toBe(26);
    expect(glyph?.runs[0]?.x).toBe((44 - 26) / 2);
    expect(glyph?.runs[0]?.color).toBe("#8870c1ff");
    expect(list.indexOf(badge as DisplayEntry)).toBeLessThan(list.indexOf(glyph as DisplayEntry));
  });
});

describe("bounds", () => {
  it("contain the geometry of every fill and run", () => {
    for (const md of ["[Go](/x)", "[➕](/add)", "`code`", "🚀"]) {
      for (const e of entries(md)) {
        if (e.type === "fill") {
          expect(e.bounds.x).toBeLessThanOrEqual(e.shape.x);
          expect(e.bounds.y).toBeLessThanOrEqual(e.shape.y);
          expect(e.bounds.x + e.bounds.width).toBeGreaterThanOrEqual(e.shape.x + e.shape.width);
        } else if (e.type === "text") {
          for (const run of e.runs) expect(e.bounds.x).toBeLessThanOrEqual(run.x);
        }
      }
    }
  });
});
