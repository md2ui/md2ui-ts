// In the grouper, a run of tiered spans on one line
// (`___27°C___ _/31_`) becomes one piece per span and each piece takes the data points
// inside it, leaving its container none; and an image card whose only content is a
// one-line spring row keeps that row as its own level instead of absorbing it, so the
// pieces still flow along the line. Expected values are md2ui's own tests; these run
// without fixtures.
import { expect, test } from "vitest";
import { groupDocument } from "../src/group/grouper.ts";
import type { GroupNode } from "../src/group/node.ts";

function nodes(root: GroupNode): GroupNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

// md2ui tests/datapoint_offsets_tests.py: test_the_regression_sample_reaches_every_edit_site
// (the `27°C` / `31` line) and the invariant every data point names its own content.
test("a run of tiered spans hands each piece its data points", () => {
  const all = nodes(groupDocument("🌡️ - ___27°C___ _/31_\n"));
  const holders = all.filter((n) => n.data_points.length > 0);
  expect(holders.map((n) => [n.content, n.data_points.map((dp) => dp.matched)])).toEqual([
    ["🌡️", ["🌡️"]],
    ["27°C", ["27°C"]],
    ["/31", ["31"]],
  ]);
  for (const n of holders) {
    for (const dp of n.data_points) {
      expect(n.content.slice(dp.start, dp.end), n.content).toBe(dp.matched);
    }
  }
});

// md2ui tests/markdown_align_split_tests.py:
// test_a_spring_line_alone_in_an_image_card_stays_a_row
test("a spring line alone in an image card stays a row", () => {
  for (const spacer of ["+++++\n", ""]) {
    const text = `![\n\`Chip\` ... [Save](agent:save)\n${spacer}](?w=800)\n**Bold**\n`;
    const holder = nodes(groupDocument(text)).find((n) =>
      n.children.some((c) => c.type === "inline_code"),
    );
    expect(holder, spacer).toBeDefined();
    expect(
      [holder?.line_split_group, holder?.align_group],
      `${spacer}: ${holder?.children.map((c) => c.type)}`,
    ).toEqual([true, true]);
  }
});
