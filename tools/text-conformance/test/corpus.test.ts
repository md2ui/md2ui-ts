import { expect, test } from "vitest";
import { corpusTexts, indexRecords } from "../src/index.ts";
import { plainMetrics } from "../src/records.ts";

const face = "Inter 18pt|Inter18pt-Regular|400|5|0";
const bold = "Inter 18pt|Inter18pt-Bold|700|5|0";
const rec = (o: object) => JSON.stringify(o);
const leaf = (id: string, content: string, a: number, type = "text") =>
  rec({ q: "leaf_line_width", a, kv_role: null, node: { node_id: id, type, content } });

const jsonl = [
  rec({ q: "advance", face, size: 15, text: "Hello", a: 30.5 }),
  rec({ q: "advance", face, size: 15, text: "world", a: 32.25 }),
  rec({ q: "advance", face, size: 15, text: " ", a: 4 }),
  rec({ q: "advance", face: bold, size: 15, text: "Hello", a: 33 }),
  rec({ q: "metrics", face, size: 15, a: { fAscent: -14, fDescent: 4 } }),
  leaf("0.1", "Hello world", 66.75),
  rec({ q: "leaf_min_width", a: 32.25, kv_role: null, node: { node_id: "0.1", type: "text" } }),
  leaf("0.2", "**Hello** world", 70),
  leaf("0.3", "Hello world", 99),
  leaf("0.4", "## Hello", 33, "heading2"),
  leaf("0.5", "Hello", 1, "link"),
].join("\n");

test("a text is kept only when one recorded face reproduces md2ui's width", () => {
  const records = indexRecords(new Map([["doc", jsonl]]));
  expect(plainMetrics(records, face, 15)).toEqual({ ascent: 14, descent: 4 });
  const { texts, skipped } = corpusTexts(records);
  expect(texts).toEqual([
    {
      doc: "doc",
      text: "Hello world",
      font: { families: ["Inter 18pt"], size: 15, weight: 400, italic: false },
      width: 66.75,
      minWidth: 32.25,
    },
    {
      doc: "doc",
      text: "Hello",
      font: { families: ["Inter 18pt"], size: 15, weight: 700, italic: false },
      width: 33,
      minWidth: undefined,
    },
  ]);
  expect(Object.fromEntries(skipped)).toEqual({
    "inline markup (several spans)": 1,
    "no single face reproduces md2ui's width (glyph fallback or emoji runs)": 1,
    "not wrapping text (link)": 1,
  });
});
