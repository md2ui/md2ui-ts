// Muted elements, link variants, button emoji keys, text style tiers and fixed colours
// in paint, as display-list entries through the whole pipeline (fake measurer). Each case
// reproduces one of md2ui's own tests, named in its title: tests/muted_element_tests.py,
// link_variant_tests.py, button_emoji_keys_tests.py, text_style_tier_tests.py and
// fixed_color_tests.py. md2ui asserts on resolved styles or pixels; here the
// same colours are read off the entries the painter draws.
import type { DisplayEntry, FillEntry, StrokeEntry, TextEntry, TextRun } from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { groupMarkdown } from "../src/group/grouper.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { fixedPins } from "../src/scene/draw/pins.ts";
import { createFakeMeasurer } from "../src/text/fake-measurer.ts";
import { parseTheme } from "../src/theme/parse.ts";
import { paintMarkdown } from "./scene-kit.ts";

const entries = (md: string, theme: string): readonly DisplayEntry[] =>
  paintMarkdown(md, theme, 400).painted.list.entries;
const fills = (list: readonly DisplayEntry[]) =>
  list.filter((e): e is FillEntry => e.type === "fill");
const strokes = (list: readonly DisplayEntry[]) =>
  list.filter((e): e is StrokeEntry => e.type === "stroke");
const runs = (list: readonly DisplayEntry[]): TextRun[] =>
  list.filter((e): e is TextEntry => e.type === "text").flatMap((e) => e.runs);
const runOf = (list: readonly DisplayEntry[], text: string) =>
  runs(list).find((r) => r.text === text);
const colorOf = (fill: FillEntry | undefined) =>
  fill?.paint.kind === "color" ? fill.paint.color : undefined;

/** `#rrggbb` at the default mute's opacity, as the display list spells it (0.4 x 255 = 102). */
const faded = (hex: string) => `${hex.toLowerCase()}66`;
const solid = (hex: string) => `${hex.toLowerCase()}ff`;

// md2ui tests/muted_element_tests.py `_KEYED`, with a stroke so the stroke key is drawn.
const KEYED = `## Inline Code
Fill color: #5EE117
Stroke width: 1
Stroke color: #123456
Disabled fill color: #EEEEF0
Disabled text color: #96969D
Disabled stroke color: #E2E2E7

### Secondary
Fill color: #E7F4EB

## Emoji styles
### Primary
Icon color: #00CF33
Background color: #D5FFCC
Padding: 9
Disabled background color: #EEEEF0
Disabled icon color: #96969D
Disabled stroke color: #E2E2E7

### Secondary
Disabled icon color: #112233
`;

