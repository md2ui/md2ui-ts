// Fixture format 4: a question is keyed by every field but its answer, so a stretched
// (`scale_x`) or shaped record never answers the plain question of the same text.
import { expect, test } from "vitest";
import { indexRecords, plainAdvance, recordsSource } from "../src/index.ts";

const face = "Helvetica|Helvetica|400|5|0";
const rec = (o: object) => JSON.stringify(o);
const plain = { q: "advance", face, size: 16, text: " ", a: 4.4453125, n: 3 };
const stretched = { ...plain, scale_x: 3.5992970123022845, a: 16, n: 45 };
const shaped = { q: "advance", face, size: 16, text: "1️⃣", shaped: true, a: 9 };

test("a stretched and a plain record of the same face, size and text resolve separately", () => {
  for (const order of [
    [plain, stretched],
    [stretched, plain],
  ]) {
    const records = indexRecords(new Map([["doc", order.map(rec).join("\n")]]));
    expect(plainAdvance(records, face, 16, " ")).toBe(4.4453125);
    expect(records.advance.size).toBe(2);
  }
  const alone = indexRecords(new Map([["doc", rec(stretched)]]));
  expect(plainAdvance(alone, face, 16, " ")).toBeUndefined();
});

test("a shaped record answers no plain question", () => {
  const records = indexRecords(new Map([["doc", rec(shaped)]]));
  expect(plainAdvance(records, face, 16, "1️⃣")).toBeUndefined();
});

test("the replay asks md2ui the text as authored, not as the canvas is handed it", () => {
  // weather/minimalist: `🌡️` in OpenMoji, which the Pretext measurer
  // hands the canvas with VS15 (`canvasText`).
  const openmoji = "OpenMoji|OpenMojiBlack|400|5|0";
  const thermometer = { q: "advance", face: openmoji, size: 13, text: "🌡️", a: 16.7578125 };
  const source = recordsSource(indexRecords(new Map([["doc", rec(thermometer)]])));
  expect(source("400 13px OpenMoji", "🌡︎").width).toBe(16.7578125);
});
