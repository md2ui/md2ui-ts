// The published build (ADR-006): ESM only, with declarations and no source maps. The C5
// frame types are inlined into the declarations, so a host installs @md2ui/wire alone.
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist/lib",
  format: "esm",
  platform: "neutral",
  target: "es2024",
  dts: { resolve: ["@md2ui/contracts"] },
});
