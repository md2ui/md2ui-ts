# ADR-402: Paint with Canvas 2D from md2ui's own display list

**Status:** active
**Domain:** renderer
**Read when:** you change how anything reaches the screen, add a draw primitive, make
scrolling or resizing cheaper, handle a tap, or are tempted to hand layout to the DOM,
CSS or a native widget.

This is not md2ui ADR-402, which records the reference's unshaped text and is
not inherited ([ADR-403](ADR-403-pretext-measures-and-breaks-lines.md)).

## Decision

- **The core produces a display list:** plain data, versioned (contract C4 in
  [ADR-005](ADR-005-packages-and-contracts.md),
  `packages/contracts/src/c4-display-list.ts`). Its entries are the primitives md2ui
  draws (boxes, shadows, images, styled text lines, controls, paths, layers), each
  with its node id ([ADR-104](ADR-104-ids-come-from-content.md)) and its
  ink-inclusive bounds. A path is an outline no box describes (a line chart's line, a
  slider bar cut inside a rounded corner), as SVG path data, which a Canvas painter
  reads with `new Path2D(d)`.
- **C4's shape:**
  - **Colours** are CSS `#rrggbbaa` strings: what Canvas consumes and a host can
    read. md2ui's ARGB integers stay internal (C2).
  - **Actionable regions are their own list.** Each target has an ordinal, a kind
    and a tap rect, apart from the paint entries, so a tap on a shadow never clicks.
    The payload (href, agent slug, slider domain) is read by ordinal from the core's
    target table, the same table the wire uses.
  - **Anchors and targets live in C4,** because they are computed per width with the
    scene.
  - **A code block wider than its box scrolls sideways,** and one cut at `Max lines`
    scrolls down; its copy button is a target.
  - **A text run's font is a `FontSpec` (C3),** the one `setCanvasFont` sets for
    measuring and for painting.
- **The web painter draws that list with Canvas 2D.** No scene-graph or rendering
  framework sits in between.
- **An R-tree over the entries' bounds handles culling and hit-testing.** A frame draws
  only what meets the viewport, and a tap is a point query.
- **No DOM or CSS layout, and no native widgets.**
- **The display list is the boundary.** Another painter (GPU, or SVG for export or
  accessibility) consumes the same list.

## Reason

- **Markdown to screen with no design handoff and no native UI.** Graphics are the
  layer every toolkit is built on. Painting them directly keeps one layout engine:
  md2ui's.
- **CSS cannot do the deciding.** CSS Grid can draw a bento once it is decided, but
  it cannot decide one, and md2ui's bento is a solve under constraints
  (md2ui ADR-300).
- **Why Canvas 2D:**
  - **One normalization point.** Text is painted by the same engine Pretext measured it
    with (ADR-403), so md2ui ADR-400 holds by construction.
  - **No scene graph needed.** md2ui already does a scene graph's work: layout,
    positions and identity.
  - **The shape is already proven.** md2ui ADR-401 records the document once and
    replays it under the scroll with R-tree culling, which made its frames several
    times cheaper. Here the display list is the recording.
  - **The draw code ports directly.** Canvas 2D is close to Skia's API, so md2ui's draw
    code ports almost call for call.
  - **Nothing extra ships**, and no framework is forced on the host.
- **The pipeline leaves the main thread.** The core is DOM-free, so it runs in a
  Worker and hands the page a display list to paint
  ([ADR-006](ADR-006-package-shape-and-support.md)).

## Considered and rejected

| | Why not |
|---|---|
| **Konva** | Canvas 2D underneath, plus a scene graph md2ui does not need: dragging, transforms, a hidden hit canvas that draws every listening shape twice, and whole-layer redraws |
| **PixiJS** | Built for many moving objects. It rasterizes text into textures, which costs memory and must be redone on every pixel-ratio or zoom change. A document UI is mostly text |
| **CanvasKit** | Shapes text with its own engine, which conflicts with Pretext (ADR-403), and it is a download of several MB, against [ADR-001](ADR-001-the-client-runs-the-pipeline.md) |
| **SVG** | Selection, find-in-page and accessibility come free, but it is DOM: thousands of nodes on a long document, and expensive filter shadows. It remains a candidate second painter |
| **Whole-document tiles** | Nothing invalidates them when an image arrives or a code block scrolls; shadows are cached instead |

## Constraint created

- **Bounds include ink.** Every entry's bounds include everything it paints (shadow,
  bleed). They are computed where the entry is created, and nowhere else.
- **Accessibility, selection and find-in-page** are built as one layer in the host,
  from the same entries: the outline's elements hold the painted words, so no word is
  in the DOM twice, and a control is named by `aria-label`.
- **Links and actions are hit regions,** not `<a>` elements.
- **Blurred shadows are cached as bitmaps, one per distinct shadow,** because blur
  dominates a frame's cost otherwise. They are drawn snapped to device pixels; crisp or
  clipped shadows are drawn directly. A shadow long enough is cached **sliced in nine**
  (its corners and one column and row of its edges, stretched to its length), so
  shadows that differ only in length share a bitmap, and a new width blurs a small
  square at most instead of every shape again. This rests on the blur of a straight
  edge stopping within a fixed reach of it (`BLUR_SIGMAS`), which a test checks in
  every engine. Ovals and
  shapes not much longer than their corners keep one whole bitmap.
- **A muted control fades as one layer** (`LayerEntry`): its entries are drawn on a
  scratch canvas and copied at the layer's opacity, as md2ui fades one layer, so
  overlapping parts do not show through each other. A layer is drawn again each frame,
  not cached; its cost is small in Chromium and Firefox and largest in WebKit.

## Reconsider when

- A frame cannot meet its budget even after culling and caching. A GPU painter then
  consumes the same list.
- Muted layers show up in a device profile: cache each layer's bitmap, as shadows are.
