// The published build (ADR-006): ESM only, with declarations and no source maps. Vue is a
// peer and @md2ui/dom a dependency: both stay imports, never inlined.
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist/lib",
  format: "esm",
  platform: "browser",
  target: "es2024",
  dts: true,
});
