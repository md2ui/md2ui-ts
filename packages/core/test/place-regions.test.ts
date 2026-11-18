// Click regions placement notes (md2ui `_note_actions`): a link card clicks where it is
// drawn, inside a table cell as outside one.
import { describe, expect, it } from "vitest";
import { paintMarkdown } from "./scene-kit.ts";

describe("table cells", () => {
  it("gives a link card inside a table cell its click region, the box it is drawn in", () => {
    const { scene } = paintMarkdown(
      "| Plan | Details |\n| --- | --- |\n" +
        "| A | See [a [nested] label](/c) now. |\n| B | plain |\n",
    );
    const cards = scene.regions.filter((r) => r.card && r.action.href === "/c");
    expect(cards).toHaveLength(1);
    const box = scene.boxes.find((b) => b.content_id === cards[0]?.action.node_id);
    expect(box).toBeDefined();
    // As md2ui's test: the slot and the box agree to float rounding.
    const near = (v: number | undefined) => expect.closeTo(v ?? Number.NaN, 6);
    expect(cards[0]).toMatchObject({
      x: near(box?.x),
      y: near(box?.y),
      width: near(box?.width),
      height: near(box?.height),
      action: { label: "a [nested] label" },
    });
  });
});
