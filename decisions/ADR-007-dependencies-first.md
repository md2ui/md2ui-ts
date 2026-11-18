# ADR-007: Dependencies first; write only what no dependency solves

**Status:** active
**Domain:** whole project
**Read when:** about to write code that a platform API or a library might already
provide (text, Unicode, dates, numbers, colours, URLs, spatial indexes, parsing,
validation), or patching a dependency.

## Decision

- **Prefer, in this order:**
  1. **the platform** (`Intl.Segmenter`, `Intl.NumberFormat`, `URL`, Canvas
     `TextMetrics`, WebCrypto, `FontFace`);
  2. **a dedicated dependency** that solves the whole problem;
  3. **our own code,** only for md2ui's own semantics: grouping rules, layout
     decisions, the theme's meaning, the display list.
- **A dependency qualifies when it is:**
  - maintained;
  - ESM, tree-shakeable and typed;
  - permissively licensed;
  - small enough for its package's size budget
    ([ADR-006](ADR-006-package-shape-and-support.md)).

  The change that adds it states its size, its licence and what it replaces.
- **A dependency used inside a ported stage must still pass conformance**
  ([ADR-002](ADR-002-md2ui-is-the-oracle-for-structure.md)). Where it answers
  differently from md2ui, the difference is classified and reported, as
  [ADR-403](ADR-403-pretext-measures-and-breaks-lines.md) does for line breaking.
  When the dependency's answer is the better one, md2ui decides whether to adopt it
  first.

### Port md2ui's behaviour, not its Python workarounds

md2ui solved many problems by hand, because Python and Skia gave it nothing better.
**Port what md2ui decides, never how it worked around its platform.** When a browser API
or a maintained library does the job, use it:

| md2ui did by hand | md2ui-ts uses |
|---|---|
| memos keyed on `id()`; caches that live across calls | **memos scoped to one call** (a `Map` dropped on return). **Cross-call caches** are a `WeakMap` keyed by immutable objects (the document, a node), or a key derived from content ([ADR-104](ADR-104-ids-come-from-content.md)), never a module-level cache. **An LRU or a size cap only when a measurement shows one is needed** |
| word-width and text caches | Pretext's own cache (ADR-403) |
| per-glyph font fallback; text shaping | the browser (`measureText` / `fillText` fall back and shape) |
| image download, a disk cache, SVG decoding | `fetch` with the browser's HTTP cache; `createImageBitmap` and the browser's SVG decoding; a per-view `Map` of decoded bitmaps |
| a recorded Skia picture for scrolling | the display list, a flatbush R-tree, and shadow bitmaps ([ADR-402](ADR-402-paint-graphics-directly.md)) |
| the window's event loop, width-gated rebuilds, polling | `requestAnimationFrame`, `ResizeObserver`, `IntersectionObserver`, `AbortController` to cancel stale loads, `requestIdleCallback` for deferrable work |
| process-level work queues | a `Worker`, with **Comlink** for the bridge (no hand-rolled `postMessage` protocol) |
| grapheme and word segmentation | `Intl.Segmenter` |
| the clipboard, focus, accessibility | the DOM's own APIs ([ADR-003](ADR-003-framework-agnostic-core.md), ADR-402) |
| Pygments syntax highlighting | **Shiki**, with its JavaScript regex engine (no WASM), languages and themes loaded on demand. md2ui's Pygments style names map to Shiki themes through one table |

**What stays hand-written, and why:**
- md2ui's own semantics: grouping, detection, layout decisions, the theme's meaning.
- The few Python behaviours conformance needs reproduced exactly
  (`packages/core/src/group/py/`: the regex dialect, `str` semantics, `pySum`,
  `pyRound`). Each `py/` helper names the md2ui behaviour it reproduces, and goes once
  md2ui stops depending on that behaviour.

**Emoji detection** uses a range table copied from md2ui. Unicode properties
(`\p{Extended_Pictographic}`, `\p{RGI_Emoji}` with the `v` flag) are the dedicated
solution. It goes to md2ui first (its `regex` module supports `\p{…}`), then here
([ADR-000](ADR-000-the-client-library-and-its-reference.md)). Until then, the port keeps
md2ui's table.

### A patched dependency ships inside our build, until upstream has the fix

When a dependency needs a change before its maintainers release one, md2ui-ts patches
it with pnpm (`patchedDependencies` in `pnpm-workspace.yaml`, the patch in `patches/`)
and offers the change upstream. A pnpm patch exists only inside this workspace: npm
gives a host the registry's copy. So:

- **The published package that uses it bundles it.** The dependency is only ever a
  `devDependency` (in a published `dependencies` list, a host would install the
  unpatched copy as well), the package's tsdown build inlines the modules it uses, and
  the dependency's copyright and licence ship in the package
  (`THIRD_PARTY_NOTICES.md`).
- **The gate enforces it** for any patched package: `pnpm packages shape` fails a
  packed package whose output imports one, or whose runtime dependencies reach one,
  directly or through workspace packages (`scripts/patched.ts`).
- **The exit condition:** once upstream releases the fix, drop the patch and the
  bundling, and depend on the dependency normally. The bundling must not outlive its
  reason.

**Pretext is patched today**, for one canvas context per font string: Firefox slows down
in a Worker every time the measuring font changes. It is inlined, through the internal
`@md2ui/text-pretext`, into `@md2ui/dom`'s build (ADR-006). The upstream change is
prepared in [`patches/pretext-upstream.md`](../patches/pretext-upstream.md). Stock
Pretext would only be slower in Firefox's Worker, never wrong: the patch changes which
context measures, not what it measures.

## Reason

- **Less code to maintain:** every line we write is a line to keep. A dedicated
  library is maintained by people who live in that problem, which matters most for
  text and Unicode.
- **Less dead code:** a dependency replaces code that would otherwise be hand-rolled
  "just in case".
- **Python's limits are not the browser's.** md2ui's workarounds exist because its
  platform lacked these tools; porting them would carry the burden without the reason.

## Considered and rejected

- **Depending on a patched package normally:** a host would get the registry's copy
  without the fix.
- **Hand-written code where a dependency answers differently from md2ui:** the
  difference is classified instead (ADR-403), and md2ui decides whether to adopt the
  dependency's answer.

## Constraint created

- **Every runtime dependency counts against a size budget.**
- **No dependency that pulls in a framework, a DOM requirement, or Node built-ins**
  goes into `contracts` or `core` (ADR-003, [ADR-004](ADR-004-repository-and-toolchain.md)).
- **A patched dependency's fixes reach hosts only through an md2ui-ts release,** and
  its bytes count against our budget. That is the accepted trade-off.

## Reconsider when

- A dependency becomes unmaintained or outgrows its budget. Replace it, behind the same
  contract.
- Upstream releases a patched dependency's fix: drop the patch.
