// The button ladder Quinary–Septenary, `Emoji gap` / `Emoji weight`, and the muted state's
// `Disabled …` colours on chips and badges. Each case mirrors md2ui's own test, named
// beside it.
import { expect, test } from "vitest";
import { parseTheme } from "../src/index.ts";
import { chipStyle, emojiBadgeStyle, linkStyle } from "../src/measure/theme-styles.ts";
import { argb } from "../src/theme/model.ts";

const rgb = (hex: string) =>
  argb(
    255,
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  );

// md2ui `button_emoji_keys_tests.test_the_keys_parse`.
test("Emoji gap and Emoji weight parse per variant, inheriting the base", () => {
  const t = parseTheme(
    "## Emoji styles\n### Primary\nEmoji weight: 300\n\n### Secondary\nEmoji weight: 700\n\n" +
      "## Links\nEmoji gap: 8\nEmoji weight: 600\n\n" +
      "### Secondary\nEmoji gap: 2\n\n### Tertiary\nEmoji weight: bold\n\n" +
      "## Inline Code\nEmoji weight: 500\n\n### Secondary\nEmoji weight: 950\n" +
      "\n### Tertiary\nEmoji weight: 200\n",
  );
  expect(emojiBadgeStyle(t, null).emoji_weight).toBe(300);
  expect(emojiBadgeStyle(t, "secondary").emoji_weight).toBe(700);
  expect(emojiBadgeStyle(t, "tertiary").emoji_weight).toBe(300); // Primary's
  expect([t.links.primary.emoji_gap, t.links.primary.emoji_weight]).toEqual([8, 600]);
  const secondary = linkStyle(t, "secondary");
  expect([secondary.emoji_gap, secondary.emoji_weight]).toEqual([2, 600]);
  expect(linkStyle(t, "tertiary").emoji_weight).toBe(600); // a bad weight is no key
  expect(chipStyle(t, null).emoji_weight).toBe(500);
  expect(chipStyle(t, "secondary").emoji_weight).toBe(500); // out of range
  expect(chipStyle(t, "tertiary").emoji_weight).toBe(200);
  expect(parseTheme("").links.primary.emoji_gap).toBeNull();
});

test("an Emoji weight is truncated to a whole weight; a negative gap is none", () => {
  const t = parseTheme("## Links\nEmoji weight: 450.9\nEmoji gap: -4\n");
  expect(t.links.primary.emoji_weight).toBe(450);
  expect(t.links.primary.emoji_gap).toBe(0);
  const kept = parseTheme("## Links\nEmoji gap: 6\nEmoji gap: wide\n");
  expect(kept.links.primary.emoji_gap).toBe(6);
});

// md2ui `link_variant_tests.test_small_ladder_blocks_and_text_styles_parse`.
test("### Quinary/Senary/Septenary and Links Quinary… are the small buttons", () => {
  const t = parseTheme(
    "## Links\n### Quinary\nCorner radius: 5\n### Senary\nCorner radius: 6\n" +
      "### Septenary\nCorner radius: 7\n\n## Text Styles\n" +
      "Links Quinary\n- Font size: 11\nLinks Senary\n- Font size: 12\n" +
      "Links Septenary\n- Font size: 13\n",
  );
  for (const [variant, n] of [
    ["quinary", 5],
    ["senary", 6],
    ["septenary", 7],
  ] as const) {
    const style = linkStyle(t, variant);
    expect(style.corner_radius).toBe(n);
    expect(style.text_style?.font_size).toBe(n + 6);
  }
  expect(t.links.text.corner_radius).toBeNull();
  expect(t.links.text.text_style).toBeNull();
});

// md2ui `link_variant_tests.test_quinary_block_is_the_small_button`.
test("a small button with no block of its own draws as Primary", () => {
  const t = parseTheme("## Links\nFill color: #111111\n### Quinary\nPadding: 4\n");
  const small = linkStyle(t, "quinary");
  expect(small.padding?.left).toBe(4);
  expect(small.fill_color).toBe(rgb("#111111"));
  expect(linkStyle(t, "senary")).toEqual(linkStyle(t, "primary"));
  expect(t.links.text.padding).toBeNull();
});

// md2ui `link_variant_tests.test_quinary_is_a_button_not_the_text_link` and
// `test_a_header_naming_no_button_style_targets_primary`: the retired names.
test("Pill names nothing: as a block or a variant it is Primary", () => {
  const t = parseTheme(
    "## Links\n### Pill\nFill color: #008800\n\n## Text Styles\nLinks Pill\n- Font size: 30\n",
  );
  expect(t.links.primary.fill_color).toBe(rgb("#008800"));
  expect(t.links.text.fill_color).toBeNull();
  expect(t.links.text.text_style).toBeNull();
  expect(linkStyle(t, "pill")).toBe(t.links.primary);
});

