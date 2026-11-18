// Expected values come from md2ui's `DataPointDetector.detect_pipeline` (its offsets are
// code points; here they are UTF-16 indices, so each astral emoji counts two).
import { expect, test } from "vitest";
import { detectDataPoints } from "../src/group/detect/detector.ts";
import { groupMarkdown } from "../src/group/grouper.ts";

test("emphasis underscores are blanked for the scan but offsets keep indexing the text", () => {
  expect(detectDataPoints("___75°___")).toEqual([
    {
      type: "measurement",
      matched: "75°",
      value: { value: 75, unit: "", measurement_type: "temperature" },
      start: 3,
      end: 6,
      is_approximate: false,
    },
  ]);
  expect(detectDataPoints("snake_5 kg_case")).toEqual([]);
});

test("overlapping matches keep the longest: the trailing symbol wins the whole amount", () => {
  expect(detectDataPoints("$2.36 €")).toEqual([
    {
      type: "currency",
      matched: "$2.36 €",
      value: { amount: 2.36, currency: "EUR" },
      start: 0,
      end: 7,
      is_approximate: false,
    },
  ]);
});

test("offsets are UTF-16 indices; an emoji carries its character and code point", () => {
  expect(detectDataPoints("😀 5 kg")).toEqual([
    {
      type: "emoji",
      matched: "😀",
      value: {
        emojis: [{ char: "😀", codepoint: "U+1F600" }],
        count: 1,
        text: "😀",
      },
      start: 0,
      end: 2,
      is_approximate: false,
    },
    {
      type: "quantity",
      matched: "5 kg",
      value: { value: 5, unit: "kg" },
      start: 3,
      end: 7,
      is_approximate: false,
    },
  ]);
});

test("a date is stored as md2ui's ISO string, a datetime beside its date", () => {
  expect(detectDataPoints("March 5, 2026 at 4:45 PM")[0]?.value).toEqual({
    datetime: "2026-03-05T16:45:00",
    date: "2026-03-05T00:00:00",
    hour: 16,
    minute: 45,
    second: 0,
    subtype: "datetime",
    has_year: true,
  });
});

test("a link keeps the emoji of its label", () => {
  const [link] = detectDataPoints("[🎉 party](http://x.com)");
  expect(link).toMatchObject({ type: "link", start: 0, end: 24 });
  expect(link?.value).toMatchObject({
    text: "🎉 party",
    emojis: [{ char: "🎉", codepoint: "U+1F389" }],
  });
});

test("an impossible date is no data point", () => {
  expect(detectDataPoints("2023-02-29")).toEqual([]);
});

test("repeated dots before a trailing symbol are an amount only as thousands", () => {
  // Three dot groups cannot be an amount: the date or version reads as itself and
  // the € stays text.
  expect(detectDataPoints("25.12.2021 €")).toEqual([
    {
      type: "date",
      matched: "25.12.2021",
      value: { datetime: "2021-12-25T00:00:00", subtype: "full", has_year: true },
      start: 0,
      end: 10,
      is_approximate: false,
    },
  ]);
  expect(detectDataPoints("1.2.3 €")).toMatchObject([
    { type: "version", matched: "1.2.3", start: 0, end: 5 },
  ]);
  expect(detectDataPoints("1.234.567 €")).toMatchObject([
    {
      type: "currency",
      matched: "1.234.567 €",
      value: { amount: 1234567, currency: "EUR" },
      start: 0,
      end: 11,
    },
  ]);
});

test("a bare hour with a year is minute 0", () => {
  expect(detectDataPoints("February 4, 2026, 3 PM")).toMatchObject([
    {
      type: "date",
      matched: "February 4, 2026, 3 PM",
      value: { datetime: "2026-02-04T15:00:00", hour: 15, minute: 0, has_year: true },
    },
  ]);
});

test("lines holding a dotted non-amount or a bare hour group", () => {
  for (const line of ["Price: 25.12.2021 €", "Build 1.2.3 €", "Meeting: February 4, 2026, 3 PM"])
    expect(groupMarkdown(line).children.length).toBeGreaterThan(0);
});
