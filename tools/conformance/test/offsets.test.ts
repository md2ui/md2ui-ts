import { describe, expect, test } from "vitest";
import { treeToUtf16, utf16Offset } from "../src/offsets.ts";

describe("utf16Offset", () => {
  test("counts an astral character as two UTF-16 units", () => {
    expect(utf16Offset("🙂ab", 0)).toBe(0);
    expect(utf16Offset("🙂ab", 1)).toBe(2);
    expect(utf16Offset("🙂ab", 3)).toBe(4);
  });

  test("is the identity on BMP-only text", () => {
    expect(utf16Offset("héllo", 3)).toBe(3);
  });
});

describe("treeToUtf16", () => {
  test("converts data point offsets on nested nodes and leaves other fields alone", () => {
    const point = { type: "percent", start: 2, end: 4 };
    const tree = {
      type: "root",
      content: "",
      children: [
        {
          type: "text",
          content: "🙂 5%",
          flag: true,
          data_points: [point],
          children: [],
        },
      ],
    };
    expect(treeToUtf16(tree)).toEqual({
      type: "root",
      content: "",
      children: [
        {
          type: "text",
          content: "🙂 5%",
          flag: true,
          data_points: [{ type: "percent", start: 3, end: 5 }],
          children: [],
        },
      ],
    });
  });
  test("converts a feed slot's range as a data point's", () => {
    const tree = {
      content: "🙂 at 3:53 PM",
      feed_slots: [{ name: "arrives", kind: "text", start: 5, end: 12 }],
      children: [],
    };
    expect(treeToUtf16(tree)).toEqual({
      ...tree,
      feed_slots: [{ name: "arrives", kind: "text", start: 6, end: 13 }],
    });
  });
});
