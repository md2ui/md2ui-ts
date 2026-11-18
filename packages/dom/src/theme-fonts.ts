// The host fonts a theme draws in: all of them a thread loads, the page, which paints
// with them, and the pipeline's Worker, which measures with them. A face the theme does
// not draw in is never loaded.
import type { FontSource, ResolvedTheme } from "@md2ui/contracts";
import { emojiFamilies, themeFamilies, themeValues } from "./theme.ts";

/**
 * Those of the host's `fonts` the theme draws in: the families its text styles name and
 * those its emoji font paths name (`emojiFamilies`), matched as CSS matches a family,
 * without regard to case. A thread loads these and no other: every face it loads holds
 * its own copy of the font's data.
 */
export function themeFonts(
  theme: ResolvedTheme,
  fonts: readonly FontSource[],
  pageBase: string,
): FontSource[] {
  const emoji = emojiFamilies(fonts, pageBase);
  const drawn = new Set([
    ...themeFamilies(theme).map((family) => family.toLowerCase()),
    ...themeValues(theme, "font_path").map((path) => emoji(path).toLowerCase()),
  ]);
  return fonts.filter((font) => drawn.has(font.family.toLowerCase()));
}
