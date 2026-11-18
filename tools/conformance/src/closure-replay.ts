// md2ui's recorded measurer closure answers: the leaf and marker answers from
// `measure/<label>/<doc>.jsonl`, the block widths and heights from
// `measure-layout/<label>/<doc>.jsonl`. A question is the record without its answer (`a`)
// and count (`n`). `recordedAnswers` looks a question up; `closureReplay` replays them as
// a `LayoutMeasurer`, so the layout generator can be checked against md2ui exactly, and a
// question md2ui never asked is a port bug there, so it throws instead of guessing. Runs in
// Node and in the browser.
import type { KvRole, LayoutMeasurer, LayoutNode, LeafInputs } from "@md2ui/core";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { isObject, type Json } from "./json.ts";

/**
 * The `LeafInputs` fields md2ui files a leaf answer under, in md2ui's names
 * (`scripts/ts_fixture_closures._LEAF_INPUTS`): every one but `atx_level`.
 */
const LEAF_FIELDS: readonly (keyof LeafInputs)[] = [
  "node_id",
  "type",
  "content",
  "heading_ctx",
  "text_style",
  "text_style_chain",
  "code_variant",
  "code_language",
  "emoji_kind",
  "emoji_index",
  "emoji_variant",
  "in_key",
  "table_role",
  "link_variant",
  "link_label",
  "link_is_emoji",
  "link_disabled",
  "drawing_element",
];

const KINDS = ["leaf_min_width", "leaf_line_width", "marker_width"] as const;
type Kind = (typeof KINDS)[number];

/** Object keys sorted recursively, arrays in order: one spelling per question. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "object" && value !== null) {
    const entries = Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value);
}

function isKind(q: Json | undefined): q is Kind {
  return KINDS.some((kind) => kind === q);
}

/** The key of a recorded question: the record without `a` and `n`. */
function recordKey(record: Record<string, Json>): string {
  const { a: _answer, n: _count, ...question } = record;
  return canonical(question);
}

function leafQuestion(kind: Kind, node: LeafInputs, kvRole: string | null): string {
  const inputs = Object.fromEntries(LEAF_FIELDS.map((field) => [field, node[field]]));
  return canonical({ q: kind, kv_role: kvRole, node: inputs });
}

/** md2ui's fixture form of a number: a non-finite float is a string. */
function fixtureNumber(value: number): number | string {
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
  return value;
}

/**
 * The key md2ui files a built subtree's answers under (`measure-layout/`):
 * SHA-256 of the canonical JSON of its fixture form, with non-zero `flow_run` values
 * renumbered 1, 2, … by first appearance in pre-order, so the generator's run counter is
 * not part of the key.
 */
function subtreeDigest(root: LayoutNode): string {
  const runs = new Map<number, number>();
  const form = (node: LayoutNode): unknown => {
    let flowRun = node.flow_run;
    if (flowRun !== 0) {
      flowRun = runs.get(flowRun) ?? runs.size + 1;
      runs.set(node.flow_run, flowRun);
    }
    return {
      ...node,
      ratios: node.ratios.map(fixtureNumber),
      flow_run: flowRun,
      children: node.children.map(form),
    };
  };
  return bytesToHex(sha256(utf8ToBytes(canonical(form(root)))));
}

/** The key of a `measure-layout/` question: the kind, the subtree's digest, the width. */
function layoutKey(kind: string, subtree: string, width: number): string {
  return canonical({ q: kind, subtree, width });
}

/** md2ui's answer to each closure question; `undefined` where md2ui never asked it. */
export interface RecordedAnswers {
  leafMinWidth(node: LeafInputs, kvRole: KvRole | null): number | null | undefined;
  leafLineWidth(node: LeafInputs, kvRole: KvRole | null): number | null | undefined;
  markerWidth(props: Readonly<Record<string, unknown>>): number | null | undefined;
  blockWidth(built: LayoutNode, available: number): number | undefined;
  layoutHeight(built: LayoutNode, width: number): number | undefined;
}

export function recordedAnswers(
  records: readonly Json[],
  layoutRecords: readonly Json[],
): RecordedAnswers {
  const answers = new Map<string, number | null>();
  for (const record of records) {
    if (!isObject(record) || !isKind(record["q"])) continue;
    answers.set(recordKey(record), record["a"] as number | null);
  }
  const layoutAnswers = new Map<string, number>();
  for (const record of layoutRecords) {
    if (!isObject(record)) continue;
    const { q, subtree, width, a } = record;
    if ((q === "layout_height" || q === "block_width") && typeof subtree === "string") {
      layoutAnswers.set(layoutKey(q, subtree, width as number), a as number);
    }
  }
  const layoutAnswer = (kind: string, built: LayoutNode, width: number): number | undefined =>
    layoutAnswers.get(layoutKey(kind, subtreeDigest(built), width));
  return {
    leafMinWidth: (node, kvRole) => answers.get(leafQuestion("leaf_min_width", node, kvRole)),
    leafLineWidth: (node, kvRole) => answers.get(leafQuestion("leaf_line_width", node, kvRole)),
    markerWidth: (props) => answers.get(canonical({ q: "marker_width", props })),
    blockWidth: (built, available) => layoutAnswer("block_width", built, available),
    layoutHeight: (built, width) => layoutAnswer("layout_height", built, width),
  };
}

export function closureReplay(
  records: readonly Json[],
  layoutRecords: readonly Json[],
): LayoutMeasurer {
  const recorded = recordedAnswers(records, layoutRecords);
  const found = <T>(answer: T | undefined, kind: string, question: () => string): T => {
    if (answer !== undefined) return answer;
    const shown = question();
    throw new Error(
      `no recorded ${kind} answer for ${shown.length > 300 ? `${shown.slice(0, 297)}...` : shown}`,
    );
  };
  return {
    leafMinWidth: (node, kvRole) =>
      found(recorded.leafMinWidth(node, kvRole), "leaf_min_width", () =>
        leafQuestion("leaf_min_width", node, kvRole),
      ),
    leafLineWidth: (node, kvRole) =>
      found(recorded.leafLineWidth(node, kvRole), "leaf_line_width", () =>
        leafQuestion("leaf_line_width", node, kvRole),
      ),
    markerWidth: (props) => {
      const answer = found(recorded.markerWidth(props), "marker_width", () =>
        canonical({ q: "marker_width", props }),
      );
      if (answer === null) throw new Error("recorded marker_width answer is null");
      return answer;
    },
    blockWidth: (built, available) =>
      found(recorded.blockWidth(built, available), "block_width", () =>
        layoutKey("block_width", subtreeDigest(built), available),
      ),
    layoutHeight: (built, width) =>
      found(recorded.layoutHeight(built, width), "layout_height", () =>
        layoutKey("layout_height", subtreeDigest(built), width),
      ),
  };
}
