# THEME.md keys md2ui-ts adds

md2ui's `THEME_GUIDE.md` documents every THEME.md key both projects read. This page holds
only the keys md2ui-ts adds; md2ui ignores them as unknown sections.

## Motion

How a document moves into place when the agent re-sends it or streams it in.

```md
## Motion
Duration: 220
Easing: cubic-bezier(0.2, 0, 0, 1)
```

| Key | Value | Default |
|---|---|---|
| `Duration` | Milliseconds, as a bare number (`300`, not `300ms`). `0` turns motion off | `220` |
| `Easing` | Any CSS easing function: `linear`, `ease`, `ease-in`, `ease-out`, `ease-in-out`, `cubic-bezier(x1, y1, x2, y2)`, `steps(n, position)`, `linear(…)` | `cubic-bezier(0.2, 0, 0, 1)` |

- **A new page fades whole:** when what was on screen and what will be there share little
  (under 40 % of either, by area, is the same content) and are not the same page with new
  values (the same structure where the reader looks), the old page fades out as one over
  the new one and nothing slides. A page re-sent with every figure changed (a weather or a
  dashboard refreshed) is an edit: each value cross-fades in its place. A host that knows sets the view's `motion`: `"page"` for a
  new message always fades whole, `"edit"` for a replacement of the message shown never
  does.
- **What moves, otherwise, in three overlapping stages within one `Duration`:** removed
  nodes fade out first (0–40 %); nodes in both documents slide from their old boxes to their
  new ones (15–85 %), and what changed inside them cross-fades as they go; added nodes fade
  in last (55–100 %), into room the others have mostly left. `Easing` eases each stage on
  its own. Text is never re-wrapped mid-motion.
- **A card moves whole:** its background slides with what it holds. When a card changes
  as it moves (a count, a price), the change cross-fades on the card as it travels. A card
  of which most is new (its title and picture, say) is another card: it fades out where
  it was and the new one fades in.
- **What never moves:** the first document shown, a resize, and a change of host state
  (a pending link, a ticked box, a slider). Nor do a stream's deltas: a document that
  arrives within one `Duration` of the last is shown at once.
- **The reader's "reduce motion" setting always wins:** with it on, nothing moves,
  whatever the theme says.
- **A value that does not read keeps the default:** a negative or non-numeric
  `Duration`, or an `Easing` the browser does not accept.
