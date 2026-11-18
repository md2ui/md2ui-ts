// The generator's input. md2ui lays out the tree rebuilt from the grouper's JSON
// (`load_grouping_ast_node(ast.to_dict())`), never the grouper's live tree; this
// checks, on every corpus document, which fields the generator reads come out the same
// on the grouper's live tree (`groupDocument`) and on the rebuilt one (`layoutInput`), so the
// production path's choice is measured, not assumed. Runs only when MD2UI_FIXTURES
// names the fixtures; the small cases below always run.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";
import { expect, test } from "vitest";
import { isDatapointSplitGroup } from "../src/group/glue.ts";
import { groupDocument } from "../src/group/grouper.ts";
import { classifyLinkContent } from "../src/group/link-content.ts";
import type { GroupNode } from "../src/group/node.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { layoutInput, leafInputs } from "../src/layout/input.ts";

const fixtures = env["MD2UI_FIXTURES"] ?? "";

/** The node fields the generator (and its measurers) read, by md2ui's names. */
const FIELDS = [
  "type",
  "content",
  "node_id",
  "glued_content_group",
  "line_split_group",
  "column_split_group",
  "column_row_group",
  "column_weights",
  "column_weights_wide",
  "column_cuts",
  "valign_group",
  "authored_valign",
  "line_valign",
  "align_group",
  "authored_align",
  "separator_chars",
  "spacer_binds",
  "spacer_lead",
  "spacer_trail",
  "separator_kind",
  "source_line_id",
  "heading_group",
  "heading_level",
  "heading_id",
  "fixed_style_key",
  "pure_element",
  "key_side",
  "top_heading_level",
  "atx_level",
  "section_style_key",
  "heading_ctx",
  "table_group",
  "table_role",
  "table_align",
  "datapoint_display",
  "datapoint_payload",
  "drawing_element",
  "text_style",
  "chart_group",
  "chart_data",
  "card_bg_url",
  "link_url",
  "emoji_variant",
  "code_variant",
  "code_language",
  "emoji_kind",
  "emoji_index",
  "rotation_index",
  "fixed_rotation_index",
  "rotation_chain",
  "text_style_chain",
  "rotation_path",
  "in_key",
  "list_ordinal",
  "list_heading_level",
  "text_length_category",
  "content_length_category",
  "child_type_counts",
  "orphan_grid",
] as const;

/** Ids compared as partitions: which nodes share a value, never the values. */
const PARTITIONS = ["kind_hash", "run_key", "fingerprint_hash"] as const;

