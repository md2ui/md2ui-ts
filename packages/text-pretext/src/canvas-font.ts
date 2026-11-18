import type { FontSpec } from "@md2ui/contracts";
import { cssFont, isGenericFamily } from "./css-font.ts";

/** VARIATION SELECTOR-15 and -16: text presentation and emoji presentation. */
const TEXT_PRESENTATION = "\uFE0E";
const EMOJI_PRESENTATION = "\uFE0F";

/** A font string no theme uses, set between two fonts so that neither repeats. */
const PLACEHOLDER = "1px serif";

/**
 * Family → CSS `font-variation-settings`: the variable-font instances a page registered
 * (`FontFaceSource.variationSettings`), for an engine that cannot set them on a face.
 */
export type FontVariations = ReadonlyMap<string, string>;

/**
 * Sets `font` on a canvas context so that it measures or draws with the face as it is
 * now. WebKit keeps a context's font resolution while `font` is set to the same string
 * again, even after a web face for it has loaded, so the string
 * is never set twice in a row (ADR-403).
 *
 * An engine without `FontFace` `variationSettings` (WebKit) still applies
 * the canvas element's own `font-variation-settings` when `font` is set: on a page's
 * canvas, an instance in `variations` is drawn that way, and any other font with the
 * page's own settings. An `OffscreenCanvas` has no style, so it draws the font's
 * default there.
 */
export function setCanvasFont(
  ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
  font: FontSpec,
  variations?: FontVariations,
): void {
  if (variations !== undefined && variations.size > 0 && "style" in ctx.canvas && !facesVary()) {
    const settings = variations.get(font.families[0] ?? "") ?? "";
    const { style } = ctx.canvas;
    if (style.fontVariationSettings !== settings) style.fontVariationSettings = settings;
  }
  ctx.font = PLACEHOLDER;
  ctx.font = cssFont(font);
}

/** Whether a `FontFace` can carry its own variation settings (no WebKit). */
function facesVary(): boolean {
  return typeof FontFace === "undefined" || "variationSettings" in FontFace.prototype;
}

/** The same rule for the context Pretext keeps for the page, which only Pretext sets. */
export function placeholderFont(): string {
  return PLACEHOLDER;
}

/**
 * `text` as the canvas is handed it, measuring and painting alike, in `font`. Chromium
 * and Firefox draw any character followed by VS16 in the system's colour emoji font,
 * even when the first family named has the glyph, so a theme's
 * named emoji face, its tint and its `## Fixed colors` pins never reach it. In a font
 * whose first family is a named face, VS16 is handed over as VS15, which those engines
 * draw in that face, as md2ui does; WebKit draws both in it. The generic `emoji` family
 * asks for colour, so it keeps VS16. VS15 is one UTF-16 unit, as VS16 is: no offset moves.
 */
export function canvasText(text: string, font: FontSpec): string {
  const first = font.families[0];
  return first === undefined || isGenericFamily(first)
    ? text
    : text.replaceAll(EMOJI_PRESENTATION, TEXT_PRESENTATION);
}

/**
 * A piece of a text `canvasText` respelled, spelled back as authored, so pins, graphemes
 * and offsets never see the substitute. A text that already held VS15 of its own and
 * VS16 in a named face comes back with VS16 for both.
 */
export function authoredText(piece: string): string {
  return piece.replaceAll(TEXT_PRESENTATION, EMOJI_PRESENTATION);
}
