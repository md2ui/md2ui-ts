// Bento (md2ui ADR-300, `Layout: bento`): runs of target-level sections tiled as an
// order-preserving mosaic. Cases from md2ui `tests/layout_bento_tests.py` and
// `tests/layout_bento_search_tests.py`, expected values from md2ui
// with the stand-in measurer of `layout-standin.ts` on both sides
// (`layout-bento.expected.json`). md2ui's own tests mostly run measurer-less, on its
// height estimate; the port always has a measurer, so these ask the stand-in's heights.
import { expect, test } from "vitest";
import { pyRound } from "../src/group/py/math.ts";
import type { LayoutNode } from "../src/layout/node.ts";
import expected from "./layout-bento.expected.json" with { type: "json" };
import { compact, type Dict, layoutOf } from "./layout-standin.ts";

const BENTO = "# T\n\n## Background styles and Spacing\n\n### Root\nLayout: Bento\n";

const cases = expected.bento as Record<
  string,
  { doc: Dict; theme: string; layouts: Record<string, unknown> }
>;

const doc = (name: string): Dict => cases[name]?.doc as Dict;

function* walk(n: LayoutNode): Generator<LayoutNode> {
  yield n;
  for (const c of n.children) yield* walk(c);
}

const bentoRows = (n: LayoutNode): LayoutNode[] =>
  [...walk(n)].filter((x) => x.type === "row" && x.bento);

const leaves = (n: LayoutNode): (string | null)[] =>
  [...walk(n)].filter((x) => x.type === "-").map((x) => x.content_id);

/** The widest bento row's span sum: the division count the mosaic used. */
const divisions = (n: LayoutNode): number =>
  Math.max(0, ...bentoRows(n).map((r) => r.ratios.reduce((s, x) => s + x, 0)));

test("every case generates md2ui's layout", () => {
  for (const [name, c] of Object.entries(cases)) {
    for (const [w, layout] of Object.entries(c.layouts)) {
      expect(compact(layoutOf(c.doc, Number(w), c.theme)), `${name} at ${w}`).toEqual(layout);
    }
  }
});

test("the division count rounds half to even, as Python's round does", () => {
  expect([pyRound(2.5), pyRound(3.5), pyRound(4.5), pyRound(2.4999), pyRound(2.6)]).toEqual([
    2, 4, 4, 2, 3,
  ]);
  // 650 / 260 = 2.5: two divisions, not three (narrow, so `Math.round` would allow 3).
  expect(divisions(layoutOf(doc("two-level-8"), 650, BENTO))).toBe(2);
  // 1170 / 260 = 4.5: four divisions, not five.
  expect(divisions(layoutOf(doc("two-level-8"), 1170, BENTO))).toBe(4);
  // 300 / 260 rounds to 1: no mosaic at all.
  expect(bentoRows(layoutOf(doc("two-level-8"), 300, BENTO))).toEqual([]);
});

test("the mosaic keeps document order, every leaf once, in integral spans", () => {
  for (const width of [500, 900, 1280]) {
    const plain = leaves(layoutOf(doc("two-level-8"), width));
    const tiled = layoutOf(doc("two-level-8"), width, BENTO);
    expect(leaves(tiled), `${width}`).toEqual(plain);
    for (const row of bentoRows(tiled)) {
      expect(row.ratios.every((r) => Number.isInteger(r) && r >= 1)).toBe(true);
    }
  }
});

test("the sections tile; their container's own title and lead-in stay full width", () => {
  const section = [...walk(layoutOf(doc("two-level-6"), 1280, BENTO))].find(
    (n) => n.type === "col" && n.section_level === 1,
  ) as LayoutNode;
  expect(section.bento).toBe(false);
  expect(section.children[0]?.content_id).not.toBeNull();
  expect(section.children.some((c) => c.bento)).toBe(true);
  const root = layoutOf(doc("lead-in"), 1280, BENTO).children[0] as LayoutNode;
  expect(root.bento).toBe(false);
  expect(root.children[0]?.bento).toBe(false);
  expect(root.children.some((c) => c.bento)).toBe(true);
});

test("two runs each tile in place around what separates them", () => {
  const root = layoutOf(doc("two-runs"), 1280, BENTO).children[0] as LayoutNode;
  expect(root.children.map((c) => c.bento)).toEqual([true, false, true]);
});

test("the target level: automatic, named by the theme, or none", () => {
  const cellLevels = (n: LayoutNode): (number | null)[] =>
    bentoRows(n).flatMap((r) => r.children.map((c) => c.section_level));
  expect(cellLevels(layoutOf(doc("auto-level"), 1280, BENTO))).toContain(2);
  const manual = cellLevels(layoutOf(doc("manual-level"), 1280, cases["manual-level"]?.theme));
  expect(manual).toContain(3);
  expect(manual).not.toContain(2);
  expect(bentoRows(layoutOf(doc("too-few"), 1280, BENTO))).toEqual([]);
  expect([...walk(layoutOf(doc("default-mode"), 1280))].some((n) => n.bento)).toBe(false);
});
