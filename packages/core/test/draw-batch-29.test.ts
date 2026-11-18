// A muted chip's and badge's paint, as display-list entries through the whole
// pipeline (fake measurer): md2ui's tests/muted_element_tests.py
// `test_muted_chip_and_badge_fade_shadows_and_image`, read off the shadow and image fill
// entries the painter draws instead of a patched `_paint_layered_fill`.
import type { DisplayEntry, FillEntry, ShadowEntry } from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { mutedBadge, mutedChip } from "../src/scene/draw/muted.ts";
import { parseTheme } from "../src/theme/parse.ts";
import { paintMarkdown } from "./scene-kit.ts";

// md2ui `_LAYERED`.
const LAYERED = `## Inline Code
Fill color: #5EE117
Background image: shared.png
Outer shadow:
- Offset y: 6
- Radius: 12
- Color: #1A1A40AA
Inner shadow:
- Radius: 4
- Color: #000000AA

## Emoji styles
### Primary
Background color: #D5FFCC
Background image: shared.png
Outer shadow:
- Offset y: 6
- Radius: 12
- Color: #1A1A40AA
Inner shadow:
- Radius: 4
- Color: #000000AA
`;

// The same, with `Disabled …` colours stated: the shadows fade all the same.
const STATED = LAYERED.replace(
  "Fill color: #5EE117\n",
  "Fill color: #5EE117\nDisabled fill color: #EEEEF0\n",
).replace(
  "Background color: #D5FFCC\n",
  "Background color: #D5FFCC\nDisabled background color: #EEEEF0\n",
);

const entriesOf = (md: string, theme: string): readonly DisplayEntry[] =>
  paintMarkdown(md, theme, 400).painted.list.entries;
const shadowsOf = (md: string, theme: string): ShadowEntry[] =>
  entriesOf(md, theme).filter((e): e is ShadowEntry => e.type === "shadow");
const imagesOf = (md: string, theme: string): FillEntry[] =>
  entriesOf(md, theme).filter((e): e is FillEntry => e.type === "fill" && e.paint.kind === "image");

/** Everything but the colour: side, offset, reach and the shape that casts it. */
const geometry = ({ inner, offsetX, offsetY, radius, shape }: ShadowEntry) => ({
  inner,
  offsetX,
  offsetY,
  radius,
  shape,
});

describe("a muted chip, badge and button fade their shadows and image (md2ui c082b328, b907483a)", () => {
  for (const [name, theme] of [
    ["no Disabled colours", LAYERED],
    ["Disabled colours stated", STATED],
  ] as const) {
    for (const [element, enabled, muted] of [
      ["chip", "`Tag`", "~~`Tag`~~"],
      ["badge", "⭐", "~~⭐~~"],
    ] as const) {
      it(`${element}, ${name}: shadows at MUTED_OPACITY, same side, offset and reach`, () => {
        const on = shadowsOf(enabled, theme);
        const off = shadowsOf(muted, theme);
        expect(on.map((s) => s.color)).toEqual(["#1a1a40aa", "#000000aa"]);
        // 0xAA x 0.4 = 68 = 0x44.
        expect(off.map((s) => s.color)).toEqual(["#1a1a4044", "#00000044"]);
        expect(off.map(geometry)).toEqual(on.map(geometry));
      });

      it(`${element}, ${name}: the theme image at MUTED_OPACITY, same shape`, () => {
        const [on] = imagesOf(enabled, theme);
        const [off] = imagesOf(muted, theme);
        // An enabled element's paint carries no opacity, so its list is unchanged.
        expect(on?.paint).toStrictEqual({ kind: "image", src: "shared.png", fallbackSrc: null });
        expect(off?.paint).toEqual({ ...on?.paint, opacity: 0.4 });
        expect(off?.shape).toEqual(on?.shape);
      });
    }
  }

  // md2ui: test_muted_button_fades_shadows_and_image, as a chip and a badge do.
  const button =
    "## Links\nFill color: #3B5BDB\nBackground image: shared.png\nOuter shadow:\n- Offset y: 6\n- Radius: 12\n- Color: #1A1A40AA\n";
  for (const [name, theme] of [
    ["no Disabled colours", button],
    ["Disabled colours stated", `${button}Disabled fill color: #EEEEF0\n`],
  ] as const) {
    it(`button, ${name}: its shadows and theme image at MUTED_OPACITY`, () => {
      const [enabled, muted] = ["[Book](agent:book)", "~~[Book](agent:book)~~"];
      const on = shadowsOf(enabled, theme);
      const off = shadowsOf(muted, theme);
      expect(on.map((s) => s.color)).toEqual(["#1a1a40aa"]);
      expect(off.map((s) => s.color)).toEqual(["#1a1a4044"]);
      expect(off.map(geometry)).toEqual(on.map(geometry));
      const [onImage] = imagesOf(enabled, theme);
      const [offImage] = imagesOf(muted, theme);
      expect(onImage?.paint).toStrictEqual({ kind: "image", src: "shared.png", fallbackSrc: null });
      expect(offImage?.paint).toEqual({ ...onImage?.paint, opacity: 0.4 });
      expect(offImage?.shape).toEqual(onImage?.shape);
    });
  }

  it("the parsed theme is never muted; the muted resolution is", () => {
    const theme = parseTheme(LAYERED);
    expect(theme.emojis.primary.is_muted).toBe(false);
    expect(theme.inline_code.muted).toBe(false);
    expect(mutedBadge(theme.emojis.primary, 0xff000000).is_muted).toBe(true);
    expect(mutedChip(theme.inline_code).muted).toBe(true);
  });
});
