// The faces a leaf is measured in are the faces it paints in (md2ui ADR-400): a link
// label in its variant's text style, and an emoji under a `### Text`
// or `### Link` font override in that override's face, and a heading
// in its own `Font Name`, else the body's.
import { expect, test } from "vitest";
import { RegexKit } from "../src/group/py/re.ts";
import { fontSet } from "../src/measure/font-set.ts";
import { linkLabelFonts } from "../src/measure/leaf-kit.ts";
import { sizedLeaf } from "../src/measure/node-index.ts";
import { applyKvRole, effectiveTextFonts } from "../src/measure/text-fonts.ts";
import { parseTheme } from "../src/theme/parse.ts";

const emojiFamily = (path: string | null): string => (path === null ? "OpenMoji" : path);

const link = (variant: string, emphasis: string | null = null) =>
  ({
    ...sizedLeaf({ type: "link", content: "x" } as never),
    link_variant: variant,
    link_emphasis: emphasis,
  }) as never;

test("a link label draws in its variant's family and weight, else the body's", () => {
  const theme = parseTheme(`## Text Styles

Text
- Font Name: Inter 18pt

Links
- Font weight: 700

Links Secondary
- Font Name: IBM Plex Mono

Links Text
- Font size: 20
`);
  const fonts = fontSet(theme, emojiFamily);
  expect(linkLabelFonts(new RegexKit(), link("primary"), fonts).face).toEqual({
    family: "Inter 18pt",
    weight: 700,
    italic: false,
  });
  expect(linkLabelFonts(new RegexKit(), link("secondary"), fonts).face).toEqual({
    family: "IBM Plex Mono",
    weight: 400,
    italic: false,
  });
  // A Text link names neither, so it keeps the body's faces, its emphasis picking one.
  expect(linkLabelFonts(new RegexKit(), link("text"), fonts).face).toBe(fonts.typeface);
  expect(linkLabelFonts(new RegexKit(), link("text", "bold_italic"), fonts).face).toBe(
    fonts.bold_italic,
  );
});

test("an unstyled link label is the body family, never Arial", () => {
  const theme = parseTheme("## Text Styles\n\nText\n- Font Name: Inter 18pt\n");
  expect(theme.links.primary.text_style?.font_name).toBe("");
  expect(linkLabelFonts(new RegexKit(), link("primary"), fontSet(theme, emojiFamily)).face).toEqual(
    {
      family: "Inter 18pt",
      weight: 400,
      italic: false,
    },
  );
});

// md2ui `layout_heading_style_tests.test_heading_honours_its_own_font_name`.
test("a heading draws in its own Font Name; unnamed, in the body's", () => {
  const theme = parseTheme(`## Text Styles

Text
- Font Name: Inter 18pt

Heading1
- Font Name: IBM Plex Mono
- Font size: 30

Heading2
- Font size: 24
`);
  const fonts = fontSet(theme, emojiFamily);
  const ctx = { table_role: null, heading_ctx: 0, text_style: null, text_style_chain: [] };
  const family = (level: number) =>
    effectiveTextFonts(`heading${level}`, level, fonts, theme, ctx).faces.typeface.family;
  expect(family(1)).toBe("IBM Plex Mono");
  // A heading block that names no family starts from the body's, never Arial.
  expect(theme.headings[2]?.font_name).toBe("");
  expect(family(2)).toBe("Inter 18pt");
  expect(fonts.typeface.family).toBe("Inter 18pt");
});

test("prose and link emoji are measured in their override's face; a heading's are not", () => {
  const theme = parseTheme(`## Emoji styles

### Text
Font: assets/fonts/Poppins-Regular.ttf

### Link
Font: assets/fonts/Poppins-Medium.ttf
`);
  const fonts = fontSet(theme, emojiFamily);
  expect(fonts.textEmoji).toBe("assets/fonts/Poppins-Regular.ttf");
  expect(fonts.linkEmoji).toBe("assets/fonts/Poppins-Medium.ttf");
  const ctx = { table_role: null, heading_ctx: 0, text_style: null, text_style_chain: [] };
  const prose = effectiveTextFonts("text", 0, fonts, theme, ctx);
  expect(prose.emoji).toBe(fonts.textEmoji);
  expect(effectiveTextFonts("heading2", 0, fonts, theme, ctx).emoji).toBe("OpenMoji");
  // A key-value role keeps the leaf's emoji face.
  expect(applyKvRole("value", prose, theme, fonts, ctx).emoji).toBe(fonts.textEmoji);
});
