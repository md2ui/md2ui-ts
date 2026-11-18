# ADR-005: Packages and contracts

**Status:** active
**Domain:** whole project
**Read when:** deciding where code goes, or changing a type another package uses.

## Decision

### Packages

| Path | Package | Layer ([ADR-003](ADR-003-framework-agnostic-core.md)) |
|---|---|---|
| `packages/contracts` | `@md2ui/contracts` | contracts: types and JSON schemas, no runtime code |
| `packages/core` | `@md2ui/core` | core: grouping, theme, layout, measurement, scene |
| `packages/text-pretext` | `@md2ui/text-pretext` | text |
| `packages/painter-canvas` | `@md2ui/painter-canvas` | painter |
| `packages/dom` | `@md2ui/dom` (host + `<md2ui-view>`) | host |
| `packages/react`, `packages/vue` | `@md2ui/react`, `@md2ui/vue` | bindings |
| `packages/wire` | `@md2ui/wire` | wire client, optional |
| `tools/*` | private | dev-only (conformance, bundler checks); never a dependency of a package |
| `apps/*` | private | pages; never published |

Which of these are published, and how the others reach a host, is
[ADR-006](ADR-006-package-shape-and-support.md).

### Contracts

The types that cross a package boundary live in `@md2ui/contracts`: six numbered
contracts (`c1-…` to `c6-…` in `src/`), and the internal shapes the core hands the
host beside C4 (the target table, the outline, the list diff):

| # | Contract | Public |
|---|---|---|
| C1 | Grouping AST, generated from md2ui's grouping-AST JSON Schema (`pnpm generate:c1`), itself derived from `MarkdownGroupNode.to_dict` | no |
| C2 | Resolved theme | no |
| C3 | Measurer interface | no |
| C4 | Display list, versioned | no, while no published package exports it |
| C5 | Wire frames: a vendored copy of md2ui's [`protocol/`](https://github.com/md2ui/md2ui/blob/main/protocol/) schemas, with a version check | yes (md2ui's spec) |
| C6 | `<md2ui-view>` API, action events, package names | **yes** |

### Field names

- **Internal contracts (C1 grouping AST, C2 theme, C3 measurer) mirror md2ui's names,**
  snake_case included, so conformance compares them directly and a reader can grep
  md2ui for any field. A shape that cannot cross JSON may differ, and is documented
  where it does: C2 nests `fixed_section_levels` by key, then level, where md2ui uses
  a tuple key.
- **Public contracts (C6), the display list (C4) and the shapes the host reads from
  the core use TypeScript's camelCase,** because host code reads them, and a host may
  read C4 once a package exports it.

## Reason

- **Package boundaries make separation of concerns physical.** A painter cannot reach
  into grouping internals, and a host bundles only what it uses.
- **One home for shared types** means a package's internals stay its own: nothing
  outside a package depends on anything but its contract.
- **An internal contract mirrors md2ui** so that conformance is a direct comparison;
  a public one follows the host's language.

## Constraint created

- **Types other packages use live in `contracts`.** A package exports nothing else
  that another package relies on.
- **Changing an internal contract** changes its producers and consumers together and
  keeps conformance green. **Changing a public one** is a change to the public API
  (ADR-006): it shows in an API report and needs a recorded decision.
- **C4 becomes public,** with an API report, when a published entry exports it (a
  custom painter, an SVG export).

## Reconsider when

Two packages are always released together and never used apart. Merge them then.
