# ADR-001: The client runs the whole pipeline; Markdown is the wire format

**Status:** active
**Domain:** whole project
**Read when:** you are about to move a stage to a server, send anything but Markdown to
the frontend, or cache a layout on the server.

## Decision

- **The client runs every stage itself:** grouping, layout, measurement and painting.
- **Markdown arrives over the wire.** The server sends plain Markdown and references
  to it (md2ui ADR-601, specified in md2ui's
  [`protocol/`](https://github.com/md2ui/md2ui/blob/main/protocol/README.md)). No AST,
  layout, theme, font or asset travels in a frame.
- **THEME.md is the user's, never a wire frame.** The host hands it to the view, by URL
  (fetched as a resource beside the wire) or as text. The server never writes it: it is
  part of the user's design system.
- **The client owns fonts, assets and images.** The server never fetches them.

## Reason

- **The goal:** Markdown to screen with no design handoff. The content decides the
  layout; the theme decides the style.
- **Layout depends on width and font metrics.** md2ui's generator asks its text
  measurers many times per document, and a layout is generated per width. With layout
  on the server, every resize would wait for a round trip.
- **Shipping the AST costs more than recomputing it.** Grouping does not depend on
  width, but its output is an order of magnitude larger than the Markdown it came from,
  even gzipped.
- **Markdown streams.** It arrives token by token, while an AST has to be rebuilt
  whole. The agent's token cost is the same either way.
- **The theme stays one file the user owns,** so a server-side preview (md2ui's CLI)
  uses exactly the user's theme.

## Considered and rejected

- **Layout on the server**, for the round trip per width above.
- **The grouping AST over the wire**, for its size and because it does not stream.

## Constraint created

- **Bundle size and startup time are product metrics,** because the client bundle
  carries the whole pipeline. They are enforced as size budgets
  ([ADR-006](ADR-006-package-shape-and-support.md)).
- **Anything the pipeline reads at run time must be loadable by the client:** the
  theme by URL or text, fonts and assets from the host.

## Reconsider when

A class of documents appears whose pipeline cost on a low-end phone is higher than a
round trip.
