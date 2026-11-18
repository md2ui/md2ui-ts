import { expect, test } from "vitest";

// Importing an entry is not a performance budget: under a loaded gate it can take longer
// than Vitest's 5 s default, so it gets a generous timeout instead.
const IMPORT_TIMEOUT_MS = 60_000;

test(
  "dom loads in Node with no side effects, and exports only the registration",
  async () => {
    // Any read of a browser global during the import is recorded.
    const globals = ["window", "document", "customElements", "HTMLElement"];
    const touched: string[] = [];
    for (const name of globals) {
      expect(name in globalThis).toBe(false);
      Object.defineProperty(globalThis, name, {
        configurable: true,
        get: () => {
          touched.push(name);
          return undefined;
        },
      });
    }
    try {
      const mod: Record<string, unknown> = await import("../src/index.ts");
      expect(Object.keys(mod)).toEqual(["defineMd2uiView"]);
    } finally {
      for (const name of globals) Reflect.deleteProperty(globalThis, name);
    }
    expect(touched).toEqual([]);
  },
  IMPORT_TIMEOUT_MS,
);

test(
  "every host module imports in Node without touching a window",
  async () => {
    expect(typeof globalThis.window).toBe("undefined");
    for (const load of [
      () => import("../src/element.ts"),
      () => import("../src/view.ts"),
      () => import("../src/pipeline.ts"),
      () => import("../src/highlight.ts"),
      () => import("../src/a11y.ts"),
      () => import("../src/images.ts"),
      () => import("../src/theme.ts"),
      () => import("../src/actions.ts"),
      () => import("../src/session.ts"),
      () => import("../src/sessions.ts"),
      () => import("../src/idle.ts"),
      () => import("../src/worker.ts"),
    ]) {
      await expect(load()).resolves.toBeDefined();
    }
  },
  IMPORT_TIMEOUT_MS,
);
