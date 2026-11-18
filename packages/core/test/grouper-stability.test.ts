// ADR-104: a node's id comes from its own subtree's content, so inserting a paragraph
// at the top of a document leaves every other node's id where it was, and an edit inside
// a block re-ids only the edited nodes and the nodes that hold them. md2ui's tree-path
// ids would renumber everything after the insertion.
import type { GroupingNode } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { groupMarkdown } from "../src/index.ts";

const INSERTED = "A brand-new opening paragraph, written later.\n\n";

/** What a node is: its type and content, and its children's, in order. */
const what = (node: GroupingNode): string =>
  `${node.type}|${node.content}[${node.children.map(what).join(",")}]`;

/** Every node of `subtrees`, parents first. */
function nodes(subtrees: readonly GroupingNode[]): GroupingNode[] {
  const out: GroupingNode[] = [];
  const walk = (node: GroupingNode): void => {
    out.push(node);
    for (const c of node.children) walk(c);
  };
  for (const s of subtrees) walk(s);
  return out;
}

/** Every node below the root by id, with what it is. */
const byId = (root: GroupingNode): Map<string, string> =>
  new Map(nodes(root.children).map((n) => [n.node_id, what(n)]));

const DOCUMENTS: Record<string, string> = {
  "headings and a list": [
    "# Trip planner",
    "",
    "Three days in Lisbon, mostly on foot.",
    "",
    "## Day one",
    "",
    "- Alfama walk",
    "- Tram 28",
    "- Dinner at 8:00 PM",
    "",
    "## Day two",
    "",
    "1. Belém tower",
    "2. Pastéis de nata",
  ].join("\n"),
  "a table": [
    "## Pricing",
    "",
    "| Plan | Price | Seats |",
    "| :--- | ---: | :---: |",
    "| Free | $0 | 1 |",
    "| Team | $12 | 10 |",
    "",
    "Prices are per month.",
  ].join("\n"),
  "a ::: row": [
    "## Dashboard",
    "",
    "**Revenue:** $48,200",
    ":::",
    "**Users:** 1,204",
    ":::",
    "**Churn:** 2.1%",
    "",
    "___",
    "",
    "Updated hourly - [Refresh](/refresh)",
  ].join("\n"),
  "cards and key-values": [
    "### Alice",
    "Role: Designer",
    "Team: Growth",
    "",
    "### Bob",
    "Role: Engineer",
    "Team: Platform",
    "",
    "> A quote to close.",
  ].join("\n"),
};

for (const [name, markdown] of Object.entries(DOCUMENTS)) {
  test(`inserting a paragraph above ${name} keeps every other node's id`, () => {
    const before = byId(groupMarkdown(markdown));
    const grouped = groupMarkdown(INSERTED + markdown);
    const after = byId(grouped);
    expect(before.size).toBeGreaterThan(3);
    for (const [id, node] of before) expect(after.get(id), id).toBe(node);
    // The only new ids are the inserted block's.
    const added = [...after.keys()].filter((id) => !before.has(id));
    const inserted = nodes(grouped.children.slice(0, 1)).map((n) => n.node_id);
    expect(added.sort()).toEqual(inserted.sort());
  });
}

test("ticking a task re-ids only the subtrees that changed", () => {
  const markdown = "# Chores\n\n- [ ] Water the plants\n- [ ] Buy milk\n- [x] Call mum\n";
  const before = byId(groupMarkdown(markdown));
  const after = nodes(groupMarkdown(markdown.replace("[ ] Water", "[x] Water")).children);
  // An id that survives still names what it named.
  for (const node of after) {
    if (before.has(node.node_id)) expect(before.get(node.node_id)).toBe(what(node));
  }
  // New: the document's block, the list and the ticked task, which hold the edit, and
  // a second ticked box, which before had one.
  expect(after.filter((n) => !before.has(n.node_id))).toHaveLength(4);
});

test("identical subtrees get distinct ids", () => {
  const ids = nodes(groupMarkdown("Same line.\n\nOther line.\n\nSame line.\n").children).map(
    (n) => n.node_id,
  );
  expect(new Set(ids).size).toBe(ids.length);
});
