import type { FontSpec } from "@md2ui/contracts";

const GENERIC_FAMILIES: readonly string[] = [
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "emoji",
  "math",
  "fangsong",
] as const;

/** Whether a family name is a CSS generic keyword (`emoji`, `sans-serif`) rather than a face. */
export function isGenericFamily(name: string): boolean {
  return GENERIC_FAMILIES.includes(name);
}

function cssFamily(name: string): string {
  if (isGenericFamily(name)) {
    return name;
  }
  return `"${name.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

/**
 * The family every stack ends in. Left to the browser, a character none of a stack's
 * faces holds is measured in another face in a Firefox Worker (sans-serif) than the page
 * paints it in (serif): an em space Inter's Latin subset lacks measured 4.17 px there and
 * painted 15 px at 15 px. Serif is the default the Chromium and Firefox
 * pages used; after a generic family the theme names, it is never reached.
 */
const FALLBACK = "serif";

/**
 * The canvas `font` shorthand for a font: what Pretext and `CanvasRenderingContext2D` both
 * read. It ends in `FALLBACK`, so every thread falls back alike.
 */
export function cssFont(font: FontSpec): string {
  const style = font.italic ? "italic " : "";
  const families = [...font.families, FALLBACK].map(cssFamily).join(", ");
  return `${style}${font.weight} ${font.size}px ${families}`;
}
