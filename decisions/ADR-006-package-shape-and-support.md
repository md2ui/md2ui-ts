# ADR-006: Package shape, public API and what is supported

**Status:** active
**Domain:** whole project
**Read when:** making a package buildable or publishable, changing anything a host
imports, adding a runtime dependency, moving work between the page and the Worker,
validating input from outside, or deciding whether a browser is supported.

## Decision

### Four packages are published; the rest are inlined

- **Published:** `@md2ui/dom`, `@md2ui/react`, `@md2ui/vue` and `@md2ui/wire`, the
  packages with a `build` script. **Each installs from npm alone.**
- **Internal:** `@md2ui/contracts`, `@md2ui/core`, `@md2ui/painter-canvas` and
  `@md2ui/text-pretext`. They have no build, size budget, API report or tarball of
  their own.
  - **`@md2ui/dom` inlines core, painter-canvas and text-pretext.** They are its
    `devDependencies`; its tsdown build bundles them (`inlineOnly` names exactly those
    and the patched Pretext, and fails the build if anything else would be inlined);
    their own runtime dependencies are its `dependencies`.
  - **`@md2ui/contracts` is types only.** The types from it that a host names are
    inlined into the declarations of `@md2ui/dom` (C6) and `@md2ui/wire` (C5).
  - The bindings depend on `@md2ui/dom` only.
- **The page and the Worker are built apart.** A chunk shared by the page's entry and
  the Worker's would hold, as one module, code a host's bundler otherwise drops module
  by module (`sideEffects: false`), and grows the Worker a host ships. The tarball holds
  the session code twice instead; a host bundles each side once either way.
- **A dependency pnpm patches is bundled, never depended on**
  ([ADR-007](ADR-007-dependencies-first.md)): it is inlined by the published package
  that uses it, listed only in `devDependencies`, and its licence ships beside the
  build (`THIRD_PARTY_NOTICES.md`).

### Package shape

- **ESM only.** Every package has `"type": "module"`, `"sideEffects": false`, and an
  `exports` map with a `types` condition. There is no CommonJS build and no default
  export.
- **Only the four published packages are publishable**, under the `@md2ui` scope: they
  carry no `private` field, and their `publishConfig` sets `access: "public"` (a scoped
  package is otherwise published restricted) and `tag: "alpha"`, so a publish never
  lands on `latest` by default. The internal packages, which dom and wire inline, stay
  `private: true`. The owner publishes.
- **Built with tsdown** ([ADR-004](ADR-004-repository-and-toolchain.md)): JavaScript
  plus `.d.ts`, targeting ES2024, with **no source maps** (owner, 2026-11-17): the
  sources they would name are not in the tarball, and a host's dev server warns about
  each one. In the workspace, `exports` points at `src`; the published `exports` point at `dist/lib`, through
  `publishConfig.exports`, so **publishing goes through pnpm**.
- **The gate checks each packed tarball** (`pnpm packages shape|size|api`,
  `scripts/packages.ts`), as a host would install it:
  - **publint** (the `package.json` is correct) and **@arethetypeswrong** with its
    ESM-only profile (types resolve);
  - **nothing unpublished is reached** (`scripts/published.ts`): the shipped code and
    declarations import only the package's runtime dependencies and peers, no runtime
    dependency is an unpublished workspace package, and every runtime dependency is
    imported by something shipped (knip cannot see the inlined packages' dependencies
    used, so this check reads the output);
  - **nothing patched is reached unpatched** (`scripts/patched.ts`);
  - **size budgets** (`size-budgets.json`) and **API reports**
    (`packages/<name>/etc/*.api.md`), below.
- **Nothing runs on import.** The custom element is **registered by an explicit call**,
  `defineMd2uiView()`, never as a side effect of importing `@md2ui/dom`.
- **Framework packages declare their framework as a peer dependency,** never a
  dependency.
- **No test-only public subpath.**

### The public API

- **The public surface is what the entry files of the four published packages
  export.** The display-list types (C4) are internal while none of them exports one;
  they become public, with an API report, when a published entry does (a custom
  painter, an SVG export).
- **An API report (API Extractor) is committed for each public entry.** The gate
  fails when the surface changes and the report was not updated, so every change to
  the public API is visible in review.
- **Versioning uses Changesets,** from the first release. Before 1.0, a breaking
  change bumps the minor version.

### C6: the element

- **`<md2ui-view>`**, registered by `defineMd2uiView()`. Its properties are
  `Md2uiViewProperties` (`packages/contracts/src/c6-view-api.ts`).
- **Two events only:** `md2ui-action` (by ordinal, cancelable, [ADR-003](ADR-003-framework-agnostic-core.md))
  and `md2ui-error`. No `md2ui-copy` and no `md2ui-render`: the accessibility layer
  announces a copy.
- **The packages:** the components `@md2ui/react` and `@md2ui/vue`, and the Worker
  entry `@md2ui/dom/worker`.
- **Two sizing modes:** a fixed-height view scrolls itself; an auto-height view grows
  to its content inside a scrolling page (chat threads), and culls by the page's
  visible area.
- **Fonts are the host's** (`fonts`, and the page's own `@font-face` on the main
  thread). The view never loads the theme's font files, and loads only the host's
  faces whose family the theme draws in, so a page's unused faces never fill memory.