function nodes(root: GroupNode): GroupNode[] {
  const out: GroupNode[] = [];
  const walk = (n: GroupNode): void => {
    out.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

function partition(values: readonly unknown[]): number[] {
  const first = new Map<unknown, number>();
  return values.map((v, i) => {
    if (v === null) return -1;
    if (!first.has(v)) first.set(v, i);
    return first.get(v) as number;
  });
}

/** The fields (by name) on which the live and the rebuilt tree differ, with a count. */
function differences(kit: RegexKit, markdown: string): Map<string, number> {
  const live = groupDocument(markdown, kit);
  const input = layoutInput(kit, live.toDict(kit));
  const a = nodes(live);
  const b = nodes(input.root);
  const out = new Map<string, number>();
  const count = (field: string): void => {
    out.set(field, (out.get(field) ?? 0) + 1);
  };
  if (a.length !== b.length) {
    count("tree");
    return out;
  }
  const index = new Map<GroupNode, number>(b.map((n, i) => [n, i]));
  const liveIndex = new Map<GroupNode, number>(a.map((n, i) => [n, i]));
  a.forEach((x, i) => {
    const y = b[i] as GroupNode;
    for (const field of FIELDS) {
      if (JSON.stringify(x[field]) !== JSON.stringify(y[field])) count(field);
    }
    const linkX =
      x.type === "link" ? classifyLinkContent(kit, x.content) : { variant: null, label: null };
    const linkY = leafInputs(input, y);
    if (linkX.variant !== linkY.link_variant || linkX.label !== linkY.link_label) count("link");
    // `repeated_children` as sets of corresponding nodes.
    const bucketsX = [...(x.repeated_children?.values() ?? [])].map((r) =>
      r.map((m) => liveIndex.get(m)),
    );
    const bucketsY = [...(y.repeated_children?.values() ?? [])].map((r) =>
      r.map((m) => index.get(m)),
    );
    if (JSON.stringify(bucketsX) !== JSON.stringify(bucketsY)) count("repeated_children");
  });
  for (const field of PARTITIONS) {
    const px = partition(a.map((n) => n[field]));
    const py = partition(b.map((n) => n[field]));
    if (px.some((v, i) => v !== py[i])) count(field);
  }
  return out;
}

test.skipIf(fixtures === "")(
  "the rebuilt input differs from the live tree only where md2ui's rebuild does",
  () => {
    const manifest = JSON.parse(readFileSync(join(fixtures, "manifest.json"), "utf8")) as {
      corpus: { doc: string; input: string }[];
    };
    const total = new Map<string, string[]>();
    for (const entry of manifest.corpus) {
      const markdown = readFileSync(join(fixtures, entry.input), "utf8");
      for (const field of differences(new RegexKit(), markdown).keys()) {
        total.set(field, [...(total.get(field) ?? []), entry.doc]);
      }
    }
    // Only `heading_ctx` differs, in the documents of the corpus that have a heading.
    // That is md2ui's own live-vs-rebuilt comparison: it is a load step
    // (`_stamp_heading_ctx`), never a grouper phase, so the live tree never has
    // it. The analyzer fields agree: a spring-cut value line is read from serialized
    // fields, and each pass starts from clean run marks. A change in which documents
    // differ is checked by listing which entered or left. Production
    // builds the layout input from `toDict()` as md2ui does; a change in the list of
    // fields is a change in what the generator would see.
    expect([...total.keys()]).toEqual(["heading_ctx"]);
    expect(total.get("heading_ctx")?.length).toBe(287);
  },
  120_000,
);

test("the input keeps the JSON's ids and stamps a heading's line", () => {
  const kit = new RegexKit();
  const input = layoutInput(kit, groupDocument("## Title\n\nBody text\n", kit).toDict(kit));
  const all = nodes(input.root);
  const ids = all.map((n) => n.node_id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(all.find((n) => n.type === "heading2")?.heading_ctx).toBe(2);
  expect(all.find((n) => n.content === "Body text")?.heading_ctx).toBe(0);
});

/** Each node's `[type, kind_hash, fingerprint_hash, run_key, orphan_grid]`, ids as partitions. */
function analyzerMarks(root: GroupNode): unknown[] {
  const all = nodes(root);
  const kinds = partition(all.map((n) => n.kind_hash));
  const prints = partition(all.map((n) => n.fingerprint_hash));
  const runs = partition(all.map((n) => n.run_key));
  return all.map((n, i) => [n.type, kinds[i], prints[i], runs[i], n.orphan_grid]);
}

test("a spring-cut value line fingerprints the same once rebuilt (md2ui e336110b)", () => {
  // The generator reads the rebuilt tree: a line that springs cut into whole values
  // must fingerprint as one value there too, or split and unsplit stat values stop
  // sharing a hash exactly where runs and grids are decided.
  const kit = new RegexKit();
  const live = groupDocument("_Accuracy_: ... ___94%___ ... _Customers_: ... ___1,293___\n", kit);
  const rebuilt = layoutInput(kit, live.toDict(kit)).root;
  expect(analyzerMarks(rebuilt)).toEqual(analyzerMarks(live));
  expect(nodes(live).some(isDatapointSplitGroup)).toBe(true);
});

test("a spaced tree keeps no run from its first analysis (md2ui b7cb9d2b)", () => {
  // A `+++` document is analyzed again once its spacers are in; its runs and orphans
  // must be the ones a single analysis of the rebuilt tree finds.
  const kit = new RegexKit();
  const text = "___\nLeft cell\n:::\n+++++\nRight cell, pushed down\n:::\nThird cell\n___\n";
  const live = groupDocument(text, kit);
  const rebuilt = layoutInput(kit, live.toDict(kit)).root;
  expect(analyzerMarks(live)).toEqual(analyzerMarks(rebuilt));
});
