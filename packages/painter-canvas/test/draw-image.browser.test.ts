import type { Color, ImageEntry, Rect, Shape } from "@md2ui/contracts";
import { expect, test } from "vitest";
import type { DecodedImage } from "../src/context.ts";
import { drawImage } from "../src/draw/image.ts";
import { inkInside, inkOutside, pixelAt, testCanvas, testEnv } from "./pixels.ts";

const RATIOS = [1, 2];

/** 4x2 source: left half red, right half blue. */
function halves(vector: boolean): DecodedImage {
  const source = new OffscreenCanvas(4, 2);
  const c = source.getContext("2d");
  if (c === null) throw new Error("no 2d context");
  c.fillStyle = "#ff0000";
  c.fillRect(0, 0, 2, 2);
  c.fillStyle = "#0000ff";
  c.fillRect(2, 0, 2, 2);
  return { source, width: 4, height: 2, vector };
}

function entry(
  shape: Shape,
  fit: ImageEntry["fit"],
  bounds: Rect,
  label: ImageEntry["placeholder"]["label"] = null,
): ImageEntry {
  return {
    type: "image",
    nodeId: "n",
    bounds,
    src: "a",
    shape,
    fit,
    placeholder: { color: "#00aa00" as Color, label },
  };
}

function rectShape(x: number, y: number, width: number, height: number): Shape {
  return { kind: "rect", x, y, width, height };
}

function shapeBounds(s: Shape): Rect {
  return { x: s.x, y: s.y, width: s.width, height: s.height };
}

function draw(dpr: number, e: ImageEntry, image?: DecodedImage, loading?: DecodedImage) {
  const t = testCanvas(200, 200, dpr);
  const env = testEnv(
    dpr,
    image === undefined ? {} : { a: image },
    new Map(),
    loading === undefined ? {} : { a: loading },
  );
  drawImage(t.ctx, e, env);
  return { t, env };
}

