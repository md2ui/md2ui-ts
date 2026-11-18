// Grouper rules at edges the corpus reaches once or not at all: a chip-only line is one kind, a
// label over a split value line is a pair, an emoji sequence is one badge, `~~` mutes a badge
// or a chip, and `_` is the small button ladder. Expected values are md2ui's own tests; these
// run without fixtures.
import { expect, test } from "vitest";
import { groupDocument } from "../src/group/grouper.ts";
import { kindSignatures } from "../src/group/kinds.ts";
import { classifyLinkContent } from "../src/group/link-content.ts";
import type { GroupNode } from "../src/group/node.ts";
import { preprocess } from "../src/group/preprocess.ts";
import { RegexKit } from "../src/group/py/re.ts";

const kit = new RegexKit();

function nodes(root: GroupNode): GroupNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

const leaves = (root: GroupNode): GroupNode[] =>
  nodes(root).filter((n) => n.children.length === 0 && n !== root);

// md2ui grouper_kind_tokens_tests: the `###` sections are the cards.
const cards = (root: GroupNode): GroupNode[] =>
  nodes(root).filter((n) => n.heading_group && n.heading_level === 3);

// md2ui grouper_kind_tokens_tests: test_any_chip_count_runs_as_one
test("a card's chip count never breaks its run", () => {
  const tasks = cards(
    groupDocument(
      "## Tasks\n\n" +
        "### Ship the release\n_Owner: Ana_\n`Open` `Urgent`\n\n" +
        "### Update the docs\n_Owner: Ben_\n\n" +
        "### Fix the login bug\n_Owner: Cleo_\n`Open` `Urgent` `Backend` `Blocked` `Q4`\n\n" +
        "### Review the budget\n_Owner: Dev_\n`Done`\n\n" +
        "### Plan the offsite\n_Owner: Eve_\n`Open` `Urgent`\n",
    ),
  );
  expect(tasks).toHaveLength(5);
  expect(tasks[0]?.run_key).not.toBeNull();
  expect(new Set(tasks.map((c) => c.run_key)).size).toBe(1);
});

// md2ui grouper_kind_tokens_tests: test_one_chip_runs_with_two
test("one chip runs with two", () => {
  const songs = cards(
    groupDocument(
      "## Songs\n\n" +
        "### Under Pressure\n_Queen, David Bowie_\n`Song` `Saved`\n\n" +
        "### Bitter Sweet Symphony\n_The Verve_\n`Song` `Saved`\n\n" +
        "### Just A Girl\n_No Doubt_\n`Song`\n",
    ),
  );
  expect(songs).toHaveLength(3);
  expect(songs[0]?.run_key).not.toBeNull();
  expect(new Set(songs.map((c) => c.run_key)).size).toBe(1);
});

// md2ui grouper_kind_tokens_tests: test_one_icon_is_not_an_icon_row
test("icon rows are not chips: their count still counts", () => {
  const [a, b, c] = cards(
    groupDocument(
      "## Picks\n\n" +
        "### Alpha\n_Owner: Ana_\n⭐ 🚀\n\n" +
        "### Beta\n_Owner: Ben_\n⭐ 🚀\n\n" +
        "### Gamma\n_Owner: Cleo_\n⭐\n",
    ),
  );
  expect(a?.run_key).not.toBeNull();
  expect(a?.run_key).toBe(b?.run_key);
  expect(c?.run_key).not.toBe(a?.run_key);
});

const glued = (root: GroupNode): GroupNode[] => nodes(root).filter((n) => n.glued_content_group);
const isPairKind = (n: GroupNode): boolean => kindSignatures(kit, n, [])[0].startsWith("pair(");

// md2ui grouper_kind_tokens_tests: test_a_split_value_line_is_one_line_of_a_pair
test("a label over a split value line is a pair, and the tiles run together", () => {
  const tiles = glued(
    groupDocument(
      "## \n\n" +
        "... _Revenue_ ...\n... ___$129K___ ...\n\n" +
        "... _Wealth Management_ ...\n... ___$412M___ ...\n\n" +
        "... _Available balance_ ...\n... ___1,204___ - tems ...\n",
    ),
  );
  expect(tiles).toHaveLength(3);
  expect(tiles.map(isPairKind)).toEqual([true, true, true]);
  const keys = new Set(tiles.map((t) => t.run_key));
  expect(keys.size).toBe(1);
  expect(keys.has(null)).toBe(false);
});

// md2ui grouper_kind_tokens_tests: test_a_key_value_line_is_not_a_pair_line. A pair a
// display reads (here a percentage bar) is not a text line, so a label over it is not a
// two-line pair.
test("a key-value line is no line of a pair", () => {
  const blocks = glued(groupDocument("## \n\nAccuracy\nScore: 94%\n\nRecall\nScore: 81%\n"));
  expect(blocks.length).toBeGreaterThan(0);
  expect(blocks.some(isPairKind)).toBe(false);
});

// md2ui markdown_preprocessing_tests: test_zero_width_joiner_survives_preprocess
test("a zero-width joiner survives preprocess; other zero-widths go", () => {
  const technologist = "\u{1f468}\u200d\u{1f4bb}";
  expect(preprocess(kit, `${technologist} Developer`).text).toBe(`${technologist} Developer`);
  expect(preprocess(kit, "a\u200bb\u200cc\ufeffd").text).toBe("abcd");
});

