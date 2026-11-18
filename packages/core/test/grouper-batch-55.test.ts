// In the grouper, a heading line ending in `\` continues onto
// the next line, and a code span keeps its backslashes. Expected
// values are md2ui's own tests (hard_break_tests, markdown_preprocessing_tests); these run
// without fixtures.
import { expect, test } from "vitest";
import { HARD_BREAK } from "../src/group/escapes.ts";
import { groupDocument } from "../src/group/grouper.ts";
import type { GroupNode } from "../src/group/node.ts";

function nodes(root: GroupNode): GroupNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

const leaves = (doc: string): [string, string][] =>
  nodes(groupDocument(doc))
    .filter((n) => n.children.length === 0)
    .map((n) => [n.type, n.content]);

// --- a heading continues as a text does ---------------------------------------

// md2ui: test_a_heading_continues_onto_its_next_lines
test("a heading's broken lines are one heading; the last keeps its backslash", () => {
  expect(leaves("# Heading line 1\\\nheading line 2\\\nheading line 3\\\n")).toEqual([
    ["heading1", `Heading line 1${HARD_BREAK}heading line 2${HARD_BREAK}heading line 3\\`],
  ]);
});

// md2ui: test_a_blank_line_ends_a_continued_heading, test_a_continued_heading_keeps_its_level
test("a blank line ends a continued heading, which keeps its level", () => {
  expect(leaves("# Heading line 1\\\nheading line 2\\\n\nheading line 3\\\n")).toEqual([
    ["heading1", `Heading line 1${HARD_BREAK}heading line 2\\`],
    ["text", "heading line 3\\"],
  ]);
  expect(leaves("## Second\\\nline 2\n\nBody")).toEqual([
    ["heading2", `Second${HARD_BREAK}line 2`],
    ["text", "Body"],
  ]);
});

// md2ui: test_the_backslash_is_drawn_where_nothing_can_join (the heading cases)
test("a heading's backslash is drawn where nothing can join", () => {
  expect(leaves("# Heading\\\n\nbody")).toEqual([
    ["heading1", "Heading\\"],
    ["text", "body"],
  ]);
  expect(leaves("# Heading\\\n- item")).toEqual([
    ["heading1", "Heading\\"],
    ["list_item", "item"],
  ]);
});

// md2ui: test_a_continued_heading_takes_its_id_from_the_last_line
test("a continued heading takes its {#id} from the end of its last line", () => {
  const section = groupDocument("# Title\\\nsecond line {#hero-1}\n\nBody").children[0];
  expect(section?.heading_id).toBe("hero-1");
  expect(section?.fixed_style_key).toBe("hero");
  expect(section?.children[0]?.content).toBe(`Title${HARD_BREAK}second line`);
});

// --- escapes stop at a code span ------------------------------------------------

// md2ui: test_a_code_span_keeps_its_backslashes
test("a code span keeps its backslashes; escapes outside it resolve", () => {
  const cases: [string, string][] = [
    ["A trailing `\\` here", "A trailing `\\` here"],
    ["`\\` alone", "`\\` alone"],
    ["`a\\-b` and `x\\*y` and \\_star\\_", "`a\\-b` and `x\\*y` and _star_"],
    ["\\`not code\\` and `C:\\path`", "`not code` and `C:\\path`"],
    ["- `a\\-b`\n- `c\\/d`", "a\\-b"],
  ];
  for (const [text, want] of cases) {
    expect(leaves(text)[0]?.[1], text).toBe(want);
  }
});
