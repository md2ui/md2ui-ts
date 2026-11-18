import inter from "@fontsource/inter/files/inter-latin-400-normal.woff2?url";
import interBold from "@fontsource/inter/files/inter-latin-700-normal.woff2?url";
import space from "@fontsource/space-grotesk/files/space-grotesk-latin-400-normal.woff2?url";
import spaceBold from "@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2?url";
import work from "@fontsource/work-sans/files/work-sans-latin-400-normal.woff2?url";
import workBold from "@fontsource/work-sans/files/work-sans-latin-700-normal.woff2?url";
import type { FontSource, FontSpec, TextSpan } from "@md2ui/contracts";

export const BREAK = String.fromCodePoint(0x2028);

export interface TestFont {
  readonly family: string;
  readonly sources: readonly FontSource[];
}

export const TEST_FONTS: readonly TestFont[] = [
  { family: "md2ui-test-inter", urls: [inter, interBold] },
  { family: "md2ui-test-work-sans", urls: [work, workBold] },
  { family: "md2ui-test-space-grotesk", urls: [space, spaceBold] },
].map(({ family, urls: [regular, bold] }) => ({
  family,
  sources: [
    { family, url: regular ?? "", weight: 400 },
    { family, url: bold ?? "", weight: 700 },
  ],
}));

export const INTER_REGULAR_URL: string = inter;

export function spec(family: string, weight = 400, size = 16): FontSpec {
  return { families: [family, "sans-serif"], size, weight, italic: false };
}

/** The font as a theme names it: its face alone, with no generic family after it. */
export function themeSpec(family: string, weight = 400, size = 16): FontSpec {
  return { families: [family], size, weight, italic: false };
}

/**
 * Characters the test fonts' Latin subsets lack, so each is measured in a fallback face:
 * Unicode spaces (whipsaw's `12:30 PM Client Meeting` is written with an em space),
 * Cyrillic, Greek and Hebrew.
 */
export const UNHELD =
  "12:30\u00a0PM\u2003Client Meeting \u2001\u2004\u2005\u2006\u2008\u200a\u205f \u0416\u03a9\u05d0";

/** Two paragraphs (regular + bold spans) joined by a hard break. */
export function twoParagraphs(family: string): readonly TextSpan[] {
  return [
    { text: "Open the ", font: spec(family) },
    { text: "Settings", font: spec(family, 700) },
    {
      text: `. Then pick a theme from the list and save it.${BREAK}Second paragraph is `,
      font: spec(family),
    },
    { text: "shorter but still wraps", font: spec(family, 700) },
    { text: " when narrow.", font: spec(family) },
  ];
}
