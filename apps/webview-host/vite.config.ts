import { defineConfig } from "vite";

// Relative URLs, so the build works from whatever origin the app's local server gives
// it. The samples, themes and icon font are the site's: served from its public folder
// rather than copied. <md2ui-view>'s pipeline Worker is built as an ES module, so the
// code-block grammars it loads on demand stay chunks of their own (Vite's default Worker
// format inlines every one of them into the Worker's file).
export default defineConfig({
  base: "./",
  publicDir: "../site/public",
  build: { outDir: "dist", emptyOutDir: true },
  worker: { format: "es" },
});
