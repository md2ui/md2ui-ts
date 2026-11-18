// md2ui rules these tests pin: five findings fixes and a heading of unclosed markers named in
// linear time. Expected values are md2ui's own tests (markup_escape_tests, hard_break_tests,
// link_actions_tests, image_min_width_tests, agent_records_tests); these run without fixtures.
import { expect, test } from "vitest";
import { parseInlineSpans, plainLinkLabel } from "../src/actions/inline-spans.ts";
import { actionFor, actionTargets } from "../src/actions/targets.ts";
import { flatLabel } from "../src/group/block-splits.ts";
import { HARD_BREAK } from "../src/group/escapes.ts";
import { groupDocument, groupMarkdown } from "../src/group/grouper.ts";
import type { GroupNode } from "../src/group/node.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { paintMarkdown } from "./scene-kit.ts";

const kit = new RegexKit();

function nodes(root: GroupNode): GroupNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

const leaves = (doc: string): [string, string][] =>
  nodes(groupDocument(doc))
    .filter((n) => n.children.length === 0 && n.content)
    .map((n) => [n.type, n.content]);

/** `[text, bold, italic]` of each span the drawer paints. */
const drawn = (content: string): [string, boolean, boolean][] =>
  parseInlineSpans(kit, content).map((s) => [s.text, s.bold, s.italic]);

// --- `\*` is a star (grouper_escapes.MARKUP_ESCAPES) -------------------------------------

// md2ui: test_an_escaped_star_starts_no_list_item
test("`\\* x` is a text drawn with its star; `* x` is a list item", () => {
  const got = leaves("\\* This is not a list\n");
  expect(got).toEqual([["text", "\\* This is not a list"]]);
  expect(drawn("\\* This is not a list")).toEqual([["* This is not a list", false, false]]);
  expect(leaves("* This is a list\n")).toEqual([["list_item", "This is a list"]]);
});

// md2ui: test_escaped_stars_draw_as_written_in_a_sentence
test("escaped stars in a sentence are drawn as stars, not emphasis", () => {
  const line = "Price is \\*not emphasis\\* and \\*\\*not bold\\*\\* here";
  expect(leaves(`${line}\n`)).toEqual([["text", line]]);
  expect(drawn(line)).toEqual([["Price is *not emphasis* and **not bold** here", false, false]]);
});

// md2ui: test_escaped_stars_are_no_thematic_break
test("`\\*\\*\\*` is three stars of text, not a section stop", () => {
  expect(leaves("\\*\\*\\*\n")).toEqual([["text", "\\*\\*\\*"]]);
  expect(drawn("\\*\\*\\*")).toEqual([["***", false, false]]);
});

// md2ui: test_an_escaped_star_never_closes_emphasis
test("an escaped star neither opens nor closes; a real span keeps it", () => {
  expect(drawn("*a\\*")).toEqual([["*a*", false, false]]);
  expect(drawn("*a\\* b*")).toEqual([["a* b", false, true]]);
  expect(drawn("**Total\\***")).toEqual([["Total*", true, false]]);
  expect(drawn("*real* \\*")).toEqual([
    ["real", false, true],
    [" *", false, false],
  ]);
});

// md2ui: test_a_code_span_keeps_its_backslash, test_a_link_label_draws_its_escaped_star
test("a code span keeps `\\*`; a link label draws it as a star", () => {
  expect(parseInlineSpans(kit, "`a\\*b`")[0]?.text).toBe("a\\*b");
  expect(parseInlineSpans(kit, "[`x\\*`](/u)")[0]?.text).toBe("x\\*");
  expect(parseInlineSpans(kit, "see [a \\*b\\*](/u) now").map((s) => s.text)).toEqual([
    "see ",
    "a *b*",
    " now",
  ]);
});

// md2ui: test_the_balancer_leaves_an_escaped_star_alone (through the grouper: the marker
// runs are private here) and test_an_escaped_star_is_measured_inside_its_word
test("a cut piece keeps an escaped star as written; `a\\*b` is one span", () => {
  expect(leaves("Note \\*important - details\n").map(([, c]) => c)).toEqual([
    "Note \\*important",
    "details",
  ]);
  expect(drawn("a\\*b and c")).toEqual([["a*b and c", false, false]]);
});

// --- a link in a code block is no target (render_actions._NOT_PROSE) ---------------------

const FENCED = `Before [Real](agent:real)

\`\`\`markdown
[Docs](https://example.com) and [Go](agent:go)
\`\`\`

After \`[x](agent:inline)\` here.
`;