- **Nothing fails in silence.** A theme family no font gives, a face the Worker could
  not load, and a session that cannot open are each an `md2ui-error`
  (`Md2uiLoadError`), because a Worker would otherwise measure in a fallback face, or
  a view stay empty, with no sign why.
- **Content images** resolve against the page's base URL. There is no loader hook
  until a host needs one.
- **`FontSource` is public**; `FontSpec` (C3) is not.

### Where the pipeline runs

- **In a module Worker, by default,** one per registration; `defineMd2uiView({ worker })`
  keeps it on the main thread (`false`) or uses the host's own Worker file, which calls
  `exposePipeline()` from `@md2ui/dom/worker` (`Md2uiViewOptions`,
  `packages/dom/src/element.ts`).
- **A Worker that cannot be made, or fails before it first answers,** leaves the
  registration's views on the main thread, silently: the page renders as with
  `worker: false`.
- **There is no start timeout.** A slow start cannot be told from a hung one, and a
  timeout would send a slow Worker's views to the main thread for good.
- **A Worker loads a font from its bytes,** fetched once per file, because a WebKit
  Worker cannot load a cross-origin font by URL even with CORS headers.
- **Raster pictures are decoded where the pipeline runs:** the page fetches a picture,
  the Worker decodes it and transfers the bitmap back. An SVG, and a picture read as an
  `<img>` (a host without CORS headers), decode on the page, as only the page can.
  Firefox decodes a blob on the page even when a Worker asks, so it gains nothing.
- **The package ships its Worker as a file beside the page's entry**
  (`dist/lib/pipeline-worker.js`), started with
  `new Worker(new URL("./pipeline-worker.js", import.meta.url), { type: "module" })`,
  the form host bundlers recognise. It is not in `exports`: nothing imports it.

### Size budgets

- **Each published entry has a budget,** minified and gzipped (`size-budgets.json`):
  the entry and what it imports statically, with peers and the other published packages
  left out, so every byte is counted once. A chunk loaded on demand (a Shiki grammar)
  is not counted. This is [ADR-001](ADR-001-the-client-runs-the-pipeline.md)'s bundle
  metric, made a check.
- **A budget is set from a measured build plus a margin.** It is raised only by a
  recorded decision that names what the bytes buy.

### Input from outside is validated, cheaply

- **Wire frames, THEME.md text and Markdown come from the network,** and are
  validated at the boundary.
- **Wire frames are checked by a hand-written codec** (`packages/wire/src/codec.ts`)
  that follows md2ui's JSON Schemas, and is tested against them and against md2ui's
  `protocol/examples`. **No runtime schema compiler ships in a bundle**; Ajv is a test
  dependency only.
- **Malformed Markdown or theme text never throws.** It renders what it can, as md2ui
  does. **A misused API throws a typed error** that names the misuse.

### Supported browsers

- **Baseline "widely available"** browsers (Chrome, Edge, Firefox, Safari, on desktop
  and mobile), **plus whatever Pretext requires:** `Intl.Segmenter`, Canvas 2D
  measurement and Unicode property escapes.
- **The compile target is ES2024.** An API newer than the support line must be
  feature-checked or not used.
- **The browser test projects cover the three engines** (ADR-004). A behaviour
  difference between them is a bug unless a record says otherwise.

## Reason

- **This is a library other teams install.** Its package shape, public API and
  supported browsers are promises to them, checked mechanically, because a library
  that breaks them silently breaks every host's build or page.
- **ESM only:** modern bundlers, current Node and every supported browser load ESM,
  and a dual build doubles the ways a package can break.
- **One package for the element:** a host installs `@md2ui/dom` and nothing else. An
  internal package published only to be depended on would be public API in all but
  name, and a tarball that imports an unpublished package does not install.
- **The Worker by default:** the pipeline off the main thread keeps drags, streams and
  a cold first document from blocking the page. The cost, a first frame somewhat later,
  some more CPU and a Worker's heap, is smaller than the jank it removes.
- **Pictures decoded in the Worker:** decoding on the page made WebKit's frames long
  while a picture-heavy page loaded or resized. The cost, accepted: on a busy page the
  last picture lands later, as decodes wait behind layouts on the Worker's one thread.

## Considered and rejected

- **A CommonJS or dual build.** See *Reconsider when*.
- **Publishing the internal packages.** Their names and shapes would become promises.
- **One shared chunk for the page and the Worker**, for the Worker it grows.
- **A Worker start timeout**, for the reason above.
- **A second Worker for decoding only:** no queueing behind layouts, but one more
  Worker per registration.
- **Keeping Firefox's decodes on the page:** it needs browser sniffing; no feature test
  tells.

## Constraint created

- **A buildable package is published.** Adding a `build` script makes a package
  subject to the shape checks, a budget and an API report.
- **The Worker keeps this package shape:** an ESM file beside the entry, named by
  `new URL(…, import.meta.url)`. A host's bundler must ship it (Vite with
  `worker.format: "es"`, so the grammars stay chunks); one that does not gets the main
  thread.
- **Anything a view does in the Worker** has a main-thread path too, for
  `worker: false` and for a Worker that fell back.

## Reconsider when

- A host needs CommonJS. Answer with a separate compatibility package, not a dual
  build.
- The supported-browser line moves.
- Late pictures are reported on busy pages: revisit the decode Worker.
- A host needs a custom painter or an SVG export: C4 becomes public.
