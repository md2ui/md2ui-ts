import { clearCache, measureNaturalWidth, prepareWithSegments } from "@chenglou/pretext";
import { expect, test } from "vitest";
import { createFontFaces, createPretextMeasurer, loadFonts } from "../src/index.ts";
import { INTER_REGULAR_URL } from "./test-fonts.ts";

const TEXT = "Hamburgefonstiv quick brown fox";

function canvasWidth(font: string, text: string): number {
  const ctx = new OffscreenCanvas(1, 1).getContext("2d");
  if (ctx === null) {
    throw new Error("no 2d context");
  }
  ctx.font = font;
  return ctx.measureText(text).width;
}

test("a font given to the measurer is used, not the fallback", async () => {
  const family = "md2ui-test-late";
  const font = { families: [family, "sans-serif"], size: 20, weight: 400, italic: false };
  const without = await createPretextMeasurer([]);
  const widthA = without.advance(TEXT, font);
  const withFont = await createPretextMeasurer([{ family, url: INTER_REGULAR_URL }]);
  const widthB = withFont.advance(TEXT, font);
  expect(widthB).not.toBe(widthA);
  expect(Math.abs(widthB - canvasWidth(`400 20px "${family}", sans-serif`, TEXT))).toBeLessThan(
    0.01,
  );
});

test("without clearCache, Pretext keeps the fallback measurement after the face arrives", async () => {
  const family = "md2ui-test-stale";
  const css = `400 20px "${family}", sans-serif`;
  const measure = (): number =>
    measureNaturalWidth(prepareWithSegments(TEXT, css, { whiteSpace: "pre-wrap" }));
  const stale = measure();
  const face = new FontFace(family, `url(${JSON.stringify(INTER_REGULAR_URL)})`);
  await face.load();
  document.fonts.add(face);
  expect(measure()).toBe(stale);
  clearCache();
  const fresh = measure();
  expect(fresh).not.toBe(stale);
  expect(Math.abs(fresh - canvasWidth(css, TEXT))).toBeLessThan(0.01);
});

test("a measurer keeps an advance until a face arriving in its thread clears Pretext's caches", async () => {
  const family = "md2ui-test-memo";
  const font = { families: [family, "sans-serif"], size: 20, weight: 400, italic: false };
  const faces = createFontFaces();
  // Made before another view's face arrives, the measurer answers in the fallback.
  const measurer = await createPretextMeasurer([], { faces });
  const fallback = measurer.advance(TEXT, font);
  expect(measurer.advance(TEXT, font)).toBe(fallback);
  await loadFonts([{ family, url: INTER_REGULAR_URL }], { faces });
  const arrived = measurer.advance(TEXT, font);
  expect(arrived).not.toBe(fallback);
  expect(Math.abs(arrived - canvasWidth(`400 20px "${family}", sans-serif`, TEXT))).toBeLessThan(
    0.01,
  );
});

test("a measurer keeps an advance until a page face arriving clears Pretext's caches", async () => {
  const family = "md2ui-test-memo-page";
  const font = { families: [family, "sans-serif"], size: 20, weight: 400, italic: false };
  const faces = createFontFaces();
  const measurer = await createPretextMeasurer([], { faces });
  const fallback = measurer.advance(TEXT, font);
  document.fonts.add(new FontFace(family, `url(${JSON.stringify(INTER_REGULAR_URL)})`));
  await loadFonts([], { faces, pageFamilies: [family] });
  expect(measurer.advance(TEXT, font)).not.toBe(fallback);
});

test("a source whose URL 404s rejects with an error naming the family", async () => {
  await expect(
    createPretextMeasurer([{ family: "md2ui-test-missing", url: "/no/such/font.woff2" }]),
  ).rejects.toThrow(/md2ui-test-missing/);
});

test("a face the page declares for a theme family is loaded before measuring", async () => {
  const family = "md2ui-test-page-face";
  const face = new FontFace(family, `url(${JSON.stringify(INTER_REGULAR_URL)})`);
  document.fonts.add(face);
  expect(face.status).toBe("unloaded");
  const measurer = await createPretextMeasurer([], { pageFamilies: [family] });
  expect(face.status).toBe("loaded");
  const font = { families: [family, "sans-serif"], size: 20, weight: 400, italic: false };
  expect(
    Math.abs(measurer.advance(TEXT, font) - canvasWidth(`400 20px "${family}", sans-serif`, TEXT)),
  ).toBeLessThan(0.01);
});

test("with onFontError, a source that fails is reported and skipped", async () => {
  const failed: string[] = [];
  const measurer = await createPretextMeasurer(
    [{ family: "md2ui-test-missing-2", url: "/no/such/font.woff2" }],
    { onFontError: (source, error) => failed.push(`${source.family}: ${error.message}`) },
  );
  expect(failed).toHaveLength(1);
  expect(failed[0]).toMatch(/^md2ui-test-missing-2: .*md2ui-test-missing-2/);
  expect(
    measurer.advance("x", { families: ["serif"], size: 10, weight: 400, italic: false }),
  ).toBeGreaterThan(0);
});
