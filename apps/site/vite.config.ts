import { defineConfig } from "vite";

// <md2ui-view> runs its pipeline in a module Worker that loads its code-block grammars on
// demand: built as an ES module, the Worker keeps them as chunks of their own (Vite's
// default Worker format inlines every one of them into the Worker's file).
export default defineConfig({
  worker: { format: "es" },
});
