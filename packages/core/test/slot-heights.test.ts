// Matching pieces of the cards in a grid row share one height (md2ui
// `render_slots`, ADR-410; md2ui's `tests/slot_heights_tests.py`). When one card's title
// wraps to two lines and its neighbours' do not, the piece at the same place in every
// card of the row takes the tallest one's height, keeps the top of that slot, and the
// gap opens under it: twins start at one y, and the row is no taller when one card is
// the tallest everywhere. Cards that stack different pieces do not share; a slot is
// per width; a piece that is or holds a picture never shares (md2ui's photo stretched in
// an image card); and a grid row inside a card shares without losing the outer row's
// record (md2ui's crash on grids inside grid cards).
import { describe, expect, it } from "vitest";
import { layoutNode } from "../src/layout/node.ts";
import { holdsPicture, rowSlots } from "../src/measure/slots.ts";
import { groupingIndex } from "../src/scene/scene.ts";
import { paintMarkdown } from "./scene-kit.ts";

const BODY = "Magnis porttitor penatibus facilisis feugiat hendrerit.";
const LONG = "A few possible examples from my career, collected over ten years";
const card = (title: string, n: number) =>
  `### ${title}\nEverything you need to know\n${BODY}\n[Read now](agent:read?id=${n})`;
const ROW = [card("Deep natured", 1), card(LONG, 2), card("Calm water", 3)].join("\n\n");

/** The y of every box drawing `content` (a button's node holds its Markdown, so by substring), left to right. */
function ys(markdown: string, content: string): number[] {
  const { scene, grouping } = paintMarkdown(markdown, "", 1280);
  const nodes = groupingIndex(grouping);
  return scene.boxes
    .filter((b) => b.content_id !== null && nodes.get(b.content_id)?.content.includes(content))
    .sort((a, b) => a.x - b.x)
    .map((b) => b.y);
}

const piece = () => layoutNode("-", [], []);

describe("a grid row's cards", () => {
  it("line up the pieces below a two-line title with their twins", () => {
    for (const content of ["Everything you need to know", BODY, "Read now"]) {
      const at = ys(ROW, content);
      expect(at, content).toHaveLength(3);
      expect(Math.max(...at) - Math.min(...at), content).toBeLessThan(0.5);
    }
  });

  it("keep the row's height when one card is the tallest in every piece", () => {
    const shared = paintMarkdown(ROW, "", 1280).scene.height;
    const alike = [card(LONG, 1), card(LONG, 2), card(LONG, 3)].join("\n\n");
    expect(shared).toBeCloseTo(paintMarkdown(alike, "", 1280).scene.height, 1);
  });

  it("keep their own heights when they stack different pieces", () => {
    const extra = `### Deep natured\nEverything you need to know\n\`New\`\n${BODY}\n[Read now](agent:read?id=1)`;
    const at = ys(
      [extra, card(LONG, 2), card("Calm water", 3)].join("\n\n"),
      "Everything you need to know",
    );
    expect(at).toHaveLength(3);
    expect(Math.max(...at) - Math.min(...at)).toBeGreaterThan(0.5);
  });
});

describe("a slot", () => {
  /** A card of `pieces`, the slots shared as `heights` measures them at `width`. */
  const shareOf = (
    slots: ReturnType<typeof rowSlots>,
    cards: readonly (readonly ReturnType<typeof piece>[])[],
    heights: readonly (readonly number[])[],
    width = 300,
    inside?: () => void,
  ) => {
    slots.share(
      cards.map((ps) =>
        layoutNode(
          "col",
          ps.map(() => 1),
          [...ps],
        ),
      ),
      () => {
        cards.forEach((ps, c) => {
          ps.forEach((p, i) => {
            slots.lift(p, width, heights[c]?.[i] as number);
            if (c === 0 && i === 0) inside?.();
          });
        });
      },
      () => false,
    );
  };

  it("lifts only its own piece, at its own width, never down", () => {
    const slots = rowSlots(() => {});
    const [a, b, c, d] = [piece(), piece(), piece(), piece()];
    shareOf(
      slots,
      [
        [a, b],
        [c, d],
      ],
      [
        [40, 10],
        [80, 10],
      ],
    );
    expect(slots.lift(a, 300, 40)).toBe(80);
    expect(slots.lift(a, 200, 40), "another width").toBe(40);
    expect(slots.lift(c, 300, 80), "the tallest keeps its own").toBe(80);
    expect(slots.lift(a, 300, 90), "never shrinks").toBe(90);
    expect(slots.lift(b, 300, 10), "the last piece shares nothing").toBe(10);
  });

  it("shares in an outer row while a grid row inside a card shares too", () => {
    const slots = rowSlots(() => {});
    const [a, b, c, d] = [piece(), piece(), piece(), piece()];
    const [e, f, g, h] = [piece(), piece(), piece(), piece()];
    // The inner row shares while the outer one measures, as a grid inside a grid card does.
    shareOf(
      slots,
      [
        [a, b],
        [c, d],
      ],
      [
        [40, 10],
        [80, 10],
      ],
      300,
      () =>
        shareOf(
          slots,
          [
            [e, f],
            [g, h],
          ],
          [
            [20, 5],
            [30, 5],
          ],
          100,
        ),
    );
    expect(slots.lift(a, 300, 40), "the outer row's record survives").toBe(80);
    expect(slots.lift(e, 100, 20), "the inner row shares too").toBe(30);
  });

  it("is never given to a piece that is or holds a picture", () => {
    const photo = piece();
    const caption = piece();
    const card = layoutNode("col", [1], [layoutNode("row", [1, 1], [photo, caption])]);
    const isPhoto = (n: unknown) => n === photo;
    expect(holdsPicture(card, isPhoto)).toBe(true);
    expect(holdsPicture(caption, isPhoto)).toBe(false);
    const backdrop = layoutNode("col", [1], [caption]);
    backdrop.card_bg_url = "https://example.com/photo.jpg";
    expect(holdsPicture(backdrop, isPhoto), "a background photo").toBe(true);
  });
});
