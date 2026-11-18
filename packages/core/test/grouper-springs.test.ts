// A `...` region is placed as one block; when a later phase splits it into its lines
// or stacked pieces, every piece keeps the region's place (md2ui `hand_down_valign`).
// Conformance covers this on the corpus; these run without fixtures.
import { expect, test } from "vitest";
import { groupDocument } from "../src/group/grouper.ts";
import type { GroupNode } from "../src/group/node.ts";

function valigns(markdown: string, contents: readonly string[]): (string | null)[] {
  const found = new Map<string, string | null>();
  const walk = (n: GroupNode): void => {
    if (contents.includes(n.content)) found.set(n.content, n.authored_valign);
    for (const c of n.children) walk(c);
  };
  walk(groupDocument(markdown));
  return contents.map((c) => found.get(c) ?? null);
}

test("every line of a centred region in a row is centred", () => {
  expect(valigns("Left\n:::\n...\nAlpha\nBravo\n...\n", ["Alpha", "Bravo"])).toEqual([
    "center",
    "center",
  ]);
});

test("every line after a leading spring sits at the bottom", () => {
  expect(valigns("...\nAlpha\nBravo\n", ["Alpha", "Bravo"])).toEqual(["bottom", "bottom"]);
});

test("a stacked line's pieces keep the region's place", () => {
  expect(valigns("Left\n:::\n...\n**Alpha** : Bravo\n...\n", ["**Alpha**", "Bravo"])).toEqual([
    "center",
    "center",
  ]);
});
