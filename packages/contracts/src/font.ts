// FontSpec — the font a text is measured in (C3) and painted in (C4). One definition,
// shared by both contracts. Public, because a display list's text runs carry it
// (ADR-402); `setCanvasFont` sets it for measuring and painting alike
// (ADR-403).
//
// FontSource — a web font file the host gives. Public, because a view's `fonts` takes
// it (C6, ADR-006).

/** A font as CSS states it; the theme resolves every text style to one. */
export interface FontSpec {
  /**
   * Family names in fallback order, unquoted. The theme's emoji face is one of them,
   * since the browser falls back per glyph. Name concrete families: `system-ui` and
   * `-apple-system` measure wrongly on macOS (ADR-403).
   */
  readonly families: readonly string[];
  readonly size: number;
  /** 100–900, as CSS `font-weight`. */
  readonly weight: number;
  readonly italic: boolean;
}

/**
 * A web font the host gives a view or a browser measurer. It is loaded before any text
 * is measured, so no answer is taken with a fallback font (ADR-403).
 */
export interface FontSource {
  /** The family name a `FontSpec` names it by. */
  readonly family: string;
  readonly url: string;
  /** Default 400. */
  readonly weight?: number;
  /** Default false. */
  readonly italic?: boolean;
}
