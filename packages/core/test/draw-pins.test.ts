// `## Fixed colors` pins (md2ui `stamp_fixed_colors`). Each case reproduces one of md2ui's
// tests/fixed_color_tests.py, named in the test title; the documents are md2ui's
// data/markdown/tests/fixed-colors samples, inlined.
// md2ui's span offsets are code points and these are UTF-16 units, so a case with an
// emoji before the range differs in its numbers, not in the characters it names.
import type { GroupingDataPoint, GroupingNode } from "@md2ui/contracts";
import { describe, expect, test } from "vitest";
import { groupMarkdown } from "../src/group/grouper.ts";
import { RegexKit } from "../src/group/py/re.ts";
import type { Pins } from "../src/scene/draw/colors.ts";
import { fixedPins } from "../src/scene/draw/pins.ts";
import { parseTheme } from "../src/theme/parse.ts";

const AMBER = 0xfff0a93b;
const GREEN = 0xff22c55e;
const RED = 0xffe5484d;
const UP = 0xff16a34a;

const FIXED = `# t
## Fixed colors
### Emoji
- ☀️ #F0A93B
- 📈 #22C55E datapoints
- ↗️ #10B981 line
### Emoji background
- 📈 #E9F9EF
### Badges
#### Exact
- Sold out: Text color: #991B1B, Fill color: #FEE2E2
#### Contains
- ⬇: Text color: #E5484D, Fill color: #FDEDEC, Stroke color: #F7C8C5
### Buttons
#### Exact
- Cancel: Text color: #26262B, Fill color: #E5E7EB
#### Contains
- Delete: Text color: #FFFFFF, Fill color: #DC2626, Stroke color: #991B1B
### Datapoints
- change up: #16A34A
- change down: #E5484D
`;

// md2ui data/markdown/tests/fixed-colors/<name>/content.md
const SAMPLES = {
  emoji:
    "<!-- Emoji-->\n☀️\n\n<!--Datapoint-->\n___75°___\n\n<!--Emoji variant, datapoint-->\n" +
    "___☀️___ 75°\n\n<!--Emoji variant-->\n___☀️___\n\n" +
    "<!--Emoji variant (produced by the datapoint split), datapoint -->\n___☀️ 75°___\n\n" +
    "<!-- Text -->\n___☀️ Display text___\n\n<!-- Text, Text-->\n_High 78_ _Low 56_\n\n" +
    "<!--Emoji (produced by the datapoint split), datapoint -->\n☀️ ___75°___\n\n" +
    "<!--Emoji variant (produced by the datapoint split), datapoint -->\n___☀️___ 75°\n\n" +
    "<!--Emoji-->\n🦞\n\n<!-- Text -->\n___Display___\n\n<!-- text -->\n# ☀️ Display text\n",
  metrics:
    "Unique views: ___192.1k___\n32k increase - ↗️\n\nBounce rate: ___21\\%___\n" +
    "7% increase - ↘️\n\nAverage time on page: ___03:12___\n3% increase - ↗️\n",
  "metrics-2-datapoint":
    "# Metrics\n\n_Users online_\n___24,104___\n+2,588\n\n_Revenue_\n___$129,201.40___\n" +
    "+$22,910\n\n\n# Plain text\n\nThis plain-text should not be painted in green.\n",
  "metrics-3-emoji-datapoint":
    "\n# Metrics\n\n_Total income_\n___$15,000___\n📈 5.1% - from last month\n\n" +
    "_Total expences_\n___$6,700___\n📉 15.5% - from last month\n\n_Saved balance_\n" +
    "___$8,300___\n📈 20.7% - from last month\n\n\n# Plain text\n\n" +
    "This plain-text should not be painted in green.\n",
  "metrics-4-pills":
    "👤 Customers: ___1,293___ - `⬇ +36.8%` : _vs last month_\n\n" +
    "💳 Balance: ___256k___ - `⬆ -36.8%` : _vs last month_\n",
} as const;

