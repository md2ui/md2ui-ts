// md2ui rules these tests pin, beside the signed chip
// (`draw-pins.test.ts`) and the line chart's default (`line-charts-batch-30.test.ts`):
// `\>` at a line start is text, not a quote, and with no theme md2ui draws in
// greys, every element reading as what it is: buttons are grey pills until a
// theme styles links, a ticked task box the theme leaves unstyled shows its tick, and an
// image's placeholder text shows when the theme declares no placeholders at all. Expected
// values are md2ui's own tests (markdown_preprocessing_tests, theme_model_tests), and
// md2ui's drawers read for the two cases its tests do not reach.
import type { DisplayEntry, FillEntry } from "@md2ui/contracts";
import { describe, expect, test } from "vitest";
import { groupDocument } from "../src/group/grouper.ts";
import type { GroupNode } from "../src/group/node.ts";
import { linkStyle } from "../src/measure/theme-styles.ts";
import { GREY_INK, GREY_LIGHT, GREY_TRACK, GREY_WHITE } from "../src/theme/model.ts";
import { parseTheme } from "../src/theme/parse.ts";
import { paintMarkdown } from "./scene-kit.ts";

const leaves = (n: GroupNode): GroupNode[] =>
  n.children.length === 0 ? [n] : n.children.flatMap(leaves);

// md2ui markdown_preprocessing_tests: test_an_escaped_angle_is_text_not_a_quote
test("an escaped angle is text that starts with an angle, never a quote", () => {
  for (const [text, want] of [
    ["\\> Not a quote", ["text", "> Not a quote"]],
    ["Price \\> 100", ["text", "Price > 100"]],
    ["> A quote", ["blockquote", "A quote"]],
  ] as const) {
    const first = leaves(groupDocument(text))[0];
    expect([first?.type, first?.content], text).toEqual(want);
  }
});

describe("links with no theme, and once a theme styles them", () => {
  // md2ui theme_model_tests: test_unthemed_buttons_are_grey_pills
  test("unthemed buttons are grey pills, and a Text link stays plain", () => {
    const theme = parseTheme("");
    expect(theme.links.themed).toBe(false);
    expect(theme.links.primary.fill_color).toBe(GREY_INK);
    expect(theme.links.primary.corner_radius).toBe(999);
    expect(linkStyle(theme, "secondary").stroke_color).toBe(GREY_INK);
    expect(linkStyle(theme, "secondary").fill_color).toBe(GREY_WHITE);
    expect(linkStyle(theme, "tertiary").fill_color).toBe(GREY_TRACK);
    expect(linkStyle(theme, "text").fill_color).toBe(0);
  });

  // md2ui theme_model_tests: test_a_theme_that_styles_links_starts_unpainted
  test("a theme that styles links starts unpainted, in either place it can", () => {
    for (const text of [
      "## Links\n### Primary\nCorner radius: 8\n",
      "## Text Styles\nLinks Secondary\n- Font size: 15\n",
    ]) {
      const theme = parseTheme(text);
      expect(theme.links.themed, text).toBe(true);
      expect(theme.links.primary.fill_color).toBe(0);
      expect(theme.links.primary.padding).toEqual({ top: 10, left: 10, right: 10, bottom: 10 });
      expect(linkStyle(theme, "tertiary").fill_color).toBe(theme.links.primary.fill_color);
    }
  });
});

const fills = (list: readonly DisplayEntry[]): FillEntry[] =>
  list.filter((e): e is FillEntry => e.type === "fill");
const css = (argb: number): string =>
  `#${(argb & 0xffffff).toString(16).padStart(6, "0")}${(argb >>> 24).toString(16)}`;
const words = (list: readonly DisplayEntry[]): string[] =>
  list.flatMap((e) => (e.type === "text" ? e.runs.map((r) => r.text) : []));

// md2ui render_drawing_elements.draw_task_control
test("an unstyled ticked box draws in ink with its tick; an open one a light ring", () => {
  const list = paintMarkdown("- [x] done\n- [ ] todo\n", "", 400).painted.list.entries;
  const colours = fills(list).map((f) => (f.paint.kind === "color" ? f.paint.color : ""));
  expect(colours).toContain(css(GREY_INK));
  expect(colours).toContain(css(GREY_LIGHT));
  expect(words(list).filter((w) => w === "✓")).toHaveLength(1);
  // A theme that styles the box and names no symbol keeps it without one.
  const styled = "## Drawing elements\n### Checked outer\nBackground color: #4F9C6B\n";
  expect(words(paintMarkdown("- [x] done\n", styled, 400).painted.list.entries)).not.toContain("✓");
});

// md2ui render_image_placeholder.named_placeholder
test("a placeholder's text shows when the theme declares no placeholders at all", () => {
  const md = "## Team\n\n![Sara Zane](?md2ui.placeholder=avatar:SZ&md2ui.shape=circle)\n";
  expect(words(paintMarkdown(md, "", 600).painted.list.entries)).toContain("SZ");
});
