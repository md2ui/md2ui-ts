// An `unmeasured-word` divergence explains a difference only where its words are written
// in an entry that differs. The ring case is the one that made the rule: before C3 reported
// horizontal ink, a ring label shrank one step less than md2ui's, and the only answers that
// differed were the ellipsis candidates of another ring's label.
import { expect, test } from "vitest";
import type { Difference } from "../src/diff.ts";
import type { Divergence } from "../src/divergence.ts";
import type { Json } from "../src/json.ts";
import { explaining } from "../src/unmeasured.ts";

const unmeasured = (...words: string[]): Divergence => ({
  class: "unmeasured-word",
  text: "advance …",
  words,
});
const differs = (path: string): Difference => ({
  class: "value",
  path,
  field: "height",
  expected: "35",
  actual: "35.7",
});

const grouping: Json = {
  node_id: "",
  content: "",
  children: [
    { node_id: "0", content: "See all", children: [] },
    { node_id: "1", content: "Wrapped bold", children: [] },
  ],
};
const scene: Json = {
  boxes: [
    { content_id: "0", render_properties: null },
    { content_id: null, render_properties: { ring_role: "unit", ring_text: "Live data" } },
  ],
  regions: [{ action: { kind: "link", label: "Wrapped bold", node_id: "1" } }],
};

test("a word written in a differing box explains it", () => {
  const d = unmeasured("See", "all");
  expect(explaining([d], [differs("boxes[0]")], scene, grouping)).toEqual([d]);
});

test("words written in no differing entry explain nothing: the ring case", () => {
  // Box 1 is the label that shrank; the unmeasured words are another label's.
  const d = unmeasured("member…", "active");
  expect(explaining([d], [differs("boxes[1]")], scene, grouping)).toEqual([]);
  // Every word must be written, not one of them.
  const some = unmeasured("Live", "member…");
  expect(explaining([some], [differs("boxes[1]")], scene, grouping)).toEqual([]);
});

test("a ring's own text and a region's node count as written", () => {
  const ring = unmeasured("Live", "data");
  expect(explaining([ring], [differs("boxes[1]")], scene, grouping)).toEqual([ring]);
  const link = unmeasured("Wrapped");
  expect(explaining([link], [differs("regions[0]")], scene, grouping)).toEqual([link]);
});

test("a layout node counts its subtree's text", () => {
  const tree: Json = {
    type: "col",
    content_id: null,
    children: [{ type: "row", content_id: null, children: [{ type: "-", content_id: "0" }] }],
  };
  const d = unmeasured("all");
  expect(explaining([d], [differs("0 (row)")], tree, grouping)).toEqual([d]);
  expect(explaining([d], [differs("root (col)")], tree, grouping)).toEqual([d]);
});

test("an unmeasured space alone explains nothing; other classes are untouched", () => {
  const space = unmeasured();
  const hyphen: Divergence = { class: "hyphen", text: "x", words: [] };
  expect(explaining([space, hyphen], [differs("boxes[0]")], scene, grouping)).toEqual([hyphen]);
});
