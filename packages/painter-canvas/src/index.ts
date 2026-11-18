// @md2ui/painter-canvas — the painter layer: paints a display list (C4) onto a Canvas 2D
// context it is given, with culling, hit-testing, pixel ratio and scrolling (ADR-003,
// ADR-402). No module-level mutable state; nothing runs on import.
export type { Context2D, DecodedImage, ImageLookup, ScrollOffset } from "./context.ts";
export type { Frame, Hit, Painter, View } from "./painter.ts";
export { createPainter } from "./painter.ts";
export { createShadowSprites, type ShadowSprites } from "./shadow-cache.ts";
export {
  createTransition,
  STAGES,
  type Stages,
  type Transition,
  type TransitionOptions,
} from "./transition.ts";
