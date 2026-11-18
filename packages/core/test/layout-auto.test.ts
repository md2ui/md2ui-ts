// `Layout: Auto` (md2ui `tests/layout_auto_tests.py`): the engine tiles or
// stacks each document by which leaves less of the page empty, decided once per
// document and width band. Run through the whole pipeline with the fake measurer; the
// stat-strip and forecast documents md2ui decides on are fixture documents, so their
// choices are checked by conformance (`layout:1280`), not here.
import { expect, test } from "vitest";
import { groupMarkdown } from "../src/group/grouper.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { autoLayout, widthBand } from "../src/layout/auto.ts";
import { generate } from "../src/layout/generate.ts";
import { layoutInput } from "../src/layout/input.ts";
import type { LayoutNode } from "../src/layout/node.ts";
import { sizingMeasurer } from "../src/measure/sizing.ts";
import { createFakeMeasurer } from "../src/text/fake-measurer.ts";
import { parseTheme } from "../src/theme/parse.ts";

const themeOf = (layout: string) =>
  parseTheme(`# t\n## Styling & Spacing\n### Root\nLayout: ${layout}\n`);

/** Four `##` sections: a run long enough to tile. */
const TILES = ["A", "B", "C", "D"].map((h) => `## ${h}\n\nBody of ${h}.`).join("\n\n");

function prepared(markdown: string, layout: string) {
  const theme = themeOf(layout);
  const input = layoutInput(new RegexKit(), groupMarkdown(markdown, new RegexKit()));
  const measurer = sizingMeasurer(input, theme, createFakeMeasurer(), {
    emojiFamily: () => "emoji",
  });
  return { theme, input, measurer };
}

function* walk(n: LayoutNode): Generator<LayoutNode> {
  yield n;
  for (const c of n.children) yield* walk(c);
}

const tiled = (n: LayoutNode): boolean => [...walk(n)].some((x) => x.bento);

/** An empty scene of `width` × `height`: all of it is empty area. */
const blank = (width: number, height: number) => ({ scene: { width, height, boxes: [] } });

// md2ui: test_auto_parses_beside_default_and_bento
test("Layout: Auto parses beside Default and Bento; an unknown value is Default", () => {
  expect(themeOf("Auto").root.layout).toBe("auto");
  expect(themeOf("Bento").root.layout).toBe("bento");
  expect(themeOf("Mosaic").root.layout).toBe("default");
});

// md2ui: test_the_width_bands
test("the bands: under 768, up to 1280, beyond", () => {
  expect([390, 767, 768, 1279, 1280, 1920].map(widthBand)).toEqual([0, 0, 1, 1, 2, 2]);
});

// md2ui: test_auto_follows_the_choice_and_the_override_wins (the port has no override)
test("under Auto the generator tiles as it is told; Bento and Default ignore it", () => {
  const at = (layout: string, tiles: boolean): boolean => {
    const { theme, input, measurer } = prepared(TILES, layout);
    return tiled(generate(input, 1000, theme, measurer, tiles));
  };
  expect([at("Auto", true), at("Auto", false)]).toEqual([true, false]);
  expect([at("Bento", false), at("Default", true)]).toEqual([true, false]);
});

/** Each choice in turn: (tiles, builds) per effective width, one `AutoLayout`. */
function chosen(markdown: string, layout: string, widths: readonly number[]) {
  const { theme, input, measurer } = prepared(markdown, layout);
  const auto = autoLayout(input, theme, measurer);
  return widths.map((width) => {
    const built: boolean[] = [];
    // The tiled layout leaves 80% of the stacked one empty, so it wins.
    const { tiles } = auto.choose(width, (tiles) => {
      built.push(tiles);
      return { tiles, ...blank(100, tiles ? 80 : 100) };
    });
    return [tiles, built.length];
  });
}

// md2ui: test_a_band_is_measured_once_and_narrow_never
test("a band is measured on its first layout only; a narrow one never", () => {
  expect(chosen(TILES, "Auto", [1280, 1440, 390, 600, 1300, 900, 1100])).toEqual([
    [true, 2],
    [true, 1],
    [false, 1],
    [false, 1],
    [true, 1],
    [true, 2],
    [true, 1],
  ]);
});

// md2ui: test_nothing_to_tile_builds_once
test("a document with nothing to tile, or a theme not on Auto, builds once", () => {
  expect(chosen("# Notes\n\nOne paragraph.\n", "Auto", [1280, 900])).toEqual([
    [false, 1],
    [false, 1],
  ]);
  expect(chosen(TILES, "Bento", [1280])).toEqual([[false, 1]]);
});

test("bento wins at most 0.85 times the stacked empty area, and loses above it", () => {
  const { theme, input, measurer } = prepared(TILES, "Auto");
  const choice = (tiledHeight: number): boolean =>
    autoLayout(input, theme, measurer).choose(1280, (tiles) => ({
      tiles,
      ...blank(100, tiles ? tiledHeight : 100),
    })).tiles;
  expect([choice(85), choice(86)]).toEqual([true, false]);
});

test("a picture covers its box; text covers its one-line width, capped at its box", () => {
  const markdown = `${TILES}\n\n## E\n\n![p](https://example.com/p.png)`;
  const { theme, input, measurer } = prepared(markdown, "Auto");
  const ids = (type: string): string[] => {
    const out: string[] = [];
    const visit = (n: typeof input.root): void => {
      if (n.type === type) out.push(n.node_id);
      n.children.forEach(visit);
    };
    visit(input.root);
    return out;
  };
  const [image] = ids("image");
  const [text] = ids("text");
  // The stacked page is 1000 × 100; the tiled one is the same page holding one leaf.
  const choice = (id: string | undefined, width: number): boolean =>
    autoLayout(input, theme, measurer).choose(1280, (tiles) => ({
      tiles,
      scene: {
        width: 1000,
        height: 100,
        boxes: tiles ? [{ content_id: id ?? null, width, height: 100 }] : [],
      },
    })).tiles;
  // A 150-wide picture covers 15% of the page: bento's empty area is 0.85 of stacking's.
  expect([choice(image, 150), choice(image, 149)]).toEqual([true, false]);
  // A short text in a 150-wide box covers only its line: not enough.
  expect(choice(text, 150)).toBe(false);
  // An id no node has covers nothing.
  expect(choice("no-such-node", 1000)).toBe(false);
});
