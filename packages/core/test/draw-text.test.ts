// Text leaves painted (md2ui `draw_styled_text_box`): prose emoji in the face the text was
// sized with, inline-link click regions laid out in that same face, and the clip room a
// line ending in italic leans into. The fake measurer widens one family threefold, so a
// face mix-up shows as a width.
import type { TextEntry } from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { createFakeMeasurer } from "../src/text/fake-measurer.ts";
import { paintMarkdown } from "./scene-kit.ts";

const base = createFakeMeasurer();
/** The fake measurer, with the `wide.ttf` family's glyphs three times as wide. */
const text = createFakeMeasurer(
  (t, f) => base.advance(t, f) * (f.families[0] === "wide.ttf" ? 3 : 1),
);
const WIDE_TEXT = "## Emoji styles\n### Text\nFont: wide.ttf\n";

const texts = (md: string, theme: string) => {
  const p = paintMarkdown(md, theme, 800, { text });
  return { p, texts: p.painted.list.entries.filter((e): e is TextEntry => e.type === "text") };
};
const runOf = (entries: readonly TextEntry[], s: string) =>
  entries.flatMap((e) => e.runs).find((r) => r.text === s);

describe("prose emoji (md2ui 60d35b0f)", () => {
  it("lays the line out in the `### Text` emoji face it paints in", () => {
    const { p, texts: list } = texts("Fly ✈ to Lisbon\n", WIDE_TEXT);
    const size = p.theme.text.font_size;
    const plane = runOf(list, "✈");
    const to = runOf(list, "to Lisbon");
    expect(plane?.font.families[0]).toBe("wide.ttf");
    // The glyph is 3 x size wide, and the next word starts after it and a space.
    expect(to?.x).toBe((plane?.x ?? 0) + 3 * size + 0.25 * size);
  });

  it("places an inline link's click region where the link paints", () => {
    const { p, texts: list } = texts("✈✈ read [docs](/d)\n", WIDE_TEXT);
    const docs = runOf(list, "docs");
    const [region] = p.scene.regions;
    expect(region?.x).toBe(docs?.x);
  });
});

describe("italic", () => {
  const box = (p: ReturnType<typeof texts>["p"]) =>
    p.scene.boxes.find((b) => b.content_id !== null) ?? { width: 0 };

  it("paints italic spans in an italic font", () => {
    const { texts: list } = texts("plain and *slanted*\n", "");
    expect(runOf(list, "slanted")?.font.italic).toBe(true);
    expect(runOf(list, "plain and")?.font.italic).toBe(false);
  });

  it("widens only the clip of a line ending in italic, by a quarter of the size (53299d15)", () => {
    const leaning = texts("plain and *slanted*\n", "");
    const size = leaning.p.theme.text.font_size;
    const [line] = leaning.texts;
    expect(line?.clip?.width).toBe(box(leaning.p).width + size * 0.25);
    const upright = texts("*slanted* and plain\n", "");
    expect(upright.texts[0]?.clip?.width).toBe(box(upright.p).width);
  });
});
