// What vitest.config.ts provides to browser tests.
declare module "vitest" {
  interface ProvidedContext {
    /** The fixtures directory from MD2UI_FIXTURES, or "" when it is not set. */
    md2uiFixtures: string;
  }
}

export {};
