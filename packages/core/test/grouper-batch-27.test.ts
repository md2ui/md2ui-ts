// In the grouper, an empty image source is an image with no picture (md2ui ADR-406).
// Expected values are md2ui's own tests; these run without fixtures.
import { expect, test } from "vitest";
import { detectDataPoints } from "../src/group/detect/detector.ts";
import { groupDocument } from "../src/group/grouper.ts";
import type { GroupNode } from "../src/group/node.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { imageSource } from "../src/utils/image-params.ts";

const kit = new RegexKit();

function nodes(root: GroupNode): GroupNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

const leaves = (doc: string): GroupNode[] =>
  nodes(groupDocument(doc)).filter((n) => n.children.length === 0);

// --- an empty image source is a picture left out --------------------------------

// md2ui image_no_picture_tests: test_an_empty_source_groups_as_an_image
test("`![alt]()` and `![alt]( )` group as an image", () => {
  for (const spelling of ["![Cacaluta Bay]()", "![Cacaluta Bay]( )"]) {
    const found = leaves(`## Bay\n\n${spelling}\nSecluded, by boat.\n`);
    expect(found.map((n) => [n.type, n.content])).toContainEqual(["image", spelling]);
    expect(found.filter((n) => n.type !== "image" && n.content.includes(spelling))).toEqual([]);
  }
});

// md2ui's detector on tests-empty-image-source.md: the empty source is an image data
// point, the protected range that keeps the splits out of its alt text.
test("an empty source is detected as an image", () => {
  expect(detectDataPoints("![Cacaluta Bay]()")).toEqual([
    {
      type: "image",
      matched: "![Cacaluta Bay]()",
      value: { matched: "[Cacaluta Bay]()", text: "Cacaluta Bay", url: "" },
      start: 0,
      end: 17,
      is_approximate: false,
    },
  ]);
});

// md2ui layout_inline_link_tests: test_image_with_parentheses_is_not_a_link
test("an empty source is an image's empty source, not no image", () => {
  expect(imageSource(kit, "![i]()")).toBe("");
  expect(imageSource(kit, "![i]( ?md2ui.aspect_ratio=4:3)")).toBe("");
  expect(imageSource(kit, "![i](https://x.org/a_(b).png)")).toBe("https://x.org/a_(b).png");
  expect(imageSource(kit, "[i](https://x.org/a.png)")).toBeNull();
});

// md2ui check_tests: test_an_escaped_dot_is_a_drawn_backslash (its `\—` line): a
// backslash before a non-ASCII character splits nothing and is drawn.
test("a backslash before a long dash or an arrow stays text", () => {
  for (const ch of "—→") {
    expect(leaves(`Now \\${ch} later.\n`).map((n) => n.content)).toEqual([`Now \\${ch} later.`]);
  }
});
