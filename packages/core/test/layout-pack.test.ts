// `Stack sections` (md2ui ADR-302): unique heading bands packed side by side. Cases from
// md2ui `tests/layout_flow_unique_tests.py` and `tests/block_width_cache_tests.py`,
// expected values from md2ui with the stand-in measurer of
// `layout-standin.ts` on both sides (`layout-pack.expected.json`). md2ui's own tests ask
// `_block_width`'s measurer-less fallback; these ask a block measurer, as a real run does.
import { expect, test } from "vitest";
import { generate } from "../src/layout/generate.ts";
import type { LayoutNode } from "../src/layout/node.ts";
import { parseTheme } from "../src/theme/parse.ts";
import expected from "./layout-pack.expected.json" with { type: "json" };
import { compact, type Dict, layoutOf, prepare } from "./layout-standin.ts";

const cases = expected.pack as Record<
  string,
  { doc: Dict; theme: string; layouts: Record<string, unknown> }
>;

/** md2ui's `_rows`: each top-level child's cell widths, a full-width child as one. */
function rows(layout: LayoutNode, width: number): number[][] {
  const top = layout.children[0] as LayoutNode;
  return top.children.map((c) =>
    c.type === "row" && !c.grid ? c.ratios.map((r) => Math.round(r * 10) / 10) : [width],
  );
}

const rowsOf = (name: string, width: number): number[][] => {
  const c = cases[name] as { doc: Dict; theme: string };
  return rows(layoutOf(c.doc, width, c.theme), width);
};

test("every case generates md2ui's layout", () => {
  for (const [name, c] of Object.entries(cases)) {
    for (const [w, layout] of Object.entries(c.layouts)) {
      expect(compact(layoutOf(c.doc, Number(w), c.theme)), `${name} at ${w}`).toEqual(layout);
    }
  }
});

test("unique bands share the line in proportion, and wrap rather than squeeze", () => {
  expect(rowsOf("abc", 1000)).toEqual([[164, 328, 492]]);
  expect(rowsOf("abcd", 700)).toEqual([[114, 228, 342], [700]]);
  // Narrowing moves a band down; the two that stay keep their 1:2 share.
  expect(rowsOf("abc", 400)).toEqual([[130.7, 261.3], [400]]);
});

test("the tail is balanced, never into a row that does not fit", () => {
  expect(rowsOf("abcd", 1000)).toEqual([
    [330.7, 661.3],
    [425.1, 566.9],
  ]);
  expect(rowsOf("abc", 420)).toEqual([[137.3, 274.7], [420]]);
  expect(rowsOf("wide-b", 500)).toEqual([[500], [500]]);
});

test("`Stack sections: no` restores the stack", () => {
  // No corpus theme turns it off, so this is its only check.
  expect(rowsOf("abc-no", 1000)).toEqual([[1000], [1000], [1000]]);
});

test("leaves and arrangements that own themselves never pack", () => {
  expect(rowsOf("leaf-first", 1000)[0]).toEqual([1000]);
  expect(rowsOf("owns-column_split_group", 1000)).toEqual([[1000], [1000], [1000]]);
  expect(rowsOf("owns-line_split_group", 1000)).toEqual([[1000], [1000], [1000]]);
});

test("a block asks for its widest same-kind run on one line", () => {
  // Its widest built row is one 140 px card; its run of three cards asks about 436, so
  // at 767 the band after it wraps, and the block's share is over four times `a`'s.
  const [first, second] = rowsOf("run-block", 767);
  expect(second).toEqual([767]);
  expect((first?.[1] ?? 0) / (first?.[0] ?? 1)).toBeGreaterThan(4);
});

test("block widths are measured once per call, and a call does not depend on the last", () => {
  const cache = expected.cache;
  const doc = cache.doc as Dict;
  const theme = parseTheme("");
  // One generator object in md2ui (`_block_w_cache` survives `generate()` for the same
  // tree and theme): at 767 after 1280 it reuses 1280's asks and stacks the two bands
  // a fresh call puts side by side (md2ui finding block-width-cache-depends-on-history).
  // Here nothing outlives a call, so 767 after 1280 is what a fresh 767 is.
  expect(cache.reused767).not.toEqual(cache.fresh767);
  const reused = prepare(doc, true);
  generate(reused.input, 1280, theme, reused.measurer);
  expect(reused.blockCalls).toHaveLength(cache.fresh1280Calls);
  const again = compact(generate(reused.input, 767, theme, reused.measurer));
  expect(reused.blockCalls).toHaveLength(cache.fresh1280Calls + cache.fresh767Calls);
  expect(again).toEqual(cache.fresh767);
  const fresh = prepare(doc, true);
  expect(compact(generate(fresh.input, 767, theme, fresh.measurer))).toEqual(cache.fresh767);
});
