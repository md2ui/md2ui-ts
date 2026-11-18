// In the grouper, a key-value colon has a space after it, so a glued colon is text, like
// `10:30`. Expected values are md2ui's own tests (markdown_separator_split_tests); these run
// without fixtures.
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

// md2ui: test_a_glued_colon_is_text
// A spaced one is text too since ADR-205: grouper-batch-53.test.ts.
test("a glued colon is text", () => {
  for (const line of ["key:value 1, key:value 2, key:value 3", "H:25° L:12°", "Friday 10:30"]) {
    const kvs = nodes(groupDocument(line)).filter((n) => n.type === "key-value");
    expect(kvs, line).toEqual([]);
    expect(contents(line), line).toEqual([line]);
  }
});
