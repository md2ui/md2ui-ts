// What vitest.config.ts provides to browser and perf tests.
declare module "vitest" {
  interface ProvidedContext {
    /** The fixtures directory from MD2UI_FIXTURES, or "" when it is not set. */
    md2uiFixtures: string;
    /** A second origin whose pictures carry no CORS headers (test/cross-origin.ts). */
    crossOrigin: string;
  }
}

export {};
