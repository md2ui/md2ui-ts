import { expect, test } from "vitest";
import type { DisplayList, FontSpec, Rect, TextRun } from "../src/index.ts";

const font: FontSpec = { families: ["Inter"], size: 16, weight: 400, italic: false };
const box: Rect = { x: 0, y: 0, width: 100, height: 40 };
const run: TextRun = { text: "Hello", x: 8, font, color: "#1a1a1aff" };

/** One of every entry and target type: the contract is plain data. */
const list: DisplayList = {
  version: 1,
  width: 320,
  height: 200,
  padding: { top: 24, right: 16, bottom: 24, left: 16 },
  centered: true,
  background: { paints: [{ kind: "color", color: "#ffffffff" }], shadows: [] },
  entries: [
    {
      type: "shadow",
      nodeId: "a",
      bounds: { x: -4, y: -2, width: 108, height: 50 },
      shape: { kind: "roundRect", radii: [8, 8, 8, 8], ...box },
      inner: false,
      offsetX: 0,
      offsetY: 2,
      color: "#00000033",
      radius: 8,
    },
    {
      type: "fill",
      nodeId: "a",
      bounds: box,
      shape: { kind: "roundRect", radii: [8, 8, 0, 0], ...box },
      paint: {
        kind: "linearGradient",
        start: [0, 0],
        end: [1, 0],
        stops: [
          { offset: 0, color: "#ff000000" },
          { offset: 1, color: "#ff0000ff" },
        ],
      },
      clip: { kind: "rect", ...box },
    },
    {
      type: "fill",
      nodeId: "a",
      bounds: box,
      shape: { kind: "rect", ...box },
      paint: { kind: "image", src: "https://example.com/a.png", fallbackSrc: null },
    },
    {
      type: "stroke",
      nodeId: "a",
      bounds: box,
      shape: { kind: "oval", ...box },
      width: 1,
      color: "#000000ff",
    },
    {
      type: "stroke",
      nodeId: "h",
      bounds: { x: 8.5, y: 18.5, width: 103, height: 23 },
      shape: { kind: "path", x: 10, y: 20, width: 100, height: 20, d: "M0 20L50 0L100 12.5" },
      width: 3,
      color: "#2060e0ff",
      join: "round",
      cap: "round",
    },
    {
      type: "shadow",
      nodeId: "g",
      bounds: box,
      shape: {
        kind: "path",
        ...box,
        d: "M8 0L97 0A8 8 0 0 1 100 4L100 36A8 8 0 0 1 97 40L8 40A8 8 0 0 1 0 32L0 8A8 8 0 0 1 8 0Z",
      },
      inner: true,
      offsetX: 1,
      offsetY: 1,
      color: "#1c1c1e19",
      radius: 0,
    },
    {
      type: "line",
      nodeId: "b",
      bounds: box,
      x0: 0,
      y0: 20,
      x1: 100,
      y1: 20,
      width: 1,
      color: "#ccccccff",
    },
    {
      type: "arc",
      nodeId: "c",
      bounds: box,
      cx: 50,
      cy: 20,
      radius: 16,
      startAngle: -90,
      sweepAngle: 216,
      width: 6,
      color: "#5b4fc4ff",
    },
    { type: "text", nodeId: "d", bounds: box, y: 28, runs: [run] },
    {
      type: "image",
      nodeId: "e",
      bounds: box,
      src: "https://example.com/b.svg",
      shape: { kind: "oval", ...box },
      fit: "auto",
      placeholder: { color: "#999999ff", label: { y: 24, runs: [run] } },
    },
    {
      type: "scroll",
      nodeId: "f",
      bounds: box,
      shape: { kind: "roundRect", radii: [6, 6, 6, 6], ...box },
      contentWidth: 240,
      contentHeight: 120,
      window: { x: 0, y: 12, width: 100, height: 16 },
      rest: 1,
      fade: "#f6f8faff",
      entries: [{ type: "text", nodeId: "f", bounds: box, y: 20, runs: [run] }],
    },
  ],
  targets: [
    { kind: "link", nodeId: "a", rect: box, ordinal: 0, card: true },
    { kind: "slider", nodeId: "g", rect: box, ordinal: 1, axis: "horizontal" },
    { kind: "copy", nodeId: "f", rect: box, text: "print(1)" },
  ],
  anchors: [{ id: "intro", y: 0 }],
};

test("a display list round-trips through JSON unchanged", () => {
  expect(JSON.parse(JSON.stringify(list))).toEqual(list);
});
