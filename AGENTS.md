# AGENTS.md — md2ui-ts

md2ui-ts is the **frontend library**: the md2ui pipeline in TypeScript, running in the
client. md2ui, the Python project in its own repository beside this one, is the maintained
server side and the **reference implementation**. Rules are found there and ported
here, and md2ui's exported fixtures are the oracle this port is checked against.
Start at [ADR-000](decisions/ADR-000-the-client-library-and-its-reference.md).

This is **its own git repository** ([ADR-004](decisions/ADR-004-repository-and-toolchain.md)).
Never run git commands against the parent checkout from here, and never read `../`
except through a path argument.

## The gate

```
pnpm check      # types, Biome, dependency rules, tests (Node + browser), conformance if fixtures are given
```

Run it before claiming a change works. It is the only gate.

## The work is organised by domain

`plans/README.md` holds the following. `plans/` is private: it is not in this repository,
and a maintainer's checkout mounts it from the private repository.
- the domain board (the source of truth for where the port stands);
- the waves;
- the contracts registry;
- the model-routing table;
- the protocol for domain leads.

If you were started as a domain lead, your brief is `plans/Dn-*.md`.

## Rules that hold from the first commit

- **Layers and packages** ([ADR-003](decisions/ADR-003-framework-agnostic-core.md),
  [ADR-005](decisions/ADR-005-packages-and-contracts.md)):
  - no DOM in `contracts` or `core`;
  - no framework outside the bindings;
  - no module-level mutable state;
  - nothing runs on import.
- **No dead or unused code** (owner, 2026-10-04): no unused locals, parameters,
  exports, files or dependencies, and nothing written "for later". The gate checks
  this ([ADR-004](decisions/ADR-004-repository-and-toolchain.md)).
- **Dependencies first** ([ADR-007](decisions/ADR-007-dependencies-first.md)): platform APIs, then dedicated
  libraries; our own code only for md2ui's semantics.
- **Types another package uses live in `@md2ui/contracts`.** Changing a contract needs
  the orchestrator; a public one also needs the owner.
- **Structure matches md2ui; pixels need not**
  ([ADR-002](decisions/ADR-002-md2ui-is-the-oracle-for-structure.md)). The
  fixtures decide.
- **The painter never measures or wraps text** ([ADR-403](decisions/ADR-403-pretext-measures-and-breaks-lines.md)).
- **Actions are data** (ADR-003):
  - events name target ordinals;
  - the client never edits the Markdown;
  - host state is transient and colour-only.

## Decisions

This repository's records, numbered independently of md2ui's:

| | |
| --- | --- |
| **0xx** whole project | [000](decisions/ADR-000-the-client-library-and-its-reference.md) the client library and its reference · [001](decisions/ADR-001-the-client-runs-the-pipeline.md) the client runs the pipeline; Markdown over the wire, THEME.md by URL · [002](decisions/ADR-002-md2ui-is-the-oracle-for-structure.md) md2ui is the oracle for structure, not pixels · [003](decisions/ADR-003-framework-agnostic-core.md) framework-agnostic core; actions are data · [004](decisions/ADR-004-repository-and-toolchain.md) repository and toolchain · [005](decisions/ADR-005-packages-and-contracts.md) packages and contracts; shared types live in contracts · [006](decisions/ADR-006-package-shape-and-support.md) package shape, public API, supported browsers · [007](decisions/ADR-007-dependencies-first.md) dependencies first; write only what none solves |
| **1xx** pipeline | [104](decisions/ADR-104-ids-come-from-content.md) ids come from content |
| **4xx** renderer | [402](decisions/ADR-402-paint-graphics-directly.md) Canvas 2D over md2ui's display list · [403](decisions/ADR-403-pretext-measures-and-breaks-lines.md) Pretext measures and breaks lines |

### md2ui records that hold here

They are cited as **"md2ui ADR-nnn"** and read in md2ui's
[`decisions/`](https://github.com/md2ui/md2ui/tree/main/decisions).

| md2ui ADR | Holds here because |
| --- | --- |
| 000 | The compiler shape: one tree, ordered stages, dependencies one way. Python tooling does not carry over |
| 100 | The grouper annotates; later stages never re-infer structure |
| 102 | Detect only what is consumed |
| 103 | The grouper's answers are memoized by text, so they stay pure — the lesson behind ADR-104's caching |
| 200, 201, 205 | The peel nests; styling is not structure; structure is authored and punctuation is text |
| 203 | Spacing is authored and sized by the theme |
| 300, 301, 302, 303 | Width constrains, never steers; run polling is authoritative; stack sections trust the content ask; the aspect cap widens only when it shortens |
| 400 | One normalization point — ADR-403 is its form here |
| 401 | Its idea (record once, replay with R-tree culling) is restated in ADR-402 |
| 404 | A click is an action reported as data — ADR-003 is its form here |
| 500 | Skills are built outside in; the Markdown dialect is the same |
| 601 | The wire carries Markdown and references, events name ordinals; the agent's state and the user's prompt. The frames themselves are md2ui's `protocol/` |
| 701 | md2ui has no learned layout, and neither has this repository |

**Not inherited:**
- **402** — md2ui draws text unshaped, shaping only emoji sequences; here the browser shapes it (ADR-403).
- **600, 602, 605** — md2ui's CLI and shells.
