// The resize cases (resize-cases.ts) on the main thread, where the layout of a new width
// is painted in the frame the width changed in.
import { frame, resizeCases } from "./resize-cases.ts";

/**
 * Until the frame after a size is set: its own frame's callbacks run before the resize
 * is observed, so the view's paint then is seen at the start of the next.
 */
resizeCases({ worker: false }, async () => {
  await frame();
  await frame();
});
