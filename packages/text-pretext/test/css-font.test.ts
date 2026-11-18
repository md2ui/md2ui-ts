import { expect, test } from "vitest";
import { cssFont } from "../src/css-font.ts";

test("a font becomes the canvas shorthand", () => {
  expect(cssFont({ families: ["Inter", "sans-serif"], size: 16, weight: 700, italic: false })).toBe(
    '700 16px "Inter", sans-serif, serif',
  );
});

test("italic leads the shorthand", () => {
  expect(cssFont({ families: ["Inter"], size: 12.5, weight: 400, italic: true })).toBe(
    'italic 400 12.5px "Inter", serif',
  );
});

test("every stack ends in serif, so a Worker falls back as the page does", () => {
  expect(cssFont({ families: ["Inter 18pt"], size: 15, weight: 500, italic: false })).toBe(
    '500 15px "Inter 18pt", serif',
  );
});

test("generic keywords stay unquoted, others are quoted and escaped", () => {
  const font = {
    families: ['My "Odd" \\ Face', "system-ui", "ui-monospace", "emoji", "Fira Code"],
    size: 10,
    weight: 400,
    italic: false,
  };
  expect(cssFont(font)).toBe(
    '400 10px "My \\"Odd\\" \\\\ Face", system-ui, ui-monospace, emoji, "Fira Code", serif',
  );
});

test("a code font's monospace comes before the serif every stack ends in", () => {
  expect(
    cssFont({ families: ["IBM Plex Mono", "monospace"], size: 13, weight: 400, italic: false }),
  ).toBe('400 13px "IBM Plex Mono", monospace, serif');
});
