// The layout generator against md2ui, answered from md2ui's recorded measurer answers
// (stage A): for every document and width label with a `layout-generated`
// fixture, the generated tree must equal md2ui's, and baking it must equal md2ui's
// baked tree. Every doc-label must pass both; a failure is printed with its first
// difference. Runs only when MD2UI_FIXTURES names the fixtures.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";
import type { GroupingNode } from "@md2ui/contracts";
import {
  bakeLayout,
  effectiveWidth,
  generate,
  type LayoutMeasurer,
  type LayoutNode,
  layoutInput,
  parseTheme,
  RegexKit,
} from "@md2ui/core";
import { expect, test } from "vitest";
import { LAYOUT } from "../src/checks.ts";
import { closureReplay } from "../src/closure-replay.ts";
import { compare, type Difference } from "../src/diff.ts";
import { type Json, readJson, readJsonLines } from "../src/json.ts";
import { readManifest } from "../src/manifest.ts";

const fixtures = env["MD2UI_FIXTURES"] ?? "";

/** Every `<label>/<doc>` with a `layout-generated` fixture, by its layout label. */
function docLabels(): {
  readonly name: string;
  readonly label: string;
  readonly width: number;
  readonly doc: string;
}[] {
  return readManifest(fixtures).layouts.flatMap((layout) =>
    layout.docs
      .filter((doc) =>
        existsSync(join(fixtures, "layout-generated", layout.label, `${doc.doc}.json`)),
      )
      .map((doc) => ({
        name: `${layout.label}/${doc.doc}`,
        label: layout.label,
        width: layout.width,
        doc: doc.doc,
      })),
  );
}

type Outcome =
  | { readonly kind: "pass" }
  | { readonly kind: "fail"; readonly detail: string }
  | { readonly kind: "unrecorded"; readonly detail: string };

const describeDifference = (stage: string, d: Difference): string =>
  `${stage} ${d.class} at ${d.path} ${d.field}: expected ${d.expected}, got ${d.actual}`;

function classify(error: unknown): Outcome {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("no recorded ")) {
    return { kind: "unrecorded", detail: message.slice(0, 160) };
  }
  return { kind: "fail", detail: `threw: ${message}` };
}

test.skipIf(fixtures === "")(
  "the generator replays md2ui's layouts",
  () => {
    const manifest = readManifest(fixtures);
    const themeInputs = new Map<string, string | null>();
    const raw = JSON.parse(readFileSync(join(fixtures, "manifest.json"), "utf8")) as {
      corpus: { doc: string; theme_input: string | null }[];
    };
    for (const entry of raw.corpus) themeInputs.set(entry.doc, entry.theme_input);

    const outcomes = new Map<string, Outcome>();
    for (const layout of manifest.layouts) {
      for (const doc of layout.docs) {
        const name = `${layout.label}/${doc.doc}`;
        const wanted = join(fixtures, "layout-generated", layout.label, `${doc.doc}.json`);
        if (!existsSync(wanted)) continue;
        const themeInput = themeInputs.get(doc.doc) ?? null;
        const theme = parseTheme(
          themeInput === null ? "" : readFileSync(join(fixtures, themeInput), "utf8"),
        );
        const measurer = closureReplay(
          readJsonLines(join(fixtures, "measure", layout.label, `${doc.doc}.jsonl`)),
          readJsonLines(join(fixtures, "measure-layout", layout.label, `${doc.doc}.jsonl`)),
        );
        const tree = readJson(join(fixtures, "grouper", "final", `${doc.doc}.json`));
        let outcome: Outcome;
        try {
          const input = layoutInput(new RegexKit(), tree as unknown as GroupingNode);
          const width = effectiveWidth(input, theme, measurer, layout.width);
          const want = readJson(wanted);
          // `Layout: Auto`: md2ui's choice is read from the tree it generated; its empty
          // area is measured in stage C, which places.
          const tiles =
            theme.root.layout === "auto" && JSON.stringify(want).includes('"bento":true');
          const generated = generate(input, width, theme, measurer, tiles);
          const asJson = (): Json => JSON.parse(JSON.stringify(generated)) as Json;
          const diffs = compare(want, asJson(), LAYOUT);
          if (diffs.length > 0) {
            outcome = {
              kind: "fail",
              detail: describeDifference("layout-generated", diffs[0] as Difference),
            };
          } else {
            bakeLayout(generated, theme);
            const baked = compare(
              readJson(join(fixtures, "layout", layout.label, `${doc.doc}.json`)),
              asJson(),
              LAYOUT,
            );
            outcome =
              baked.length > 0
                ? { kind: "fail", detail: describeDifference("layout", baked[0] as Difference) }
                : { kind: "pass" };
          }
        } catch (error) {
          outcome = classify(error);
        }
        outcomes.set(name, outcome);
      }
    }

    const labels = [...new Set([...outcomes.keys()].map((k) => k.split("/")[0] ?? ""))];
    const lines: string[] = [];
    for (const label of labels) {
      const counts = new Map<string, number>();
      for (const [name, o] of outcomes) {
        if (name.startsWith(`${label}/`)) counts.set(o.kind, (counts.get(o.kind) ?? 0) + 1);
      }
      const shown = ["pass", "fail", "unrecorded"]
        .map((k) => `${k} ${counts.get(k) ?? 0}`)
        .join(", ");
      lines.push(`${label}: ${shown}`);
    }
    for (const [name, o] of outcomes) {
      if (o.kind !== "pass") lines.push(`  ${o.kind.padEnd(10)} ${name}: ${o.detail}`);
    }
    console.log(`layout replay\n${lines.join("\n")}`);

    const broken = [...outcomes]
      .filter(([, o]) => o.kind !== "pass")
      .map(([name, o]) => `${name}: ${JSON.stringify(o)}`);
    expect(broken).toEqual([]);
    expect(outcomes.size).toBe(docLabels().length);
  },
  600_000,
);

