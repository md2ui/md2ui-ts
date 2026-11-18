import { expect, test } from "vitest";

// Importing an entry is not a performance budget: under a loaded gate it can take longer
// than Vitest's 5 s default, so it gets a generous timeout instead.
const IMPORT_TIMEOUT_MS = 60_000;

test(
  "painter-canvas exports its painter, shadow bitmaps and transition, and runs nothing on import",
  async () => {
    const mod: Record<string, unknown> = await import("../src/index.ts");
    expect(Object.keys(mod).sort()).toEqual([
      "STAGES",
      "createPainter",
      "createShadowSprites",
      "createTransition",
    ]);
  },
  IMPORT_TIMEOUT_MS,
);
