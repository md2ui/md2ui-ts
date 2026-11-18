// Fixture format 4 keys a font question by every field but its answer: a stretched
// font's question carries `scale_x`, an emoji run measured whole carries `shaped`. The
// replay finds each record only by its own question, never one in place of the other.
import type { FontSpec } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { fontAnswers, fontReplay } from "../src/font-replay.ts";
import type { Json } from "../src/json.ts";

const HELVETICA = "Helvetica|Helvetica|400|5|0";
const OPENMOJI = "OpenMoji|OpenMojiBlack|400|5|0";
const text = (families: readonly string[]): FontSpec => ({
  families,
  size: 16,
  weight: 400,
  italic: false,
});
const answers = (records: readonly Json[]) =>
  fontAnswers(records, { fontPaths: [], fonts: [], families: {}, variations: new Map() });

test("a stretched and a plain record of the same face, size and text resolve separately", () => {
  const plain = { q: "advance", face: HELVETICA, size: 16, text: "x", a: 8, n: 1 };
  const stretched = { ...plain, scale_x: 3.5992970123022845, a: 28.8 };
  expect(answers([stretched, plain]).advance("x", text(["Helvetica"]))).toBe(8);
  expect(answers([plain, stretched]).advance("x", text(["Helvetica"]))).toBe(8);
  // The font replay never asks a stretched question, so a stretched record alone answers nothing.
  expect(() => answers([stretched]).advance("x", text(["Helvetica"]))).toThrow(
    /no recorded advance/u,
  );
});

const PERSON = 0x1f468;
const LAPTOP = 0x1f4bb;
const glyphs = [PERSON, LAPTOP].map((cp) => ({ q: "has_glyph", face: OPENMOJI, cp, a: true }));
const SEQUENCE = "\u{1F468}‍\u{1F4BB}";
const plainRun = { q: "advance", face: OPENMOJI, size: 16, text: SEQUENCE, a: 41.25 };
const shapedRun = { ...plainRun, shaped: true, a: 20.625 };

test("an emoji run holding a sequence is answered only by its shaped record", () => {
  const emoji = text(["OpenMoji", "Helvetica"]);
  expect(answers([...glyphs, plainRun, shapedRun]).advance(SEQUENCE, emoji)).toBe(20.625);
  expect(() => answers([...glyphs, plainRun]).advance(SEQUENCE, emoji)).toThrow(
    /no recorded shaped advance/u,
  );
});

test("a shaped record answers no plain question", () => {
  const emojiFaceOnly = text(["OpenMoji"]);
  expect(answers([...glyphs, plainRun, shapedRun]).advance(SEQUENCE, emojiFaceOnly)).toBe(41.25);
  expect(() => answers([...glyphs, shapedRun]).advance(SEQUENCE, emojiFaceOnly)).toThrow(
    /no recorded advance/u,
  );
});

const NOTO = "Noto Emoji|NotoEmoji-Medium|500|5|0";
const HEART = 0x2764;
// md2ui's selector probe, asked at Skia's default size 12 (`_selector_draws_box`).
const probe = (face: string, withSelector: number, without: number): Json[] => [
  { q: "has_glyph", face, cp: HEART, a: true },
  { q: "advance", face, size: 12, text: "❤️", a: withSelector },
  { q: "advance", face, size: 12, text: "❤", a: without },
];

test("a variation selector a face draws as a box is left out of the run", () => {
  const records = [...probe(NOTO, 21.09375, 15.234375)];
  records.push({ q: "advance", face: NOTO, size: 16, text: "❤", a: 20.3125 });
  expect(answers(records).advance("❤️", text(["Noto Emoji", "Helvetica"]))).toBe(20.3125);
});

test("a variation selector a face gives its own empty glyph stays in the run", () => {
  const records = [...probe(OPENMOJI, 15.234375, 15.234375)];
  records.push({ q: "advance", face: OPENMOJI, size: 16, text: "❤️", a: 20.625 });
  expect(answers(records).advance("❤️", text(["OpenMoji", "Helvetica"]))).toBe(20.625);
});

