// How md2ui sizes a `:::` row: a `:::0` cell is sized without its `---` rules, a weighted cell
// gets its widest pill or word out of its `:::0` pictures, and a 0 x 0 picture draws nothing.
// Mirrors md2ui's layout_column_row_tests; these run without fixtures.
import { expect, test } from "vitest";
import type { LayoutBox } from "../src/scene/boxes.ts";
import { paintScene } from "../src/scene/display-list.ts";
import { paintMarkdown } from "./scene-kit.ts";

const PHOTO = "https://example.com/photo.jpg";

// md2ui's fixture theme (data/markdown/tests/THEME.md), the parts a button's pill reads.
const THEME = `## Styling & Spacing
### Root
Padding: 40
Spacing: 32

## Links
Fill color: #26262B
Corner radius: 24
Padding top: 10
Padding bottom: 10
Padding left: 18
Padding right: 18
`;

const isPicture = (b: LayoutBox, cap: number) => b.render_properties?.["max_width"] === cap;

// md2ui: test_a_rule_does_not_size_a_fit_cell
test("a rule in a `:::0` cell leaves its neighbour the row", () => {
  const doc =
    `![A](${PHOTO}?md2ui.max_width=104&md2ui.aspect_ratio=1:1)\n` +
    ":::1\n**3591**\n_Reviews_\n---\n**4.82★**\n_Rating_\n:::0\n";
  const { boxes } = paintMarkdown(doc, "", 800).scene;
  const picture = boxes.find((b) => isPicture(b, 104));
  expect(picture?.width).toBeGreaterThan(0);
  expect(picture?.height).toBeGreaterThan(0);
  expect(Math.max(...boxes.map((b) => b.width))).toBeLessThan(800 - 104);
});

// md2ui: test_a_zero_sized_picture_draws_nothing
test("a picture given no room draws nothing", () => {
  // md2ui's test hands `draw_image_box` a 0 x 0 box; here the placed box is set to one
  // and the scene painted again.
  const { sizer, scene, grouping, painted } = paintMarkdown(`![A](${PHOTO})\n`, "", 400);
  const images = (list: typeof painted.list) => list.entries.filter((e) => e.type === "image");
  expect(images(painted.list)).toHaveLength(1);
  const box = scene.boxes.find((b) => b.content_id !== null) as LayoutBox;
  box.width = 0;
  box.height = 0;
  expect(images(paintScene(sizer, scene, grouping, null).list)).toHaveLength(0);
});

// md2ui: test_a_picture_gives_way_before_a_button
test("a `:::0` picture gives way before a button is squeezed", () => {
  // A button's label never wraps, so its box must hold its pill. Pictures flex first,
  // down to their floor; the row wraps below it.
  const doc =
    `![A](${PHOTO}?md2ui.max_width=180&md2ui.aspect_ratio=172:186)\n:::0\n` +
    "___Good Morning, Mia!___\n_Let's enjoy some music today!_\n" +
    "[▶️ Play Something Wonderful](/play)\n:::1\n" +
    `![B](${PHOTO}?md2ui.max_width=96&md2ui.aspect_ratio=96:144)\n:::0\n`;
  const short: [number, number][] = [];
  let buttons = 0;
  for (let width = 340; width < 640; width += 20) {
    const { sizer, scene } = paintMarkdown(doc, THEME, width);
    for (const box of scene.boxes) {
      const nd = sizer.index.get(box.content_id ?? "") ?? null;
      if (nd?.type !== "link") continue;
      buttons++;
      const pill = sizer.widths.leafNaturalWidth(nd, 1e6, box.render_properties);
      if (pill > box.width + 0.5) short.push([width, Math.round((pill - box.width) * 10) / 10]);
    }
  }
  expect(buttons).toBe(15);
  expect(short).toEqual([]);
});
