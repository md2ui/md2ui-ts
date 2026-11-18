// What a measurer divergence cannot explain: a measured width may move
// geometry, wraps and arrangement, never which content is laid out or how it is painted.
import { expect, test } from "vitest";
import { sceneInvariants, treeInvariants } from "../src/invariant.ts";
import type { Json } from "../src/json.ts";

const section = (y: number, bg: number[]): Json => ({
  kind: "table_row",
  level: 0,
  x: 0,
  y,
  width: 300,
  height: 20,
  clip: [0, y, 300, 20, 0],
  bg_stack: bg,
});

test("a section's background stack is not explained: the hidden table case", () => {
  // tests-glyph-fallback-alone: a `no-spaces` divergence beside unported row stacks.
  const expected = { sections: [section(0, [1, 2]), section(20, [1, 2])], boxes: [] };
  const actual = { sections: [section(0, []), section(20, [])], boxes: [] };
  const found = sceneInvariants(expected, actual);
  expect(found.map((d) => d.path)).toEqual([
    "sections[0] · bg_stack[0]",
    "sections[0] · bg_stack[1]",
    "sections[1] · bg_stack[0]",
    "sections[1] · bg_stack[1]",
  ]);
});

test("geometry alone is explained, in every list", () => {
  const scene = (shift: number): Json => ({
    width: 300,
    height: 100 + shift,
    asked_width: 300,
    anchors: { intro: 10 + shift },
    sections: [section(shift, [1])],
    boxes: [{ content_id: "1", x: shift, y: 0, width: 20, height: 10, bg_stack: [1] }],
    regions: [{ action: { kind: "link", href: "/a" }, card: false, x: shift, y: 0 }],
    scrollables: [{ content_id: "2", x: 0, y: shift, content_width: 400 + shift }],
  });
  expect(sceneInvariants(scene(0), scene(7))).toEqual([]);
});

test("a wrap that adds boxes and link regions is explained; a changed paint or link is not", () => {
  const box = (y: number, bg: number[]): Json => ({ content_id: "1", x: 0, y, bg_stack: bg });
  const link = (href: string, y: number): Json => ({ action: { kind: "link", href }, x: 0, y });
  const expected = { boxes: [box(0, [1])], regions: [link("/a", 0)] };
  const wrapped = { boxes: [box(0, [1]), box(10, [1])], regions: [link("/a", 0), link("/a", 10)] };
  expect(sceneInvariants(expected, wrapped)).toEqual([]);
  const repainted = { boxes: [box(0, [1]), box(10, [2])], regions: [link("/b", 0)] };
  const found = sceneInvariants(expected, repainted);
  expect(found.map((d) => [d.path, d.field, d.expected, d.actual])).toEqual([
    ["boxes of content 1", "", "absent", '{"content_id":"1","bg_stack":[2]}'],
    ["regions · action", "href", '"/a"', '"/b"'],
  ]);
});

test("a section measurement cannot add or drop is a difference", () => {
  const found = sceneInvariants({ sections: [section(0, [1])] }, { sections: [] });
  expect(found).toEqual([
    { class: "value", path: "sections", field: "length", expected: "1", actual: "0" },
  ]);
});

const leaf = (id: string, fields: Record<string, Json> = {}): Json => ({
  type: "-",
  content_id: id,
  children: [],
  ...fields,
});
const card = (id: string, rotation: number, fields: Record<string, Json> = {}): Json => ({
  type: "col",
  content_id: null,
  is_card: true,
  rotation_index: rotation,
  render_properties: null,
  ratios: [1],
  children: [leaf(id)],
  ...fields,
});
const row = (ratios: number[], children: Json[]): Json => ({
  type: "row",
  content_id: null,
  grid: true,
  grid_cols: children.length,
  ratios,
  children,
});

