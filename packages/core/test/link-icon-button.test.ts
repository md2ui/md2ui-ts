// md2ui: an emoji-only link label in a circle or square variant is as tall as a
// text label of its variant. The glyph takes the vertical padding on every side, so wider
// left and right padding never makes an icon button bigger than the text buttons beside
// it. Measure and paint read the one `linkPill`. md2ui's
// link_variant_tests: test_an_icon_button_is_as_tall_as_a_text_button, on the
// deterministic fake measurer.
import { expect, test } from "vitest";
import { leafKit } from "../src/measure/leaf-kit.ts";
import { sizedLeaf } from "../src/measure/node-index.ts";
import { createFakeMeasurer } from "../src/text/fake-measurer.ts";
import { parseTheme } from "../src/theme/parse.ts";

const THEME = parseTheme(
  "## Links\n### Primary\nPadding top: 16\nPadding bottom: 16\nPadding left: 24\nPadding right: 24\nEmoji shape: circle\n",
);
const KIT = leafKit(THEME, createFakeMeasurer(), (path) => path ?? "OpenMoji");

const link = (label: string, isEmoji: boolean) =>
  ({
    ...sizedLeaf({ type: "link", content: `[${label}](agent:play)` } as never),
    link_variant: "primary",
    link_label: label,
    link_is_emoji: isEmoji,
  }) as never;

test("an icon button is as tall as a text button of its variant", () => {
  const textButton = KIT.linkPill(link("Play", false));
  const icon = KIT.linkPill(link("▶", true));
  expect(icon.width).toBe(icon.height);
  expect(icon.height).toBe(textButton.height);
  // Only the vertical padding: a text button keeps its own left and right padding.
  expect(textButton.width - textButton.height).toBeGreaterThan(icon.width - icon.height);
});
