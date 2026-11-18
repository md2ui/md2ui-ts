// The grouper: Markdown in, a `GroupNode` tree out, phase by phase (md2ui:
// pipeline/markdown_grouper.MarkdownGrouper).
//
// Each phase annotates or reshapes one shared tree and hands it on. md2ui runs them
// in `_process_once`; `processOnce` here runs them in the same
// order, and reports the tree after each to an optional recorder, which is how the
// conformance runner compares a phase with md2ui's. `groupMarkdown` is the finished tree. Each phase's work lives in the
// module named for it; this file is the order.
import type { GroupingNode } from "@md2ui/contracts";
import {
  annotateDataPointsWalk,
  annotateDatapointDisplays,
  annotateRotationIndices,
  stampFinishedTree,
  stampLeafKinds,
  wrapDateChipGroups,
} from "./annotate.ts";
import { buildBlockAst } from "./block-ast.ts";
import {
  assignSourceLineIds,
  pruneEmpty,
  restructureListBodies,
  stampListOrdinals,
  subgroupContent,
  subgroupContentClassifiedMulti,
} from "./block-passes.ts";
import { splitAllLists, splitBlankLines, splitBlockquote, splitNewlines } from "./block-splits.ts";
import { expandCardsWalk, restoreUnexpandedSentinels } from "./cards.ts";
import { flagCharts } from "./charts.ts";
import { type CodeBlockSpec, expandCodeBlocks, restoreCodeBlocks } from "./code-blocks.ts";
import type { CardSpec } from "./constructs.ts";
import { flagTableGroups } from "./displays.ts";
import {
  restoreEscapedTaskControls,
  splitTaskControls,
  stampTaskControls,
} from "./drawing-elements.ts";
import { peelBoundaryDpsWalk } from "./element-walk.ts";
import { type Respelled, respell, stampFeedSlots } from "./feed-slots.ts";
import { fingerprints } from "./fingerprint.ts";
import { collapseGroups, wrapGluedContent, wrapLoneRootContent } from "./glue.ts";
import { IdMint } from "./ids.ts";
import { consumeLineValigns, deriveLineSplitGroups } from "./line-flow.ts";
import { GroupNode } from "./node.ts";
import { unpairUnread } from "./pairs.ts";
import { preprocess } from "./preprocess.ts";
import { RegexKit } from "./py/re.ts";
import { strip } from "./py/str.ts";
import { separateStructuredContentWalk } from "./separate.ts";
import { restoreEscapedSliders, splitSliders, stampSliders } from "./sliders.ts";
import { restoreInlineSpacerText, stampSpacers, stripSpacerLines } from "./spacers.ts";
import { subgroupTablesWalk } from "./tables.ts";
import { annotateTextStyleTiers } from "./text-style-tiers.ts";

/** Receives the tree after each ported phase, by md2ui's phase name (`2.1`). */
type PhaseRecorder = (phase: string, root: GroupNode) => void;

/** md2ui: `MarkdownGrouper`, on the `process()` path. */
class Grouper {
  text: string;
  ast: GroupNode | null = null;
  /** The document's id counters (md2ui `_ids`). */
  readonly ids = new IdMint();
  /** The run's compiled regexes. */
  readonly kit: RegexKit;
  /** Block-content link/image bodies, by sentinel id; expanded in Phase 2.13. */
  card_specs: CardSpec[] = [];
  /** Opaque code blocks, by sentinel id; expanded in Phase 6.08. */
  code_specs: CodeBlockSpec[] = [];
  /** md2ui `_unwrapped_lines`: each line Phase 2.16 left unstamped, for Phase 6.055. */
  unwrapped_lines = new Map<number, string>();
  /** The end-of-line valign tokens Phase 2.165 consumed, by line; applied at Phase 6.1. */
  line_valigns: ReturnType<typeof consumeLineValigns> = new Map();
  /** md2ui `_feed_slots`: the feed slots the respell wrote as their words, stamped at Phase 6.246. */
  feed_slots: Respelled | null = null;

  constructor(text: string, kit: RegexKit) {
    this.text = text;
    this.kit = kit;
  }