for (const dpr of RATIOS) {
  test(`cover fills the square with both colours at ratio ${dpr}`, () => {
    const shape = rectShape(40, 40, 80, 80);
    const e = entry(shape, "cover", shapeBounds(shape));
    const { t } = draw(dpr, e, halves(false));
    expect(inkInside(t, e.bounds)).toBeGreaterThan(0);
    expect(inkOutside(t, e.bounds)).toBe(0);
    expect(pixelAt(t, 80, 80)[3]).toBeGreaterThan(0);
    const left = pixelAt(t, 50, 80);
    const right = pixelAt(t, 110, 80);
    expect(left[0]).toBeGreaterThan(200);
    expect(left[2]).toBeLessThan(50);
    expect(right[2]).toBeGreaterThan(200);
    expect(right[0]).toBeLessThan(50);
  });

  test(`contain letterboxes a tall target at ratio ${dpr}`, () => {
    const shape = rectShape(40, 40, 80, 120);
    const e = entry(shape, "contain", shapeBounds(shape));
    const { t } = draw(dpr, e, halves(false));
    expect(inkInside(t, e.bounds)).toBeGreaterThan(0);
    expect(inkOutside(t, e.bounds)).toBe(0);
    expect(pixelAt(t, 45, 45)[3]).toBe(0);
    expect(pixelAt(t, 80, 100)[3]).toBeGreaterThan(0);
    expect(pixelAt(t, 45, 100)[0]).toBeGreaterThan(200);
  });

  test(`auto contains a vector and covers a raster at ratio ${dpr}`, () => {
    const shape = rectShape(40, 40, 80, 120);
    const vector = draw(dpr, entry(shape, "auto", shapeBounds(shape)), halves(true));
    expect(pixelAt(vector.t, 45, 45)[3]).toBe(0);
    const raster = draw(dpr, entry(shape, "auto", shapeBounds(shape)), halves(false));
    expect(pixelAt(raster.t, 45, 45)[3]).toBeGreaterThan(0);
  });

  test(`an oval clips the image at ratio ${dpr}`, () => {
    const shape: Shape = { kind: "oval", x: 40, y: 40, width: 80, height: 80 };
    const e = entry(shape, "cover", shapeBounds(shape));
    const { t } = draw(dpr, e, halves(false));
    expect(inkInside(t, e.bounds)).toBeGreaterThan(0);
    expect(inkOutside(t, e.bounds)).toBe(0);
    expect(pixelAt(t, 42, 42)[3]).toBe(0);
    expect(pixelAt(t, 80, 80)[3]).toBeGreaterThan(0);
  });

  test(`a roundRect clips its corners at ratio ${dpr}`, () => {
    const shape: Shape = {
      kind: "roundRect",
      x: 40,
      y: 40,
      width: 80,
      height: 80,
      radii: [30, 30, 30, 30],
    };
    const e = entry(shape, "cover", shapeBounds(shape));
    const { t } = draw(dpr, e, halves(false));
    expect(inkOutside(t, e.bounds)).toBe(0);
    expect(pixelAt(t, 41, 41)[3]).toBe(0);
    expect(pixelAt(t, 80, 80)[3]).toBeGreaterThan(0);
  });

  test(`with no loading placeholder, a rect draws diagonals at ratio ${dpr}`, () => {
    const shape = rectShape(40, 40, 80, 80);
    // The 1px diagonals may overhang the shape by 0.5px, so the bounds are 1px larger.
    const e = entry(shape, "cover", { x: 39, y: 39, width: 82, height: 82 });
    const { t } = draw(dpr, e);
    expect(inkInside(t, e.bounds)).toBeGreaterThan(0);
    expect(inkOutside(t, e.bounds)).toBe(0);
    expect(pixelAt(t, 80, 80)[3]).toBeGreaterThan(0);
    expect(pixelAt(t, 80, 41)[3]).toBe(0);
  });

  test(`with no loading placeholder, an oval is outlined at ratio ${dpr}`, () => {
    const shape: Shape = { kind: "oval", x: 40, y: 40, width: 80, height: 80 };
    const e = entry(shape, "cover", { x: 39, y: 39, width: 82, height: 82 });
    const { t } = draw(dpr, e);
    expect(inkInside(t, e.bounds)).toBeGreaterThan(0);
    expect(inkOutside(t, e.bounds)).toBe(0);
    expect(pixelAt(t, 80, 80)[3]).toBe(0);
    expect(pixelAt(t, 80, 40)[3]).toBeGreaterThan(0);
  });

  test(`with no loading placeholder, the label is drawn and the font tracked at ratio ${dpr}`, () => {
    const shape = rectShape(40, 40, 120, 80);
    const font = { families: ["sans-serif"], size: 16, weight: 400, italic: false };
    const label = { y: 100, runs: [{ text: "Alt", x: 60, font, color: "#000000" as Color }] };
    const e = entry(shape, "cover", { x: 39, y: 39, width: 122, height: 82 }, label);
    const { t, env } = draw(dpr, e);
    expect(inkOutside(t, e.bounds)).toBe(0);
    // Left of the diagonals' crossing, text ink is black.
    let black = 0;
    const data = t.ctx.getImageData(0, 0, t.ctx.canvas.width, t.ctx.canvas.height).data;
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] ?? 0) > 200 && (data[i + 1] ?? 0) < 50) black++;
    }
    expect(black).toBeGreaterThan(0);
    expect(env.font).toEqual(font);
    expect(t.ctx.font).toContain("16px");
  });

  test(`the loading placeholder is drawn as the picture would be, never with diagonals or label, at ratio ${dpr}`, () => {
    const shape = rectShape(40, 40, 80, 80);
    const font = { families: ["sans-serif"], size: 16, weight: 400, italic: false };
    const label = { y: 100, runs: [{ text: "Alt", x: 60, font, color: "#000000" as Color }] };
    const e = entry(shape, "auto", shapeBounds(shape), label);
    // Mostly one colour, as a smoothed upscale samples it.
    const near = (pixel: readonly number[], rgb: readonly number[]) =>
      rgb.every((c, i) => Math.abs((pixel[i] ?? 0) - c) <= 8) && pixel[3] === 255;
    // A raster placeholder covers the square: both halves meet in the middle.
    const raster = draw(dpr, e, undefined, halves(false));
    expect(near(pixelAt(raster.t, 50, 80), [255, 0, 0])).toBe(true);
    expect(near(pixelAt(raster.t, 110, 80), [0, 0, 255])).toBe(true);
    expect(raster.env.font).toBeNull();
    // A vector one is contained, letterboxed top and bottom: the corner is empty.
    const vector = draw(dpr, e, undefined, halves(true));
    expect(near(pixelAt(vector.t, 50, 80), [255, 0, 0])).toBe(true);
    expect(pixelAt(vector.t, 80, 42)[3]).toBe(0);
    expect(inkOutside(vector.t, e.bounds)).toBe(0);
  });

  test(`a picture wins over the loading placeholder at ratio ${dpr}`, () => {
    const shape = rectShape(40, 40, 80, 80);
    const e = entry(shape, "cover", shapeBounds(shape));
    const blank = new OffscreenCanvas(4, 2);
    const { t } = draw(
      dpr,
      e,
      { source: blank, width: 4, height: 2, vector: false },
      halves(false),
    );
    expect(inkInside(t, e.bounds)).toBe(0);
  });

  test(`a decoded image leaves the font record consistent at ratio ${dpr}`, () => {
    const shape = rectShape(40, 40, 80, 80);
    const { t, env } = draw(dpr, entry(shape, "cover", shapeBounds(shape)), halves(false));
    expect(env.font).toBeNull();
    expect(t.ctx.globalAlpha).toBe(1);
  });
}

