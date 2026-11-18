// `float32-height`: md2ui rounds a marker's ink height to float32 (Skia's `Rect.height()`),
// the port keeps the browser's double. The numbers are md2ui's `spotify-artist`
// marker "3" in Google Sans 16 (box 19), where the class was found.
import { expect, test } from "vitest";
import type { Difference } from "../src/diff.ts";
import { float32Heights } from "../src/float32-height.ts";
import type { Json } from "../src/json.ts";

const TOP = -11.711999893188477;
const BOTTOM = 0.25600001215934753;
/** The outline's height in doubles, the port's: 11.967999905347824. */
const PORT = BOTTOM - TOP;
/** Skia's float32 `Rect.height()`, md2ui's: 11.967999458312988. */
const MD2UI = Math.fround(PORT);

const records: Json[] = [
  {
    q: "outline",
    face: "Google Sans|GoogleSans-Regular|400|5|0",
    size: 16,
    text: "3",
    a: [8.5, 0.6, TOP, 7.8, BOTTOM],
  },
];
const scene = (height: number, y: number): Json => ({
  boxes: [{ content_id: null, x: 8, y, width: 8.5, height }],
});
const differs = (field: string, expected: number, actual: number): Difference => ({
  class: "value",
  path: "boxes[0]",
  field,
  expected: String(expected),
  actual: String(actual),
});

test("the found case: md2ui's rounding of the port's ink height", () => {
  expect(PORT).toBe(11.967999905347824);
  expect(MD2UI).toBe(11.967999458312988);
});

test("a height md2ui rounded to float32, and the y it moved, are classified", () => {
  const y = 775.2307829856873;
  const shifted = y - (MD2UI - PORT) / 2;
  const height = differs("height", MD2UI, PORT);
  const top = differs("y", y, shifted);
  const proved = float32Heights(scene(MD2UI, y), scene(PORT, shifted), records, [height, top]);
  expect([...proved.keys()]).toEqual([height, top]);
  expect([...proved.values()].map((d) => d.class)).toEqual(["float32-height", "float32-height"]);
});

test("a height off by more than the float32 rounding still fails", () => {
  const port = PORT + 1e-6;
  const height = differs("height", MD2UI, port);
  expect(float32Heights(scene(MD2UI, 0), scene(port, 0), records, [height]).size).toBe(0);
});

test("a y moved further than the height's rounding still fails", () => {
  const moved = differs("y", 10, 10 + 2 * (PORT - MD2UI));
  const proved = float32Heights(scene(MD2UI, 10), scene(PORT, 10.1), records, [moved]);
  expect(proved.size).toBe(0);
});

test("a float32 rounding of a height md2ui never recorded as an outline still fails", () => {
  const port = 11.712000340223312;
  const height = differs("height", Math.fround(port), port);
  const proved = float32Heights(scene(Math.fround(port), 0), scene(port, 0), records, [height]);
  expect(proved.size).toBe(0);
});

test("any other field of the box still fails", () => {
  const width = differs("width", 8.5, 8.500000001);
  expect(float32Heights(scene(MD2UI, 0), scene(PORT, 0), records, [width]).size).toBe(0);
});
