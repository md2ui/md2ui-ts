// Two stamps md2ui puts on blocks, at edges the corpus reaches only once:
// a heading written inside another block (Phase 6.18) and a link
// whose label is two or more glued lines. Expected values are
// md2ui's own tests (content_card_tests); these run without fixtures.
import { expect, test } from "vitest";
import { groupDocument } from "../src/group/grouper.ts";
import type { GroupNode } from "../src/group/node.ts";

function nodes(root: GroupNode): GroupNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

const ofType = (root: GroupNode, type: string): GroupNode[] =>
  nodes(root).filter((n) => n.type === type);

const linkedGroups = (root: GroupNode): GroupNode[] =>
  ofType(root, "group").filter((n) => n.link_url !== null);

/** What a card is, without the ids that count lines (md2ui `_shape`). */
type Shape = [string, string, string | null, string | null, Shape[]];
const shape = (n: GroupNode): Shape => [
  n.type,
  n.content,
  n.link_url,
  n.text_style,
  n.children.map(shape),
];

test("a heading written inside a list item keeps its level, not its marker", () => {
  const items = ofType(groupDocument("- ## Inside\n- plain\n"), "list_item");
  const leaves = items.flatMap((i) => nodes(i).filter((n) => n.children.length === 0));
  expect(leaves.map((n) => [n.content, n.atx_level])).toEqual([
    ["Inside", 2],
    ["plain", 0],
  ]);
});

test("a heading marker inside code stays code", () => {
  const code = ofType(groupDocument("- `# not a heading`\n"), "inline_code");
  expect(code.map((n) => n.atx_level)).toEqual([0]);
});

const GLUED_LABELS =
  "[**Flights CDMX**\n_Edited Oct 4_](/a)\n\n" +
  "[**Gastos 2026**\n_Edited Oct 1_](/b)\n\n" +
  "[**Carta justificacion**\n_Edited Sep 22_](/c)";

test("a label of glued lines is a group link", () => {
  const ast = groupDocument(GLUED_LABELS);
  expect(ofType(ast, "link")).toEqual([]);
  const cards = linkedGroups(ast);
  expect(cards.map((c) => c.link_url)).toEqual(["/a", "/b", "/c"]);
  for (const card of cards) {
    const [title, caption] = card.children;
    expect(card.children).toHaveLength(2);
    expect(card.glued_content_group).toBe(true);
    expect(title?.type).toBe("text");
    expect(title?.content.startsWith("**")).toBe(true);
    expect(caption?.text_style).toBe("muted");
    expect(caption?.content.includes("_")).toBe(false);
  }
  expect(new Set(cards.map((c) => c.fingerprint_hash)).size).toBe(1);
});

test("the bracketed glued label is the same card as the inline one", () => {
  const inline = groupDocument("[**Gastos 2026**\n_Edited Oct 1_](/b)");
  const bracketed = groupDocument("[\n**Gastos 2026**\n_Edited Oct 1_\n](/b)");
  expect(shape(bracketed)).toEqual(shape(inline));
  expect(ofType(inline, "group").map((n) => n.link_url)).toEqual(["/b"]);
});

test("a label without glued lines stays a pill", () => {
  for (const text of [
    "[**Gastos 2026** _Edited Oct 1_](/b)",
    "[\nPreview\n](/b)",
    "[\nPreview\n\nmore\n](/b)",
  ]) {
    expect(groupDocument(text).children.map((n) => n.type)).toEqual(["link"]);
  }
  expect(linkedGroups(groupDocument("See the [long wrapped\nlabel](/b) mid-sentence."))).toEqual(
    [],
  );
  const image = groupDocument("![two glued\nalt lines](p.png)");
  expect(ofType(image, "image")).not.toEqual([]);
  expect(ofType(image, "image_card")).toEqual([]);
});

test("a list item of glued label lines is a group link", () => {
  const ast = groupDocument(
    "- [**Flights CDMX**\n  _Edited Oct 4_](/a)\n" +
      "- [**Gastos 2026**\n  _Edited Oct 1_](/b)\n" +
      "- [\n  **Carta**\n  _Edited Sep 22_\n  ](/c)\n" +
      "- [One line](/d)",
  );
  const items = ofType(ast, "list_item");
  expect(items.map((i) => i.link_url)).toEqual(["/a", "/b", "/c", null]);
  for (const item of items.slice(0, 3)) {
    const [title, caption] = item.children;
    expect(title?.content.startsWith("**")).toBe(true);
    expect(caption?.text_style).toBe("muted");
  }
  expect(new Set(items.slice(0, 3).map((i) => i.fingerprint_hash)).size).toBe(1);
  expect(items[3]?.children.map((c) => c.type)).toEqual(["link"]);
});