/** Every grouping node, parents first. */
function* walk(node: GroupingNode): Generator<GroupingNode> {
  yield node;
  for (const child of node.children) yield* walk(child);
}

test.skipIf(fixtures === "")(
  "the layout does not depend on what the ids look like",
  () => {
    const themeInputs = new Map<string, string | null>();
    const raw = JSON.parse(readFileSync(join(fixtures, "manifest.json"), "utf8")) as {
      corpus: { doc: string; theme_input: string | null }[];
    };
    for (const entry of raw.corpus) themeInputs.set(entry.doc, entry.theme_input);
    for (const { name, label, doc, width } of docLabels()) {
      const themeInput = themeInputs.get(doc) ?? null;
      const theme = parseTheme(
        themeInput === null ? "" : readFileSync(join(fixtures, themeInput), "utf8"),
      );
      const replay = closureReplay(
        readJsonLines(join(fixtures, "measure", label, `${doc}.jsonl`)),
        readJsonLines(join(fixtures, "measure-layout", label, `${doc}.jsonl`)),
      );
      const tree = readJson(
        join(fixtures, "grouper", "final", `${doc}.json`),
      ) as unknown as GroupingNode;
      // The same tree with every id replaced by an opaque string that is no path.
      const relabelled = JSON.parse(
        JSON.stringify(tree, (_k, v: unknown) => (typeof v === "bigint" ? null : v)),
      ) as GroupingNode;
      const back = new Map<string, string>();
      [...walk(relabelled)].forEach((n, i) => {
        const opaque = `id-${((i + 1) * 2654435761) % 4294967296}`;
        back.set(opaque, n.node_id);
        n.node_id = opaque;
      });
      // The recorded answers are filed under md2ui's ids: ask with the original one.
      const original = (id: string): string => back.get(id) ?? id;
      const restored = (built: LayoutNode): LayoutNode => ({
        ...built,
        content_id: built.content_id === null ? null : original(built.content_id),
        link_node_id: built.link_node_id === null ? null : original(built.link_node_id),
        children: built.children.map(restored),
      });
      const measurer: LayoutMeasurer = {
        ...replay,
        leafMinWidth: (node, role) =>
          replay.leafMinWidth({ ...node, node_id: original(node.node_id) }, role),
        leafLineWidth: (node, role) =>
          replay.leafLineWidth({ ...node, node_id: original(node.node_id) }, role),
        blockWidth: (built, available) => replay.blockWidth(restored(built), available),
        layoutHeight: (built, width) => replay.layoutHeight(restored(built), width),
      };
      const run = (input: GroupingNode, m: LayoutMeasurer): LayoutNode => {
        const prepared = layoutInput(new RegexKit(), input);
        return generate(prepared, effectiveWidth(prepared, theme, m, width), theme, m);
      };
      const expected = run(tree, replay);
      const mapped = JSON.stringify(run(relabelled, measurer), (key, v: unknown) =>
        (key === "content_id" || key === "link_node_id") && typeof v === "string" ? original(v) : v,
      );
      expect(mapped, name).toBe(JSON.stringify(expected));
    }
  },
  600_000,
);