// md2ui markdown_datapoint_split_tests: test_an_emoji_sequence_peels_as_one_badge
test("a joined emoji, a flag, a skin tone and a keycap each peel as one badge", () => {
  for (const seq of [
    "\u{1f468}\u200d\u{1f4bb}",
    "\u{1f1fa}\u{1f1f8}",
    "\u{1f44d}\u{1f3fd}",
    "1\ufe0f\u20e3",
  ]) {
    for (const text of [seq, `${seq} - Label`]) {
      const emojis = nodes(groupDocument(text)).filter((n) => n.type === "emoji");
      expect(
        emojis.map((n) => n.content),
        text,
      ).toEqual([seq]);
    }
  }
});

/** `[type, content, variant, muted]` for every leaf, in document order. */
const marked = (src: string): [string, string, string | null, boolean][] =>
  leaves(groupDocument(src)).map((n) => [
    n.type,
    n.content,
    n.emoji_variant ?? n.code_variant,
    n.element_muted,
  ]);

// md2ui muted_element_tests: test_struck_badge_is_a_muted_badge
test("~~ around a badge, wrapper inside or out, is the badge muted", () => {
  for (const [src, variant] of [
    ["~~⭐~~", null],
    ["~~*⭐*~~", "secondary"],
    ["*~~⭐~~*", "secondary"],
    ["~~***⭐***~~", "quaternary"],
  ] as const) {
    expect(marked(src), src).toEqual([["emoji", "⭐", variant, true]]);
  }
});

// md2ui muted_element_tests: test_struck_chip_is_a_muted_chip
test("~~ around a chip is the chip muted, in its variant", () => {
  for (const [src, variant] of [
    ["~~`Tag`~~", null],
    ["~~**`Tag`**~~", "tertiary"],
    ["**~~`Tag`~~**", "tertiary"],
    ["~~_`Tag`_~~", "quinary"],
    ["~~`~/path`~~", null],
  ] as const) {
    expect(marked(src), src).toEqual([["inline_code", src.split("`")[1], variant, true]]);
  }
});

// md2ui muted_element_tests: test_an_enabled_element_is_not_muted
test("no ~~, no muted state", () => {
  for (const src of ["⭐", "*⭐*", "`Tag`", "**`Tag`**"]) {
    expect(
      marked(src).some(([, , , muted]) => muted),
      src,
    ).toBe(false);
  }
});

// md2ui muted_element_tests: test_prose_strike_stays_struck_text
test("a strike around prose, or a lone ~, stays text", () => {
  for (const src of ["~~struck prose~~", "~~⭐ old item~~", "~⭐~"]) {
    expect(marked(src), src).toEqual([["text", src, null, false]]);
  }
});

// md2ui muted_element_tests: test_muted_element_in_a_run
test("only the struck element of a run is muted", () => {
  expect(marked("⭐ ~~`Sold out`~~ 🚀")).toEqual([
    ["emoji", "⭐", null, false],
    ["inline_code", "Sold out", null, true],
    ["emoji", "🚀", null, false],
  ]);
});

// md2ui muted_element_tests: test_muted_survives_the_round_trip (the to_dict half)
test("element_muted is on the AST", () => {
  for (const src of ["~~**⭐**~~", "~~*`Tag`*~~"]) {
    expect(groupDocument(src).toDict(kit).children?.[0]?.element_muted, src).toBe(true);
  }
});

const URL = "https://example.com";

// md2ui link_variant_tests: test_underscore_wrappers_are_the_small_ladder
test("_ / __ / ___ around a button pick Quinary / Senary / Septenary", () => {
  for (const [wrap, variant] of [
    ["_", "quinary"],
    ["__", "senary"],
    ["___", "septenary"],
  ] as const) {
    for (const [label, is_emoji] of [
      ["Go", false],
      ["⭐", true],
    ] as const) {
      expect(classifyLinkContent(kit, `${wrap}[${label}](${URL})${wrap}`)).toEqual({
        variant,
        label,
        is_emoji,
        is_disabled: false,
        emphasis: null,
      });
    }
  }
});

// md2ui link_variant_tests: the disabled small ladder
test("~~ composes with the small ladder", () => {
  for (const [src, variant] of [
    [`~~_[x](${URL})_~~`, "quinary"],
    [`~~__[x](${URL})__~~`, "senary"],
    [`~~___[x](${URL})___~~`, "septenary"],
  ] as const) {
    const got = classifyLinkContent(kit, src);
    expect([got.variant, got.is_disabled], src).toEqual([variant, true]);
  }
});

// md2ui link_variant_tests: test_grouper_records_the_small_ladder
test("the AST records each ladder's link variant", () => {
  for (const [wrap, variant] of [
    ["*", "secondary"],
    ["_", "quinary"],
    ["__", "senary"],
    ["___", "septenary"],
  ] as const) {
    for (const label of ["Go", "⭐"]) {
      const src = `${wrap}[${label}](/x)${wrap}`;
      const links = leaves(groupDocument(src))
        .filter((n) => n.type === "link")
        .map((n) => n.toDict(kit))
        .map((d) => [d.link_label, d.link_variant]);
      expect(links, src).toEqual([[label, variant]]);
    }
  }
});

// md2ui link_variant_tests: test_emoji_badge_underscore_stays_a_synonym
test("an emoji badge's _ is still the * ladder", () => {
  const variants = (src: string): (string | null)[] =>
    nodes(groupDocument(src))
      .filter((n) => n.type === "emoji")
      .map((n) => n.emoji_variant);
  expect(variants("_⭐_")).toEqual(["secondary"]);
  expect(variants("__⭐__")).toEqual(["tertiary"]);
});
