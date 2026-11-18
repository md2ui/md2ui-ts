// Offsets cross the fixture boundary here and nowhere else (ADR-002). md2ui counts
// string offsets in code points (Python `str` indices); a JavaScript string counts
// UTF-16 units. Every offset a fixture holds is converted when it is read, so a stage
// and the comparison only ever see UTF-16 offsets.
import { isArray, isObject, type Json, type JsonObject } from "./json.ts";

const SURROGATE = /[\uD800-\uDFFF]/;

/**
 * The UTF-16 offset of code-point offset `cp` in `text`. Past the end of `text`, each
 * further code point counts one unit: md2ui keeps some data-point offsets from before
 * a split shortened the node's content, and those are converted as far as the
 * content allows.
 */
export function utf16Offset(text: string, cp: number): number {
  if (!SURROGATE.test(text)) return cp;
  let units = 0;
  let seen = 0;
  for (const char of text) {
    if (seen === cp) return units;
    units += char.length;
    seen += 1;
  }
  return units + (cp - seen);
}

/** Data points (`{start, end, …}`) found in `text`, with their offsets in UTF-16 units. */
export function dataPointsToUtf16(points: Json, text: string): Json {
  if (!isArray(points) || !SURROGATE.test(text)) return points;
  return points.map((point) => {
    if (!isObject(point)) return point;
    const { start, end } = point;
    return {
      ...point,
      ...(typeof start === "number" ? { start: utf16Offset(text, start) } : {}),
      ...(typeof end === "number" ? { end: utf16Offset(text, end) } : {}),
    };
  });
}

/** A grouping tree (C1) with every node's `data_points` and `feed_slots` offsets in UTF-16 units. */
export function treeToUtf16(node: Json): Json {
  if (!isObject(node)) return node;
  const { children, content, data_points: points, feed_slots: slots } = node;
  const converted: { [key: string]: Json } = { ...node };
  if (points !== undefined && typeof content === "string") {
    converted["data_points"] = dataPointsToUtf16(points, content);
  }
  // A feed slot is a `{start, end, …}` range of the content too (md2ui ADR-206).
  if (slots !== undefined && typeof content === "string") {
    converted["feed_slots"] = dataPointsToUtf16(slots, content);
  }
  if (isArray(children)) converted["children"] = children.map(treeToUtf16);
  return converted satisfies JsonObject;
}
