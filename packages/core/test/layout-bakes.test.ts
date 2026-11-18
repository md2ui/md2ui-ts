// The tree bakes against md2ui. Two parts:
//  - every fixture document at every width label: `layout-generated` baked here equals
//    `layout` (runs only when MD2UI_FIXTURES names the fixtures);
//  - small hand-built trees whose expected values were produced by running md2ui's own
//    bake functions on the same input.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";
import { expect, test } from "vitest";
import { bakeLayout } from "../src/layout/bakes.ts";
import { type LayoutNode, layoutNode } from "../src/layout/node.ts";
import { parseTheme } from "../src/theme/parse.ts";

const fixtures = env["MD2UI_FIXTURES"] ?? "";

interface CorpusEntry {
  readonly doc: string;
  readonly theme_input: string | null;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));
const readText = (path: string): string => readFileSync(path, "utf8");

// The whole corpus, read from disk: under a loaded machine it outruns Vitest's 5 s
// default, which is not a budget (performance lives in `pnpm perf`, ADR-004).
const CORPUS_TIMEOUT_MS = 60_000;

test.skipIf(fixtures === "")(
  "baking the generated tree gives md2ui's baked tree",
  () => {
    const manifest = readJson(join(fixtures, "manifest.json")) as { corpus: CorpusEntry[] };
    const labels = readdirSync(join(fixtures, "layout")).sort();
    let cases = 0;
    for (const entry of manifest.corpus) {
      const theme = parseTheme(
        entry.theme_input === null ? "" : readText(join(fixtures, entry.theme_input)),
      );
      for (const label of labels) {
        const want = join(fixtures, "layout", label, `${entry.doc}.json`);
        let expected: unknown;
        try {
          expected = readJson(want);
        } catch {
          continue; // a label directory holds only the documents it has
        }
        const tree = readJson(
          join(fixtures, "layout-generated", label, `${entry.doc}.json`),
        ) as LayoutNode;
        bakeLayout(tree, theme);
        expect(tree, `${entry.doc} @ ${label}`).toStrictEqual(expected);
        cases += 1;
      }
    }
    expect(cases).toBeGreaterThan(0);
  },
  CORPUS_TIMEOUT_MS,
);

const THEME = parseTheme(`## Styling & Spacing

### Heading 2
Horizontal align: Center
Background color: #112233
Merge rows: yes

### Elements
Background color: #445566

### Unordered Lists
Background color: #778899
`);

const leaf = (fields: Partial<LayoutNode> = {}): LayoutNode => layoutNode("-", [], [], fields);
const node = (
  type: "row" | "col",
  children: LayoutNode[],
  fields: Partial<LayoutNode> = {},
): LayoutNode =>
  layoutNode(
    type,
    children.map(() => 1),
    children,
    fields,
  );

/** The fields the bakes write, per node in pre-order. */
function baked(root: LayoutNode): unknown[] {
  const out: unknown[] = [];
  const walk = (n: LayoutNode): void => {
    out.push([n.render_properties, n.gap_in_line, n.is_card, n.card_kind, n.card_bg_url]);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

test("a node's own content_align beats the inherited one", () => {
  const root = node(
    "col",
    [
      leaf(),
      leaf({ render_properties: { content_align: "right" } }),
      node("col", [leaf()], { render_properties: { content_align: "center" } }),
    ],
    { render_properties: { content_align: "left" } },
  );
  bakeLayout(root, THEME);
  expect(baked(root)).toStrictEqual([
    [{ content_align: "left" }, false, false, null, null],
    [{ content_align: "left" }, false, false, null, null],
    [{ content_align: "right" }, false, false, null, null],
    [{ content_align: "center" }, false, false, null, null],
    [{ content_align: "center" }, false, false, null, null],
  ]);
});

test("a level's themed Align seeds only an empty slot", () => {
  const root = node("col", [
    node("col", [leaf()], { section_level: 2 }),
    node("col", [leaf()], { section_level: 2, render_properties: { content_align: "right" } }),
  ]);
  bakeLayout(root, THEME);
  expect(baked(root)).toStrictEqual([
    [null, false, false, null, null],
    [{ content_align: "center" }, false, false, null, null],
    [{ content_align: "center" }, false, false, null, null],
    [{ content_align: "right" }, false, false, null, null],
    [{ content_align: "right" }, false, false, null, null],
  ]);
});

test("a card inside a line block gets gap_in_line, one outside does not", () => {
  const root = node("col", [
    node("row", [node("col", [leaf()], { is_card: true }), leaf()], { line_split: true }),
    node("col", [leaf()], { is_card: true }),
  ]);
  bakeLayout(root, THEME);
  expect(baked(root)).toStrictEqual([
    [null, false, false, null, null],
    [null, true, false, null, null],
    [null, true, true, null, null],
    [null, false, false, null, null],
    [null, false, false, null, null],
    [null, false, true, null, null],
    [null, false, false, null, null],
  ]);
});

test("a merging row takes its children's shared photo", () => {
  const card = (url: string): LayoutNode =>
    node("col", [leaf()], {
      section_level: 2,
      is_card: true,
      card_kind: "image_card",
      card_bg_url: url,
    });
  const root = node("row", [card("a.png?md2ui.x=1"), card("a.png")], { section_level: 2 });
  bakeLayout(root, THEME);
  const centred = { content_align: "center" };
  expect(baked(root)).toStrictEqual([
    [centred, false, false, null, "a.png?md2ui.x=1"],
    [centred, false, false, null, null],
    [centred, false, false, null, null],
    [centred, false, false, null, null],
    [centred, false, false, null, null],
  ]);
});

test("a glued card inside a painted list surface loses is_card, an image card keeps it", () => {
  const root = node(
    "col",
    [
      node("col", [leaf()], { is_card: true }),
      node("col", [leaf()], { is_card: true, card_kind: "image_card" }),
    ],
    { background_kind: "unordered_list" },
  );
  bakeLayout(root, THEME);
  expect(baked(root)).toStrictEqual([
    [null, false, false, null, null],
    [null, false, false, null, null],
    [null, false, false, null, null],
    [null, false, true, "image_card", null],
    [null, false, false, null, null],
  ]);
});
