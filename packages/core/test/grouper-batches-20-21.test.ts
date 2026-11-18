// In the grouper, an escaped separator beside an element keeps the line whole and an
// escaped task box draws as written, and a lone `...` inside a card does not end its
// glued run. Expected values are md2ui's own tests; these run without
// fixtures.
import { expect, test } from "vitest";
import { groupDocument } from "../src/group/grouper.ts";
import type { GroupNode } from "../src/group/node.ts";

function nodes(root: GroupNode): GroupNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

const leaves = (root: GroupNode): GroupNode[] =>
  nodes(root).filter((n) => n.children.length === 0 && n.content);

// md2ui markdown_datapoint_split_tests: test_an_escaped_separator_keeps_its_element_inline
test("an escaped separator keeps its element inline", () => {
  for (const line of [
    String.raw`Draft words here \- ${"`Label`"}`,
    String.raw`${"`Label`"} \- draft words here`,
    String.raw`Read more \| [docs](/d)`,
  ]) {
    const typed = leaves(groupDocument(line)).map((n) => [n.type, n.content]);
    expect(typed, line).toHaveLength(1);
    expect(typed[0]?.[0], line).toBe("text");
    expect(typed[0]?.[1], line).not.toContain("\\");
  }
  const chips = nodes(groupDocument("Draft words here - `Label`"))
    .filter((n) => n.type === "inline_code")
    .map((n) => n.content);
  expect(chips).toEqual(["Label"]);
});

// md2ui task_control_tests: test_an_escaped_box_draws_as_written
test("an escaped task box draws as written", () => {
  const root = groupDocument("plain \\[x] one\n\nplain \\[X] two\n\nplain \\[ ] three\n");
  expect(nodes(root).filter((n) => n.type === "drawing_element")).toEqual([]);
  expect(leaves(root).map((n) => n.content)).toEqual([
    "plain [x] one",
    "plain [X] two",
    "plain [ ] three",
  ]);
});

// md2ui column_spring_tests: test_a_spring_keeps_the_card_one_glued_block
test("a spring keeps the card one glued block", () => {
  const card = nodes(groupDocument("## \n🎯\n__Title__\n...\n_Caption_\n")).find(
    (n) => n.heading_group,
  );
  expect(card?.glued_content_group).toBe(true);
  expect(card?.valign_group).toBe(true);
  const nested = nodes(card as GroupNode).filter((n) => n !== card && n.glued_content_group);
  expect(nested).toEqual([]);
});

// The other side of the same rule (md2ui `glued_runs`): a spring with a blank line
// beside it ends the run like any break.
test("a spring beside a blank line still ends the run", () => {
  const card = nodes(groupDocument("## \n🎯\n__Title__\n\n...\n_Caption_\n")).find(
    (n) => n.heading_group,
  );
  expect(card?.valign_group).toBe(true);
  expect(nodes(card as GroupNode).filter((n) => n.glued_content_group)).not.toEqual([]);
  expect(card?.glued_content_group).toBe(false);
});
