// Past the grouper, as md2ui paints it: an image with no picture, `![alt]()`,
// keeps a picture's box and its run, and paints only a quiet box (md2ui
// ADR-406). Each case is one of md2ui's tests/image_no_picture_tests.py, through the
// whole pipeline and the fake measurer; md2ui reads pixels, here the entries are read.
import type { DisplayEntry, FillEntry, ImageEntry } from "@md2ui/contracts";
import { expect, test } from "vitest";
import type { LayoutBox } from "../src/scene/boxes.ts";
import { type Painted, paintMarkdown } from "./scene-kit.ts";

const RATIO = "?md2ui.aspect_ratio=4:3";

/** The image nodes' ids, in document order. */
function imageIds(p: Painted): string[] {
  const ids: string[] = [];
  const walk = (n: Painted["grouping"]): void => {
    if (n.type === "image") ids.push(n.node_id);
    for (const c of n.children) walk(c);
  };
  walk(p.grouping);
  return ids;
}

function imageBoxes(p: Painted): LayoutBox[] {
  const ids = new Set(imageIds(p));
  return p.scene.boxes.filter((b) => b.content_id !== null && ids.has(b.content_id));
}

const size = (b: LayoutBox) => [b.width, b.height];

// md2ui `_run`: three `;;;`-less list items, each a picture beside a two-line text cell.
function run(middle: string): string {
  const item = (picture: string, name: string) =>
    `- ${picture}\n  :::1\n  **${name}**\n  A line about ${name}.\n  :::2\n\n`;
  return (
    "## Bays\n\n" +
    item(`![A](https://example.com/a.jpg${RATIO})`, "A") +
    item(middle, "B") +
    item("![C](https://example.com/c.jpg)", "C")
  );
}

// md2ui image_no_picture_tests: test_the_box_measures_as_a_picture_box
test("a box with no picture measures as a picture box with the same params", () => {
  const pairs = [
    ["![Bay](https://example.com/bay.jpg)", "![Bay]()"],
    ["![Bay](https://example.com/bay.jpg)", "![Bay]( )"],
    [`![Bay](https://example.com/bay.jpg${RATIO})`, `![Bay](${RATIO})`],
    [`![Bay](https://example.com/bay.jpg${RATIO})`, `![Bay]( ${RATIO})`],
  ];
  for (const [real, empty] of pairs) {
    const picture = imageBoxes(paintMarkdown(`## Bay\n\n${real}\nText.\n`, "", 1024));
    const nothing = imageBoxes(paintMarkdown(`## Bay\n\n${empty}\nText.\n`, "", 1024));
    expect(picture).toHaveLength(1);
    expect(nothing.map(size), empty).toEqual(picture.map(size));
  }
});

// md2ui image_no_picture_tests: test_an_item_with_no_picture_keeps_its_run
test("an item with no picture keeps its run, and the run's ratio", () => {
  for (const spelling of ["![B]()", "![B]( )"]) {
    const boxes = imageBoxes(paintMarkdown(run(spelling), "", 1024));
    expect(boxes).toHaveLength(3);
    expect(
      boxes.map((b) => b.render_properties?.["aspect_ratio"]),
      spelling,
    ).toEqual(["4:3", "4:3", "4:3"]);
    expect(new Set(boxes.map((b) => size(b).join("x"))).size).toBe(1);
  }
});

const own = (p: Painted, id: string): DisplayEntry[] =>
  p.painted.list.entries.filter((e) => e.nodeId === id);

// md2ui image_no_picture_tests: test_nothing_is_fetched_and_nothing_loads and
// test_it_paints_a_quiet_empty_box. The host fetches what image entries name, so an
// image with no picture is no image entry: its shape filled in the picture background,
// and nothing else (no placeholder, cross or label).
test("an empty source paints a quiet box and names nothing to fetch", () => {
  const p = paintMarkdown(run("![B]()"), "", 1024);
  const [a, b, c] = imageIds(p);
  const images = p.painted.list.entries.filter((e): e is ImageEntry => e.type === "image");
  expect(images.map((e) => e.nodeId)).toEqual([a, c]);
  expect(images.map((e) => e.src)).toEqual([
    "https://example.com/a.jpg",
    "https://example.com/c.jpg",
  ]);
  const quiet = own(p, b as string);
  expect(quiet.map((e) => e.type)).toEqual(["fill"]);
  const fill = quiet[0] as FillEntry;
  expect(fill.paint).toEqual({ kind: "color", color: "#d0d0d0ff" });
  expect(fill.clip).toBeUndefined();
  // The loaded picture beside it is drawn in a region of the same shape and size.
  const { kind, width, height } = (images[0] as ImageEntry).shape;
  expect(fill.shape).toMatchObject({ kind, width, height });
  const { x, y } = fill.shape;
  expect(fill.bounds).toEqual({ x, y, width, height });
});

// md2ui image_no_picture_tests: test_it_paints_a_quiet_empty_box, the shape: a circle
// and rounded corners clip the quiet box exactly as they would a picture.
test("the quiet box takes a picture's shape", () => {
  const shapes = (src: string) => {
    const p = paintMarkdown(`## Bay\n\n![Bay](${src})\nText.\n`, "", 600);
    return own(p, imageIds(p)[0] as string).map((e) =>
      e.type === "image" || e.type === "fill" ? e.shape : null,
    );
  };
  for (const params of ["?md2ui.shape=circle", "?md2ui.aspect_ratio=4:3"]) {
    expect(shapes(params), params).toEqual(shapes(`https://example.com/bay.jpg${params}`));
  }
});
