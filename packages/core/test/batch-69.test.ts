// md2ui rules these tests pin: a line of unclosed `_` openers parsed in linear time, a
// quantity fraction inside a sentence stays text, a variant's shadows replace Primary's
// kind by kind with four layers of each kind, and a link inside a styled phrase is the
// sentence's inline link. Expected values are md2ui's own tests (inline_span_nesting_tests,
// datapoint_grouping_tests, shadow_tests, link_actions_tests); these run without fixtures.
import type { ShadowSpec } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { inlineLinkUrls, parseInlineSpans } from "../src/actions/inline-spans.ts";
import { actionTargets } from "../src/actions/targets.ts";
import { groupDocument, groupMarkdown } from "../src/group/grouper.ts";
import type { GroupNode } from "../src/group/node.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { chipStyle, emojiBadgeStyle, linkStyle } from "../src/measure/theme-styles.ts";
import { parseTheme } from "../src/theme/parse.ts";

const kit = new RegexKit();

/** `[text, bold, italic, code, strike, link]` of each span, md2ui's tuple. */
const tuples = (text: string) =>
  parseInlineSpans(kit, text).map((s) => [s.text, s.bold, s.italic, s.code, s.strike, s.link]);

// --- a line of unclosed `_` openers (render_text._hide_dead_underscores) ------------------

// md2ui: test_a_line_of_unclosed_underscores_parses_in_linear_time
test("a line of unclosed `_` openers parses in linear time, spans and links unchanged", () => {
  const flood = "_a ".repeat(32_000);
  const started = performance.now();
  const spans = parseInlineSpans(kit, flood);
  const took = performance.now() - started;
  // Generous for a loaded machine: quadratic, this line takes many seconds.
  expect(took).toBeLessThan(2000);
  expect(spans.map((s) => s.text).join("")).toBe(flood);
  expect(tuples("_it_ then _a _b")).toEqual([
    ["it", false, true, 0, 0, 0],
    [" then _a _b", false, false, 0, 0, 0],
  ]);
  const tail = `${"_a ".repeat(20)}see [x](/a_b) ${"_c ".repeat(20)}`;
  expect(inlineLinkUrls(kit, tail)).toEqual(["/a_b"]);
  expect(parseInlineSpans(kit, tail).map((s) => s.text)).toEqual([
    `${"_a ".repeat(20)}see `,
    "x",
    ` ${"_c ".repeat(20)}`,
  ]);
  expect(tuples("__[a](/b)__x")[0]?.slice(0, 3)).toEqual(["a", true, false]);
});

// --- a link inside a styled phrase (render_text.parse_inline_spans) ----------------------

// md2ui: test_a_link_inside_a_styled_phrase_is_its_inline_link
test("a link inside a styled phrase is its inline link, styled and numbered", () => {
  for (const [wrap, flag] of [
    ["**", "bold"],
    ["*", "italic"],
    ["__", "bold"],
    ["~~", "strike"],
  ] as const) {
    const spans = parseInlineSpans(kit, `${wrap}see [the docs](/d) for more${wrap}`);
    expect(spans.map((s) => s.text)).toEqual(["see ", "the docs", " for more"]);
    expect(spans[1]?.link).toBe(1);
    expect(spans.every((s) => Boolean(s[flag]))).toBe(true);
  }
  const line = "**a [one](/1) b** and [two](/2) and *c [three](/3)*";
  expect(
    parseInlineSpans(kit, line)
      .filter((s) => s.link)
      .map((s) => [s.text, s.link]),
  ).toEqual([
    ["one", 1],
    ["two", 2],
    ["three", 3],
  ]);
  expect(inlineLinkUrls(kit, line)).toEqual(["/1", "/2", "/3"]);
  expect(tuples("**`[x](/y)`**")[0]?.slice(0, 4)).toEqual(["[x](/y)", true, false, 1]);
});

