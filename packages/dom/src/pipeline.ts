// The core, as a view runs it: Markdown grouped once per document; sized once
// per document, theme and measurer; laid out, placed and painted once per effective
// width. Host state is shown by the painted scene's `withStates`, never by a relayout.
//
// `Layout: Auto` (md2ui `session.build_scene`) is decided per document and width band:
// a band's first layout builds both arrangements and keeps the one leaving less of the
// page empty; every later width in that band builds one.
//
// Width: md2ui rebuilds only when `session.effective_width` moves. It clamps the asked
// width between the document's floor and the theme's `Max width`, and those two bounds
// are the only width thresholds the layout reports. Outside them the scene stands, and
// centring it inside a wider view is the painter's (C4 `centered`); between them every
// width is its own layout, as in md2ui.
import type { GroupingNode, ResolvedTheme, TargetTable, TextMeasurer } from "@md2ui/contracts";
import {
  autoLayout,
  bakeLayout,
  type DocumentShape,
  documentShape,
  documentSizer,
  effectiveWidth,
  generate,
  groupMarkdown,
  type LoadedHighlighter,
  layoutInput,
  type PaintedScene,
  paintScene,
  placeScene,
  RegexKit,
  type SizingOptions,
  sizingMeasurer,
  targetTable,
} from "@md2ui/core";

/** A document grouped from its Markdown: what depends on the text alone. */
export interface GroupedDocument {
  readonly grouping: GroupingNode;
  /** What each target reports, by ordinal (the core's target table). */
  readonly targets: TargetTable;
  /** The languages its code blocks name, for the highlighter to load first. */
  readonly languages: ReadonlySet<string>;
  /** Its structure, which tells an update with new values from a new page. */
  readonly shape: DocumentShape;
}

/**
 * md2ui's grouper over `markdown`; once per document. A view passes the same `kit`
 * for every document it shows, so text the last document held is not detected again.
 */
export function groupDocument(markdown: string, kit: RegexKit): GroupedDocument {
  const grouping = groupMarkdown(markdown, kit);
  const languages = new Set<string>();
  const visit = (node: GroupingNode): void => {
    if (node.type === "code_block" && node.code_language) languages.add(node.code_language);
    node.children.forEach(visit);
  };
  visit(grouping);
  return {
    grouping,
    targets: targetTable(grouping, kit),
    languages,
    shape: documentShape(grouping),
  };
}

/** What sizing and painting need beside the document. */
export interface Faces {
  readonly theme: ResolvedTheme;
  readonly text: TextMeasurer;
  readonly emojiFamily: SizingOptions["emojiFamily"];
  /** Loaded for the document's languages; null paints code in its text colour. */
  readonly highlight: LoadedHighlighter | null;
}

/** A grouped document under one theme and measurer. */
export interface PreparedDocument {
  /**
   * The scene for a view `width` CSS px wide, root padding included. The same object
   * comes back while the effective width does not move.
   */
  render(width: number): PaintedScene;
}

/** `grouped` sized under `faces`; once per document, theme and measurer. */
export function prepareDocument(grouped: GroupedDocument, faces: Faces): PreparedDocument {
  const { theme, text, emojiFamily, highlight } = faces;
  const { grouping } = grouped;
  const input = layoutInput(new RegexKit(), grouping);
  const options = { emojiFamily };
  const measurer = sizingMeasurer(input, theme, text, options);
  // One sizer for every width: its leaf-text cache is keyed by content.
  const sizer = documentSizer(input, theme, text, options);
  // The thresholds, measured once (md2ui memoizes the floor the same way):
  // effective(asked) = clamp(asked, effective(0), effective(∞)).
  const floor = effectiveWidth(input, theme, measurer, 0);
  const cap = effectiveWidth(input, theme, measurer, Number.POSITIVE_INFINITY);
  const { left, right } = theme.root.padding;
  // `Layout: Auto`'s choice, once per width band for this document's life.
  const auto = autoLayout(input, theme, measurer);
  let last: { readonly at: number; readonly scene: PaintedScene } | null = null;
  return {
    render(width) {
      const at = Math.min(cap, Math.max(floor, width - left - right));
      if (last?.at === at) return last.scene;
      const placed = auto.choose(at, (tiles) => {
        const layout = generate(input, at, theme, measurer, tiles);
        bakeLayout(layout, theme);
        return { scene: placeScene(sizer, layout, grouping, at) };
      }).scene;
      const scene = paintScene(sizer, placed, grouping, highlight);
      last = { at, scene };
      return scene;
    },
  };
}