describe("~~ mutes a badge, a chip and a Text button (md2ui 49daa4b3)", () => {
  it("test_muted_chip_paints_the_keys: the Disabled keys, at the enabled geometry", () => {
    const enabled = entries("*`Tag`*", KEYED);
    const muted = entries("~~*`Tag`*~~", KEYED);
    expect(colorOf(fills(enabled)[0])).toBe(solid("#E7F4EB"));
    expect(colorOf(fills(muted)[0])).toBe(solid("#EEEEF0"));
    expect(strokes(muted)[0]?.color).toBe(solid("#E2E2E7"));
    expect(runOf(muted, "Tag")?.color).toBe(solid("#96969D"));
    expect(fills(muted)[0]?.shape).toEqual(fills(enabled)[0]?.shape);
  });

  it("test_muted_chip_default_mute: no Disabled keys, the chip's own colours faded", () => {
    const theme =
      "## Text Styles\nText\n- Font color: #26262B\n\n" +
      "## Inline Code\nFill color: #5EE117\nBackground gradient:\n- Colors:\n  - #F2EEF9\n  - #DDD4F1\n";
    const muted = entries("~~`Tag`~~", theme);
    const [pill, gradient] = fills(muted);
    expect(colorOf(pill)).toBe(faded("#5EE117"));
    expect(gradient?.paint.kind).toBe("linearGradient");
    expect(JSON.stringify(gradient?.paint)).toContain(faded("#F2EEF9"));
    expect(JSON.stringify(gradient?.paint)).toContain(faded("#DDD4F1"));
    expect(runOf(muted, "Tag")?.color).toBe(faded("#26262B"));
  });

  it("test_muted_badge_paints_the_keys: the Disabled keys, at the enabled size", () => {
    const enabled = entries("⭐", KEYED);
    const muted = entries("~~⭐~~", KEYED);
    expect(colorOf(fills(muted)[0])).toBe(solid("#EEEEF0"));
    expect(runOf(muted, "⭐")?.color).toBe(solid("#96969D"));
    expect(fills(muted)[0]?.shape).toEqual(fills(enabled)[0]?.shape);
    // A variant inherits Primary's keys and states its own.
    expect(runOf(entries("~~*⭐*~~", KEYED), "⭐")?.color).toBe(solid("#112233"));
  });

  it("test_muted_badge_default_mute: the badge's own colours faded, no layer added", () => {
    const theme =
      "## Emoji styles\n### Primary\nIcon color: #00CF33\nBackground color: #D5FFCC\nPadding: 9\n";
    const muted = entries("~~⭐~~", theme);
    expect(colorOf(fills(muted)[0])).toBe(faded("#D5FFCC"));
    expect(runOf(muted, "⭐")?.color).toBe(faded("#00CF33"));
    // No icon colour of its own: the glyph's ink is the one faded.
    const bare =
      "## Text Styles\nText\n- Font color: #26262B\n\n## Emoji styles\n### Primary\nPadding: 9\n";
    const glyph = entries("~~⭐~~", bare);
    expect(runOf(glyph, "⭐")?.color).toBe(faded("#26262B"));
    // Its padding paints the transparent fill the enabled badge paints, and nothing more.
    expect(fills(glyph)).toEqual(fills(entries("⭐", bare)));
    expect(colorOf(fills(glyph)[0])).toBe("#00000000");
  });

  it("test_muted_text_button: ### Text's Disabled keys, else the default mute", () => {
    const theme =
      "## Text Styles\nText\n- Font color: #26262B\n\n" +
      "## Links\nFill color: #26262B\nDisabled fill color: #EEEEF0\n### Text\nFill color: #00000000\n";
    const enabled = runOf(entries("[`Go`](/x)", theme), "Go")?.color;
    expect(enabled?.endsWith("ff")).toBe(true);
    expect(runOf(entries("~~[`Go`](/x)~~", theme), "Go")?.color).toBe(`${enabled?.slice(0, 7)}66`);
    const keyed = "## Links\n### Text\nDisabled text color: #96969D\n";
    expect(runOf(entries("~~[`Go`](/x)~~", keyed), "Go")?.color).toBe(solid("#96969D"));
  });

  it("test_muted_elements_take_no_pin: a muted element paints its state, not its pin", () => {
    const theme = parseTheme(
      "## Fixed colors\n### Emoji\n- ⭐ #D7A139\n### Badges\n#### Contains\n- ⬆: Text color: #00CF33\n",
    );
    const kit = new RegexKit();
    const leafPin = (src: string) => {
      const root = groupMarkdown(src, kit);
      const leaf = root.children[0];
      return {
        muted: leaf?.element_muted === true,
        pins: fixedPins(root, theme, kit).get(leaf?.node_id ?? ""),
      };
    };
    for (const src of ["~~⭐~~", "~~`⬆ 4%`~~"]) {
      const { muted, pins } = leafPin(src);
      expect(muted, src).toBe(true);
      expect(pins?.text, src).toBeUndefined();
    }
    for (const src of ["⭐", "`⬆ 4%`"]) expect(leafPin(src).pins?.text, src).toBeDefined();
  });
});

describe("the _ ladder is the small buttons (md2ui 5756c9a9)", () => {
  const LADDER =
    "## Links\nFill color: #26262B\n### Quinary\nFill color: #111111\n" +
    "### Senary\nFill color: #222222\n### Septenary\nFill color: #333333\n";

  it("test_quinary_block_is_the_small_button: each wrapper paints its own block", () => {
    expect(colorOf(fills(entries("_[Go](/x)_", LADDER))[0])).toBe(solid("#111111"));
    expect(colorOf(fills(entries("__[Go](/x)__", LADDER))[0])).toBe(solid("#222222"));
    expect(colorOf(fills(entries("___[Go](/x)___", LADDER))[0])).toBe(solid("#333333"));
  });

  it("test_small_ladder_without_blocks_draws_as_primary", () => {
    const theme = "## Links\nFill color: #26262B\nCorner radius: 6\n";
    const primary = fills(entries("[Go](/x)", theme))[0];
    for (const md of ["_[Go](/x)_", "__[Go](/x)__", "___[Go](/x)___"]) {
      const [pill] = fills(entries(md, theme));
      expect(colorOf(pill), md).toBe(solid("#26262B"));
      expect(pill?.shape, md).toEqual(primary?.shape);
    }
  });
});

