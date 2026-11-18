# Pretext upstream PR (prepared, not opened): one measuring context per font

**For the owner, who decides whether to open it.** Target: `chenglou/pretext`, from
md2ui-ts's `patches/@chenglou__pretext@0.0.9.patch`.

Pretext is at 0.0.x and moves fast: the diff below is against the `src/measurement.ts` that
`@chenglou/pretext@0.0.9` publishes (the package ships its `src/`), not against the
repository's `main`, so it will likely need rebasing before it is opened. Check, when
rebasing, that nothing in the repository's tests or benchmarks (which the package does not
ship) imports `getMeasureContext`, which the change makes private.

## The change

Pretext keeps one module-level canvas context and sets its `font` before measuring each
font's segments. The change keeps one context per font string, its `font` set once when it
is made, tied to that font's segment-metric cache, and cleared with the caches by
`clearCache()`. What is measured does not change; which context measures it does.

md2ui-ts applies the same change to `dist/measurement.js` (the patch file); this is its
source equivalent. It type-checks with the rest of 0.0.9's `src/` (`tsc --strict
--noUnusedLocals`, 2026-11-06).

```diff
--- a/src/measurement.ts
+++ b/src/measurement.ts
@@ -17,8 +17,15 @@
 
 export type BreakableFitMode = 'sum-graphemes' | 'segment-prefixes' | 'pair-context'
 
-let measureContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null
+type MeasureContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
+
+// One measuring context per font string, its font set once. Firefox gets slower with
+// every font change followed by a measurement in a Worker (each batch of 2,000 calls
+// 55 -> 131 -> 204 -> 280 -> 364 ms on one shared context); a context whose font never
+// changes stays flat in every engine.
+const fontContexts = new Map<string, MeasureContext>()
 const segmentMetricCaches = new Map<string, Map<string, SegmentMetrics>>()
+const cacheContexts = new WeakMap<Map<string, SegmentMetrics>, MeasureContext>()
 let cachedEngineProfile: EngineProfile | null = null
 
 // Safari's prefix-fit policy is useful for ordinary word-sized runs, but letting
@@ -31,27 +38,34 @@
 const maybeEmojiRe = /[\p{Emoji_Presentation}\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u20E3]/u
 const emojiCorrectionCache = new Map<string, number>()
 
-export function getMeasureContext(): CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D {
-  if (measureContext !== null) return measureContext
-
+function createMeasureContext(): MeasureContext {
   if (typeof OffscreenCanvas !== 'undefined') {
-    measureContext = new OffscreenCanvas(1, 1).getContext('2d')!
-    return measureContext
+    return new OffscreenCanvas(1, 1).getContext('2d')!
   }
 
   if (typeof document !== 'undefined') {
-    measureContext = document.createElement('canvas').getContext('2d')!
-    return measureContext
+    return document.createElement('canvas').getContext('2d')!
   }
 
   throw new Error('Text measurement requires OffscreenCanvas or a DOM canvas context.')
 }
 
+function getFontContext(font: string): MeasureContext {
+  let ctx = fontContexts.get(font)
+  if (ctx === undefined) {
+    ctx = createMeasureContext()
+    ctx.font = font
+    fontContexts.set(font, ctx)
+  }
+  return ctx
+}
+
 export function getSegmentMetricCache(font: string): Map<string, SegmentMetrics> {
   let cache = segmentMetricCaches.get(font)
   if (!cache) {
     cache = new Map()
     segmentMetricCaches.set(font, cache)
+    cacheContexts.set(cache, getFontContext(font))
   }
   return cache
 }
@@ -59,7 +73,7 @@
 export function getSegmentMetrics(seg: string, cache: Map<string, SegmentMetrics>): SegmentMetrics {
   let metrics = cache.get(seg)
   if (metrics === undefined) {
-    const ctx = getMeasureContext()
+    const ctx = cacheContexts.get(cache)!
     metrics = {
       width: ctx.measureText(seg).width,
     }
@@ -128,8 +142,7 @@
   if (correction !== undefined) return correction
 
   const fontSize = parseFontSize(font)
-  const ctx = getMeasureContext()
-  ctx.font = font
+  const ctx = getFontContext(font)
   const canvasW = ctx.measureText('\u{1F600}').width
   correction = 0
   if (
@@ -252,8 +265,6 @@
   cache: Map<string, SegmentMetrics>
   emojiCorrection: number
 } {
-  const ctx = getMeasureContext()
-  ctx.font = font
   const cache = getSegmentMetricCache(font)
   const emojiCorrection = needsEmojiCorrection ? getEmojiCorrection(font) : 0
   return { cache, emojiCorrection }
@@ -262,4 +273,5 @@
 export function clearMeasurementCaches(): void {
   segmentMetricCaches.clear()
   emojiCorrectionCache.clear()
+  fontContexts.clear()
 }
```

## Why: Firefox slows down with every font change in a Worker

Measured by md2ui-ts (D10 report, "Merge and Firefox workaround", 2026-10-06; Firefox
Nightly build 1543 under Playwright 1.63):

- **Bare probe, no md2ui or Pretext code.** A Worker measures with the Inter 18pt web font from md2ui's fixtures,
  in batches of 2,000 measurements over 10 font strings, ms per batch:

  | Engine | One shared context | One context per font |
  |---|---|---|
  | Firefox | 55 → 131 → 204 → 280 → 364 (grows every batch) | 8 → 5 → 6 → 7 → 6 (flat) |
  | Chromium | 6–9 | 5–7 |
  | WebKit | 14–16 | 10–15 |

  Setting the font alone (5 ms) or measuring alone (2 ms) stays flat; it is the
  alternation that grows, and only with web fonts (`sans-serif` is flat at 10 ms).
- **Through md2ui-ts's pipeline**, which measures with Pretext: one document's `render`
  in a Firefox Worker grew from 516 to 2,455 ms over five calls before the change; after
  it, eight calls ran 1414/218, 201/109, 171/87, 138/75, 132/37, 93/50, 84/40, 82/200 ms
  (md2ui's `prepare`/`render`).
  Chromium and WebKit were unchanged on both threads.

## PR description

> **Measure each font on its own canvas context**
>
> Pretext sets the shared measuring context's `font` before measuring each font's
> segments. In Firefox, inside a Worker and with web fonts, every font change followed by
> a measurement makes later measurements slower, without bound: a probe of 2,000
> measurements over 10 fonts went 55 → 131 → 204 → 280 → 364 ms per batch on one
> context, and stayed at 5–8 ms with one context per font. Chromium and WebKit are flat
> either way (5–16 ms).
>
> This keeps one context per font string, its `font` set once, looked up through the
> font's segment-metric cache, and drops the contexts in `clearMeasurementCaches()` with
> the caches, so `clearCache()` after a web font loads still starts afresh. Measured
> widths do not change.
>
> The cost is one small canvas context per distinct font string in use; a document
> typically uses a handful.
>
> We have shipped this as a patch of 0.0.9 in md2ui-ts since October 2026, across
> Chromium, Firefox and WebKit, on the main thread and in a Worker.
