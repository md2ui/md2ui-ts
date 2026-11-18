import { describe, expect, test } from "vitest";
import { createPretextMeasurer } from "../src/index.ts";
import { battery } from "./battery.ts";
import { BREAK, spec, TEST_FONTS, twoParagraphs } from "./test-fonts.ts";

describe.each(TEST_FONTS)("measurer with $family", ({ family, sources }) => {
  const measurerPromise = createPretextMeasurer(sources);

  test("advance is positive and bold is wider than regular", async () => {
    const m = await measurerPromise;
    const regular = m.advance("WWW MMM Settings", spec(family));
    expect(regular).toBeGreaterThan(0);
    expect(m.advance("WWW MMM Settings", spec(family, 700))).toBeGreaterThan(regular);
  });

  test("leading spaces count in advance", async () => {
    const m = await measurerPromise;
    expect(m.advance("    x", spec(family))).toBeGreaterThan(m.advance("x", spec(family)));
  });

  test("font metrics are positive", async () => {
    const { ascent, descent } = (await measurerPromise).fontMetrics(spec(family));
    expect(ascent).toBeGreaterThan(0);
    expect(descent).toBeGreaterThan(0);
  });

  test("ink bounds: glyphs have extent, a space is the ascent", async () => {
    const m = await measurerPromise;
    const ink = m.inkBounds("Hx", spec(family));
    expect(ink.top).toBeGreaterThan(0);
    expect(ink.height).toBeGreaterThan(0);
    const { ascent } = m.fontMetrics(spec(family));
    expect(m.inkBounds(" ", spec(family))).toEqual({
      top: ascent,
      height: ascent,
      left: 0,
      width: 0,
    });
  });

  test("ink bounds: the horizontal extent runs from the pen origin across the glyphs", async () => {
    const m = await measurerPromise;
    const font = spec(family);
    const ink = m.inkBounds("Hx", font);
    const advance = m.advance("Hx", font);
    // The ink is about as wide as the advance, within side bearings.
    expect(ink.width).toBeGreaterThan(advance / 2);
    expect(ink.width).toBeLessThan(advance + font.size / 2);
    expect(Math.abs(ink.left)).toBeLessThan(font.size / 2);
    // Measured from the pen origin: leading spaces move the ink's right edge by their
    // advance. (WebKit answers the advance box, so its left edge stays at the origin.)
    const pad = m.inkBounds("    Hx", font);
    const right = (b: typeof ink): number => b.left + b.width;
    expect(right(pad) - right(ink)).toBeCloseTo(m.advance("    Hx", font) - advance, 0);
  });

  test("two styled paragraphs wrap within the width they are given", async () => {
    const m = await measurerPromise;
    const prepared = m.prepare(twoParagraphs(family));
    const min = prepared.minWidth();
    const max = prepared.lineWidth();
    expect(min).toBeGreaterThan(0);
    expect(max).toBeGreaterThanOrEqual(min);
    expect(prepared.lineCount(max)).toBe(2);
    expect(prepared.lines(max)).toHaveLength(2);
    const expectedWords = twoParagraphs(family)
      .map((s) => s.text)
      .join("")
      .split(new RegExp(`[ ${BREAK}]+`))
      .filter((w) => w !== "");
    for (let step = 0; step <= 10; step++) {
      const width = min + ((max - min) * step) / 10;
      const lines = prepared.lines(width);
      expect(prepared.lineCount(width)).toBe(lines.length);
      for (const line of lines) {
        expect(line.width).toBeLessThanOrEqual(width + 0.01);
        line.fragments.forEach((fragment, i) => {
          expect(fragment.span).toBeGreaterThanOrEqual(0);
          expect(fragment.span).toBeLessThan(5);
          const previous = line.fragments[i - 1];
          if (previous !== undefined) {
            expect(fragment.x).toBeGreaterThan(previous.x);
          }
        });
      }
      const words = lines
        .flatMap((line) => line.fragments.map((f) => f.text))
        .join(" ")
        .split(/\s+/)
        .filter((w) => w !== "");
      // Fragments of one word split across spans ("Settings" + ".") rejoin without a space.
      expect(words.join("").replace(/\s/g, "")).toBe(expectedWords.join(""));
    }
  });

  test("minWidth treats Settings + '.' across spans as one unit", async () => {
    const m = await measurerPromise;
    const prepared = m.prepare([
      { text: "a ", font: spec(family) },
      { text: "Settings", font: spec(family, 700) },
      { text: ".", font: spec(family) },
    ]);
    expect(prepared.minWidth()).toBeCloseTo(
      m.advance("Settings", spec(family, 700)) + m.advance(".", spec(family)),
      5,
    );
  });

  test("empty and blank texts take no lines", async () => {
    const m = await measurerPromise;
    const prepared = m.prepare([{ text: `  ${BREAK} `, font: spec(family) }]);
    expect(prepared.lineCount(100)).toBe(0);
    expect(prepared.lines(100)).toEqual([]);
  });

  test("answers are stable: asked twice, and by a measurer made after clearCache", async () => {
    const { clearCache } = await import("@chenglou/pretext");
    const m = await measurerPromise;
    const first = battery(m, family);
    expect(battery(m, family)).toEqual(first);
    clearCache();
    const second = await createPretextMeasurer(sources);
    expect(battery(second, family)).toEqual(first);
  });
  test("a text with VS16 comes back as authored, though the canvas measured VS15", async () => {
    const m = await measurerPromise;
    const text = "Risk \u26A0\uFE0F high, \u2764\uFE0F\u200D\u{1F525} too";
    const prepared = m.prepare([{ text, font: spec(family) }]);
    for (const width of [prepared.minWidth(), prepared.lineWidth()]) {
      const pieces = prepared.lines(width).flatMap((line) => line.fragments.map((f) => f.text));
      expect(pieces.join("").replaceAll(" ", "")).toBe(text.replaceAll(" ", ""));
    }
  });
});
