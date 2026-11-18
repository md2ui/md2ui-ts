// A `...` inside a painted card keeps every region inside it (md2ui
// `render_place._col_spring_gaps`): the spring measures each region as the placement
// loop reserves it, so a region that paints a surface of its own (here a quote) counts
// that surface's padding, which is not surplus to push the caption down with.
// md2ui's own `tests/column_spring_tests.py` cards do not reach this
// (their lines stay one box); a quote region still does. The tree is md2ui's grouping
// of the document below (empty fields and fingerprints dropped),
// so the test does not depend on this port's grouper. A natural-height spring would
// move this card's caption; the wrap-aware one puts it on the card's floor.
import type { GroupingNode } from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { paintGrouping } from "./scene-kit.ts";

// ## \n> quoted line\n...\n_Caption_\n\n## \n__Secure__\n...\n_Short caption_\n
const CARDS = {
  content: "",
  type: "root",
  node_id: "",
  children: [
    {
      node_id: "0",
      content: "",
      type: "group",
      children: [
        {
          node_id: "0.0",
          content: "quoted line",
          type: "blockquote",
          authored_valign: "top",
          rotation_chain: [2],
          text_style_chain: ["root", "heading:2", "quotes"],
          rotation_path: [0],
          avg_word_count: 2.0,
          text_length_category: "very_short",
          content_length_category: "very_short",
          children: [],
        },
        {
          node_id: "0.1",
          content: "Caption",
          type: "text",
          authored_valign: "bottom",
          source_line_id: 1,
          text_style: "muted",
          rotation_chain: [2],
          text_style_chain: ["root", "heading:2"],
          rotation_path: [0],
          avg_word_count: 1.33,
          text_length_category: "very_short",
          content_length_category: "one_word",
          children: [],
        },
      ],
      glued_content_group: true,
      valign_group: true,
      heading_group: true,
      heading_level: 2,
      text_style_chain: ["root", "heading:2"],
      avg_word_count: 3.0,
      text_length_category: "very_short",
      content_length_category: "very_short",
      child_types: ["blockquote", "text"],
      child_type_counts: { blockquote: 1, text: 1 },
    },
    {
      node_id: "1",
      content: "",
      type: "group",
      children: [
        {
          node_id: "1.0",
          content: "Secure",
          type: "text",
          authored_valign: "top",
          source_line_id: 2,
          text_style: "lead",
          rotation_chain: [2],
          text_style_chain: ["root", "heading:2"],
          rotation_path: [1],
          avg_word_count: 1.33,
          text_length_category: "very_short",
          content_length_category: "one_word",
          glued_content_id: 1,
          children: [],
        },
        {
          node_id: "1.1",
          content: "Short caption",
          type: "text",
          authored_valign: "bottom",
          source_line_id: 3,
          text_style: "muted",
          rotation_chain: [2],
          text_style_chain: ["root", "heading:2"],
          rotation_path: [1],
          avg_word_count: 1.33,
          text_length_category: "very_short",
          content_length_category: "very_short",
          glued_content_id: 1,
          children: [],
        },
      ],
      glued_content_group: true,
      valign_group: true,
      heading_group: true,
      heading_level: 2,
      rotation_index: 1,
      text_style_chain: ["root", "heading:2"],
      avg_word_count: 3.0,
      text_length_category: "very_short",
      content_length_category: "very_short",
      child_types: ["text", "text"],
      child_type_counts: { text: 2 },
    },
  ],
  top_heading_level: 2,
  text_style_chain: ["root"],
  avg_word_count: 6.0,
  text_length_category: "very_short",
  content_length_category: "very_short",
  child_types: ["group", "group"],
  child_type_counts: { group: 2 },
} as unknown as GroupingNode;

// The padding `data/markdown/tests/THEME.md` gives a card and a quote.
const THEME = [
  "## Styling & Spacing",
  "### Heading 2",
  "Background color: #FDFDFD",
  "Padding: 24",
  "### Quotes",
  "Padding top: 6",
  "Padding bottom: 6",
  "Padding left: 8",
  "",
].join("\n");

describe("a spring inside a card", () => {
  for (const width of [767, 1280]) {
    it(`puts each caption on its card's floor, past a quote region (${width})`, () => {
      const { scene } = paintGrouping(CARDS, THEME, width);
      const cards = scene.sections.filter((s) => s.kind === "section" && s.level === 2);
      const captions = scene.boxes.filter((b) => b.content_id === "0.1" || b.content_id === "1.1");
      expect(captions).toHaveLength(2);
      for (const b of captions) {
        const cx = b.x + b.width / 2;
        const card = cards
          .filter((s) => s.x <= cx && cx <= s.x + s.width && s.y <= b.y)
          .reduce((a, s) => (s.y > a.y ? s : a));
        expect(b.y + b.height).toBeCloseTo(card.y + card.height - card.padding.bottom, 1);
      }
    });
  }
});
