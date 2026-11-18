// Asset references resolve to URLs against the base the host gives, never fetched.
import { expect, test } from "vitest";
import { parseTheme, resolveThemeAssets } from "../src/index.ts";

const THEME = `## Root
Background image: hero.png

## Styling & Spacing
### Heading 2
Background image: https://example.com/a.png

## Emoji styles
Font: fonts/emoji.ttf
### Text
Font: /abs/emoji.ttf

## Fonts
- fonts/Inter.ttf
- ../shared/Mono.ttf
- data:font/ttf;base64,AAAA
`;

test("relative references resolve beside the theme; URLs and absolute paths stay", () => {
  const theme = resolveThemeAssets(parseTheme(THEME), "https://cdn.example/themes/a/THEME.md");
  expect(theme.root.bg_image).toBe("https://cdn.example/themes/a/hero.png");
  expect(theme.sections[2]?.bg_image).toBe("https://example.com/a.png");
  expect(theme.emojis.font_path).toBe("https://cdn.example/themes/a/fonts/emoji.ttf");
  expect(theme.emojis.text.font_path).toBe("/abs/emoji.ttf");
  expect(theme.font_paths).toEqual([
    "https://cdn.example/themes/a/fonts/Inter.ttf",
    "https://cdn.example/themes/shared/Mono.ttf",
    "data:font/ttf;base64,AAAA",
  ]);
});

test("a base that is not a URL leaves every reference as written", () => {
  const parsed = parseTheme(THEME);
  expect(resolveThemeAssets(parsed, "not a url")).toEqual(parsed);
});

test("resolving returns a new theme and leaves the parsed one untouched", () => {
  const parsed = parseTheme(THEME);
  resolveThemeAssets(parsed, "https://cdn.example/t/THEME.md");
  expect(parsed.root.bg_image).toBe("hero.png");
});
