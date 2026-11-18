// In the grouper, a styled glued colon is text too, and a `...` spring inside a tappable or
// photo card keeps its flag. Expected values are md2ui's own tests
// (markdown_separator_split_tests, column_spring_tests); these run without fixtures.
import { expect, test } from "vitest";
import { groupDocument } from "../src/group/grouper.ts";
import type { GroupNode } from "../src/group/node.ts";

function nodes(root: GroupNode): GroupNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

// md2ui: _contents. The content of every childless node, in order.
const contents = (text: string): string[] =>
  nodes(groupDocument(text))
    .filter((n) => n.children.length === 0 && n.content)
    .map((n) => n.content);

const keyValues = (text: string): GroupNode[] =>
  nodes(groupDocument(text)).filter((n) => n.type === "key-value");

// md2ui: test_a_glued_colon_is_text, its styled lines
// A styled spaced one is text too since ADR-205: grouper-batch-53.test.ts.
test("a styled glued colon is text", () => {
  for (const line of ["**H:25°**", "__H:25°__", "***H:25°***", "~~H:25°~~"]) {
    expect(keyValues(line), line).toEqual([]);
    // `__x__` is the Lead tier: its markers become the text's style.
    expect(contents(line), line).toEqual([line.startsWith("__") ? line.slice(2, -2) : line]);
  }
});

// md2ui: test_a_cards_springs_survive_into_its_section
test("a card's springs survive into its section", () => {
  for (const body of [
    "[\nTop\n\n...\n\nBottom\n](agent:open)",
    "![\nTop\n\n...\n\nBottom\n](https://example.com/p.jpg)",
  ]) {
    const held = nodes(groupDocument(`## \n\n${body}\n`)).filter((n) => n.valign_group);
    expect(held.length, body).toBeGreaterThan(0);
    const placed = nodes(held[0] as GroupNode).filter((n) => n.content);
    expect(
      placed.map((n) => n.authored_valign),
      body,
    ).toEqual(["top", "bottom"]);
  }
});
