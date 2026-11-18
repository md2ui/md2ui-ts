// A spring line that wraps (md2ui `generator_spring_wrap`, ADR-304; md2ui's
// `tests/spring_wrap_tests.py`). While a `...` line fits, its pieces sit where they were
// written. When it wraps: a right piece alone on a later line starts at the left; a
// centred piece stays centred; in `A ... B ... C` the end wraps first, and A and B keep
// one line unless they cannot share one either, when each piece takes its own line in
// order; a run's lines wrap together, so they realign together. Each case reads the
// placed box: its `y` says which line the piece is on, its `content_align` how the text
// is aligned in it. The texts are md2ui's, a little longer where the fake measurer's
// glyphs are narrower than md2ui's fonts.
import { describe, expect, it } from "vitest";
import { layoutNode } from "../src/layout/node.ts";
import { leftWhenAlone } from "../src/layout/spring-wrap.ts";
import { groupingIndex } from "../src/scene/scene.ts";
import { paintMarkdown } from "./scene-kit.ts";

// Too long to share a 320 px line with a price.
const LONG = "A charred double smash burger with crisp fries";

function boxes(markdown: string, width: number) {
  const { scene, grouping } = paintMarkdown(markdown, "", width);
  const nodes = groupingIndex(grouping);
  const box = (content: string) => {
    const hits = scene.boxes.filter(
      (b) => b.content_id !== null && nodes.get(b.content_id)?.content === content,
    );
    expect(hits, content).toHaveLength(1);
    return hits[0] as (typeof hits)[number];
  };
  return {
    y: (content: string) => box(content).y,
    align: (content: string) => box(content).render_properties?.["content_align"],
  };
}

describe("a wrapped spring line", () => {
  it("puts a right piece that wraps onto its own line at the left", () => {
    const b = boxes(`${LONG} ... $14.50`, 320);
    expect(b.y("$14.50")).toBeGreaterThan(b.y(LONG));
    expect(b.align("$14.50")).toBe("left");
  });

  it("keeps every piece where it was written while the line fits", () => {
    const b = boxes(`${LONG} ... $14.50`, 900);
    expect(b.y("$14.50")).toBe(b.y(LONG));
    expect(b.align("$14.50")).toBe("right");
  });

  it("keeps a centred piece centred, and the right one after it goes left", () => {
    let b = boxes(`${LONG} ... $14.50 ...`, 320);
    expect(b.y("$14.50")).toBeGreaterThan(b.y(LONG));
    expect(b.align("$14.50")).toBe("center");
    b = boxes(`... ${LONG} ... $14.50`, 320);
    expect(b.align(LONG)).toBe("center");
    expect(b.align("$14.50")).toBe("left");
  });

  it("wraps the end of A ... B ... C first, to the left", () => {
    const b = boxes("Charred Double Smash Burger ... Lisbon, Portugal ... $14.50", 320);
    const first = b.y("Charred Double Smash Burger");
    expect(b.y("Lisbon, Portugal"), "A and B keep one line").toBe(first);
    expect(b.y("$14.50"), "the end wraps").toBeGreaterThan(first);
    expect(b.align("Lisbon, Portugal")).toBe("center");
    expect(b.align("$14.50")).toBe("left");
  });

  it("gives each piece a line, in order, when A and B cannot share one", () => {
    const b = boxes(`${LONG} ... Lisbon ... $14.50`, 320);
    const ys = [LONG, "Lisbon", "$14.50"].map(b.y);
    expect(new Set(ys).size).toBe(3);
    expect([...ys].sort((p, q) => p - q)).toEqual(ys);
    expect(b.align("Lisbon")).toBe("center");
    expect(b.align("$14.50")).toBe("left");
  });

  it("wraps a run's lines together, and realigns them together", () => {
    const b = boxes(`- ${LONG} ... $14.50\n- Fries ... $3.00`, 320);
    expect(b.y("$3.00"), "the twin wraps too").toBeGreaterThan(b.y("Fries"));
    expect(b.align("$14.50")).toBe("left");
    expect(b.align("$3.00")).toBe("left");
  });

  it("moves only a right piece alone on a later line", () => {
    const piece = () => {
      const node = layoutNode("-", [], []);
      node.render_properties = { content_align: "right" };
      return node;
    };
    const [first, alone, shared] = [piece(), piece(), piece()];
    leftWhenAlone([first, alone, shared], [["a"], ["b"], ["c", "d"]]);
    expect(first.render_properties).toEqual({ content_align: "right" });
    expect(alone.render_properties).toEqual({ content_align: "left" });
    expect(shared.render_properties).toEqual({ content_align: "right" });
  });
});
