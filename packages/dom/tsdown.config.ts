// The published build (ADR-006): ESM only, with declarations and no source maps, for the two
// entries, the page's (`@md2ui/dom`) and the Worker's (`@md2ui/dom/worker`), and the file
// of the Worker the element starts by default, which the page's entry names beside itself
// (`new URL("./pipeline-worker.js", import.meta.url)`) for the host's bundler to ship.
//
// @md2ui/dom is the one package a host installs for the element, so the internal packages
// it is built from (core, painter-canvas, text-pretext; contracts is types only) are
// devDependencies, inlined here, and their own runtime dependencies are this package's.
// Through text-pretext that inlines Pretext, which pnpm patches in this workspace only
// (`patchedDependencies`, a fix for Pretext in a Firefox Worker): the patched modules
// used ship in this output, under Pretext's licence (THIRD_PARTY_NOTICES.md), until
// Pretext releases the fix (ADR-007). `inlineOnly` fails the build if anything else would
// be inlined. The C6 types a host names (the actions, the load error, the properties) are
// inlined into the declarations, so a host installs @md2ui/dom alone to type what it handles.
//
// The page and the Worker are built apart: a chunk the two shared would hold, as one
// module, code each side's bundler could otherwise drop module by module (`sideEffects`),
// and the Worker a host ships grew that way. The package holds the session code twice
// instead; a host bundles each side once either way.
import { defineConfig, type UserConfig } from "tsdown";

const build: UserConfig = {
  outDir: "dist/lib",
  format: "esm",
  platform: "browser",
  target: "es2024",
  inlineOnly: [/^@md2ui\/(core|painter-canvas|text-pretext)($|\/)/, /^@chenglou\/pretext($|\/)/],
  dts: { resolve: ["@md2ui/contracts"] },
};

export default defineConfig([
  { ...build, entry: ["src/index.ts"] },
  { ...build, entry: ["src/worker.ts", "src/pipeline-worker.ts"] },
]);