const pinsOf = (root: GroupingNode, themeText: string): Map<string, Pins> =>
  fixedPins(root, parseTheme(themeText), new RegexKit());

/** md2ui `_stamped`: (stripped content, pins) of every leaf, in document order. */
function stamped(sample: keyof typeof SAMPLES, themeText = FIXED): [string, Pins][] {
  const root = groupMarkdown(SAMPLES[sample]);
  const pins = pinsOf(root, themeText);
  const out: [string, Pins][] = [];
  const walk = (n: GroupingNode): void => {
    if (n.children.length === 0) out.push([n.content.trim(), pins.get(n.node_id) ?? {}]);
    for (const c of n.children) walk(c);
  };
  walk(root);
  return out;
}

/** md2ui `_pin`: the first leaf with this content's pins. */
function pin(leaves: [string, Pins][], content: string): Pins {
  const hit = leaves.find(([c]) => c === content);
  if (hit === undefined) throw new Error(`no leaf ${content} in ${leaves.map(([c]) => c)}`);
  return hit[1];
}

let ids = 0;
/** A hand-built node, as md2ui's tests build dicts. */
function node(props: Partial<GroupingNode> & Pick<GroupingNode, "type">): GroupingNode {
  ids += 1;
  return { node_id: `n${ids}`, content: "", children: [], fingerprint_hash: null, ...props };
}

const dp = (
  label: GroupingDataPoint["label"],
  matched: string,
  start: number,
  end = start + matched.length,
): GroupingDataPoint => ({ label, matched, start, end, value: null });

/** md2ui `_range_node` and `_assert_annotate_only_span_reaches_its_pin`: one leaf, stamped. */
function rangeLeaf(content: string, dps: GroupingDataPoint[], themeText: string): Pins {
  const leaf = node({ type: "text", content, data_points: dps });
  return pinsOf(node({ type: "root", children: [leaf] }), themeText).get(leaf.node_id) ?? {};
}

/** md2ui `_stamped_inline_leaf`: the one leaf of a grouped line, stamped. */
function inlineLeaf(markdown: string, themeText = FIXED): [GroupingNode, Pins] {
  const root = groupMarkdown(markdown);
  const pins = pinsOf(root, themeText);
  const leaves: GroupingNode[] = [];
  const walk = (n: GroupingNode): void => {
    if (n.children.length === 0 && n.content !== "") leaves.push(n);
    for (const c of n.children) walk(c);
  };
  walk(root);
  expect(leaves).toHaveLength(1);
  const leaf = leaves[0] as GroupingNode;
  return [leaf, pins.get(leaf.node_id) ?? {}];
}

/** md2ui `_stamped_button`. */
function button(label: string, themeText = FIXED): Pins {
  const b = node({ type: "link", content: `[${label}](/action)`, link_label: label });
  return pinsOf(node({ type: "root", children: [b] }), themeText).get(b.node_id) ?? {};
}

/** A chip leaf (`inline_code`) of this content, stamped. */
function chip(content: string): Pins {
  const c = node({ type: "inline_code", content });
  return pinsOf(node({ type: "root", children: [c] }), FIXED).get(c.node_id) ?? {};
}

describe("activation", () => {
  test("test_an_absent_section_is_inert / test_no_pins_means_no_stamping", () => {
    expect(
      stamped("metrics-3-emoji-datapoint", "").every(([, p]) => Object.keys(p).length === 0),
    ).toBe(true);
  });

  test("test_button_rules_alone_activate_fixed_color_stamping", () => {
    const only = "## Fixed colors\n### Buttons\n#### Contains\n- Delete: Fill color: #DC2626\n";
    expect(button("Delete account", only).fill).toBe(0xffdc2626);
  });
});

