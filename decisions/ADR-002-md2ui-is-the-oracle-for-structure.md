# ADR-002: md2ui is the oracle for structure, not for pixels

**Status:** active
**Domain:** whole project
**Read when:** porting a stage, deciding whether a difference from md2ui is a bug, or
translating a Python regex.

## Decision

md2ui, the reference implementation, exports fixtures (`scripts/export_ts_fixtures.py`
in md2ui). Each is pinned to the md2ui commit that made it. `tools/conformance` checks
these outputs against them, exactly:

| What | Compared how |
|---|---|
| **Grouping** | The tree after each phase of `MarkdownGrouper.process` and the final tree, for every Markdown file under md2ui's `data/markdown/tests` and `data/markdown/tests-render`. The node tree and the annotation flags are compared separately. Ids are compared as **partitions**: which nodes share an id, not the id values ([ADR-104](ADR-104-ids-come-from-content.md)). So is `fingerprint_hash`: the port must group the same nodes as same-kind, not reproduce md2ui's signature strings |
| **Split criteria** (rules, no model) | the answer to every question asked during grouping |
| **Data-point detector** | every call made during grouping |
| **Theme** | the resolved theme for every THEME file in the corpus |
| **Layout** (full LayoutNode trees) and **placed boxes** | at the render snapshot's widths, **under replayed measurements**: md2ui records every font-level answer, and the tests feed those answers to Pretext, the text engine that ships, at its `measureText` boundary ([ADR-403](ADR-403-pretext-measures-and-breaks-lines.md)). Where the two line-breaking rules find the same opportunities, the comparison is exact; where they do not, each difference is classified and reported, never tolerated |
| **The wire** | every frame in md2ui's [`protocol/examples`](https://github.com/md2ui/md2ui/blob/main/protocol/examples) accepted, and every frame in `protocol/examples/invalid` rejected |

### Equal layouts, not equal pixels

- **What must match is the arrangement:** the LayoutNode tree, meaning which rows,
  columns, grids, bento cells, stacks and sections md2ui chose, under replayed
  measurements.
- **Box geometry and line breaks may differ** where the text engines legitimately
  differ (Pretext against md2ui's wrapping). Such differences are classified, never
  "fixed" towards md2ui.
- **md2ui does not adopt Pretext's break rules.** Each side keeps the rules its own
  libraries give it.

Two things are **not** compared:

- **Renders, pixel for pixel.** The measurer and the painter differ on purpose
  ([ADR-402](ADR-402-paint-graphics-directly.md),
  [ADR-403](ADR-403-pretext-measures-and-breaks-lines.md)). Renders are judged against
  this repository's own earlier renders, and reviewed side by side with md2ui's for
  structure.
- **md2ui's tooling** ([ADR-000](ADR-000-the-client-library-and-its-reference.md)).

## Reason

Structure is the product's logic. If grouping or layout differs, the page differs for
reasons nobody chose. md2ui's snapshot corpus is a ready-made conformance suite of
documents that broke at least once.

Pixel parity is not feasible and not worth chasing: Skia and Canvas 2D render
differently, and md2ui's text decisions follow the libraries Python had. Equal layouts
are what a reader sees as the same page.

### Regex dialects

The grouper and the detector are mostly regex. None of the following raises an error
in a port. They just split text differently, and only the fixtures catch them:

| Python `re` (on `str`) | JavaScript |
|---|---|
| `\d` `\w` `\b` match Unicode | `\d` `\w` `\b` are ASCII only, even with the `u` flag |
| `str.isalpha()` / `isupper()` / `isdigit()` are Unicode | use `\p{L}` / `\p{Lu}` / `\p{Nd}` with the `u` flag |
| `$` also matches before a trailing `\n` | `$` without the `m` flag does not |
| `re.match` anchors at the start; `re.fullmatch` at both ends | anchor with `^…$` |
| `(?P<name>…)`, `(?P=name)` | `(?<name>…)`, `\k<name>` |
| atomic `(?>…)`, possessive `a++` | not supported; rewrite |
| string indices count code points | string indices count UTF-16 units: convert at the fixture boundary |
| `round()` rounds half to even | `Math.round` rounds half up: use `pyRound` |
| `sum()` of floats is compensated (Python 3.12+) | `+=` is not: use `pySum` at every ported `sum(` |

## Constraint created

- **Every fixture names its md2ui commit.** When md2ui changes, the fixtures are
  regenerated and the differences triaged before any TS change.
- **A difference that looks like an md2ui bug is reported, not copied.** It is not
  fixed silently on either side.

## Reconsider when

md2ui stops being where the rules are found (see ADR-000). The oracle is then this
repository's own snapshot.
