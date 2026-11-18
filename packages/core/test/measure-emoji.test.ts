// Emoji in measurement: a keycap belongs to the emoji run (md2ui
// `_KEYCAP_RE`); a button label's `Emoji gap` replaces the spaces beside a
// leading or trailing emoji, and an element's `Emoji weight` asks its emoji at that
// weight; the small-button variants have faces of their own. The
// emoji keys ask for an instance of the emoji font, a family of its own.
import type { FontSpec, TextMeasurer } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { RegexKit } from "../src/group/py/re.ts";
import { emojiVariations, fontSet } from "../src/measure/font-set.ts";
import { labelRunsAdvance, leafKit, linkLabelFonts } from "../src/measure/leaf-kit.ts";
import { sizedLeaf } from "../src/measure/node-index.ts";
import { emojiEnds, emojiRuns } from "../src/measure/text-runs.ts";
import { createFakeMeasurer } from "../src/text/fake-measurer.ts";
import { parseTheme } from "../src/theme/parse.ts";

const emojiFamily = (path: string | null): string => (path === null ? "OpenMoji" : path);
const link = (content: string, variant = "primary") =>
  ({
    ...sizedLeaf({ type: "link", content: `[${content}](/x)` } as never),
    link_variant: variant,
    link_label: content,
  }) as never;

test("a keycap is one emoji run, its digit included", () => {
  expect(emojiRuns("Press 1️⃣ now")).toEqual([
    ["Press ", false],
    ["1️⃣", true],
    [" now", false],
  ]);
  expect(emojiRuns("#⃣")).toEqual([["#⃣", true]]);
  expect(emojiRuns("1 2")).toEqual([["1 2", false]]);
});

test("the emoji ends of a label: several, apart or not, and only beside words", () => {
  expect(emojiEnds("⭐ Save")).toEqual({ lead: 1, start: 2, end: 6, trail: 6 });
  expect(emojiEnds("Next ➜")).toEqual({ lead: 0, start: 0, end: 4, trail: 5 });
  expect(emojiEnds("⭐ ⭐  Save ⭐")).toEqual({ lead: 3, start: 5, end: 9, trail: 10 });
  expect(emojiEnds("Save")).toBeNull();
  expect(emojiEnds("⭐")).toBeNull();
  expect(emojiEnds("⭐ ⭐")).toBeNull();
});

const THEME = `## Links
Emoji gap: 16
Emoji weight: 700

### Tertiary
Emoji gap: 0
Emoji weight: 300

### Quinary
Fill color: #000000

## Text Styles

Links Quinary
- Font Name: Space Grotesk
- Font weight: 600
`;

test("an Emoji gap replaces the typed spaces, none, one or several", () => {
  const fonts = fontSet(parseTheme(THEME), emojiFamily);
  const kit = new RegexKit();
  const texts = (label: string, variant?: string) =>
    linkLabelFonts(kit, link(label, variant), fonts).runs.map((r) => [r.text, r.gap]);
  const gapped = [
    ["⭐", null],
    [" ", 16],
    ["Save", null],
  ];
  expect(texts("⭐Save")).toEqual(gapped);
  expect(texts("⭐ Save")).toEqual(gapped);
  expect(texts("⭐   Save")).toEqual(gapped);
  expect(texts("Next ➜")).toEqual([
    ["Next", null],
    [" ", 16],
    ["➜", null],
  ]);
  // A gap of 0 removes the spaces and adds nothing.
  expect(texts("⭐ Save", "tertiary")).toEqual([
    ["⭐", null],
    ["Save", null],
  ]);
  // Words alone keep their spaces.
  expect(texts("Save it")).toEqual([["Save it", null]]);
});

test("a gap adds its width, and the label's emoji ask the variant's Emoji weight", () => {
  const asked: FontSpec[] = [];
  const advance = (text: string, font: FontSpec): number => {
    asked.push(font);
    return text.length;
  };
  const measurer: TextMeasurer = createFakeMeasurer(advance);
  const fonts = fontSet(parseTheme(THEME), emojiFamily);
  const kit = new RegexKit();
  const { runs, emojiKeys } = linkLabelFonts(kit, link("⭐ Save"), fonts);
  expect(emojiKeys?.emoji_weight).toBe(700);
  expect(labelRunsAdvance(measurer, runs, fonts.linkEmoji, 16, emojiKeys)).toBe(1 + 16 + 4);
  expect(asked.map((f) => [f.families[0], f.weight])).toEqual([
    ["OpenMoji (wght 700)", 700],
    [fonts.typeface.family, 400],
  ]);
  const weightOf = (variant: string) =>
    linkLabelFonts(kit, link("⭐ Save", variant), fonts).emojiKeys?.emoji_weight;
  expect(weightOf("tertiary")).toBe(300);
  // An unknown variant resolves to Primary.
  expect(weightOf("pill")).toBe(700);
});

test("a small button with its own text style draws in its own face", () => {
  const fonts = fontSet(parseTheme(THEME), emojiFamily);
  expect(linkLabelFonts(new RegexKit(), link("Go", "quinary"), fonts).face).toEqual({
    family: "Space Grotesk",
    weight: 600,
    italic: false,
  });
});

test("a badge asks its glyph at its variant's Emoji weight, else at the text's", () => {
  const theme = parseTheme("## Emoji styles\n\n### Secondary\nEmoji weight: 700\n");
  const asked: FontSpec[] = [];
  const measurer = createFakeMeasurer((text, font) => {
    asked.push(font);
    return text.length;
  });
  const leaves = leafKit(theme, measurer, emojiFamily);
  const badge = (variant: string | null) =>
    ({ ...sizedLeaf({ type: "emoji", content: "⭐" } as never), emoji_variant: variant }) as never;
  leaves.emojiLeafSize(badge("secondary"));
  leaves.emojiLeafSize(badge(null));
  expect(asked.map((f) => [f.families[0], f.weight])).toEqual([
    ["OpenMoji (wght 700)", 700],
    ["OpenMoji", 400],
  ]);
});

test("every emoji font instance the theme asks for is named once, after its keys", () => {
  const theme = parseTheme(
    [
      "## Links",
      "### Primary",
      "Emoji weight: 500",
      "Emoji optical size: auto",
      "## Inline Code",
      "Emoji weight: 500",
      "Emoji optical size: auto",
      "## Emoji styles",
      "### Primary",
      "Emoji fill: 1",
      "Emoji grade: -25",
      "",
    ].join("\n"),
  );
  // Buttons and chips asking alike share one instance; the badge variants inherit Primary's.
  expect(emojiVariations(theme, emojiFamily).map((v) => [v.family, v.settings])).toEqual([
    ["OpenMoji (FILL 1 GRAD -25)", '"FILL" 1, "GRAD" -25'],
    ["OpenMoji (wght 500 opsz auto)", ""],
  ]);
  // The platform's own emoji face is never varied: the host has no file to vary.
  expect(emojiVariations(theme, () => "emoji")).toEqual([]);
  expect(emojiVariations(parseTheme(""), emojiFamily)).toEqual([]);
});
