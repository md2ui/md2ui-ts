// Theme input: text or URL, asset references resolved against the asset base.
import { expect, test } from "vitest";
import { emojiInstances } from "../src/emoji-instances.ts";
import { emojiFamilies, loadTheme, themeFamilies } from "../src/theme.ts";
import { themeFonts } from "../src/theme-fonts.ts";

const PAGE = "https://app.example/chat/";
const THEME = "## Root\nBackground image: hero.png\n";
const signal = new AbortController().signal;

test("theme text resolves assets against the asset base, else the page", async () => {
  const input = { themeSrc: null, themeText: THEME, assetBase: null };
  const onPage = await loadTheme(input, PAGE, signal);
  expect(onPage.theme.root.bg_image).toBe("https://app.example/chat/hero.png");
  const based = await loadTheme({ ...input, assetBase: "/themes/a/" }, PAGE, signal);
  expect(based.theme.root.bg_image).toBe("https://app.example/themes/a/hero.png");
});

test("theme text wins over a theme URL, whose folder is still the asset base", async () => {
  const input = { themeSrc: "../themes/b/THEME.md", themeText: THEME, assetBase: null };
  const { theme, error } = await loadTheme(input, PAGE, signal);
  expect(error).toBeNull();
  expect(theme.root.bg_image).toBe("https://app.example/themes/b/hero.png");
});

test("the theme's families are what the page's own faces are loaded for", async () => {
  const text = "## Styling & Spacing\n### Root\n#### Text\n- Font name: Inter\n";
  const { theme } = await loadTheme(
    { themeSrc: null, themeText: text, assetBase: null },
    PAGE,
    signal,
  );
  expect(themeFamilies(theme)).toContain("Inter");
});

test("an emoji font path draws in the family of the host font at that URL, else the platform's", async () => {
  const text = "## Emoji styles\nFont: fonts/OpenMoji.ttf\n";
  const { theme } = await loadTheme(
    { themeSrc: "/themes/a/THEME.md", themeText: text, assetBase: null },
    PAGE,
    signal,
  );
  const family = emojiFamilies(
    [
      { family: "Inter", url: "/fonts/Inter.woff2" },
      { family: "OpenMoji", url: "../themes/a/fonts/OpenMoji.ttf" },
    ],
    PAGE,
  );
  expect(family(theme.emojis.font_path)).toBe("OpenMoji");
  expect(family("https://elsewhere.example/Other.ttf")).toBe("emoji");
  expect(family(null)).toBe("emoji");
});

test("the fonts a theme draws in are its families, named in any case, and its emoji font's", async () => {
  const text = [
    "## Styling & Spacing",
    "### Root",
    "#### Text",
    "- Font name: inter",
    "## Emoji styles",
    "Font: fonts/OpenMoji.ttf",
    "",
  ].join("\n");
  const { theme } = await loadTheme(
    { themeSrc: "/themes/a/THEME.md", themeText: text, assetBase: null },
    PAGE,
    signal,
  );
  const inter = { family: "Inter", url: "/fonts/Inter.woff2" };
  const bold = { family: "Inter", url: "/fonts/Inter-Bold.woff2", weight: 700 };
  const moji = { family: "OpenMoji", url: "../themes/a/fonts/OpenMoji.ttf" };
  const other = { family: "Lora", url: "/fonts/Lora.woff2" };
  expect(themeFonts(theme, [inter, other, bold, moji], PAGE)).toEqual([inter, bold, moji]);
});

test("each emoji font instance the theme asks for is made from the host's file nearest its weight", async () => {
  const text = [
    "## Emoji styles",
    "Font: fonts/Icons.ttf",
    "### Primary",
    "Emoji fill: 1",
    "Emoji optical size: auto",
    "### Secondary",
    "Emoji weight: 600",
    "Emoji grade: -25",
    "Emoji optical size: 20",
    "## Links",
    "### Primary",
    "Emoji weight: 500",
    "",
  ].join("\n");
  const { theme } = await loadTheme(
    { themeSrc: "/themes/a/THEME.md", themeText: text, assetBase: null },
    PAGE,
    signal,
  );
  const fonts = [
    { family: "Icons", url: "../themes/a/fonts/Icons.ttf" },
    { family: "Icons", url: "/fonts/Icons-Bold.ttf", weight: 700 },
    { family: "Icons", url: "/fonts/Icons-Italic.ttf", weight: 600, italic: true },
  ];
  expect(emojiInstances(theme, fonts, PAGE)).toEqual([
    // `auto` states no optical size: the engine sizes it optically itself.
    {
      family: "Icons (FILL 1 opsz auto)",
      url: "../themes/a/fonts/Icons.ttf",
      weight: 400,
      variationSettings: '"FILL" 1',
    },
    // Secondary inherits Primary's fill; 600 is nearer 700 than 400, and italic is never taken.
    {
      family: "Icons (wght 600 FILL 1 GRAD -25 opsz 20)",
      url: "/fonts/Icons-Bold.ttf",
      weight: 600,
      variationSettings: '"FILL" 1, "GRAD" -25, "opsz" 20',
    },
    // A weight alone is the face's own weight, with no other axis.
    { family: "Icons (wght 500)", url: "../themes/a/fonts/Icons.ttf", weight: 500 },
  ]);
  // With no host file for the emoji font, the platform's emoji face draws, unvaried.
  expect(emojiInstances(theme, [], PAGE)).toEqual([]);
});