describe("emoji scope", () => {
  test("test_glyph_scope_stops_at_the_glyph", () => {
    const leaves = stamped("emoji");
    expect(pin(leaves, "☀️").text).toBe(AMBER);
    expect(pin(leaves, "75°")).toEqual({});
  });

  test("test_datapoints_scope_reaches_the_value_beside_it (an emoji before the range)", () => {
    const leaves = stamped("metrics-3-emoji-datapoint");
    // md2ui: {start: 2, end: 6} in code points; 📈 is two UTF-16 units.
    expect(pin(leaves, "📈 5.1%").spans).toEqual([{ start: 3, end: 7, color: GREEN }]);
    expect("📈 5.1%".slice(3, 7)).toBe("5.1%");
    expect(pin(leaves, "from last month")).toEqual({});
    expect(pin(leaves, "This plain-text should not be painted in green.")).toEqual({});
  });

  test("test_line_scope_needs_a_peeled_emoji", () => {
    const leaves = stamped("metrics");
    expect(pin(leaves, "↗️").text).toBe(0xff10b981);
    expect(pin(leaves, "32k increase").text).toBe(0xff10b981);
    // Named as the tree holds it: since ADR-205 that `Key: value` line is one text.
    expect(pin(leaves, "Unique views: ___192.1k___")).toEqual({});
  });

  test("an emoji node takes its `### Emoji background` as its fill (stamp_fixed_colors)", () => {
    const e = node({ type: "emoji", content: "📈" });
    const pins = pinsOf(node({ type: "root", children: [e] }), FIXED).get(e.node_id);
    expect(pins).toEqual({ text: GREEN, fill: 0xffe9f9ef });
  });
});

// md2ui: an emoji pin names the kinds it paints, and
// `datapoints` reaches every datapoint beside the glyph, links and emojis included.
describe("emoji scope by kind", () => {
  // md2ui _EVERY_KIND, _PIECES: every kind on one run, cut into pieces so each is the
  // emoji's sibling.
  const EVERY_KIND =
    "🔥 - Hot deal - ⭐ - `Chip` - [Button](agent:buy) - [`Text link`](agent:more) - 42%\n";
  const PIECES = [
    "Hot deal",
    "⭐",
    "Chip",
    "[Button](agent:buy)",
    "[`Text link`](agent:more)",
    "42%",
  ];

  /** md2ui `_painted`: the pin colour a leaf is painted with, whole or as its one span. */
  const painted = (p: Pins): number | undefined => p.text ?? p.spans?.[0]?.color;

  /** md2ui `_reached`: which pieces a 🔥 pin with this scope paints red. */
  function reached(scope: string): Set<string> {
    const root = groupMarkdown(EVERY_KIND);
    const pins = pinsOf(root, `# t\n## Fixed colors\n### Emoji\n- 🔥 #E5484D ${scope}\n`);
    const leaves = new Map<string, Pins>();
    const walk = (n: GroupingNode): void => {
      if (n.children.length === 0) leaves.set(n.content.trim(), pins.get(n.node_id) ?? {});
      for (const c of n.children) walk(c);
    };
    walk(root);
    expect(painted(leaves.get("🔥") ?? {})).toBe(RED);
    return new Set(PIECES.filter((c) => painted(leaves.get(c) ?? {}) === RED));
  }

  test("test_kind_words_parse_and_add_up", () => {
    const { emoji } = parseTheme(
      "# t\n## Fixed colors\n### Emoji\n- 🔥 #E5484D text chips\n" +
        "- ⭐ #E5484D chips datapoint glyph\n- 🌙 #E5484D chip\n",
    ).fixed;
    expect(emoji["🔥"]).toEqual([RED, ["chips", "text"]]);
    // Aliases fold, and `glyph` is no word.
    expect(emoji["⭐"]).toEqual([RED, ["chips", "datapoints"]]);
    // A word the parser does not know still drops the entry.
    expect(Object.hasOwn(emoji, "🌙")).toBe(false);
  });

  test("test_a_kind_scope_paints_only_its_kinds", () => {
    expect(reached("chips")).toEqual(new Set(["Chip"]));
    expect(reached("emojis")).toEqual(new Set(["⭐"]));
    expect(reached("buttons")).toEqual(
      new Set(["[Button](agent:buy)", "[`Text link`](agent:more)"]),
    );
    expect(reached("text")).toEqual(new Set(["Hot deal", "42%"]));
    expect(reached("text chips")).toEqual(new Set(["Hot deal", "42%", "Chip"]));
    expect(reached("line")).toEqual(new Set(PIECES));
    expect(reached("")).toEqual(new Set());
  });

  test("test_datapoints_scope_reaches_every_datapoint", () => {
    const datapoints = new Set(["⭐", "[Button](agent:buy)", "[`Text link`](agent:more)", "42%"]);
    expect(reached("datapoints")).toEqual(datapoints);
    expect(reached("chips datapoints")).toEqual(new Set([...datapoints, "Chip"]));
  });

  test("test_an_inline_datapoints_pin_reaches_an_emoji_in_its_sentence", () => {
    const [leaf, pins] = inlineLeaf(
      "📈 5.1% from last month ⭐\n",
      "# t\n## Fixed colors\n### Emoji\n- 📈 #22C55E datapoints\n",
    );
    const starts = new Set((pins.spans ?? []).map((span) => span.start));
    expect(starts.has(leaf.content.indexOf("⭐"))).toBe(true);
  });
});

