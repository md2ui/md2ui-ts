// The Markdown link fragments the grouper's patterns are built from.
//
// md2ui keeps one definition of a link's destination so the grouper and the renderer
// agree on where a link ends (md2ui: pipeline/render_text.py).

// md2ui: render_text.LINK_DESTINATION. Balanced parentheses (one level), no bare
// space, an optional title, and may be empty (`[↗️]()`).
// py: r"[ \t]*(?:(?:<[^<>\n]*>|(?:[^\s()<]|\([^\s()]*\))(?:[^\s()]|\([^\s()]*\))*)"
// py: r"""(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t]*)?"""
export const LINK_DESTINATION =
  String.raw`[ \t]*(?:(?:<[^<>\n]*>|(?:[^\s()<]|\([^\s()]*\))(?:[^\s()]|\([^\s()]*\))*)` +
  String.raw`(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^()\n]*\)))?[ \t]*)?`;

// md2ui: render_text.LINK_LABEL. Brackets inside a label balance, one level deep; an
// escaped bracket does not count.
// py: r"(?:\\.|[^\[\]\\]|\[(?:\\.|[^\[\]\\])*\])+"
export const LINK_LABEL = String.raw`(?:\\.|[^\[\]\\]|\[(?:\\.|[^\[\]\\])*\])+`;

// md2ui: render_text._LINK_LABEL. Inline, a nested pair may not open a destination of
// its own: a link written inside another's label is the link.
// py: r"(?:\\.|[^\[\]\\]|\[(?:\\.|[^\[\]\\])*\](?!\())+"
export const INLINE_LINK_LABEL = String.raw`(?:\\.|[^\[\]\\]|\[(?:\\.|[^\[\]\\])*\](?!\())+`;

// md2ui: render_text.OVERFLOW_MARKS. A "more" button's label: a link whose whole label is
// one of these is an icon button (md2ui's icon font draws them as more_horiz / more_vert),
// while the same character anywhere else stays text, as an ellipsis in a sentence must.
export const OVERFLOW_MARKS: readonly string[] = Object.freeze(["…", "⋯", "⋮"]);
