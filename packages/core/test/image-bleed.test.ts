// Image bleed (md2ui `tests/image_bleed_tests.py`): an image reaches over its level's
// padding on every inner edge it already touches, and a full-width or aside image that
// ends a stretched card's content runs down through the empty space below it, to the
// card's edge. Judged on the rects before any image bled.
import type { ResolvedTheme, SectionStyle } from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import type { NodeIndex } from "../src/measure/node-index.ts";
import { bakeImageBleed } from "../src/scene/bleed.ts";
import type { LayoutBox, SectionBox } from "../src/scene/boxes.ts";
import { parseTheme } from "../src/theme/parse.ts";

const PAD = 20;
const RADIUS = 24;
// Card at (0,0) 300x400; its content is inset by PAD on every side.
const IN_L = PAD;
const IN_T = PAD;
const IN_R = 300 - PAD;
const IN_B = 400 - PAD;
const padding = { top: PAD, left: PAD, right: PAD, bottom: PAD };

function theme(): ResolvedTheme {
  const base = parseTheme("");
  const level = base.sections[3] as SectionStyle;
  const style: SectionStyle = {
    ...level,
    padding,
    corner_radius: RADIUS,
    image_bleed: true,
    image_corner_radius: 0,
  };
  return { ...base, sections: { ...base.sections, 3: style } };
}

const card: SectionBox = {
  x: 0,
  y: 0,
  width: 300,
  height: 400,
  level: 3,
  padding,
  kind: "section",
  clip: null,
  ring: null,
  bg_image_url: null,
  rotation_index: null,
  rotation_chain: [],
  rotation_path: [],
  bg_stack: [],
  fixed_style_key: null,
};

// Only the node's `type` is read here.
const index = new Map([
  ["i", { type: "image" }],
  ["t", { type: "text" }],
]) as unknown as NodeIndex;

const box = (id: string, x: number, y: number, width: number, height: number): LayoutBox => ({
  x,
  y,
  width,
  height,
  content_id: id,
  render_properties: null,
  bg_stack: [],
});
const img = (x: number, y: number, w: number, h: number) => box("i", x, y, w, h);
const text = (x: number, y: number, w: number, h: number) => box("t", x, y, w, h);
/** The card's last line: an image above it does not end the card's content. */
const restOfCard = () => text(IN_L, IN_B - 20, IN_R - IN_L, 20);

const rect = (b: LayoutBox) => [b.x, b.y, b.width, b.height];
const radii = (b: LayoutBox) => b.render_properties?.["corner_radii"] ?? null;

/** Bleed `image` among the card's `others` (by default, just its last line). */
function run(image: LayoutBox, ...others: LayoutBox[]): LayoutBox {
  bakeImageBleed([image, ...(others.length > 0 ? others : [restOfCard()])], [card], index, theme());
  return image;
}

describe("which edges bleed: every inner edge the image already touches", () => {
  it("bleeds a leading image TLR, not bottom", () => {
    expect(rect(run(img(IN_L, IN_T, IN_R - IN_L, 150)))).toEqual([0, 0, 300, 170]);
  });

  it("bleeds a trailing image LRB, not top", () => {
    expect(rect(run(img(IN_L, IN_B - 150, IN_R - IN_L, 150)))).toEqual([0, 230, 300, 170]);
  });

  it("bleeds a middle image LR only: never over the sibling below", () => {
    const below = text(IN_L, 240, IN_R - IN_L, 40);
    expect(rect(run(img(IN_L, 120, IN_R - IN_L, 100), below))).toEqual([0, 120, 300, 100]);
  });
});

describe("a card stretched past its content (a bento band)", () => {
  it("runs an image that ends the card's content down to its bottom edge", () => {
    const above = text(IN_L, IN_T, IN_R - IN_L, 40);
    const image = run(img(IN_L, 80, IN_R - IN_L, 150), above);
    expect(rect(image)).toEqual([0, 80, 300, 320]);
    expect(radii(image)).toEqual([0, 0, RADIUS, RADIUS]);
  });

  it("bleeds an aside that ends the card's content TRB", () => {
    const beside = text(IN_L, IN_T, 160, 120);
    expect(rect(run(img(IN_R - 100, IN_T, 100, 200), beside))).toEqual([180, 0, 120, 400]);
  });

  it("keeps an aside beside a longer column at its height", () => {
    const beside = text(IN_L, IN_T, 160, 300);
    expect(rect(run(img(IN_R - 100, IN_T, 100, 200), beside))).toEqual([180, 0, 120, 220]);
  });

  it("runs two asides ending together both down: each is judged before the other bled", () => {
    const left = img(IN_L, IN_T, 100, 200);
    const right = img(IN_R - 100, IN_T, 100, 200);
    bakeImageBleed([left, right], [card], index, theme());
    expect(rect(left)).toEqual([0, 0, 120, 400]);
    expect(rect(right)).toEqual([180, 0, 120, 400]);
  });

  it("keeps pictures sharing a line below text at their height", () => {
    const above = text(IN_L, IN_T, IN_R - IN_L, 40);
    const left = img(IN_L, 80, 100, 100);
    const right = img(IN_R - 100, 80, 100, 100);
    bakeImageBleed([above, left, right], [card], index, theme());
    expect(rect(left)).toEqual([0, 80, 120, 100]);
    expect(rect(right)).toEqual([180, 80, 120, 100]);
  });
});