  /**
   * md2ui: `process`. A document with `+++` spacer lines is grouped twice: the
   * spaced text first, then the text without them, and the spaced grouping's spacers
   * are then put into the plain one (ADR-203). `pass` hands each grouping its own
   * recorder.
   */
  process(pass: () => PhaseRecorder | undefined = () => undefined): void {
    this.kit.startRun();
    const plain = stripSpacerLines(this.kit, this.text);
    if (plain === null) {
      this.processOnce(pass());
      return;
    }
    const spaced = new Grouper(this.text, this.kit);
    spaced.processOnce(pass());
    this.text = plain;
    this.processOnce(pass());
    if (this.ast === null || spaced.ast === null || !stampSpacers(this.ast, spaced.ast)) {
      this.ast = spaced.ast;
    } else if (this.ast.children.length > 0) {
      // Node ids are positions, and the spacers took some: number the tree again.
      // Their hashes are silenced, so no fingerprint moves.
      fingerprints(this.kit, this.ast);
      // The spacers are leaves, and a group's leaf kinds count them.
      stampLeafKinds(this.ast);
    }
  }

  /** md2ui: `_process_once`, the phases ported so far. */
  processOnce(record?: PhaseRecorder): void {
    // Phase 1 — block structure (order-sensitive).
    const ast = this.toAst();
    subgroupContent(this.kit, this.ids, ast, splitBlankLines, true, false);
    subgroupTablesWalk(this.kit, ast);
    subgroupContent(this.kit, this.ids, ast, splitNewlines, false, true);
    record?.("1", ast);

    // Phase 2 — list extraction only; item bodies stay raw for Phase 2.1.
    subgroupContentClassifiedMulti(this.kit, this.ids, ast, [splitAllLists, splitBlockquote]);
    pruneEmpty(ast);
    record?.("2", ast);

    // Phase 2.1 — each multi-line list-item / blockquote body as a mini-document.
    restructureListBodies(this.kit, this.ids, ast);
    record?.("2.1", ast);

    // Phase 2.1b — each ordered item's running ordinal.
    stampListOrdinals(this.kit, ast);
    record?.("2.1b", ast);

    // Phase 2.13 — expand block-content link/image cards.
    if (this.card_specs.length > 0) {
      expandCardsWalk(this.kit, { cards: this.card_specs, ids: this.ids }, ast);
      pruneEmpty(ast);
    }
    record?.("2.13", ast);

    // Phase 2.15 — per-physical-source-line ids; every content leaf is one line now.
    assignSourceLineIds(this.ids, ast);
    record?.("2.15", ast);

    // Phase 2.16 — authored display tiers, whole-LINE pass, before detection.
    this.unwrapped_lines = new Map();
    annotateTextStyleTiers(
      this.kit,
      ast,
      { ids: this.ids, unwrappedLines: this.unwrapped_lines },
      true,
    );
    record?.("2.16", ast);

    // Phase 2.165 — consume the end-of-line vertical align tokens.
    this.line_valigns = consumeLineValigns(this.kit, ast);
    record?.("2.165", ast);

    // Safety net: a sentinel the expander missed is put back as its Markdown.
    if (this.card_specs.length > 0)
      restoreUnexpandedSentinels(this.kit, { cards: this.card_specs, ids: this.ids }, ast);
    record?.("safety-net", ast);

    // Phase 3 — data-point annotation before any inline splitting, so data-point
    // regions are protected from every cut.
    annotateDataPointsWalk(this.kit, ast);
    record?.("3", ast);

    // Phase 4+5 — prune, annotate and separate, in one walk.
    separateStructuredContentWalk(this.kit, ast, this.ids);
    record?.("4+5", ast);

    // Phase 5.5 — the element walk: images, then the boundary emoji / link / chip
    // peel, node by node in one post-order walk.
    peelBoundaryDpsWalk(this.kit, this.ids, ast);
    record?.("5.5", ast);

    // Phase 5.55 — drawing elements: sliders, then task controls, after every pass
    // that reads a line as one string; then escaped tokens become text again.
    splitSliders(this.kit, ast, this.ids);
    splitTaskControls(this.kit, ast, this.ids);
    restoreEscapedTaskControls(this.kit, ast);
    restoreEscapedSliders(this.kit, ast);
    record?.("5.55", ast);

    // Phase 5.6 — wrap source-glued content segments before collapsing.
    wrapGluedContent(ast);
    record?.("5.6", ast);

    // Phase 6 — collapse redundant group nodes (0 or 1 child).
    collapseGroups(ast);
    record?.("6", ast);

    // Phase 6.04 — the root is a container, never a leaf.
    wrapLoneRootContent(ast);
    record?.("6.04", ast);

    // Phase 6.05 — flag table containers.
    flagTableGroups(ast);
    record?.("6.05", ast);

    // Phase 6.055 — authored display tiers on the final leaves, the wrapper consumed.
    annotateTextStyleTiers(
      this.kit,
      ast,
      { ids: this.ids, unwrappedLines: this.unwrapped_lines },
      false,
    );
    record?.("6.055", ast);

    // Phase 6.06 — datapoint display replacements and their payloads.
    annotateDatapointDisplays(this.kit, ast);
    record?.("6.06", ast);

    // Phase 6.065 — each date-chip leaf becomes a group of its key and day.
    wrapDateChipGroups(ast);
    record?.("6.065", ast);

    // Phase 6.07 — flag chart containers (chart_group, line_group) over bullet runs of
    // `Key: value` rows in one unit; a chart wins over its rows' own displays.
    flagCharts(this.kit, ast);
    record?.("6.07", ast);

    // Phase 6.075 — a pair exists only while a display reads it (ADR-205): every
    // `Key: value` pair no display or chart took is its line again.
    unpairUnread(this.kit, ast);
    record?.("6.075", ast);

    // Phase 6.08 — opaque code blocks restored, after every pass that reads Markdown.
    if (this.code_specs.length > 0) {
      expandCodeBlocks(this.kit, ast, this.code_specs, this.ids);
      restoreCodeBlocks(this.kit, ast, this.code_specs);
    }
    record?.("6.08", ast);

    // Phase 6.1 — line_split_group from source_line_id, glue cleared where a line
    // flows, and each line's authored valign applied.
    deriveLineSplitGroups(this.kit, ast, this.line_valigns);
    record?.("6.1", ast);

    // Phases 6.15–6.245 — the finishing stamps in one pre-order walk; then any inline
    // spacer mark no separator consumed is the author's `+++` again.
    stampFinishedTree(this.kit, ast);
    restoreInlineSpacerText(this.kit, ast);
    record?.("6.15–6.245", ast);

    // Phase 6.246 — each control's ordinal and label, what a click reports.
    stampTaskControls(ast);
    stampSliders(this.kit, ast);
    stampFeedSlots(this.kit, ast, this.feed_slots);
    record?.("6.246", ast);

    // Phase 6.25 — each node's color-rotation slot.
    annotateRotationIndices(this.kit, ast);
    record?.("6.25", ast);

    // Phase 6.26 — what each group's leaves all are (pills, keys) and the document's
    // top heading level, read by the layout generator on every layout.
    stampLeafKinds(ast);
    record?.("6.26", ast);

    // Phase 6.5 — fingerprints, kinds and text lengths on the final tree.
    fingerprints(this.kit, ast);
    record?.("6.5", ast);
  }

