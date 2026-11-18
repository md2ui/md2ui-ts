// The emoji font instances a theme asks for (md2ui ADR-407), made from the host's fonts.
// Only the session uses it, so a view that measures in a Worker never ships it.
import type { FontSource, ResolvedTheme } from "@md2ui/contracts";
import { emojiVariations } from "@md2ui/core";
import type { FontFaceSource } from "@md2ui/text-pretext";
import { emojiFamilies } from "./theme.ts";

/**
 * The emoji font instances the theme's emoji keys ask for (core `emojiVariations`), each
 * made from the host's file of the font it varies: of that family's upright sources, the
 * one nearest the weight asked, the lighter of two equally near (md2ui
 * `font_loader._nearest_weight`), registered at the weight asked with the variation's
 * other axes.
 */
export function emojiInstances(
  theme: ResolvedTheme,
  fonts: readonly FontSource[],
  pageBase: string,
): FontFaceSource[] {
  return emojiVariations(theme, emojiFamilies(fonts, pageBase)).flatMap((variation) => {
    const asked = variation.weight ?? 400;
    const weightOf = (font: FontSource): number => font.weight ?? 400;
    // Nearer first, then lighter: the order of md2ui's `min` key.
    const rank = (font: FontSource): number =>
      Math.abs(weightOf(font) - asked) * 1000 + weightOf(font);
    const upright = fonts.filter((font) => font.family === variation.base && font.italic !== true);
    const source = upright.reduce<FontSource | undefined>(
      (best, font) => (best === undefined || rank(font) < rank(best) ? font : best),
      undefined,
    );
    if (source === undefined) return [];
    const { settings } = variation;
    return [
      {
        family: variation.family,
        url: source.url,
        weight: variation.weight ?? weightOf(source),
        ...(settings === "" ? {} : { variationSettings: settings }),
      },
    ];
  });
}
