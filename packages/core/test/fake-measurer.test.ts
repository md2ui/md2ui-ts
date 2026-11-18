import type { FontSpec, TextLine, TextSpan } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { createFakeMeasurer } from "../src/text/fake-measurer.ts";

const f: FontSpec = { families: ["Fake"], size: 10, weight: 400, italic: false };
const bold: FontSpec = { ...f, weight: 700 };
const m = createFakeMeasurer();
const one = (text: string) => m.prepare([{ text, font: f }]);
const texts = (lines: readonly TextLine[]) =>
  lines.map((l) => l.fragments.map((x) => x.text).join(" "));

test("advance counts spaces, weight and emoji", () => {
  expect(m.advance("ab c", f)).toBe(17.5);
  expect(m.advance("ab c", bold)).toBeCloseTo(19.25);
  expect(m.advance("ab c", { ...f, italic: true })).toBe(17.5);
  expect(m.advance("🙂", f)).toBe(10);
});

test("fontMetrics and inkBounds", () => {
  expect(m.fontMetrics(f)).toEqual({ ascent: 8, descent: 2 });
  expect(m.inkBounds("ab", f)).toEqual({ top: 7, height: 7, left: 0, width: 10 });
  expect(m.inkBounds("  ", f)).toEqual({ top: 8, height: 8, left: 0, width: 0 });
  // The ink spans the advance the measurer was given.
  const replayed = createFakeMeasurer(() => 33);
  expect(replayed.inkBounds("ab", f)).toEqual({ top: 7, height: 7, left: 0, width: 33 });
});

test("one-line width and min width of a single span", () => {
  const p = one("Open Settings now");
  expect(p.lineWidth()).toBe(80);
  expect(p.minWidth()).toBe(40);
});

test("a glued span change is one unit and has a space only where written", () => {
  const spans: TextSpan[] = [
    { text: "Open ", font: f },
    { text: "Settings", font: bold },
    { text: ".", font: f },
  ];
  const p = m.prepare(spans);
  expect(p.minWidth()).toBeCloseTo(m.advance("Settings", bold) + 5);
  expect(p.lineWidth()).toBeCloseTo(20 + 2.75 + m.advance("Settings", bold) + 5);
});

test("wrapping into 1, 2 and 3 lines", () => {
  const p = one("Open Settings now");
  expect(p.lineCount(80)).toBe(1);
  expect(texts(p.lines(80))).toEqual(["Open Settings now"]);
  expect(p.lineCount(62.5)).toBe(2);
  expect(texts(p.lines(62.5))).toEqual(["Open Settings", "now"]);
  expect(p.lines(62.5).map((l) => l.width)).toEqual([62.5, 15]);
  expect(texts(p.lines(62.4))).toEqual(["Open", "Settings now"]);
  expect(p.lineCount(40)).toBe(3);
  expect(texts(p.lines(40))).toEqual(["Open", "Settings", "now"]);
});

test("a unit wider than maxWidth sits alone and overflows", () => {
  const lines = one("Open Settings now").lines(30);
  expect(texts(lines)).toEqual(["Open", "Settings", "now"]);
  expect(lines[1]?.width).toBe(40);
});

test("no line is wider than maxWidth from minWidth upward", () => {
  const p = m.prepare([
    { text: "The quick brown ", font: f },
    { text: "fox", font: bold },
    { text: ", jumps over the lazy dog 🙂 again", font: f },
  ]);
  for (let w = p.minWidth(); w <= p.lineWidth() + 10; w += 1.5) {
    for (const line of p.lines(w)) expect(line.width).toBeLessThanOrEqual(w);
  }
});

test("a hard break starts a new line at every width", () => {
  const p = one("one two\u2028three");
  expect(p.lineCount(Number.POSITIVE_INFINITY)).toBe(2);
  expect(texts(p.lines(1000))).toEqual(["one two", "three"]);
  expect(p.lineWidth()).toBe(32.5);
});

test("fragments carry span, x and width", () => {
  const gap = m.prepare([
    { text: "ab ", font: f },
    { text: "cd", font: bold },
  ]);
  const [g] = gap.lines(1000);
  expect(g?.fragments).toEqual([
    { span: 0, text: "ab", x: 0, width: 10 },
    { span: 1, text: "cd", x: 12.75, width: expect.closeTo(11) },
  ]);
  expect(g?.width).toBeCloseTo(23.75);
  const glued = m.prepare([
    { text: "ab", font: f },
    { text: "cd", font: bold },
  ]);
  expect(glued.lines(1000)[0]?.fragments.map((x) => x.x)).toEqual([0, 10]);
  expect(one("ab cd").lines(1000)[0]?.fragments).toEqual([
    { span: 0, text: "ab cd", x: 0, width: 22.5 },
  ]);
});

test("empty text takes no lines", () => {
  for (const p of [m.prepare([]), m.prepare([{ text: "", font: f }]), one("   ")]) {
    expect(p.lineCount(100)).toBe(0);
    expect(p.lines(100)).toEqual([]);
    expect(p.lineWidth()).toBe(0);
    expect(p.minWidth()).toBe(0);
  }
});

test("two measurers answer identically", () => {
  const a = createFakeMeasurer().prepare([{ text: "Open Settings now", font: bold }]);
  const b = createFakeMeasurer().prepare([{ text: "Open Settings now", font: bold }]);
  expect(a.lines(50)).toEqual(b.lines(50));
  expect(a.lineWidth()).toBe(b.lineWidth());
});

test("an injected advance replaces the per-class widths in every answer that sums them", () => {
  const widths: Record<string, number> = { one: 3, two: 5, " ": 1 };
  const m = createFakeMeasurer((text) => widths[text] ?? 0);
  const p = m.prepare([{ text: "one two", font: f }]);
  expect(p.lineWidth()).toBe(9);
  expect(p.minWidth()).toBe(5);
  expect(p.lines(8).map((l) => l.width)).toEqual([3, 5]);
  expect(m.advance("two", f)).toBe(5);
});
