// @md2ui/text-pretext — the text layer: a measurer backed by Pretext, in the browser
// (ADR-003, ADR-403). It exports the measurer factory, the one routine that sets a canvas
// font and the one that spells a text for the canvas, which the painter shares so a font
// is set, and a text handed over, the same way for measuring and painting (ADR-403). It also exports the font loader the factory uses: a view
// whose measurer runs in a Worker still loads the same faces into the page, where it
// paints (C6), and whether a family is a CSS generic one, which no host face can be.
// The CSS font shorthand is exported for the DOM text a view lays over its paint, so the
// browser lays that text out in the font string the canvas paints with.
// No module-level mutable state; nothing runs on import.
export { canvasText, type FontVariations, setCanvasFont } from "./canvas-font.ts";
export { cssFont, isGenericFamily } from "./css-font.ts";
export { createFontFaces, type FontFaceSource, type FontFaces, loadFonts } from "./fonts.ts";
export { createPretextMeasurer } from "./measurer.ts";
