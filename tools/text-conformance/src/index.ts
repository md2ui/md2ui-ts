// @md2ui/text-conformance — dev-only. Runs the Pretext measurer on md2ui's recorded font
// answers and names every place its lines differ from md2ui's (ADR-002, ADR-403). Never
// a dependency of a package. Nothing runs on import.
export { causeOf, classifyDivergence, classifyGap } from "./classify.ts";
export { type CorpusText, corpusTexts } from "./corpus.ts";
export {
  faceKeyOf,
  indexRecords,
  plainAdvance,
  questionKey,
  type Records,
} from "./records.ts";
export {
  type FamilyFace,
  type Gap,
  installReplayCanvas,
  loadFaces,
  loadFamilies,
  type Measured,
  type Replayed,
  type ReplayLog,
  type ReplaySource,
  recordsSource,
} from "./replay-canvas.ts";