describe("datapoints by direction", () => {
  test("test_a_signed_value_colors_by_direction", () => {
    const leaves = stamped("metrics-2-datapoint");
    expect(pin(leaves, "+$22,910").text).toBe(UP);
    expect(pin(leaves, "$129,201.40")).toEqual({});
  });

  test("test_a_sign_stays_with_its_number", () => {
    const leaves = stamped("metrics-2-datapoint");
    expect(pin(leaves, "+2,588").text).toBe(UP);
    expect(pin(leaves, "24,104")).toEqual({});
  });

  test("a lone sign takes its number's colour (_dp_pin's previous-sibling fall-back)", () => {
    const sign = node({ type: "text", content: "+" });
    const value = node({
      type: "text",
      content: "2,588",
      data_points: [dp("dp_number", "2,588", 0)],
    });
    const pins = pinsOf(node({ type: "root", children: [sign, value] }), FIXED);
    expect(pins.get(sign.node_id)).toEqual({ text: UP });
    expect(pins.get(value.node_id)).toEqual({ text: UP });
  });

  /** md2ui `_after`: a pinned datapoint leaf stamped after `prev`; the pins of both. */
  function after(prev: GroupingNode, content: string, dps: GroupingDataPoint[], tail: string) {
    const leaf = node({ type: "text", content, data_points: dps });
    const pins = pinsOf(
      node({ type: "root", children: [prev, leaf] }),
      `# t\n## Fixed colors\n### Datapoints\n${tail}`,
    );
    return [pins.get(prev.node_id) ?? {}, pins.get(leaf.node_id) ?? {}] as const;
  }

  test("test_only_a_lone_sign_takes_its_numbers_pin", () => {
    const pct = [dp("dp_percentage", "5%", 0)];
    const tail = "- percentage: #22C55E\n";
    // A container (empty content) and `+-` both passed Python's `in "+-"`.
    const group = node({ type: "group", children: [node({ type: "text", content: "a" })] });
    expect(after(group, "5%", pct, tail)[0]).toEqual({});
    expect(after(node({ type: "text", content: "+-" }), "5%", pct, tail)[0]).toEqual({});
    expect(after(node({ type: "text", content: "+" }), "5%", pct, tail)[0]).toEqual({
      text: GREEN,
    });
  });

  test("test_a_lone_sign_takes_the_color_its_number_is_painted", () => {
    // The first annotation listed is the currency; the leaf opens with the percentage.
    const dps = [dp("dp_currency", "$3", 9), dp("dp_percentage", "5%", 0)];
    const tail = "- percentage: #22C55E\n- currency: #E5484D\n";
    const [sign, leaf] = after(node({ type: "text", content: "+" }), "5% and   $3", dps, tail);
    expect(leaf.spans?.[0]?.color).toBe(GREEN);
    expect(sign).toEqual({ text: GREEN });
  });

  test("test_annotate_only_changes_keep_directional_span_pins", () => {
    const [up, upPins] = inlineLeaf("+2.58% 🔥");
    expect(up.type).toBe("text");
    expect(upPins.spans).toEqual([{ start: 0, end: 6, color: UP }]);
    const [down, downPins] = inlineLeaf("-$36.10 ✨");
    expect(down.type).toBe("text");
    expect(downPins.spans).toEqual([{ start: 0, end: 7, color: RED }]);
  });
});

