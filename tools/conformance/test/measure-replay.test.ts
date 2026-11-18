// Layout's sizing composed from C3 against md2ui's own closure answers (stage B).
// The generator runs on md2ui's recorded answers, so it stays on md2ui's path; every
// question it asks (leaf and marker widths, block widths, heights of the subtrees it
// built) is also put to the composed measurer, over md2ui's recorded FONT answers
// (`fontReplay`), and the two answers must be identical. Every recorded code block is
// checked against the code-block plan. A difference must have a named cause, proved case
// by case from the recording (`sizingCause`); anything else fails. Runs only when
// MD2UI_FIXTURES is set.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";
import type { GroupingNode } from "@md2ui/contracts";
import {
  codeBlockPlan,
  effectiveWidth,
  generate,
  type KvRole,
  type LayoutMeasurer,
  type LayoutNode,
  type LeafInputs,
  layoutInput,
  parseTheme,
  RegexKit,
  sizingMeasurer,
} from "@md2ui/core";
import { expect, test } from "vitest";
import { closureReplay } from "../src/closure-replay.ts";
import { fontAnswers, fontReplay, themeFonts } from "../src/font-replay.ts";
import { isObject, readJson, readJsonLines } from "../src/json.ts";
import { readManifest } from "../src/manifest.ts";
import {
  describeLeaf,
  describeTree,
  SIZING_CAUSES,
  type SizingContext,
  type SizingQuestion,
  sizingCause,
} from "../src/sizing-classes.ts";

const fixtures = env["MD2UI_FIXTURES"] ?? "";

const KINDS = [
  "leaf_min_width",
  "leaf_line_width",
  "marker_width",
  "code_block",
  "block_width",
  "layout_height",
] as const;
type Kind = (typeof KINDS)[number];

type Question = SizingQuestion & { readonly kind: Kind };

interface Diff {
  readonly doc: string;
  readonly question: Question;
  readonly recorded: number | null;
  readonly composed: number | null | string;
  /** A cause, or null when none explains it. */
  readonly cause: string | null;
}

/** A code-block record's content as the leaf the plan measures. */
function codeBlockLeaf(content: string): LeafInputs {
  return {
    node_id: "",
    type: "code_block",
    content,
    heading_ctx: 0,
    atx_level: 0,
    text_style: null,
    text_style_chain: [],
    code_variant: null,
    code_language: null,
    emoji_kind: null,
    emoji_index: 0,
    emoji_variant: null,
    in_key: false,
    table_role: null,
    link_variant: null,
    link_label: null,
    link_is_emoji: false,
    link_disabled: false,
    drawing_element: null,
  };
}

