// md2ui reads a marker's ink height as Skia's `Rect.height()`: the float32 difference of
// the outline's edges (`render_metrics._text_ink`). C3 `inkBounds` is the browser's, in
// doubles, and the port keeps it so (ADR-403): the rounding is an artifact of md2ui's
// engine, classified here where a scene is compared, never reproduced in a package. Runs
// in Node and in the browser.
import type { Difference } from "./diff.ts";
import type { Divergence } from "./divergence.ts";
import { isObject, type Json } from "./json.ts";

/** Every outline height md2ui recorded, unrounded: the bottom edge minus the top. */
function outlineHeights(records: readonly Json[]): Set<number> {
  const heights = new Set<number>();
  for (const r of records) {
    if (!isObject(r) || r["q"] !== "outline" || !Array.isArray(r["a"])) continue;
    const [, , top, , bottom] = r["a"];
    if (typeof top === "number" && typeof bottom === "number") heights.add(bottom - top);
  }
  return heights;
}

/** A scene box's `height`, or undefined. */
function heightAt(scene: Json, index: number): number | undefined {
  const boxes = isObject(scene) ? scene["boxes"] : undefined;
  const box = Array.isArray(boxes) ? boxes[index] : undefined;
  const height = isObject(box) ? box["height"] : undefined;
  return typeof height === "number" ? height : undefined;
}

/**
 * The differences a `float32-height` divergence explains, each with its divergence. A box
 * qualifies when the port's height is a recorded outline's, bottom minus top in doubles,
 * and md2ui's is that height rounded to float32 (no other value passes). Then its `height`
 * differs by that rounding, and its `y` by at most the same amount: a box is placed by its
 * height top-aligned, centred or bottom-aligned, so by none, half or all of it. Any other
 * field of the box, and every other box, must still match exactly.
 */
export function float32Heights(
  expected: Json,
  actual: Json,
  records: readonly Json[],
  differences: readonly Difference[],
): Map<Difference, Divergence> {
  const proved = new Map<Difference, Divergence>();
  let heights: Set<number> | undefined;
  for (const d of differences) {
    const at = /^boxes\[(\d+)\]$/u.exec(d.path);
    if (at === null || (d.field !== "height" && d.field !== "y")) continue;
    const md2ui = heightAt(expected, Number(at[1]));
    const port = heightAt(actual, Number(at[1]));
    if (md2ui === undefined || port === undefined || md2ui === port) continue;
    if (Math.fround(port) !== md2ui) continue;
    heights ??= outlineHeights(records);
    if (!heights.has(port)) continue;
    const shift = Math.abs(Number(d.expected) - Number(d.actual));
    if (d.field === "y" && !(shift <= Math.abs(md2ui - port))) continue;
    proved.set(d, {
      class: "float32-height",
      text: `${d.path} ${d.field}: md2ui ${d.expected}, port ${d.actual}`,
      words: [],
    });
  }
  return proved;
}
