// Feed slots (md2ui ADR-206, `grouper_feed_slots`): a `[words](feed:name)` groups as its
// words, is never a link or a target, and the leaf drawing it carries `feed_slots`, the
// range of its words. Expected values are md2ui's own (`tests/feed_slots_tests.py`, the
// grouping and target cases), and, for the placement cases md2ui's tests do not pin,
// what md2ui gives for the same documents.
import type { GroupingNode } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { actionTargets } from "../src/actions/targets.ts";
import { respell } from "../src/group/feed-slots.ts";
import { groupMarkdown } from "../src/group/grouper.ts";
import { RegexKit } from "../src/group/py/re.ts";

const kit = new RegexKit();

// md2ui: TIERS. Each spelling with a slot, and the same line with only its words.
const TIERS: Record<string, [string, string]> = {
  "key line": ["Arrives: [3:53 PM](feed:arrives)", "Arrives: 3:53 PM"],
  stat: ["_Arrives_\n___[3:53 PM](feed:arrives)___", "_Arrives_\n___3:53 PM___"],
  "colon stat": ["_Arrives_ : ___[3:53 PM](feed:arrives)___", "_Arrives_ : ___3:53 PM___"],
  bold: ["**[Ready soon](feed:a)**", "**Ready soon**"],
  caption: ["_[Ready soon](feed:a)_", "_Ready soon_"],
  struck: ["~~[Ready soon](feed:a)~~", "~~Ready soon~~"],
  hero: ["___[3:53 PM](feed:a)___", "___3:53 PM___"],
  sentence: [
    "Your order arrives at **[3:53 PM](feed:arrives)** today.",
    "Your order arrives at **3:53 PM** today.",
  ],
  chip: ["[`Preparing`](feed:status)", "`Preparing`"],
  "chip key": ["Status: [`Preparing`](feed:status)", "Status: `Preparing`"],
  "chip colon": ["[`Preparing`](feed:status) : _Status_", "`Preparing` : _Status_"],
  "chip spring": ["Order BS-1043 ... [`Preparing`](feed:status)", "Order BS-1043 ... `Preparing`"],
};

// md2ui: ORDER
const ORDER =
  "## Order BS-1043\n\n" +
  "Status: [`Preparing`](feed:status)\n\n" +
  "_Arrives_\n___[3:53 PM](feed:arrives)___\n\n" +
  "Your courier is **[Sam](feed:courier)** today.\n\n" +
  "[Track · Preparing](agent:track?id=BS-1043&md2ui.feed=track) | " +
  "[Cancel](agent:cancel?id=BS-1043)\n";

/** `node` without its slot annotations: what the plain twin groups to. */
function bare(node: GroupingNode): GroupingNode {
  const { feed_slots: _, ...rest } = node;
  return { ...rest, children: node.children.map(bare) };
}

/** Every placed slot, in document order, with the words it covers. */
function placed(node: GroupingNode): [string, string, string][] {
  const own = (node.feed_slots ?? []).map((s): [string, string, string] => [
    s.name,
    s.kind,
    node.content.slice(s.start, s.end),
  ]);
  return [...own, ...node.children.flatMap(placed)];
}

// md2ui: test_a_slot_groups_as_its_words
test("a slot groups as its words, in every tier", () => {
  for (const [name, [slotted, plain]] of Object.entries(TIERS)) {
    const page = (line: string) => `## Order\n\n${line}\n`;
    expect(bare(groupMarkdown(page(slotted), kit)), name).toEqual(groupMarkdown(page(plain), kit));
  }
});

// md2ui: test_a_slot_is_no_target
test("a slot is no target; a fed label stays its button", () => {
  const targets = actionTargets(groupMarkdown(ORDER, kit), kit);
  expect(targets.map((t) => t.action?.label)).toEqual(["Track · Preparing", "Cancel"]);
  expect(targets.some((t) => (t.action?.href ?? "").slice(0, 5) === "feed:")).toBe(false);
  // `md2ui.feed` is a hint, split off the button's destination like every `md2ui.*` param.
  expect(targets[0]?.action?.hints).toEqual([["feed", "track"]]);
});

// md2ui: test_the_node_drawing_a_slot_carries_its_words
test("the node drawing a slot carries its words", () => {
  expect(placed(groupMarkdown(ORDER, kit))).toEqual([
    ["status", "chip", "Preparing"],
    ["arrives", "text", "3:53 PM"],
    ["courier", "text", "Sam"],
    ["track", "label", "Track · Preparing"],
  ]);
});

// md2ui: test_feed_slots_names_the_span_of_each_slots_words (the scan, read through the
// respell: md2ui's `feed_slots` shell helper is not ported)
test("code, comments and escapes hold no slot; the scheme is case-insensitive", () => {
  const quiet =
    "`[a](feed:a)` \\[b](feed:b) <!-- [c](feed:c) -->\n\n```\n[d](feed:d)\n```\n\n[E](FEED:e)\n";
  const [text, respelled] = respell(kit, quiet);
  expect(respelled.slots.map((s) => s.name)).toEqual(["e"]);
  expect(text).toBe(quiet.replace("[E](FEED:e)", "E"));
  // In a link written inside another's label, the inner one is the link.
  expect(respell(kit, "[Track · [Preparing](feed:s)](agent:t)")[0]).toBe(
    "[Track · Preparing](agent:t)",
  );
});

// md2ui: test_a_page_without_slots_is_left_as_written
test("a page without slots is left as written", () => {
  const text = "## A\n\n[Go](/g) and `[x](feed:a)`\n";
  expect(respell(kit, text)[0]).toBe(text);
  expect(respell(kit, "## A\n\nplain\n")[0]).toBe("## A\n\nplain\n");
});

// md2ui `stamp`: whole words, after as many drawn copies as lie between two slots.
// Expected: md2ui on the same documents.
test("a slot's words are placed as whole words after the copies before it", () => {
  const spans = (n: GroupingNode): [string, number, number][] => [
    ...(n.feed_slots ?? []).map((s): [string, number, number] => [s.name, s.start, s.end]),
    ...n.children.flatMap(spans),
  ];
  const at = (doc: string) => spans(groupMarkdown(doc, kit));
  // `x` is not found inside `Text`.
  expect(at("## A\n\nText is x: [x](feed:a)\n")).toEqual([["a", 11, 12]]);
  expect(at("## A\n\nSam met Sam, then [Sam](feed:c) left.\n")).toEqual([["c", 18, 21]]);
  // A code span's and a link label's words are drawn copies; a destination is not.
  expect(at("## A\n\nAt [5 PM](feed:a) or `5 PM` or [5 PM](/x) then [5 PM](feed:b).\n")).toEqual([
    ["a", 3, 7],
    ["b", 37, 41],
  ]);
  // Code and comments are not counted; a slot in them is not read.
  expect(
    at(
      "## A\n\n```\n[d](feed:d)\n```\n\nThen [Go](feed:e) and <!-- [c](feed:c) --> [Go](feed:f)\n",
    ),
  ).toEqual([
    ["e", 5, 7],
    ["f", 13, 15],
  ]);
  // An escaped slot's words are found unescaped; one in a picture's alt is drawn nowhere.
  expect(at("## A\n\nArrives: [3\\:53 PM](feed:a)\n")).toEqual([["a", 9, 16]]);
  expect(at("## A\n\n![a [x](feed:b)](https://e.com/i.png)\n\nText.\n")).toEqual([]);
});