test.skipIf(fixtures === "")(
  "sizing composed from C3 answers what md2ui answered",
  () => {
    const manifest = readManifest(fixtures);
    const raw = JSON.parse(readFileSync(join(fixtures, "manifest.json"), "utf8")) as {
      corpus: { doc: string; theme_input: string | null }[];
    };
    const themeInputs = new Map(raw.corpus.map((e) => [e.doc, e.theme_input]));
    const asked = new Map<Kind, number>(KINDS.map((k) => [k, 0]));
    const diffs: Diff[] = [];
    let docLabels = 0;

    for (const layout of manifest.layouts) {
      for (const doc of layout.docs) {
        const wanted = join(fixtures, "layout-generated", layout.label, `${doc.doc}.json`);
        if (!existsSync(wanted)) continue;
        docLabels += 1;
        const name = `${layout.label}/${doc.doc}`;
        const themeInput = themeInputs.get(doc.doc) ?? null;
        const theme = parseTheme(
          themeInput === null ? "" : readFileSync(join(fixtures, themeInput), "utf8"),
        );
        const records = readJsonLines(join(fixtures, "measure", layout.label, `${doc.doc}.jsonl`));
        const layoutRecords = readJsonLines(
          join(fixtures, "measure-layout", layout.label, `${doc.doc}.jsonl`),
        );
        const replay = closureReplay(records, layoutRecords);
        const fonts = manifest.fonts.get(doc.theme) ?? [];
        const { context, emojiFamily } = themeFonts(
          theme,
          fonts,
          manifest.families.get(doc.theme) ?? {},
        );
        const text = fontReplay(fontAnswers(records, context));
        const tree = readJson(join(fixtures, "grouper", "final", `${doc.doc}.json`));
        const input = layoutInput(new RegexKit(), tree as unknown as GroupingNode);
        const ctx: SizingContext = { theme, records };
        const composed = sizingMeasurer(input, theme, text, { emojiFamily });

        const check = (q: Question, recorded: number | null, ask: () => number | null): void => {
          asked.set(q.kind, (asked.get(q.kind) ?? 0) + 1);
          let answer: number | null | string;
          try {
            answer = ask();
          } catch (error) {
            answer = `threw: ${error instanceof Error ? error.message : String(error)}`;
          }
          if (answer === recorded) return;
          const found = typeof answer === "string" ? null : sizingCause(ctx, q, recorded, answer);
          const cause = found === null ? null : SIZING_CAUSES[found];
          diffs.push({ doc: name, question: q, recorded, composed: answer, cause });
        };
        const leaf = (kind: Kind, node: LeafInputs, role: KvRole | null): Question => ({
          kind,
          node,
          role,
          field: null,
          what: `${describeLeaf(node)} kv=${role}`,
        });
        const built = (kind: Kind, tree: LayoutNode, width: number): Question => ({
          kind,
          node: null,
          role: null,
          field: null,
          what: `${describeTree(tree)} at ${width}`,
        });

        const checking: LayoutMeasurer = {
          leafMinWidth: (node, role) => {
            const a = replay.leafMinWidth(node, role);
            check(leaf("leaf_min_width", node, role), a, () => composed.leafMinWidth(node, role));
            return a;
          },
          leafLineWidth: (node, role) => {
            const a = replay.leafLineWidth(node, role);
            check(leaf("leaf_line_width", node, role), a, () => composed.leafLineWidth(node, role));
            return a;
          },
          markerWidth: (props) => {
            const a = replay.markerWidth(props);
            const q: Question = {
              kind: "marker_width",
              node: null,
              role: null,
              field: null,
              what: JSON.stringify(props),
            };
            check(q, a, () => composed.markerWidth(props));
            return a;
          },
          blockWidth: (tree, available) => {
            const a = replay.blockWidth(tree, available);
            check(built("block_width", tree, available), a, () =>
              composed.blockWidth(tree, available),
            );
            return a;
          },
          layoutHeight: (tree, width) => {
            const a = replay.layoutHeight(tree, width);
            check(built("layout_height", tree, width), a, () => composed.layoutHeight(tree, width));
            return a;
          },
        };
        generate(input, effectiveWidth(input, theme, checking, layout.width), theme, checking);

        for (const record of layoutRecords) {
          if (!isObject(record) || record["q"] !== "code_block" || !isObject(record["a"])) continue;
          const content = record["content"] as string;
          const a = record["a"];
          const plan = (): Readonly<Record<string, number>> => ({
            ...codeBlockPlan(content, theme, text),
          });
          for (const field of Object.keys(a)) {
            const q: Question = {
              kind: "code_block",
              node: codeBlockLeaf(content),
              role: null,
              field,
              what: `${field} of ${JSON.stringify(content.slice(0, 40))}`,
            };
            check(q, a[field] as number, () => plan()[field] ?? null);
          }
        }
      }
    }

    const lines = ["measure replay"];
    for (const kind of KINDS) {
      const different = diffs.filter((d) => d.question.kind === kind).length;
      const total = asked.get(kind) ?? 0;
      lines.push(`  ${kind}: asked ${total}, equal ${total - different}, different ${different}`);
    }
    const byCause = new Map<string, Diff[]>();
    for (const d of diffs) {
      const key = d.cause ?? "UNEXPLAINED";
      byCause.set(key, [...(byCause.get(key) ?? []), d]);
    }
    for (const [cause, list] of byCause) {
      lines.push(`  [${list.length}] ${cause}`);
      const kinds = new Map<Kind, number>();
      for (const d of list) kinds.set(d.question.kind, (kinds.get(d.question.kind) ?? 0) + 1);
      lines.push(`    by kind: ${[...kinds].map(([k, n]) => `${k} ${n}`).join(", ")}`);
      for (const d of list.slice(0, cause === "UNEXPLAINED" ? 40 : 3)) {
        lines.push(
          `    ${d.doc} ${d.question.kind} ${d.question.what}: md2ui ${d.recorded}, composed ${String(d.composed)}`,
        );
      }
    }
    console.log(lines.join("\n"));

    // Every document of every layout label was replayed: none was skipped.
    expect(docLabels).toBe(manifest.layouts.reduce((n, layout) => n + layout.docs.length, 0));
    expect(
      diffs
        .filter((d) => d.cause === null)
        .map((d) => `${d.doc} ${d.question.kind} ${d.question.what}`),
    ).toEqual([]);
  },
  600_000,
);
