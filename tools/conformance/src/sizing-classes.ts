// The cause by which sizing composed from C3 answers differently from md2ui under
// md2ui's own font answers (stage B). It is proved case by case from the recording,
// never assumed: `sizingCause` names it only when it reproduces md2ui's number from the
// recorded answers. Runs in Node and in the browser.
import type { ResolvedTheme } from "@md2ui/contracts";
import type { KvRole, LayoutNode, LeafInputs } from "@md2ui/core";
import { isObject, type Json } from "./json.ts";

/** One closure question, as the cause reads it. */
export interface SizingQuestion {
  readonly kind: string;
  /** The leaf asked about; for a code-block record, a code block of its content; `null` for a built subtree. */
  readonly node: LeafInputs | null;
  readonly role: KvRole | null;
  /** The code-block plan field, for a code-block record. */
  readonly field: string | null;
  readonly what: string;
}

/** What the cause reads about one document: its theme and md2ui's recorded answers. */
export interface SizingContext {
  readonly theme: ResolvedTheme;
  readonly records: readonly Json[];
}

export type SizingCause = "code-line-runs" | "emoji-gap";

export const SIZING_CAUSES: Readonly<Record<SizingCause, string>> = {
  "code-line-runs":
    "code-line runs: md2ui sums a code line's syntax-highlighted runs, each measured in " +
    "float32 by Skia; C3 measures the line whole, and a decomposition of the line into " +
    "recorded runs reproduces md2ui's width exactly",
  "emoji-gap":
    "emoji gap: md2ui's `Emoji gap` is a space stretched to the gap, whose float32 Skia " +
    "advance can miss it by a few ulps; the port adds the gap itself, and putting md2ui's " +
    "recorded stretched space in its place reproduces md2ui's width exactly",
};

/** Python's float `sum`, compensated (Neumaier), as a running state. */
interface PySum {
  readonly hi: number;
  readonly lo: number;
}

function pyAdd({ hi, lo }: PySum, x: number): PySum {
  const t = hi + x;
  const err = Math.abs(hi) >= Math.abs(x) ? hi - t + x : x - t + hi;
  return { hi: t, lo: lo + err };
}

const pyTotal = ({ hi, lo }: PySum): number => (lo !== 0 && Number.isFinite(lo) ? hi + lo : hi);

/** Python's `expandtabs(4)` and md2ui's `_normalized_source`, split into lines. */
function codeLines(content: string): string[] {
  let source = "";
  let column = 0;
  for (const ch of content.replaceAll("\r\n", "\n").replaceAll("\r", "\n")) {
    if (ch === "\t") {
      const pad = 4 - (column % 4);
      source += " ".repeat(pad);
      column += pad;
    } else {
      source += ch;
      column = ch === "\n" ? 0 : column + 1;
    }
  }
  return (source.endsWith("\n") ? source.slice(0, -1) : source).split("\n");
}

/** Every Python `sum` of recorded advances that spells `line` run by run. */
function runSums(line: string, runs: ReadonlyMap<string, number>): Set<number> {
  const states: Map<string, PySum>[] = Array.from({ length: line.length + 1 }, () => new Map());
  states[0]?.set("0|0", { hi: 0, lo: 0 });
  for (let pos = 0; pos < line.length; pos++) {
    const here = states[pos] as Map<string, PySum>;
    if (here.size === 0) continue;
    for (const [run, advance] of runs) {
      if (!line.startsWith(run, pos)) continue;
      const next = states[pos + run.length] as Map<string, PySum>;
      for (const state of here.values()) {
        const s = pyAdd(state, advance);
        if (next.size < 256) next.set(`${s.hi}|${s.lo}`, s);
      }
    }
  }
  return new Set([...(states[line.length]?.values() ?? [])].map(pyTotal));
}

