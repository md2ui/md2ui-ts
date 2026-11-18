// Element-pass helpers at edges the corpus barely reaches. Expected values were read
// from md2ui's Python (_split_emoji_clusters, format(x, "g")), offsets turned into
// UTF-16 units.
import { expect, test } from "vitest";
import { splitEmojiClusters } from "../src/group/element-splits.ts";
import { formatG } from "../src/group/py/str.ts";

test("a flag pair, a skin tone and a variation selector each stay in their emoji", () => {
  // flag FR, thumbs up + medium skin tone, north-east arrow + VS16, star
  const run = "\u{1f1eb}\u{1f1f7}\u{1f44d}\u{1f3fd}\u{2197}\u{fe0f}\u{2b50}";
  expect(splitEmojiClusters(run)).toEqual([
    [0, 4],
    [4, 8],
    [8, 10],
    [10, 11],
  ]);
});

test("a slider value is spelled the way Python's {:g} spells it", () => {
  expect([65, 40.5, 33.333333333, 100, 0.00001, 1234567, 3].map(formatG)).toEqual([
    "65",
    "40.5",
    "33.3333",
    "100",
    "1e-05",
    "1.23457e+06",
    "3",
  ]);
});
