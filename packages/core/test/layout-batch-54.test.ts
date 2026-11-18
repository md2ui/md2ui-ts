// In the generator, a stacked run of spring rows shares its
// column edges (`generator_fit_votes.stacked_lines`). The cases are md2ui's own
// (`layout_fit_votes_tests`), run through this port's grouper and the deterministic fake
// measurer; they need no fixtures.
import { expect, test } from "vitest";
import { groupMarkdown } from "../src/group/grouper.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { generate } from "../src/layout/generate.ts";
import { layoutInput } from "../src/layout/input.ts";
import type { LayoutNode } from "../src/layout/node.ts";
import { sizingMeasurer } from "../src/measure/sizing.ts";
import { createFakeMeasurer } from "../src/text/fake-measurer.ts";
import { parseTheme } from "../src/theme/parse.ts";

function walk(n: LayoutNode): LayoutNode[] {
  return [n, ...n.children.flatMap(walk)];
}

/** The asks of every spring row of `lines` laid out as a list at 767. */
function springAsks(lines: readonly string[]): number[][] {
  const kit = new RegexKit();
  const theme = parseTheme("");
  const input = layoutInput(kit, groupMarkdown(lines.map((l) => `- ${l}\n`).join(""), kit));
  const measurer = sizingMeasurer(input, theme, createFakeMeasurer(), {
    emojiFamily: (path) => path ?? "emoji",
  });
  return walk(generate(input, 767, theme, measurer))
    .filter((n) => n.spring)
    .map((n) => n.ratios);
}

// findings/row-lines-do-not-line-up: two list rows of one spring shape whose names and
// chips differ in length, so each row's own asks differ.
const fare = (name: string, fares: string, chip: string): string =>
  `**${name}** : _Nonstop_ ... Fare (EUR): ${fares} ... \`${chip}\``;
const FARES = [
  fare("Lisbon to New York", "612 → 598 → 640 → 575 → 549", "-63"),
  fare("Porto to Paris", "88 → 92 → 79 → 84 → 81", "-7"),
];

// md2ui: test_a_stacked_run_of_spring_rows_shares_its_column_edges
test("a stacked run of spring rows shares its column edges", () => {
  const asks = springAsks(FARES);
  expect(asks).toHaveLength(2);
  expect(asks[0]).toHaveLength(3);
  expect(asks[0]).toEqual(asks[1]);
});

// md2ui: test_spring_rows_of_other_regions_keep_their_own_asks
test("spring rows of other regions keep their own asks", () => {
  const second = FARES[1] as string;
  const asks = springAsks([FARES[0] as string, second.slice(0, second.lastIndexOf(" ... "))]);
  expect(asks.map((a) => a.length)).toEqual([3, 2]);
  expect(asks[0]?.slice(0, 2)).not.toEqual(asks[1]);
});