describe("datapoint ranges inside text leaves", () => {
  const RANGES = `${FIXED}- percentage: #22C55E\n- currency: #E5484D\n`;

  test("test_a_datapoint_pin_colors_one_span_inside_a_longer_leaf", () => {
    const pins = rangeLeaf("Revenue 5.1% today", [dp("dp_percentage", "5.1%", 8)], RANGES);
    expect(pins).toEqual({ spans: [{ start: 8, end: 12, color: GREEN }] });
  });

  test("test_two_datapoint_pins_keep_two_regions_in_one_leaf", () => {
    const pins = rangeLeaf(
      "5.1% and $20",
      [dp("dp_percentage", "5.1%", 0), dp("dp_currency", "$20", 9)],
      RANGES,
    );
    expect(pins.spans).toEqual([
      { start: 0, end: 4, color: GREEN },
      { start: 9, end: 12, color: RED },
    ]);
  });

  test("test_invalidated_datapoint_offsets_fall_back_to_the_whole_leaf", () => {
    const pins = rangeLeaf("Gain 5.1% today", [dp("dp_percentage", "5.1%", 4, 8)], RANGES);
    expect(pins).toEqual({ text: GREEN });
  });

  // md2ui test_an_annotate_only_<label>_still_reaches_its_pin, one per detected type.
  const annotateOnly: [string, string, GroupingDataPoint["label"], string, number][] = [
    ["dimension", "Photo 1920 x 1080 ready", "dp_dimension", "1920 x 1080", 6],
    ["duration", "Waited 4 hours 35 minutes today", "dp_duration", "4 hours 35 minutes", 7],
    ["version", "Release v1.2.3 ready", "dp_version", "v1.2.3", 8],
    ["rate", "Rate $50/hour ready", "dp_rate", "$50/hour", 5],
    ["date_range", "Dates Jan 12-28, 2026 ready", "dp_date_range", "Jan 12-28, 2026", 6],
    ["file_size", "File 500 MB ready", "dp_file_size", "500 MB", 5],
    ["phone", "Call (555) 123-4567 now", "dp_phone", "(555) 123-4567", 5],
    ["url", "Visit https://example.com now", "dp_url", "https://example.com", 6],
    ["date", "Date May 2017 ready", "dp_date", "May 2017", 5],
    ["range", "Value €180-200M now", "dp_range", "€180-200M", 6],
    ["quantity", "Wait 5 days now", "dp_quantity", "5 days", 5],
    ["time", "Meet at 3 PM today", "dp_time", "3 PM", 8],
  ];
  test.each(annotateOnly)(
    "test_an_annotate_only_%s_still_reaches_its_pin",
    (key, content, label, matched, start) => {
      const pins = rangeLeaf(content, [dp(label, matched, start)], `${FIXED}- ${key}: #22C55E\n`);
      expect(pins).toEqual({ spans: [{ start, end: start + matched.length, color: GREEN }] });
    },
  );

  // md2ui test_annotate_only_<label>_keeps_its_span_pin, through the grouper.
  const grouped: [string, string, number, number][] = [
    ["currency", "Pay $20 now", 4, 7],
    ["ranking", "Ranked #1 today", 7, 9],
    ["measurement", "Set to 75° now", 7, 10],
    ["score", "Rated 4.8/5.0 today", 6, 13],
    ["ratio", "Aspect 3:2 here", 7, 10],
    ["number", "Count 42 today", 6, 8],
  ];
  test.each(grouped)("test_annotate_only_%s_keeps_its_span_pin", (key, markdown, start, end) => {
    const [leaf, pins] = inlineLeaf(markdown, `${FIXED}- ${key}: #E5484D\n`);
    expect(leaf.type).toBe("text");
    expect(pins).toEqual({ spans: [{ start, end, color: RED }] });
  });

  test("a leaf the painter would strip Markdown from falls back to the whole leaf", () => {
    const pins = rangeLeaf("Up **5.1%** now", [dp("dp_percentage", "5.1%", 5)], RANGES);
    expect(pins).toEqual({ text: GREEN });
  });
});

