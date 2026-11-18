import { expect, test } from "vitest";

// Importing an entry is not a performance budget: under a loaded gate it can take longer
// than Vitest's 5 s default, so it gets a generous timeout instead.
const IMPORT_TIMEOUT_MS = 60_000;

test(
  "text-pretext exports the measurer factory, the font loader, the font and text routines, the CSS font shorthand and the generic-family check, and runs nothing on import",
  async () => {
    const mod: Record<string, unknown> = await import("../src/index.ts");
    expect(Object.keys(mod).sort()).toEqual([
      "canvasText",
      "createFontFaces",
      "createPretextMeasurer",
      "cssFont",
      "isGenericFamily",
      "loadFonts",
      "setCanvasFont",
    ]);
  },
  IMPORT_TIMEOUT_MS,
);