describe("a button's emoji takes its label's ink (md2ui 39da763c)", () => {
  const THEME =
    "## Emoji styles\n### Link\nColor: #25845B\n\n" +
    "## Links\n### Primary\nStroke width: 2\nStroke color: #000000\n" +
    "Disabled text color: #96969D\n\n" +
    "## Text Styles\n\nLinks\n- Font size: 32\n- Font color: #1144AA\n";

  it("test_outline_button_emoji_takes_the_label_ink: never `### Link` Color", () => {
    const list = entries("[😀 Label](/x)", THEME);
    expect(runOf(list, "😀")?.color).toBe(solid("#1144AA"));
    expect(runs(list).map((r) => r.color)).not.toContain(solid("#25845B"));
  });

  it("follows the disabled label; a glyph pin wins only on an enabled button", () => {
    expect(runOf(entries("~~[😀 Label](/x)~~", THEME), "😀")?.color).toBe(solid("#96969D"));
    const pinned = `${THEME}\n## Fixed colors\n### Emoji\n- 😀 #E5484D\n`;
    expect(runOf(entries("[😀 Label](/x)", pinned), "😀")?.color).toBe(solid("#E5484D"));
    expect(runOf(entries("~~[😀 Label](/x)~~", pinned), "😀")?.color).toBe(solid("#96969D"));
  });
});

describe("a glyph in styled text follows that text's ink (md2ui 393a84ac)", () => {
  it("test_a_glyph_follows_any_tier_even_one_inked_like_body_text", () => {
    const theme =
      "## Text Styles\nText\n- Font color: #26262B\n\nMuted\n- Font color: #7C7C84\n\n" +
      "Lead\n- Font color: #26262B\n\nDisplay\n- Font color: #202025\n\n" +
      "## Emoji styles\n\n### Text\nColor: #8870C1\n";
    const glyph = (md: string) => runOf(entries(md, theme), "❤️")?.color;
    expect(glyph('"❤️" Plain')).toBe(solid("#8870C1"));
    expect(glyph('_"❤️" Muted_')).toBe(solid("#7C7C84"));
    expect(glyph('__"❤️" Lead__')).toBe(solid("#26262B"));
    expect(glyph('___"❤️" Display___')).toBe(solid("#202025"));
  });
});

describe("an emoji pin matches with or without its selector (md2ui d3b1171d)", () => {
  const RED = 0xffe5484d;

  it("test_an_emoji_pin_matches_with_or_without_its_selector: badge, inline run, text slot", () => {
    const kit = new RegexKit();
    for (const [pin, glyph] of [
      ["☀️", "☀"],
      ["☀", "☀️"],
    ] as const) {
      const theme = `## Fixed colors\n### Emoji\n- ${pin} #E5484D\n`;
      const root = groupMarkdown(glyph, kit);
      const leaf = root.children[0];
      expect(fixedPins(root, parseTheme(theme), kit).get(leaf?.node_id ?? "")?.text).toBe(RED);
      // Inside prose, where `### Text`'s Fixed colors cut the run per glyph.
      expect(runOf(entries(`Sunny ${glyph} today`, theme), glyph)?.color).toBe(solid("#E5484D"));
    }
    // A key written with a selector pins a symbol drawn in the text slot.
    const theme = "## Fixed colors\n### Emoji\n- ⏷️ #E5484D\n";
    expect(runOf(entries("Sort ⏷ by", theme), "⏷")?.color).toBe(solid("#E5484D"));
  });
});

