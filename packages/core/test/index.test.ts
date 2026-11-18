import { expect, test } from "vitest";

// Importing an entry is not a performance budget: under a loaded gate it can take longer
// than Vitest's 5 s default, so it gets a generous timeout instead.
const IMPORT_TIMEOUT_MS = 60_000;

test(
  "core loads with no side effects and exports exactly its stages",
  async () => {
    const mod: Record<string, unknown> = await import("../src/index.ts");
    expect(Object.keys(mod).sort()).toEqual([
      "RegexKit",
      "actionTargets",
      "alignNodeIds",
      "applicable",
      "autoLayout",
      "bakeLayout",
      "closedPrefix",
      "codeBlockPlan",
      "codeLanguages",
      "createFakeMeasurer",
      "detectDataPoints",
      "diffDisplayLists",
      "documentShape",
      "documentSizer",
      "effectiveWidth",
      "emojiVariations",
      "generate",
      "groupDocument",
      "groupMarkdown",
      "groupPhases",
      "holderIds",
      "keptShare",
      "layoutInput",
      "loadCodeHighlighter",
      "paintScene",
      "parseTheme",
      "placeScene",
      "resolveThemeAssets",
      "ruleApplicable",
      "sceneText",
      "shapeShare",
      "sizingMeasurer",
      "targetTable",
    ]);
  },
  IMPORT_TIMEOUT_MS,
);
