# ADR-403: Pretext measures and breaks lines; the painter draws Pretext's lines

**Status:** active
**Domain:** renderer
**Read when:** measuring text, wrapping text, loading or setting a font, text is
clipped, a script renders wrongly, or you are checking text against md2ui.

## Decision

- **Text is measured and broken into lines by
  [Pretext](https://github.com/chenglou/pretext)** (`@chenglou/pretext`, MIT). It
  measures each text once and computes lines at any width by arithmetic. md2ui's own
  wrapping is **not** ported: a dedicated dependency solves what it can
  ([ADR-007](ADR-007-dependencies-first.md)).
- **Contract C3** ([ADR-005](ADR-005-packages-and-contracts.md),
  `packages/contracts/src/c3-measurer.ts`) asks questions about text, answered by
  Pretext (its width on one line, the narrowest width before a word breaks, its lines
  at a width), and three font-level questions (`advance`, `fontMetrics`, `inkBounds`).
  md2ui's generator asks questions about leaves and blocks; those belong to layout,
  which composes them from C3.
- **The browser does font fallback.** `measureText` and `fillText` fall back per
  glyph, so md2ui's `has_glyph` and `system_face` are not questions here.
- **Kerning and ligatures stay on.** Typography is the product; pixel parity is not a
  goal ([ADR-002](ADR-002-md2ui-is-the-oracle-for-structure.md)).
- **The painter draws exactly Pretext's lines:**
  - one `fillText` per styled span, at the layout's position;
  - it never wraps;
  - it never passes `fillText`'s `maxWidth`, which squeezes text instead of wrapping
    it.
- **md2ui ADR-402 is not inherited.** md2ui draws text unshaped; here the browser
  shapes it.
- **A space takes the style of the span it is written in, as in CSS.** md2ui gives a
  space the style of the word after it: in `⚡ **55**` it measures and paints the space
  bold. md2ui is consistent with itself, so this is a convention, not a defect there.

## How conformance still tests the code that ships

- **Under replay, Pretext itself runs, on md2ui's widths.** md2ui records every
  font-level answer. In tests, the replay feeds those answers to Pretext at the canvas
  `measureText` boundary it calls, mapping theme fonts to md2ui's font keys
  (`tools/text-conformance`).
- **What that proves:** md2ui and Pretext both wrap greedily at break opportunities.
  So wherever they find the same opportunities, the lines, layout and boxes must
  match md2ui exactly.
- **Where they differ, each difference is reported by its class,** never absorbed by
  a tolerance (`DivergenceClass` in `tools/conformance/src/divergence.ts`): hyphens,
  text without spaces, words longer than the line, punctuation attached to words, the
  space convention above, and the like. A difference no class explains fails the
  check. md2ui keeps its own rules: these classes are expected, not defects, and only
  the arrangement must match (ADR-002).
- **md2ui's engine artifacts are classified in the conformance tool, never reproduced
  in `packages/`.** The product answers with the browser's own numbers. Where md2ui's
  numbers differ only by how Skia computes them, the comparison names that difference
  as a class, proved from md2ui's recording, and everything else stays exact. The
  replay answers what md2ui measured, not what one of its callers made of it. Example:
  md2ui reads a marker's ink height as Skia's float32, where the browser gives a
  double; the class is `float32-height` (`tools/conformance/src/float32-height.ts`),
  and no `Math.fround` goes into the measurer.
- With md2ui's own font files and kerning and ligatures off, Chromium's `advance`
  matches md2ui's recorded answers. That is evidence for the replay boundary, not a
  product setting.

## Considered and rejected

- **Porting md2ui's wrapping.** It would be code to maintain that a dedicated library
  already does, with the engine that paints the text.
- **Adopting Pretext's break rules in md2ui.** Each side keeps the rules its own
  libraries give it.
- **Reproducing Skia's numbers in the product** (float32 rounding and the like): it
  would make the shipped code wrong for the browser to match a test oracle.

## Constraint created

Pretext's documented limits:
- **Browser only:** it needs `Intl.Segmenter`, Canvas 2D measurement and Unicode
  property escapes, so measuring tests run in the browser projects.
- **No bidi levels.**
- **`system-ui` / `-apple-system` are unsafe** on macOS; themes name concrete
  families.
- **Narrow widths:** emoji and complex scripts may break at grapheme boundaries.
- **Hyphenation** needs soft hyphens.
- **Supported modes:** `white-space: normal | pre-wrap` and `word-break: normal |
  keep-all`.

Fonts:
- **Load before measuring.** A web font loads before anything is prepared, and
  Pretext's cache is cleared when a font arrives; otherwise a text keeps its fallback
  width.
- **WebKit keeps a stale font:** setting a canvas `font` to the same string again
  after a web font loads keeps the fallback. Every canvas that sets fonts, the
  painter's included, goes through one shared routine, `setCanvasFont`, which never
  sets the same string twice in a row (md2ui ADR-400).
- **WebKit's canvas cannot switch kerning off.** No product setting depends on it.
- **Every font string ends in a generic family** (`cssFont` ends every stack in
  `serif`). A character none of a stack's faces holds is drawn in the browser's
  default family, and Firefox's default differs between the page and a Worker, so
  without it the Worker measures a glyph in one face that the page paints in another.

## Reconsider when

- A text behaviour md2ui needs cannot be expressed through Pretext.
- A divergence class turns out to change page structure on real documents and md2ui
  declines the better rule.
