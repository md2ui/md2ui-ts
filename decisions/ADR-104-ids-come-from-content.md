# ADR-104: Node ids come from content; stages are pure functions over blocks

**Status:** active
**Domain:** pipeline
**Read when:** you assign an id, key a cache or host state, add a pass that reads the
whole document, match one display list against the next, or handle a streamed chunk
or a replaced message.

## Decision

- **A node's id is derived from what the node is, not where it is.** It is a hash of the
  node's own subtree (each node's type and content, in document order), plus the
  node's occurrence among earlier nodes with the same hash, counted in document order
  over the whole document. It names no ancestor: an edit re-ids only the nodes that
  changed and the nodes that hold them. The root's id is empty.
- **Ids are for identity inside the client only:**
  - anchoring the scroll while content changes above it;
  - keying transient host state ([ADR-003](ADR-003-framework-agnostic-core.md));
  - matching display-list entries across an update, for repainting and animation;
  - reusing measurements.
- **The wire never uses them.** Events name target ordinals (md2ui ADR-601).
- **Each stage is a pure function of its input.** The per-block work takes hashable
  input, so it can be cached by content hash.
- **Whole-document passes re-run on every change:** colour rotation, list ordinals,
  same-kind fingerprints and glue. They are cheap walks.
- **A cache is added only when timings show it is needed.** With the cache on, the
  output must equal a full rebuild across the whole corpus.

### Matching across an update

A streamed chunk and a replaced message (the agent's way of changing state) take the
same path: run the pipeline, match the new display list against the old, and repaint
or animate only what changed. The ids stay stateless; the matching is done per update.

- **Identical nodes are matched by place, not by occurrence** (`alignNodeIds`, in
  `packages/core/src/scene/diff.ts`), before the diff, the transition or the scroll
  anchoring reads either list. Identical nodes pair after the same anchor (the last
  node before them that each list paints once, such as their card's title or button),
  in the longest common run of keys, so a card dropped from identical cards drops
  whole. What pairs with nothing is removed or added.
- **Between two matches**, the nodes left on both sides pair in order where they paint
  the same kinds of entry: a stepper's `1` with the `0` that replaced it. Each then
  slides with its card and cross-fades.
- **A card's or section's background** (fill, shadow, stroke, photo) carries the id of
  the innermost node holding every box inside it (C4). A section over a run of siblings
  with no node of their own keeps `""`. Such a node, with a box that holds another
  node's centre, is a *holder*, and slides with its card.
- **A holder is matched by what it holds,** not by its id, which changes whenever its
  content does: to the unclaimed holder whose nodes are the partners of more than half
  of its own nodes' area, or of more than half of the other's; of two, the nearer its
  size. By area, so a changed count or price leaves a card the same card, while a new
  title and picture make it another. Either side, so a section that lost or gained most
  of its content is still itself.
- **A pair stands only where its matched holders match** (or neither has one): a
  holder matched on one side only is passed over, but a pair between two holders
  matched to nothing is dropped, so everything in a card that became another card fades
  out and the new card's fades in.
- **A holder is never a scroll anchor:** what changes inside it above the view moves
  what is read in it, while its top stays.
- **An update that keeps little is a new page.** Matching pairs whatever it can, so
  what it keeps is measured, not assumed: `keptShare` (by area, the share of what was
  and will be on screen whose partner shows the same content) and `shapeShare` (the
  share of the grouper's `fingerprint_hash`es seen, with what holds them, that pair up
  in order). When both are low (`NEW_PAGE` and `SAME_SHAPE` in
  `packages/dom/src/view.ts`), the update keeps the scroll as it is, anchors nothing,
  and fades whole instead of moving node by node. A host that knows sets C6 `motion`:
  `"page"` skips the match, `"edit"` never fades whole.

## Reason

md2ui's ids are positions. `node_id` is the tree path, and the glue and source-line
ids are running counters, so inserting one section renumbers every node after it.

Keying a node by its root-level block plus its path inside the block fails the same
way: many documents are a single block, so ticking one task re-ids most of the page.
Keyed by its own subtree, a node keeps its id unless it or something it holds changed.

Matching identical nodes by occurrence slides every later twin when one changes (a
stepper's `1` turning `0` moves every later `0` one card over). Matching by place keeps
each where the reader sees it.

Content alone misreads a page re-sent with new values everywhere (a refreshed weather
card or dashboard) as a new page; the grouper's fingerprints show it kept its shape.
So a new page needs both little content and a different shape.

## Considered and rejected

- **Patching the AST in place.** A local edit has effects elsewhere in the document:
  rotation slots counted per sibling, list ordinals, per-cluster fingerprints and
  length categories, sibling glue, grid runs and the bento solve. A patch that misses
  one produces a wrong page that only a full rebuild fixes.
- **Regrouping only the blocks that changed.** Reusing unchanged blocks' grouped
  subtrees saves at most about half a regroup, since the whole-document passes still
  run, and risks a reused tree diverging from a fresh grouping that conformance never
  sees. Grouping runs in the Worker, and a stream regroups only its open tail.
- **Matching against the previous tree** (stateful ids): it makes ids depend on what was
  shown before.

## Constraint created

- **An id is not a tree path.** Anything that needs a node's position reads it from
  the tree.
- **Conformance compares id partitions, not id values**
  ([ADR-002](ADR-002-md2ui-is-the-oracle-for-structure.md)).
- **Identical subtrees are told apart only by order.** An edit can hand an identical
  node's id to its neighbour. A reused id always names an identical subtree.
- **Whatever compares two lists** goes through `alignNodeIds` first.

## Reconsider when

- Matching by place proves wrong for a document a host shows: match against the
  previous tree then.
- An agent-sized page (tens of KB) regroups slower than 50 ms in a browser Worker:
  regrouping only changed blocks may then pay.