// md2ui `muted_element_tests.test_disabled_keys_parse_and_cascade`.
test("Disabled keys parse on chips and badges, and variants inherit them", () => {
  const t = parseTheme(
    "## Inline Code\nDisabled fill color: #EEEEF0\nDisabled text color: #96969D\n" +
      "Disabled stroke color: #E2E2E7\n\n### Secondary\nFill color: #E7F4EB\n\n" +
      "## Emoji styles\n### Primary\nDisabled background color: #EEEEF0\n" +
      "Disabled icon color: #96969D\nDisabled stroke color: #E2E2E7\n\n" +
      "### Secondary\nDisabled icon color: #112233\n",
  );
  for (const style of [chipStyle(t, null), chipStyle(t, "secondary")]) {
    expect(style.disabled_fill_color).toBe(rgb("#EEEEF0"));
    expect(style.disabled_text_color).toBe(rgb("#96969D"));
    expect(style.disabled_stroke_color).toBe(rgb("#E2E2E7"));
    expect(style.muted).toBe(false);
  }
  const badge = emojiBadgeStyle(t, null);
  expect(badge.disabled_bg_color).toBe(rgb("#EEEEF0"));
  expect(badge.disabled_icon_color).toBe(rgb("#96969D"));
  expect(badge.disabled_stroke_color).toBe(rgb("#E2E2E7"));
  const badge2 = emojiBadgeStyle(t, "secondary");
  expect(badge2.disabled_bg_color).toBe(rgb("#EEEEF0"));
  expect(badge2.disabled_icon_color).toBe(rgb("#112233"));
});

test("a Disabled colour that does not read leaves the key unset", () => {
  const t = parseTheme("## Inline Code\nDisabled fill color: grey\n");
  expect(t.inline_code.disabled_fill_color).toBeNull();
});

// md2ui `emoji_axis_keys_tests.test_the_keys_parse_and_inherit`.
test("Emoji fill, grade and optical size parse per variant, inheriting the base", () => {
  const t = parseTheme(
    "## Emoji styles\n### Primary\nEmoji fill: 1\nEmoji grade: -25\nEmoji optical size: AUTO\n\n" +
      "### Secondary\nEmoji fill: 0.5\n\n### Tertiary\nEmoji fill: 2\nEmoji optical size: 0\n\n" +
      "## Links\nEmoji grade: 100\nEmoji optical size: 24\n\n### Secondary\nEmoji fill: 0\n\n" +
      "## Inline Code\nEmoji optical size: auto\n\n### Secondary\nEmoji grade: 50\n",
  );
  expect(emojiBadgeStyle(t, null).emoji_axes).toEqual({
    fill: 1,
    grade: -25,
    optical_size: "auto",
  });
  expect(emojiBadgeStyle(t, "secondary").emoji_axes).toEqual({
    fill: 0.5,
    grade: -25,
    optical_size: "auto",
  });
  // An out-of-range value is no key.
  expect(emojiBadgeStyle(t, "tertiary").emoji_axes).toEqual({
    fill: 1,
    grade: -25,
    optical_size: "auto",
  });
  expect(linkStyle(t, "tertiary").emoji_axes).toEqual({ fill: null, grade: 100, optical_size: 24 });
  expect(linkStyle(t, "secondary").emoji_axes).toEqual({ fill: 0, grade: 100, optical_size: 24 });
  expect(chipStyle(t, null).emoji_axes).toEqual({ fill: null, grade: null, optical_size: "auto" });
  expect(chipStyle(t, "secondary").emoji_axes).toEqual({
    fill: null,
    grade: 50,
    optical_size: "auto",
  });
});

test("an emoji axis reads as Python float(): units, NaN and a wrong range are no key", () => {
  const t = parseTheme(
    "## Links\nEmoji fill: 0.25\nEmoji grade: 10\nEmoji optical size: 20\n" +
      "Emoji fill: 1.5\nEmoji grade: nan\nEmoji optical size: 20px\nEmoji optical size: -3\n",
  );
  expect(t.links.primary.emoji_axes).toEqual({ fill: 0.25, grade: 10, optical_size: 20 });
  expect(parseTheme("").links.primary.emoji_axes).toEqual({
    fill: null,
    grade: null,
    optical_size: null,
  });
});

test("one style's emoji axes never change another's", () => {
  const t = parseTheme(
    "## Emoji styles\n### Primary\nEmoji fill: 1\n\n### Secondary\nEmoji fill: 0\n",
  );
  expect(emojiBadgeStyle(t, null).emoji_axes.fill).toBe(1);
  expect(emojiBadgeStyle(t, "secondary").emoji_axes.fill).toBe(0);
});