  /** md2ui: `to_ast`. Preprocesses, then builds the heading-level tree into `ast`. */
  private toAst(): GroupNode {
    // A feed slot is its words before anything else reads the text (ADR-206).
    [this.text, this.feed_slots] = respell(this.kit, this.text);
    const prepared = preprocess(this.kit, this.text);
    this.text = prepared.text;
    this.card_specs = prepared.cards;
    this.code_specs = prepared.code;
    // md2ui: validate. Empty or white-space-only input is an empty root.
    this.ast = strip(this.text)
      ? buildBlockAst(this.kit, this.text, this.ids)
      : new GroupNode("", "root");
    return this.ast;
  }
}

/**
 * The tree after each ported phase, one map per grouping pass: a document with `+++`
 * spacer lines is grouped twice, spaced first (md2ui's fixture exporter's view of
 * `process()`).
 */
export function groupPhases(
  markdown: string,
  kit: RegexKit = new RegexKit(),
): Map<string, GroupingNode>[] {
  const passes: Map<string, GroupingNode>[] = [];
  new Grouper(markdown, kit).process(() => {
    const trees = new Map<string, GroupingNode>();
    passes.push(trees);
    return (phase, root) => trees.set(phase, root.toDict(kit));
  });
  return passes;
}

/**
 * md2ui: `MarkdownGrouper(text).process(SplitCriteria()).ast`: the grouping tree in
 * memory, with what C1 does not carry (`kind_hash`, `run_key`, `repeated_children`,
 * `orphan_grid`) for the layout generator.
 */
export function groupDocument(markdown: string, kit: RegexKit = new RegexKit()): GroupNode {
  const grouper = new Grouper(markdown, kit);
  grouper.process();
  return grouper.ast ?? new GroupNode("", "root");
}

/** md2ui: `MarkdownGrouper(text).process(SplitCriteria()).ast.to_dict()`: the grouping tree (C1). */
export function groupMarkdown(markdown: string, kit: RegexKit = new RegexKit()): GroupingNode {
  return groupDocument(markdown, kit).toDict(kit);
}