// C3 `InkBounds`: md2ui's recorded ink box `[advance, left, top, right,
// bottom]` answers all four fields; a text with no ink answers the ascent, and 0, 0.
test("the replayed ink is md2ui's recorded box, horizontal extent included", () => {
  const ink = { q: "ink", face: HELVETICA, size: 16, text: "Hx", a: [21.5, -1, -12, 22.25, 2] };
  const blank = { q: "ink", face: HELVETICA, size: 16, text: " ", a: [4.5, 0, 0, 0, 0] };
  const metrics = { q: "metrics", face: HELVETICA, size: 16, a: { fAscent: -14, fDescent: 4 } };
  const m = fontReplay(answers([ink, blank, metrics]));
  const font = text(["Helvetica"]);
  expect(m.inkBounds("Hx", font)).toEqual({ top: 12, height: 14, left: -1, width: 23.25 });
  expect(m.inkBounds(" ", font)).toEqual({ top: 14, height: 14, left: 0, width: 0 });
});

// A ring label fits by its glyph outlines (`render_ring_text._outline_ink`),
// recorded as `outline`; the port asks C3 `inkBounds` for it, as for a marker's ink.
test("a ring label's ink is md2ui's recorded outline, and its advance too", () => {
  const outline = {
    q: "outline",
    face: HELVETICA,
    size: 13,
    text: "Live data",
    a: [54.86279296875, 1.09814453125, -9.70556640625, 53.904296875, 0.15234375],
  };
  const m = fontReplay(answers([outline]));
  const font = { ...text(["Helvetica"]), size: 13 };
  expect(m.inkBounds("Live data", font)).toEqual({
    top: 9.70556640625,
    height: 9.70556640625 + 0.15234375,
    left: 1.09814453125,
    width: 53.904296875 - 1.09814453125,
  });
  expect(m.advance("Live data", font)).toBe(54.86279296875);
  // The same text recorded both ways, differently, cannot be told apart.
  const ink = { ...outline, q: "ink", a: [54.86279296875, 1, -10, 54, 1] };
  expect(() => fontReplay(answers([outline, ink])).inkBounds("Live data", font)).toThrow(
    /both an ink and an outline/u,
  );
});

// md2ui measures a ring's text whole in its one face (`render_ring_text`) and asks no glyph
// of it, so a non-ASCII text recorded whole answers its advance with no glyph records.
test("a non-ASCII text md2ui recorded whole is answered without its glyphs", () => {
  const ink = { q: "ink", face: HELVETICA, size: 16, text: "ab…", a: [30, 0, -12, 30, 2] };
  expect(answers([ink]).advance("ab…", text(["Helvetica"]))).toBe(30);
  expect(() => answers([ink]).advance("ac…", text(["Helvetica"]))).toThrow(/has_glyph/u);
});

// md2ui measures a code line as its highlighted runs (api-reference): in a
// face that is not monospaced md2ui's answer for the line is the sum of the runs that spell it.
test("a text md2ui measured only as runs is answered by their sum, when it is one sum", () => {
  const run = (t: string, a: number): Json => ({
    q: "advance",
    face: HELVETICA,
    size: 16,
    text: t,
    a,
  });
  const font = text(["Helvetica"]);
  expect(answers([run("$ ", 10.5), run("gem", 20.25)]).advance("$ gem", font)).toBe(30.75);
  // Two spellings that sum differently prove no answer.
  const both = [run("$ ", 10.5), run("gem", 20.25), run("$", 6), run(" gem", 25)];
  expect(() => answers(both).advance("$ gem", font)).toThrow(/no recorded advance/u);
  // Runs that do not spell the whole text prove none either.
  expect(() => answers([run("$ ", 10.5)]).advance("$ gem", font)).toThrow(/no recorded advance/u);
});