// md2ui: link_actions_tests.test_a_link_inside_a_styled_phrase_is_a_target
test("a link inside a bold phrase is offered as a target", () => {
  const doc = "Please **read [the terms](https://ex.com/t) first** before you pay.\n";
  const targets = actionTargets(groupMarkdown(doc));
  expect(targets.map((t) => [t.action?.kind, t.action?.label, t.action?.href])).toEqual([
    ["link", "the terms", "https://ex.com/t"],
  ]);
});

// --- a quantity fraction inside a sentence (grouper_displays._try_leaf_display) ----------

function displays(root: GroupNode, kind: string): GroupNode[] {
  const own = root.datapoint_display === kind ? [root] : [];
  return [...own, ...root.children.flatMap((c) => displays(c, kind))];
}

// md2ui: test_a_sentence_that_mentions_a_quantity_fraction_stays_text
test("a sentence mentioning 75/100g stays text; the bare fraction draws its ring", () => {
  for (const line of [
    "I ate 75/100g of protein today and felt fine.",
    "Protein 75/100g",
    "Sugar 3 / 10 g left",
  ]) {
    expect(displays(groupDocument(line), "unit_ratio"), line).toEqual([]);
  }
  for (const line of ["75/100g", "**75/100g**", "75 / 100 g"]) {
    expect(displays(groupDocument(line), "unit_ratio"), line).toHaveLength(1);
  }
});

// --- a variant's shadows (theme_model.inherit_shadows, the variant replay) ---------------

const layers = (n: number, kind: "Outer" | "Inner", first: number): string =>
  Array.from(
    { length: n },
    (_, i) => `${kind} shadow:\n- Radius: ${first + i}\n- Color: #000000FF\n`,
  ).join("");

const radii = (shadows: readonly ShadowSpec[], inner: boolean): number[] =>
  shadows.filter((s) => s.inner === inner).map((s) => s.radius);

// md2ui: test_more_than_four_of_one_kind_are_dropped
test("a fifth shadow of one kind is dropped, keeping the first four", () => {
  const block = `## Background styles and Spacing\n\n### Image Cards\n\n${Array.from(
    { length: 6 },
    (_, i) => `Outer shadow:\n- Radius: ${i}\n- Color: #000000FF\n\n`,
  ).join("")}`;
  expect(parseTheme(block).image_cards.shadows.map((s) => s.radius)).toEqual([0, 1, 2, 3]);
});

// md2ui: test_a_variant_replaces_primarys_shadows_kind_by_kind
test("a variant's shadows replace Primary's of that kind, and keep the other", () => {
  const primary = layers(4, "Outer", 10) + layers(1, "Inner", 50);
  const own = layers(2, "Outer", 20);
  const theme = parseTheme(
    `## Links\n### Primary\n${primary}### Secondary\n${own}` +
      `## Inline Code\n${primary}### Secondary\n${own}` +
      `## Emoji styles\n### Primary\n${primary}### Secondary\n${own}`,
  );
  for (const shadows of [
    linkStyle(theme, "secondary").shadows,
    chipStyle(theme, "secondary").shadows,
    emojiBadgeStyle(theme, "secondary").fill.shadows,
  ]) {
    expect(radii(shadows, false)).toEqual([20, 21]);
    expect(radii(shadows, true)).toEqual([50]);
  }
  for (const shadows of [
    linkStyle(theme, "primary").shadows,
    theme.inline_code.shadows,
    theme.emojis.primary.fill.shadows,
  ]) {
    expect(radii(shadows, false)).toEqual([10, 11, 12, 13]);
  }
});

// md2ui: test_a_variant_may_declare_the_full_cap_of_its_own
test("a variant keeps all four of its own, whatever Primary declared", () => {
  const primary = layers(4, "Outer", 10);
  const own = layers(4, "Outer", 30);
  const theme = parseTheme(
    `## Inline Code\n${primary}### Secondary\n${own}` +
      `## Emoji styles\n### Primary\n${primary}### Secondary\n${own}`,
  );
  for (const shadows of [
    chipStyle(theme, "secondary").shadows,
    emojiBadgeStyle(theme, "secondary").fill.shadows,
  ]) {
    expect(radii(shadows, false)).toEqual([30, 31, 32, 33]);
  }
});