describe("pills and buttons", () => {
  test("test_a_contains_key_matches_a_label_that_varies", () => {
    expect(chip("⬇ +36.8%").text).toBe(RED);
    expect(chip("⬇ 12").text).toBe(RED);
    expect(chip("+36.8%")).toEqual({});
  });

  test("test_an_exact_key_matches_only_the_whole_label", () => {
    expect(chip("Sold out").fill).toBe(0xfffee2e2);
    expect(chip("Sold out soon")).toEqual({});
  });

  test("test_a_pill_gets_all_three_roles", () => {
    expect(pin(stamped("metrics-4-pills"), "⬇ +36.8%")).toEqual({
      text: RED,
      fill: 0xfffdedec,
      stroke: 0xfff7c8c5,
    });
  });

  // md2ui: a chip that is one signed value takes the `change up` / `change down`
  // pin, the label in it on a light tint of it; a matching Badges pin still wins, and a chip
  // of more than one value keeps the chip's own paint.
  test("test_a_chip_of_one_signed_value_takes_its_direction", () => {
    const root = groupMarkdown("`-2.01%`\n\n`+0.39%`\n\n`-2.01% today`\n\n`⬇ +36.8%`\n");
    const pins = pinsOf(root, FIXED);
    const leaves: [string, Pins][] = [];
    const walk = (n: GroupingNode): void => {
      if (n.children.length === 0) leaves.push([n.content.trim(), pins.get(n.node_id) ?? {}]);
      for (const c of n.children) walk(c);
    };
    walk(root);
    expect(pin(leaves, "-2.01%")).toEqual({ text: RED, fill: 0x19e5484d });
    expect(pin(leaves, "+0.39%")).toEqual({ text: UP, fill: 0x1916a34a });
    expect(pin(leaves, "-2.01% today"), "not one value").toEqual({});
    expect(pin(leaves, "⬇ +36.8%"), "the pill pin wins").toMatchObject({
      text: RED,
      fill: 0xfffdedec,
    });
  });

  // md2ui 5ea345ba4: the block that pins a static label is `### Badges`; `### Pills`, its
  // old name, is no longer read.
  test("### Badges pins a static label and ### Pills no longer does", () => {
    const stampedChip = (block: string): Pins => {
      const c = node({ type: "inline_code", content: "Sold out" });
      const theme = `## Fixed colors\n### ${block}\n#### Exact\n- Sold out: Fill color: #FEE2E2\n`;
      return pinsOf(node({ type: "root", children: [c] }), theme).get(c.node_id) ?? {};
    };
    expect(stampedChip("Badges").fill).toBe(0xfffee2e2);
    expect(stampedChip("Badge").fill).toBe(0xfffee2e2);
    expect(stampedChip("Pills")).toEqual({});
  });

  test("test_button_exact_and_contains_are_independent_from_pills", () => {
    expect(button("Cancel").fill).toBe(0xffe5e7eb);
    const del = button("Delete account");
    expect(del.fill).toBe(0xffdc2626);
    expect(del.stroke).toBe(0xff991b1b);
    expect(button("Sold out").fill).toBeUndefined();
    expect(chip("Delete account")).toEqual({});
  });
});
