// @md2ui/core — Markdown + theme -> display list (ADR-003). No DOM, no module-level
// mutable state, nothing runs on import.

export { actionTargets, type DocumentTarget, targetTable } from "./actions/targets.ts";
export { type ClosedPrefix, closedPrefix } from "./group/code-blocks.ts";
export { detectDataPoints } from "./group/detect/detector.ts";
export type { DataPoint, DetectedPoint } from "./group/detect/types.ts";
export { groupDocument, groupMarkdown, groupPhases } from "./group/grouper.ts";
export type { GroupNode } from "./group/node.ts";
export { RegexKit } from "./group/py/re.ts";
export { applicable, type Criterion, ruleApplicable } from "./group/split/criteria.ts";
export { autoLayout } from "./layout/auto.ts";
export { bakeLayout } from "./layout/bakes.ts";
export { generate } from "./layout/generate.ts";
export { type LayoutInput, layoutInput } from "./layout/input.ts";
export type { KvRole, LayoutMeasurer, LeafInputs } from "./layout/measurer.ts";
export type { LayoutNode } from "./layout/node.ts";
export { effectiveWidth } from "./layout/width.ts";
export { type CodeBlockPlan, codeBlockPlan } from "./measure/code-blocks.ts";
export { type EmojiVariation, emojiVariations } from "./measure/font-set.ts";
export { documentSizer, type SizingOptions, sizingMeasurer } from "./measure/sizing.ts";
export type { Scene } from "./scene/boxes.ts";
export { alignNodeIds, diffDisplayLists, holderIds, keptShare } from "./scene/diff.ts";
export { type PaintedScene, paintScene } from "./scene/display-list.ts";
export {
  codeLanguages,
  type LoadedHighlighter,
  loadCodeHighlighter,
} from "./scene/highlight.ts";
export { placeScene } from "./scene/scene.ts";
export { type DocumentShape, documentShape, shapeShare } from "./scene/shape.ts";
export { type LineRun, type SceneText, sceneText, type TextGroup } from "./scene/text-layer.ts";
export { createFakeMeasurer } from "./text/fake-measurer.ts";
export { resolveThemeAssets } from "./theme/assets.ts";
export { parseTheme } from "./theme/parse.ts";
