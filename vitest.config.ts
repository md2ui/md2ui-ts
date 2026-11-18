// Test projects (ADR-004): `node` for everything that neither measures nor paints,
// `browser` (real engines through Playwright) for everything that does. A test file
// chooses by name: `*.browser.test.ts` runs in the browser, any other `*.test.ts` in
// Node. The browser project has one instance per engine, each its own project:
// `browser (chromium)` runs in `pnpm check`; `pnpm check:browsers` runs all three,
// because Safari is the iOS engine and text metrics differ between engines.
// `*.protocol.test.ts` runs in Node against md2ui's protocol/ folder, named by
// MD2UI_PROTOCOL; `pnpm check` runs that project only when the variable is set.
// `*.perf.browser.test.ts` holds timing budgets: it runs in the `perf` projects only,
// through `pnpm perf` on an idle machine, never in the correctness gate (ADR-004).
import { cwd, env } from "node:process";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";

// The fixtures directory, passed as an argument (AGENTS.md), never hard-coded. Browser
// tests receive it through `inject("md2uiFixtures")` and may read files under it.
const fixtures = env["MD2UI_FIXTURES"] || undefined;

const roots = ["packages", "tools", "apps"].map((dir) => `${dir}/*/test/**`);

export default defineConfig({
  test: {
    passWithNoTests: false,
    projects: [
      {
        test: {
          name: "node",
          environment: "node",
          include: ["test/*.test.ts", ...roots.map((root) => `${root}/*.test.ts`)],
          exclude: roots.flatMap((root) => [
            `${root}/*.browser.test.ts`,
            `${root}/*.protocol.test.ts`,
          ]),
        },
      },
      {
        test: {
          name: "protocol",
          environment: "node",
          include: roots.map((root) => `${root}/*.protocol.test.ts`),
        },
      },
      {
        test: {
          name: "browser",
          provide: { md2uiFixtures: fixtures ?? "" },
          // A second origin, serving pictures without CORS headers (test/cross-origin.ts).
          globalSetup: ["test/cross-origin.ts"],
          include: roots.map((root) => `${root}/*.browser.test.ts`),
          exclude: roots.map((root) => `${root}/*.perf.browser.test.ts`),
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }],
          },
        },
        server: { fs: { allow: fixtures === undefined ? [cwd()] : [cwd(), fixtures] } },
      },
      {
        test: {
          name: "perf",
          provide: { md2uiFixtures: fixtures ?? "" },
          include: roots.map((root) => `${root}/*.perf.browser.test.ts`),
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }, { browser: "firefox" }, { browser: "webkit" }],
          },
        },
        server: { fs: { allow: fixtures === undefined ? [cwd()] : [cwd(), fixtures] } },
      },
    ],
  },
});
