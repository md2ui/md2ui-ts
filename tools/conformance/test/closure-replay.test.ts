import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { LayoutNode, LeafInputs } from "@md2ui/core";
import { describe, expect, test } from "vitest";
import { closureReplay } from "../src/closure-replay.ts";
import { isObject, type Json, type JsonObject, readJsonLines } from "../src/json.ts";

const NODE: LeafInputs = {
  node_id: "n1",
  type: "text",
  content: "Hello",
  heading_ctx: 0,
  atx_level: 0,
  text_style: null,
  text_style_chain: ["Muted"],
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
  drawing_element: { b: 1, a: [2, { y: 1, x: 2 }] },
};

/** md2ui files a leaf answer under every `LeafInputs` field but `atx_level`. */
function leafRecord(q: string, kvRole: string | null, answer: number | null): JsonObject {
  const { atx_level: _read, ...filed } = NODE;
  return { q, kv_role: kvRole, node: filed as unknown as JsonObject, a: answer, n: 3 };
}

const PINNED_DIGEST = "431d650af1d2cff1050ab153d7df4b0a2bc29927f5f31bb49a4bd458f189a312";

/** md2ui `LayoutNode(type, ratios, children, …)` with every other field at its default. */
function layoutNode(
  type: LayoutNode["type"],
  ratios: number[],
  children: LayoutNode[],
  fields: Partial<LayoutNode> = {},
): LayoutNode {
  return {
    type,
    ratios,
    children,
    content_id: null,
    render_properties: null,
    section_level: null,
    section_style_key: null,
    heading_id: null,
    rotation_index: null,
    rotation_chain: [],
    rotation_path: [],
    is_card: false,
    card_kind: null,
    background_kind: null,
    card_bg_url: null,
    link_url: null,
    link_node_id: null,
    grid: false,
    grid_cols: 0,
    bento: false,
    line_split: false,
    flow_run: 0,
    spring: false,
    column_row: false,
    col_spring: false,
    gap_in_line: false,
    heading_line: false,
    block_line: false,
    table: false,
    table_row: null,
    in_table: null,
    ...fields,
  };
}

/** The pinned subtree, with the leaf's `flow_run` given. */
function pinned(flowRun: number): LayoutNode {
  const leaf = layoutNode("-", [1], [], { content_id: "0.1", flow_run: flowRun });
  return layoutNode("row", [0.5, 0.5], [leaf]);
}

describe("closureReplay", () => {
  const replay = closureReplay(
    [
      leafRecord("leaf_min_width", null, 12.5),
      leafRecord("leaf_line_width", "key", null),
      { q: "marker_width", props: { size: 3, kind: "dot" }, a: 7, n: 1 },
      { q: "advance", text: "x", size: 1, face: "f", a: 1, n: 1 },
    ],
    [
      // The pinned example, row[leaf flow_run 7] → this digest.
      { q: "layout_height", subtree: PINNED_DIGEST, width: 300, a: 42, n: 1 },
      { q: "block_width", subtree: PINNED_DIGEST, width: 300, a: 17.5, n: 1 },
    ],
  );

  test("hit, and a null answer is returned as null", () => {
    expect(replay.leafMinWidth(NODE, null)).toBe(12.5);
    expect(replay.leafLineWidth(NODE, "key")).toBeNull();
    expect(replay.markerWidth({ size: 3, kind: "dot" })).toBe(7);
  });

  test("a miss throws naming the kind and the key", () => {
    expect(() => replay.leafMinWidth(NODE, "value")).toThrow(/leaf_min_width.*"kv_role":"value"/);
    expect(() => replay.markerWidth({ size: 4 })).toThrow(/marker_width.*"size":4/);
  });

  test("key order does not matter", () => {
    const reordered = { ...NODE, drawing_element: { a: [2, { x: 2, y: 1 }], b: 1 } };
    expect(replay.leafMinWidth(reordered, null)).toBe(12.5);
    expect(replay.markerWidth({ kind: "dot", size: 3 })).toBe(7);
  });

  test("a built subtree is found by md2ui's digest, whatever its flow_run numbers", () => {
    expect(replay.layoutHeight(pinned(7), 300)).toBe(42);
    expect(replay.blockWidth(pinned(3), 300)).toBe(17.5);
    expect(() => replay.layoutHeight(pinned(7), 301)).toThrow(/layout_height/);
    expect(() => replay.layoutHeight(layoutNode("col", [1], []), 300)).toThrow(/layout_height/);
  });

  test("extra fields on the node are ignored", () => {
    const extra = { ...NODE, children: [1, 2], other: "x" } as LeafInputs;
    expect(replay.leafMinWidth(extra, null)).toBe(12.5);
  });
});

const FIXTURES = process.env["MD2UI_FIXTURES"];
const CLOSURE = new Set(["leaf_min_width", "leaf_line_width", "marker_width"]);

function measureFiles(root: string): string[] {
  const base = join(root, "measure");
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((label) =>
      readdirSync(join(base, label.name))
        .filter((name) => name.endsWith(".jsonl"))
        .map((name) => join(base, label.name, name)),
    );
}

describe("recorded closure answers", () => {
  test.skipIf(!FIXTURES || !existsSync(join(FIXTURES, "measure")))(
    "every recorded question replays to its own answer",
    () => {
      let checked = 0;
      for (const file of measureFiles(FIXTURES as string)) {
        const records: Json[] = readJsonLines(file);
        const replay = closureReplay(records, []);
        for (const record of records) {
          if (!isObject(record) || typeof record["q"] !== "string" || !CLOSURE.has(record["q"]))
            continue;
          const answer = record["a"] as number | null;
          const kvRole = record["kv_role"] as "key" | "value" | null;
          const node = record["node"] as unknown as LeafInputs;
          let got: number | null;
          if (record["q"] === "leaf_min_width") got = replay.leafMinWidth(node, kvRole);
          else if (record["q"] === "leaf_line_width") got = replay.leafLineWidth(node, kvRole);
          else got = replay.markerWidth(record["props"] as Record<string, unknown>);
          expect(got, `${file} ${record["q"]}`).toBe(answer);
          checked += 1;
        }
      }
      console.log(`closure records checked: ${checked}`);
      expect(checked).toBeGreaterThan(0);
    },
    120_000,
  );
});