// md2ui data/markdown/tests/tests-button-emoji-keys (content.md and THEME.md, the parts
// these cases read; font files dropped, the emoji family keeps its path as its name).
const KEYS_THEME = `## Links
Fill color: #1F2937
Padding: 10
Emoji gap: 16
Emoji weight: 700

### Secondary
Fill color: #00000000
Stroke color: #1F2937
Stroke width: 2

### Tertiary
Fill color: #00000000
Stroke color: #1F2937
Stroke width: 2
Emoji gap: 0
Emoji weight: 300

## Inline Code
Fill color: #EEEEEE
Padding: 6

### Secondary
Emoji weight: 700

## Emoji styles
Font: NotoEmoji-Regular.ttf

### Primary
Icon size: 40

### Secondary
Emoji weight: 700

### Tertiary
Emoji weight: 300

### Link
Color: #25845B

## Text Styles

Text
- Font size: 16
- Font color: #1F2937

Links
- Font size: 16
- Font color: #FFFFFF
`;

describe("Emoji gap and Emoji weight are painted as sized (md2ui 39da763c, ADR-400)", () => {
  // The measurer `paintMarkdown` uses: a run's advance in the font it is painted in.
  const fake = createFakeMeasurer();
  const end = (r: TextRun | undefined) => (r?.x ?? 0) + (r ? fake.advance(r.text, r.font) : 0);
  /** The one button of `md`: its pill, its emoji run and the run after it. */
  const button = (md: string) => {
    const list = entries(md, KEYS_THEME);
    const label = runs(list);
    const star = label.find((r) => r.text === "⭐");
    const save = label.find((r) => r.text === "Save");
    return { pill: fills(list)[0], label, star, save };
  };

  it("draws a button's emoji at its variant's weight", () => {
    expect(button("[⭐ Save](/x)").star?.font.weight).toBe(700);
    // Secondary inherits Primary's weight; Tertiary states its own.
    expect(button("*[⭐ Save](/x)*").star?.font.weight).toBe(700);
    expect(button("**[⭐ Save](/x)**").star?.font.weight).toBe(300);
    expect(button("[⭐](/x)").star?.font.weight).toBe(700);
  });

  it("leaves the gap unpainted and starts the words where the measurement put them", () => {
    const widths: number[] = [];
    for (const md of ["[⭐Save](/x)", "[⭐ Save](/x)", "[⭐   Save](/x)"]) {
      const { pill, label, star, save } = button(md);
      // No space is drawn: the gap replaces whatever was typed.
      expect(
        label.map((r) => r.text),
        md,
      ).toEqual(["⭐", "Save"]);
      expect(save?.x, md).toBeCloseTo(end(star) + 16, 9);
      // The label ends exactly where sizing's padding begins.
      expect(end(save), md).toBeCloseTo((pill?.shape.x ?? 0) + (pill?.shape.width ?? 0) - 10, 9);
      widths.push(pill?.shape.width ?? 0);
    }
    // The three Primary buttons are equally wide: none, one or three typed spaces.
    expect(new Set(widths).size).toBe(1);
    // `Emoji gap: 0` closes the gap, still painting no space.
    const tight = button("**[⭐ Save](/x)**");
    expect(tight.label.map((r) => r.text)).toEqual(["⭐", "Save"]);
    expect(tight.save?.x).toBeCloseTo(end(tight.star), 9);
  });

  it("draws a badge's and a chip's emoji at their variant's weight, prose at none", () => {
    const glyph = (md: string, text: string) => runOf(entries(md, KEYS_THEME), text)?.font;
    // Primary states no weight: the face's own.
    expect(glyph("⭐", "⭐")?.weight).toBe(400);
    expect(glyph("*⭐*", "⭐")?.weight).toBe(700);
    expect(glyph("**⭐**", "⭐")?.weight).toBe(300);
    expect(glyph("`⭐ Star`", "⭐")?.weight).toBe(400);
    expect(glyph("*`⭐ Star`*", "⭐")?.weight).toBe(700);
    expect(glyph("A sentence with a ⭐ star in it.", "⭐")?.weight).toBe(400);
  });

  it("sizes a chip for the weighted emoji it paints", () => {
    const list = entries("*`⭐ Star`*", KEYS_THEME);
    const [pill] = fills(list);
    const star = runOf(list, "⭐");
    const word = runs(list).at(-1);
    // The label sits centred in the pill sizing gave it: equal insets on both sides.
    const left = (star?.x ?? 0) - (pill?.shape.x ?? 0);
    const right = (pill?.shape.x ?? 0) + (pill?.shape.width ?? 0) - end(word);
    expect(right).toBeCloseTo(left, 9);
  });
});