// A theme's placeholder (md2ui bdd919ab, ADR-406): painted in the picture's own clip,
// while the picture loads and once it failed, which the host tells by answering
// `loading` with the broken placeholder `images` answers too.
const close = (pixel: readonly number[], rgb: readonly number[]) =>
  rgb.every((c, i) => Math.abs((pixel[i] ?? 0) - c) <= 8) && pixel[3] === 255;
const standIns = (loading: string, broken: string) => ({
  loading: { paints: [{ kind: "color" as const, color: loading as Color }], label: null },
  broken: {
    paints: [
      { kind: "color" as const, color: broken as Color },
      { kind: "image" as const, src: "theme", fallbackSrc: null },
    ],
    label: null,
  },
});

for (const dpr of RATIOS) {
  test(`a theme's placeholder stands in while the picture loads at ratio ${dpr}`, () => {
    const shape: Shape = { kind: "oval", x: 40, y: 40, width: 80, height: 80 };
    const e = {
      ...entry(shape, "cover", shapeBounds(shape)),
      standIn: standIns("#e8f0feff", "#fde7e9ff"),
    };
    const { t } = draw(dpr, e, undefined, halves(false));
    expect(close(pixelAt(t, 80, 80), [0xe8, 0xf0, 0xfe])).toBe(true);
    // The circle's corner: outside the clip, never the fill.
    expect(pixelAt(t, 42, 42)[3]).toBe(0);
  });

  test(`a failed picture paints the theme's broken placeholder at ratio ${dpr}`, () => {
    const shape = rectShape(40, 40, 80, 80);
    const e = {
      ...entry(shape, "cover", shapeBounds(shape)),
      standIn: standIns("#e8f0feff", "#fde7e9ff"),
    };
    const broken = halves(false);
    const t = testCanvas(200, 200, dpr);
    // The broken placeholder in both lookups; the stand-in's image is a theme picture.
    drawImage(
      t.ctx,
      e,
      testEnv(dpr, { a: broken, theme: halves(false) }, new Map(), { a: broken }),
    );
    expect(close(pixelAt(t, 50, 80), [255, 0, 0])).toBe(true);
    expect(close(pixelAt(t, 110, 80), [0, 0, 255])).toBe(true);
    // Without the theme's image, its fill.
    const plain = testCanvas(200, 200, dpr);
    drawImage(plain.ctx, e, testEnv(dpr, { a: broken }, new Map(), { a: broken }));
    expect(close(pixelAt(plain, 80, 80), [0xfd, 0xe7, 0xe9])).toBe(true);
  });

  test(`a loaded picture never takes the theme's placeholder at ratio ${dpr}`, () => {
    const shape = rectShape(40, 40, 80, 80);
    const e = {
      ...entry(shape, "cover", shapeBounds(shape)),
      standIn: standIns("#e8f0feff", "#fde7e9ff"),
    };
    const { t } = draw(dpr, e, halves(false), halves(true));
    expect(close(pixelAt(t, 50, 80), [255, 0, 0])).toBe(true);
  });
}
