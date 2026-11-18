# ADR-004: Repository, toolchain and the gate

**Status:** active
**Domain:** whole project
**Read when:** adding a package, a dependency, a script, a check or a test, or moving
the repository.

How packages are built, published and supported is in
[ADR-006](ADR-006-package-shape-and-support.md).

## Decision

### Repository

- **Its own git repository** ([ADR-000](ADR-000-the-client-library-and-its-reference.md)).
- **A pnpm workspace:** `packages/` (the library), `tools/` (dev-only: conformance,
  bundler checks), `apps/` (pages, never published). pnpm and Node are pinned in
  `package.json` (`packageManager`, `engines`) with `engine-strict`; versions are exact
  (`save-exact`), and `pnpm-lock.yaml` is committed.

### Language and tools

| Concern | Choice |
|---|---|
| Language | **TypeScript 6, pinned.** TypeScript 7 (the native compiler) has no classic compiler API, which dependency-cruiser and declaration builds depend on |
| Compiler settings | Beyond `strict` (`tsconfig.base.json`): `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`, `erasableSyntaxOnly` and the unused-code checks among them. Project references with `composite`. **`contracts`, `core` and `wire` have no DOM lib** |
| Lint and format | **Biome.** `no-dom-in-core` is Biome's `noRestrictedGlobals` over `contracts` and `core`; `no-module-level-state` is a GritQL plugin (`lint/`) |
| Layer rules | **dependency-cruiser** (`.dependency-cruiser.cjs`): the layers of ADR-003, packages reached by name only, nothing imported from outside the repository, no Node built-ins in `packages/*/src`, `tools/` and `apps/` never a dependency of a package, no cycles |
| Dead code | **knip:** unused files, exports, types, dependencies, unlisted and unresolved imports, all as errors |
| Tests | **Vitest.** A file named `*.browser.test.ts` runs in the browser (Playwright); `*.perf.browser.test.ts` only in `pnpm perf`; `*.protocol.test.ts` against md2ui's `protocol/`; every other `*.test.ts` in Node. Tests live in each package's `test/`, with their own tsconfig, so test-only types never enter `src` |
| Builds | **tsdown** (tsup is unmaintained and points to it). Pinned to the last release that runs on the pinned Node; raise the Node floor and tsdown together |
| Pages | **Vite,** under `apps/`, never published |

### The gate: `pnpm check`

- **It runs every step, even after one fails,** and prints a summary, so one run
  names every broken rule. md2ui's `make check` stops at the first failure; this
  difference is deliberate.
- **The steps** (`scripts/check.ts`): types; Biome; the dependency rules; knip;
  Vitest in Node and in **Chromium**; the build of every buildable package; package
  shape, size budgets and API reports ([ADR-006](ADR-006-package-shape-and-support.md));
  the packed `@md2ui/dom` bundled by real host bundlers (`tools/bundlers`). Two steps
  run only when their input is named, and are otherwise reported as skipped: the wire
  protocol (`MD2UI_PROTOCOL`) and conformance (`MD2UI_FIXTURES`).
- **`pnpm check:browsers`** runs the browser tests in **WebKit and Firefox** as well.
  A change that measures, paints or handles input runs it, because Safari is the iOS
  engine and text metrics differ between engines. `pnpm browsers` installs the engines
  once per machine.
- **Performance budgets are not in the correctness gate.** Timing assertions are
  machine-load sensitive, so they live in `pnpm perf`, run on an idle machine. The
  gate keeps behaviour, never speed.
- **Every rule is proven to fire.** A new rule is shown failing the gate once before
  it is relied on.

### No dead or unused code

- **What counts as dead or unused:** an unused local, parameter, file, export, type
  or dependency, and code written "for later".
- **A dependency is declared when its first import arrives,** never before.

## Reason

- **Separate packages keep concerns apart for hosts.** A host installs only what it
  uses.
- **Rules are enforced, not remembered.** The compiler, the lint and the dependency
  rules are this repository's version of md2ui's import-linter.
- **The strict compiler settings fit a port.** Python lets an index miss silently;
  `noUncheckedIndexedAccess` makes every miss visible.
- **Every failure in one run** saves a round of fix-and-rerun for each broken rule.

## Constraint created

- **Adding a dependency is a decision.** Its size counts against
  [ADR-001](ADR-001-the-client-runs-the-pipeline.md)'s bundle metric, through the size
  budgets of ADR-006.
- **`no-module-level-state`** catches, at module scope, a `let` or `var`, a `const`
  holding a mutable object (`new Map()`, `new Set()`, an array or object literal not
  `as const`), and a regex with the `g` or `y` flag, whose `lastIndex` is hidden state.
  A table is made immutable with `as const` or `Object.freeze`.
- **"Nothing runs on import"** is tested (`test/nothing-runs-on-import.test.ts`): each
  package entry is imported in Node, with no `window` or `document`, and must not throw
  or touch a global.
- **Known limit:** knip treats every export of a package's entry file as public API,
  so an unused export of an internal package's entry is not reported. Review catches
  it.

## Reconsider when

- the gate runs in CI: it runs there unchanged;
- dependency-cruiser and the declaration build support TypeScript 7.