test("a grid regrouped into other rows compares each card with its counterpart", () => {
  // generated-home-dashboard at 767: six cards to a row in md2ui, three in the port.
  const cards = ["a", "b", "c", "d"].map((id, i) => card(id, i));
  const expected = { type: "col", ratios: [1], children: [row([1, 1, 1, 1], cards)] };
  const actual = {
    type: "col",
    ratios: [1, 1],
    children: [row([1, 1], cards.slice(0, 2)), row([1, 1], cards.slice(2))],
  };
  expect(treeInvariants(expected, actual)).toEqual([]);
  // A cell the port's wrap filled and md2ui's did not: md2ui writes no properties.
  const filled = {
    ...actual,
    children: [
      row([1, 1], [card("a", 0), card("b", 1, { render_properties: { fill_row: true } })]),
      row([1, 1], cards.slice(2)),
    ],
  };
  expect(treeInvariants(expected, filled)).toEqual([]);
  const recoloured = {
    ...actual,
    children: [row([1, 1], cards.slice(0, 2)), row([1, 1], [card("c", 0), card("d", 3)])],
  };
  expect(treeInvariants(expected, recoloured)).toEqual([
    { class: "flag", path: "0.2 (col)", field: "rotation_index", expected: "2", actual: "0" },
  ]);
});

test("a line flowed differently moves its line flags, not its paint", () => {
  // schedule at 767: md2ui wraps a line into a col of rows, the port keeps one row.
  const expected = {
    type: "col",
    children: [
      { type: "col", line_split: true, children: [leaf("1", { line_split: true }), leaf("2")] },
    ],
  };
  const flowed = (first: Json): Json => ({
    type: "col",
    children: [{ type: "row", spring: true, children: [first, leaf("2", { flow_run: 3 })] }],
  });
  expect(treeInvariants(expected, flowed(leaf("1")))).toEqual([]);
  const linked = treeInvariants(expected, flowed(leaf("1", { link_url: "/x" })));
  expect(linked.map((d) => `${d.path} · ${d.field}`)).toEqual(["0.0 (-) · link_url"]);
});

test("a line flag no measurer divergence moves is compared", () => {
  const expected = { type: "col", children: [leaf("1", { heading_line: true }), leaf("2")] };
  const dropped = { type: "col", children: [leaf("1"), leaf("2")] };
  expect(treeInvariants(expected, dropped).map((d) => `${d.path} · ${d.field}`)).toEqual([
    "0 (-) · heading_line",
  ]);
});

test("a card only one side builds is not an arrangement", () => {
  // A row the wrap built is bare; a card around the same content is not.
  const expected = { type: "col", children: [leaf("1"), leaf("2")] };
  const wrapped = { type: "col", children: [{ type: "row", children: [leaf("1"), leaf("2")] }] };
  expect(treeInvariants(expected, wrapped)).toEqual([]);
  const carded = {
    type: "col",
    children: [{ type: "col", is_card: true, children: [leaf("1"), leaf("2")] }],
  };
  expect(treeInvariants(expected, carded)).toEqual([
    {
      class: "tree",
      path: "port 0 (col)",
      field: "node",
      expected: "absent",
      actual: '{"is_card":true}',
    },
  ]);
});

test("content laid out on one side only is a difference", () => {
  const expected = { type: "col", children: [leaf("1"), leaf("2")] };
  const actual = { type: "col", children: [leaf("1")] };
  expect(treeInvariants(expected, actual)).toEqual([
    { class: "tree", path: "content 2", field: "nodes", expected: "1", actual: "0" },
    { class: "tree", path: "1 (-)", field: "node", expected: "{}", actual: "absent" },
  ]);
});

const mosaic = (children: Json[]): Json => ({
  type: "row",
  content_id: null,
  bento: true,
  children,
});
const stack = (children: Json[]): Json => ({ type: "col", content_id: null, children });

test("a mosaic a measurement reshaped is explained; a mosaic one side lacks is not", () => {
  // generated-home-dashboard at 1280 (since rewritten): a long word split the tiles otherwise.
  const expected = {
    type: "col",
    children: [mosaic([stack([leaf("1"), leaf("2")]), leaf("3")]), leaf("4")],
  };
  const reshaped = {
    type: "col",
    children: [mosaic([leaf("1"), stack([leaf("2"), leaf("3")])]), leaf("4")],
  };
  expect(treeInvariants(expected, reshaped)).toEqual([]);
  // statistics-user at 1280, stacked instead: the same content.
  const stacked = { type: "col", children: [leaf("1"), leaf("2"), leaf("3"), leaf("4")] };
  expect(treeInvariants(expected, stacked).map((d) => `${d.path} · ${d.field}`)).toEqual([
    "content 1 · tiled",
    "content 2 · tiled",
    "content 3 · tiled",
  ]);
});