// md2ui: test_a_link_in_a_code_block_is_not_a_target
test("a link in a code block is not a target; targets match regions", () => {
  const targets = actionTargets(groupMarkdown(FENCED));
  expect(targets.map((t) => [t.action?.kind, t.action?.action])).toEqual([["agent", "real"]]);
  for (const width of [767, 1280]) {
    const { scene } = paintMarkdown(FENCED, "", width);
    const regions = new Set(
      scene.regions.filter((r) => r.action.kind !== "copy").map((r) => r.action.node_id),
    );
    expect([...regions]).toEqual(targets.map((t) => t.key));
  }
});

// --- a `\` breaks inside a link label (grouper_block_splits.flat_label) ------------------

// md2ui: test_a_break_holds_inside_a_link_label_in_a_sentence
test("a break holds inside a link label in a sentence; a soft one is a space", () => {
  expect(leaves("Pick the [monthly plan\\\nat $9](agent:choose) today.")).toEqual([
    ["text", `Pick the [monthly plan${HARD_BREAK}at $9](agent:choose) today.`],
  ]);
  expect(leaves("x [a\nb](/x) y")).toEqual([["text", "x [a b](/x) y"]]);
});

// md2ui: test_a_button_label_keeps_its_break_and_reads_as_words
test("a button label keeps its break and reads as words", () => {
  expect(leaves("[Monthly\\\nplan](agent:a) [Yearly](agent:b)")).toContainEqual([
    "link",
    `[Monthly${HARD_BREAK}plan](agent:a)`,
  ]);
  expect(plainLinkLabel(kit, `Monthly${HARD_BREAK}plan`, undefined)).toBe("Monthly plan");
});

// md2ui: test_a_label_breaks_only_where_a_text_would
test("a label breaks only where a text would", () => {
  expect(flatLabel("a\\\\\nb")).toBe("a\\\\ b");
  expect(flatLabel("a\\\n\nb")).toBe("a\\ b");
  expect(flatLabel("a\\\nb")).toBe(`a${HARD_BREAK}b`);
});

// --- an authored image floor replaces the default (generator_units._min_width) -----------

// md2ui: test_a_floor_below_the_default_lowers_it. The picture is left a little under
// 96 px beside the chip at this width with this port's stand-in measurer.
test("a floor below the default lowers it; no floor keeps the default", () => {
  const tops = (params: string): number[] => {
    const doc = `![Photo](https://example.com/p.jpg?${params})\n:::\n\`${"x".repeat(30)}\`\n`;
    return paintMarkdown(doc, "", 320).scene.boxes.map((b) => b.y);
  };
  const lowered = tops("md2ui.min_width=80");
  const fallback = tops("md2ui.fit=cover");
  expect(lowered).toHaveLength(2);
  expect(lowered[0]).toBe(lowered[1]);
  expect(fallback).toHaveLength(2);
  expect(fallback[0]).toBeLessThan(fallback[1] as number);
});

// --- `md2ui.*` params leave every link (render_actions.action_for) -----------------------

// md2ui: test_md2ui_params_never_leave_a_link (its `hints` half is `check`'s, server-side)
test("md2ui params never leave a link; commit is read on agent: only", () => {
  const link = actionFor(kit, "https://example.com/d?md2ui.commit=1&q=a", "Docs", "n");
  expect([link?.href, link?.commit]).toEqual(["https://example.com/d?q=a", false]);
  expect(actionFor(kit, "mailto:a@b.co?md2ui.x=1", "Mail", "n")?.href).toBe("mailto:a@b.co");
  const agent = actionFor(kit, "agent:keep?id=7&md2ui.commit=1", "Keep", "n");
  expect([agent?.commit, agent?.params]).toEqual([true, [["id", "7"]]]);
});

// --- a heading of unclosed markers (security S7) -------------------------------

// md2ui: test_a_heading_of_unclosed_markers_reads_in_linear_time. md2ui's quadratic pattern
// named a page's sections on the server; this port has no such pattern, and its grouper
// must stay linear on the same input.
test("a 96 KB heading of unclosed markers groups in well under a second", () => {
  const flood = "*a _b ".repeat(16000);
  const started = performance.now();
  const got = leaves(`# ${flood}\n\nBody\n`);
  const took = performance.now() - started;
  expect(took).toBeLessThan(1000);
  expect(got.at(-1)).toEqual(["text", "Body"]);
});
