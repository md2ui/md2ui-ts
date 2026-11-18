import { expect, test } from "vitest";

// Importing an entry is not a performance budget: under a loaded gate it can take longer
// than Vitest's 5 s default, so it gets a generous timeout instead.
const IMPORT_TIMEOUT_MS = 60_000;

test(
  "importing the entry has no side effects and exports the documented runtime names",
  async () => {
    const before = Object.keys(globalThis).sort();
    const mod: Record<string, unknown> = await import("../src/index.ts");
    expect(Object.keys(globalThis).sort()).toEqual(before);
    expect(Object.keys(mod).sort()).toEqual([
      "WireFrameError",
      "connectWebSocket",
      "createWireClient",
      "decodeClientFrame",
      "decodeServerFrame",
      "encodeClientFrame",
    ]);
  },
  IMPORT_TIMEOUT_MS,
);
