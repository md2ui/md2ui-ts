// `Emoji weight`, `Emoji fill`, `Emoji grade` and `Emoji optical size` draw an emoji in an
// instance of a variable emoji font (md2ui ADR-407): a family of its own that the view
// registers from the host's file (`emojiInstances`), which measuring and painting both
// name. This draws one glyph through that path in each engine and compares its ink, in
// md2ui's own icon font (variable: FILL, GRAD, opsz, wght) and OpenMoji (static). Runs
// only when MD2UI_FIXTURES names the fixtures, which carry both files.
import type { FontSource, FontSpec } from "@md2ui/contracts";
import {
  createPretextMeasurer,
  type FontVariations,
  loadFonts,
  setCanvasFont,
} from "@md2ui/text-pretext";
import { expect, inject, test } from "vitest";
import { commands } from "vitest/browser";
import { emojiInstances } from "../src/emoji-instances.ts";
import { loadTheme } from "../src/theme.ts";

const fixtures = inject("md2uiFixtures");
const PAGE = "https://app.example/";
/** U+1F3E0 HOUSE BUILDING, drawn as Material's `home`, whose fill no table row pins. */
const HOUSE = "\u{1F3E0}";
const SIZE = 40;

/** One theme, a badge variant per case. */
const THEME = [
  "## Emoji styles",
  "Font: fonts/emoji.ttf",
  "### Primary",
  "Emoji weight: 400",
  "### Secondary",
  "Emoji weight: 700",
  "### Tertiary",
  "Emoji fill: 1",
  "### Quaternary",
  "Emoji grade: 200",
  "",
].join("\n");

async function fontUrl(file: string): Promise<string> {
  const data = await commands.readFile(`${fixtures}/fonts/${file}`, "base64");
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "font/ttf" }));
}

/** The instances that set axes, as the view hands them to the painter (`Frame.variations`). */
let variations: FontVariations = new Map();

/** The four badge variants' fonts, each drawn as the scene would name it. */
async function variants(family: string, file: string): Promise<FontSpec[]> {
  const source: FontSource = { family, url: await fontUrl(file) };
  const { theme } = await loadTheme(
    { themeSrc: null, themeText: THEME.replace("fonts/emoji.ttf", source.url), assetBase: null },
    PAGE,
    new AbortController().signal,
  );
  const instances = emojiInstances(theme, [source], PAGE);
  await loadFonts([source, ...instances], {});
  variations = new Map(
    instances.flatMap((i) =>
      i.variationSettings === undefined ? [] : [[i.family, i.variationSettings] as const],
    ),
  );
  return instances.map((i) => ({
    families: [i.family],
    size: SIZE,
    weight: i.weight ?? 400,
    italic: false,
  }));
}

/** The glyph's ink, drawn on a page canvas as the painter draws: the sum of its alpha, which any change of outline moves. */
function ink(font: FontSpec): number {
  const canvas = document.createElement("canvas");
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2D context");
  ctx.canvas.width = ctx.canvas.height = 2 * SIZE;
  setCanvasFont(ctx, font, variations);
  ctx.fillText(HOUSE, 4, 1.5 * SIZE);
  const { data } = ctx.getImageData(0, 0, 2 * SIZE, 2 * SIZE);
  canvas.remove();
  let sum = 0;
  for (let i = 3; i < data.length; i += 4) sum += data[i] ?? 0;
  return sum;
}

test.skipIf(fixtures === "")("an emoji key sets its axis on a variable emoji font", async () => {
  const [regular, bold, filled, graded] = await variants(
    "md2ui-test-icons",
    "material-design-icons-md2ui.ttf",
  );
  if (!regular || !bold || !filled || !graded) throw new Error("an instance is missing");
  expect(ink(bold)).toBeGreaterThan(ink(regular));
  // Through the instance's face, or in WebKit, which has no FontFace `variationSettings`
  // through the page canvas's own settings (`setCanvasFont`).
  expect(ink(filled)).toBeGreaterThan(ink(regular));
  expect(ink(graded)).toBeGreaterThan(ink(regular));
  // Measuring names the same instance: the icon font's one advance, never a fallback's.
  // WebKit measures on an OffscreenCanvas, which has no style, so there it measures the
  // default; this font's advance is the same on every axis.
  const measurer = await createPretextMeasurer([]);
  for (const font of [regular, bold, filled, graded]) {
    expect(measurer.advance(HOUSE, font)).toBeCloseTo((SIZE * 1320) / 1024, 1);
  }
});

test.skipIf(fixtures === "")("an axis the font lacks changes nothing", async () => {
  // OpenMoji is static, with no sibling file: no key moves its outline, and a face
  // registered at the weight asked is never synthesized bold (md2ui keeps the file).
  const inks = (await variants("md2ui-test-openmoji", "OpenMoji-black-glyf.ttf")).map(ink);
  expect(inks).toHaveLength(4);
  expect(inks[0]).toBeGreaterThan(0);
  expect(new Set(inks).size).toBe(1);
});
