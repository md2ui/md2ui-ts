// In the grouper, an escape inside a link's label keeps the
// link. Expected values are md2ui's own test (datapoint_grouping_tests); it
// runs without fixtures.
import { expect, test } from "vitest";
import { groupDocument } from "../src/group/grouper.ts";
import type { GroupNode } from "../src/group/node.ts";

function nodes(root: GroupNode): GroupNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

const links = (text: string): GroupNode[] =>
  nodes(groupDocument(text)).filter((n) => n.type === "link");

// md2ui: test_an_escape_in_a_link_label_keeps_the_link
test("an escape in a link's label keeps the link; its words still decline", () => {
  // A tight or value escape declines the reading of its token. A link is an element,
  // not a reading: the escape in its label must not turn it into text.
  for (const text of [
    "[Tree\\-lined](agent:a)",
    "[Save 20\\%](agent:b)",
    "*[Plan 5\\-day](https://example.com)*",
  ]) {
    expect(links(text), text).toHaveLength(1);
  }
  // A row of suggestions keeps all three when one label holds the escape...
  const row = "... [Plan a 5\\-day itinerary](agent:x) [Hotels](agent:y) [Back](agent:z) ...";
  expect(links(row)).toHaveLength(3);
  // ...and the label's words still decline their reading: no day chip.
  const day = nodes(groupDocument("[Mon\\-15](agent:m)"));
  expect(day.filter((n) => n.type === "link")).toHaveLength(1);
  expect(day.filter((n) => n.datapoint_display === "date_chip")).toEqual([]);
});
