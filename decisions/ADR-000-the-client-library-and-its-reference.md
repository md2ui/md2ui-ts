# ADR-000: md2ui-ts is the client library; md2ui (Python) is its reference

**Status:** active
**Domain:** whole project
**Read when:** deciding whether something belongs here or in md2ui, adding anything
that reaches outside this repository, or starting another platform.

## Decision

- **md2ui-ts is the frontend library.** It runs the md2ui pipeline in the client:
  Markdown and a theme in, a painted and interactive UI out.
- **md2ui, the Python project, is the reference implementation,** and a maintained
  product in its own right: the server tools, the CLI, the MCP and wire servers, the
  Claude plugins and the user's window. Rules are found and proven there, then ported
  here.
- **md2ui-ts holds the product surface only:**
  - **ported:** everything that shapes the user's page: the full grouper, every layout
    arrangement, the displays, tables, code blocks, sliders and actions;
  - **left out:** md2ui's tooling: the CLI, the servers, the window chrome and the debug
    overlays;
  - **optional:** the wire *client*, as its own package.
- **It is its own git repository.** Nothing here imports, symlinks or builds from
  `../`; md2ui's outputs reach this repository only through a path argument.
- **Records are numbered independently.** md2ui's are cited as "md2ui ADR-nnn"
  ([md2ui `decisions/`](https://github.com/md2ui/md2ui/blob/main/decisions/)); the ones
  that hold here are listed in `AGENTS.md`.
- **Every platform gets its own implementation.** Web comes first. Platforms share the
  Markdown dialect, THEME.md, the wire protocol and the conformance oracle
  ([ADR-002](ADR-002-md2ui-is-the-oracle-for-structure.md)), not code.

## Reason

- **Python cannot be the library.** The pipeline has to run on the client
  ([ADR-001](ADR-001-the-client-runs-the-pipeline.md)), and Python does not run in a
  browser or on a phone without shipping a runtime.
- **One place finds the rules.** md2ui's rules still change. Finding them there and
  porting what has settled means a rule is not designed twice.
- **A separate history** keeps the library's releases apart from md2ui's tooling.

## Constraint created

- A grouping or layout rule changes in md2ui first, then here. A rule found here is
  written back to md2ui, or recorded here as a deliberate divergence.
- Nothing here reads `../` at build or test time, except md2ui's exported fixtures and
  `protocol/`, passed in as path arguments.

## Reconsider when

md2ui stops being where the rules are found.