/** md2ui's code-block width from recorded runs: some line's run sum plus the padding. */
function codeWidthFromRuns(ctx: SizingContext, content: string, recorded: number): boolean {
  const style = ctx.theme.code_blocks.text_style;
  const family = (style.font_name || ctx.theme.text.font_name || "Arial").toLowerCase();
  const runs = new Map<string, number>();
  for (const r of ctx.records) {
    if (!isObject(r) || r["q"] !== "advance" || r["size"] !== style.font_size) continue;
    // A code line's runs are measured plain: never stretched, never shaped as a sequence.
    if (r["scale_x"] !== undefined || r["shaped"] !== undefined) continue;
    const face = String(r["face"]).split("|")[0]?.toLowerCase();
    if (face === family) runs.set(r["text"] as string, r["a"] as number);
  }
  const pad = ctx.theme.code_blocks.padding;
  return codeLines(content).some((line) =>
    [...runSums(line, runs)].some((s) => s + (pad.left + pad.right) === recorded),
  );
}

/** How far md2ui's stretched space may be from the gap it was stretched to. */
const STRETCH_SLACK = 1e-3;

/** Each stretched space md2ui recorded for a gap the theme's link styles state, and the gap. */
function stretchedGaps(ctx: SizingContext): [stretched: number, gap: number][] {
  const links = ctx.theme.links;
  const gaps = new Set(
    [links.primary, links.secondary, links.tertiary, links.quaternary, links.quinary]
      .concat([links.senary, links.septenary, links.text])
      .flatMap((style) => (style.emoji_gap === null ? [] : [style.emoji_gap])),
  );
  return ctx.records.flatMap((r) => {
    if (!isObject(r) || r["q"] !== "advance" || r["text"] !== " ") return [];
    const stretched = r["a"];
    if (r["scale_x"] === undefined || typeof stretched !== "number") return [];
    return [...gaps]
      .filter((gap) => Math.abs(stretched - gap) <= STRETCH_SLACK)
      .map((gap): [number, number] => [stretched, gap]);
  });
}

/**
 * Whether a button label's width is the port's with each of its one or two gaps (a
 * leading and a trailing emoji) replaced by a stretched space md2ui recorded for a gap
 * one of the theme's link styles states.
 */
function gapFromStretchedSpace(ctx: SizingContext, recorded: number, composed: number): boolean {
  return stretchedGaps(ctx).some(([stretched, gap]) =>
    [1, 2].some((count) => composed + count * (stretched - gap) === recorded),
  );
}

/**
 * The most md2ui's stretched space misses a gap by, in this document; 0 when it never
 * does. Where placement sums `emoji-gap` widths, a position moves by multiples of it.
 */
export function emojiGapError(ctx: SizingContext): number {
  return Math.max(0, ...stretchedGaps(ctx).map(([stretched, gap]) => Math.abs(stretched - gap)));
}

/** The stated cause of a difference, proved from the recording, or null. */
export function sizingCause(
  ctx: SizingContext,
  q: SizingQuestion,
  recorded: number | null,
  composed: number | null,
): SizingCause | null {
  // No built-tree difference has a stated cause: every one is a port bug.
  if (recorded === null || composed === null || q.node === null) return null;
  if (q.node.type === "code_block" && (q.field === null || q.field === "width")) {
    return codeWidthFromRuns(ctx, q.node.content, recorded) ? "code-line-runs" : null;
  }
  if (q.node.type === "link") {
    return gapFromStretchedSpace(ctx, recorded, composed) ? "emoji-gap" : null;
  }
  return null;
}

/** A built subtree in a line: its kind, its size, and the first leaves it holds. */
export function describeTree(tree: LayoutNode): string {
  const leaves: string[] = [];
  let count = 0;
  const visit = (n: LayoutNode): void => {
    count += 1;
    if (n.type === "-" && leaves.length < 3) leaves.push(n.content_id ?? "(synthetic)");
    for (const c of n.children) visit(c);
  };
  visit(tree);
  return `${tree.type}${tree.table ? " table" : ""}${tree.grid ? " grid" : ""} of ${count} nodes [${leaves.join(", ")}${count > 3 ? ", ..." : ""}]`;
}

/** A leaf in a line: its id, type and content. */
export function describeLeaf(node: LeafInputs): string {
  const content = node.content.length > 60 ? `${node.content.slice(0, 57)}...` : node.content;
  return `${node.node_id} ${node.type} ${JSON.stringify(content)}`;
}
