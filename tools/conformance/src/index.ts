// @md2ui/conformance — dev-only conformance runner against md2ui's fixtures (ADR-002,
// ADR-005). Never a dependency of a package. Its entry is the interface a ported
// stage registers against (`stages.ts`); the runner itself is the `conformance` script.
export type { Divergence, DivergenceClass } from "./divergence.ts";
export type {
  BoxesInput,
  LayoutInput,
  LayoutResult,
  PhaseTrees,
  SplitCriteriaStage,
  Stages,
  ThemeSource,
} from "./stages.ts";
