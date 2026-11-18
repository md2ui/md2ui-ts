// An emoji font instance's axes reach its glyph in every engine (md2ui ADR-407). Chromium
// and Firefox set them on the instance's own face (`variationSettings`); WebKit has no
// such descriptor and applies the page canvas's `font-variation-settings`
// when a font is set, so the painter hands `setCanvasFont` the instances (`Frame.
// variations`) and it sets them around each run. Several instances and plain text share
// one canvas in one frame, each drawn as it would be alone. The fonts are md2ui's
// variable icon font and static Inter, from the fixtures, so the test runs only with them.
import type { DisplayList, FontSpec, TextRun } from "@md2ui/contracts";
import { type FontFaceSource, loadFonts } from "@md2ui/text-pretext";
import { expect, inject, test } from "vitest";
import { commands } from "vitest/browser";
import { createPainter } from "../src/painter.ts";
import { list } from "./lists.ts";

const fixtures = inject("md2uiFixtures");
/** U+1F3E0 HOUSE BUILDING, drawn as Material's `home`, whose fill no table row pins. */
const HOUSE = "\u{1F3E0}";
const SIZE = 40;
const CELL = 80;

async function fontUrl(file: string): Promise<string> {
  const data = await commands.readFile(`${fixtures}/fonts/${file}`, "base64");
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "font/ttf" }));
}

/** The instances, as the session makes them: a family each, with its settings. */
const INSTANCES = [
  { family: "md2ui-test-icons", settings: "" },
  { family: "md2ui-test-icons (FILL 1)", settings: '"FILL" 1' },
  { family: "md2ui-test-icons (GRAD 200)", settings: '"GRAD" 200' },
] as const;

async function loadTestFonts(): Promise<void> {
  const icons = await fontUrl("material-design-icons-md2ui.ttf");
  const sources: FontFaceSource[] = INSTANCES.map(({ family, settings }) => ({
    family,
    url: icons,
    ...(settings === "" ? {} : { variationSettings: settings }),
  }));
  sources.push({ family: "md2ui-test-inter", url: await fontUrl("Inter_18pt-Regular.ttf") });
  await loadFonts(sources, {});
}

const font = (family: string): FontSpec => ({
  families: [family],
  size: SIZE,
  weight: 400,
  italic: false,
});

/** One line of runs, a cell each. */
function line(runs: readonly { text: string; family: string }[]): DisplayList {
  const textRuns: TextRun[] = runs.map(({ text, family }, i) => ({
    text,
    x: i * CELL + 4,
    font: font(family),
    color: "#000000ff",
  }));
  const bounds = { x: 0, y: 0, width: runs.length * CELL, height: CELL };
  return list([{ type: "text", nodeId: "line", bounds, y: 60, runs: textRuns }], [], bounds);
}

/** Paints `doc` on a page canvas and returns each cell's alpha. */
function paint(doc: DisplayList, variations: ReadonlyMap<string, string>): Uint8ClampedArray[] {
  const canvas = document.createElement("canvas");
  canvas.width = doc.width;
  canvas.height = doc.height;
  document.body.append(canvas);
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2D context");
  const frame = {
    width: doc.width,
    height: doc.height,
    scrollX: 0,
    scrollY: 0,
    pixelRatio: 1,
    images: () => undefined,
    loading: () => undefined,
    offsets: new Map(),
    variations,
  };
  createPainter(doc).paint(ctx, frame);
  const cells = Array.from({ length: doc.width / CELL }, (_, i) =>
    ctx.getImageData(i * CELL, 0, CELL, CELL).data.filter((_, j) => j % 4 === 3),
  );
  canvas.remove();
  return cells;
}

const same = (a: Uint8ClampedArray | undefined, b: Uint8ClampedArray | undefined): boolean =>
  a !== undefined && b !== undefined && a.every((v, i) => v === b[i]);

const VARIATIONS = new Map(
  INSTANCES.filter((i) => i.settings !== "").map((i) => [i.family, i.settings] as const),
);

test.skipIf(fixtures === "")(
  "each instance on a shared canvas draws its own axes, and plain text none",
  async () => {
    await loadTestFonts();
    const [base, fill, grade] = INSTANCES.map(
      ({ family }) => paint(line([{ text: HOUSE, family }]), VARIATIONS)[0],
    );
    const text = paint(line([{ text: "Ag", family: "md2ui-test-inter" }]), VARIATIONS)[0];
    expect(same(fill, base)).toBe(false);
    expect(same(grade, base)).toBe(false);
    // Fill, plain text, grade, then the instance with no axes: each as it draws alone.
    const mixed = paint(
      line([
        { text: HOUSE, family: INSTANCES[1].family },
        { text: "Ag", family: "md2ui-test-inter" },
        { text: HOUSE, family: INSTANCES[2].family },
        { text: HOUSE, family: INSTANCES[0].family },
      ]),
      VARIATIONS,
    );
    expect(
      [mixed[0], mixed[1], mixed[2], mixed[3]].map((c, i) => same(c, [fill, text, grade, base][i])),
    ).toEqual([true, true, true, true]);
  },
);

test.skipIf(fixtures === "")(
  "without the instances, an engine that cannot vary a face draws the default",
  async () => {
    await loadTestFonts();
    const [base, fill] = INSTANCES.map(
      ({ family }) => paint(line([{ text: HOUSE, family }]), new Map())[0],
    );
    // WebKit (no `FontFace` `variationSettings`) is the engine the canvas route exists for.
    expect(same(fill, base)).toBe(!("variationSettings" in FontFace.prototype));
  },
);
