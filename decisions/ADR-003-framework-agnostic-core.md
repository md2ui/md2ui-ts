# ADR-003: The core is framework-agnostic; a custom element is the integration point

**Status:** active
**Domain:** whole project
**Read when:** adding or changing a public API, touching `window` or `document`,
adding state that lives longer than a call, writing a binding, or making something
clickable.

## Decision

The layers, each depending only on the ones below it. Package names are in
[ADR-005](ADR-005-packages-and-contracts.md).

| Layer | Does | Depends on |
|---|---|---|
| **Contracts** | Types and schemas only: the grouping AST, theme, measurer, display list | nothing |
| **Core** | Markdown + theme → display list. Pure TypeScript, no DOM; text measurement is injected ([ADR-403](ADR-403-pretext-measures-and-breaks-lines.md)) | contracts |
| **Text** | Measurer implementations (Pretext in the browser) | contracts, Canvas 2D |
| **Painter** | Paints a display list onto a canvas it is given: pixel ratio, scroll, culling, hit-testing ([ADR-402](ADR-402-paint-graphics-directly.md)) | contracts, Canvas 2D, and the text layer's `setCanvasFont`, so one routine sets a canvas font for measuring and for painting ([ADR-403](ADR-403-pretext-measures-and-breaks-lines.md)) |
| **Host** | Connects a canvas to a page: pointer, wheel, `ResizeObserver`, focus, the accessibility layer, and the custom element `<md2ui-view>`. Emits actions | core, text, painter, DOM |
| **Bindings** | Thin React and Vue wrappers: props to methods, events to callbacks, no logic | host and the framework, only here |
| **Wire client** (optional) | md2ui's wire protocol, with an injected transport | contracts |

**The rules:**

- The integration point is `<md2ui-view>`. It works unchanged in React, Vue, Svelte,
  Angular and plain HTML.
- **The public surface is small:** mount, set the Markdown, set the theme, receive
  actions, destroy.
- No module-level mutable state.
- Importing anything has no side effects, so server-side-rendering hosts do not break.
- No global CSS. Style comes from THEME.md.

**Actions are data, not behaviour** (md2ui ADR-404, ADR-601):

- **Each actionable target has an ordinal** within its message, computed exactly as
  md2ui computes it. **An event names that ordinal,** never a node id or a restated
  action.
- **`link` (http(s), `mailto`, `/route`):** reported to the host as a cancelable
  `md2ui-action`. If the host does not call `preventDefault()`, the view opens
  allow-listed http(s) and mailto links (external ones in a new tab), as a plain `<a>`
  would. Routing hosts cancel it and route the link themselves.
- **`#anchor`:** md2ui-ts scrolls to the heading itself.
- **`agent` (an `agent:` link or card, a linked task box, a linked slider),
  `checkbox` (a plain task box) and `slider` (a value inside its authored domain):**
  reported as events the host may send over the wire. A slider reports once, on
  release.
- **`copy` (a code block's copy button):** handled in the client, which writes the
  text to the clipboard. It is never sent.
- **There is no `prompt:` scheme.** Free text comes from the host's own native field.
- **A disabled (`~~…~~`) target emits nothing.** A disabled *view* (`disabled`, set
  while a message streams or the agent works) silences only agent-bound actions;
  `#anchor` and `copy` keep working, because they are local.
- **The client never edits the Markdown.** The agent changes state by re-sending the
  message (`r`, replace). The view replaces it in place and keeps the scroll.
- **Host state** (pending, an optimistic tick, a slider thumb while dragging) is
  transient: it changes colours and a thumb's place, never a box. It is keyed by the
  target's ordinal, the same number an event names. A replacement keeps it only on
  targets it left exactly as they were (same ordinal, same number of targets), so a
  click the agent has not answered yet is not undone; one whose Markdown is unchanged
  is the agent's "no change" and clears it all (md2ui
  [`protocol/README.md`](https://github.com/md2ui/md2ui/blob/main/protocol/README.md),
  *Lifecycle*). A target inside a sentence (an inline link) is addressed alone and
  leaves the rest of its sentence as it is: node ids address paint, ordinals address
  actions.
- **Native hosts** get the same layering and surface, in their own code. A web view is
  only a stopgap.

## Reason

- **No framework forced on hosts.** md2ui-ts drops into existing frontends. Any UI or
  rendering framework it depended on would be forced on every one of them.
- **A custom element is the platform's own component model.**
- **A DOM-free core** can run in a Worker and in headless tests.
- **One action contract, shared with every md2ui client:**
  - a target named by ordinal cannot be forged into an action the message did not
    offer;
  - state stays with the agent.
- **The one shared global is Pretext's measurement cache.** It is page-wide and safe to
  share; a font load clears it for every view.

## Constraint created

- A framework import outside the bindings is a defect; so is DOM access in the core.
  The dependency rules and the lint enforce both
  ([ADR-004](ADR-004-repository-and-toolchain.md)).
- **Target ordinals must agree with md2ui's,** which the grouping fixtures guarantee
  ([ADR-002](ADR-002-md2ui-is-the-oracle-for-structure.md)).
- **Every public name is a commitment.** The public surface (contract C6) changes only
  through a recorded decision, visible in its API report
  ([ADR-006](ADR-006-package-shape-and-support.md)).

## Reconsider when

A host needs something the element cannot express through its attributes, properties
and events.
