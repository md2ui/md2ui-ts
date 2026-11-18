// THEME.md text in, the resolved theme out. Ported from md2ui's `parse_theme`
// (`pipeline/theme.py`): the same line walk, the same `## ` blocks, the same
// defaults. Malformed text never throws: a line that does not read is skipped, and an
// unknown `## ` block or key is ignored, as md2ui ignores it. One block is md2ui-ts's
// own, `## Motion` (`motion.ts`); md2ui skips it as unknown.
import type { ResolvedTheme } from "@md2ui/contracts";
import { splitlines, strip } from "../group/py/str.ts";
import { chartsSection } from "./charts.ts";
import { codeBlocksSection } from "./code-blocks.ts";
import { colorReplacementsSection, fixedColorsSection } from "./colors.ts";
import { datapointsSection } from "./datapoints.ts";
import { emojiStylesSection, finishEmojis, newEmojiVariants } from "./emoji.ts";
import { finishInlineCode, inlineCodeSection, newCodeVariants } from "./inline-code.ts";
import { linksSection } from "./links.ts";
import { newTheme } from "./model.ts";
import { motionSection } from "./motion.ts";
import { imagesSection } from "./placeholders.ts";
import { rootSection } from "./root.ts";
import { StylingScope, sectionsSection } from "./scope.ts";
import {
  contentArrangementSection,
  contentWeightSection,
  fontsSection,
  horizontalRuleSection,
  separatorsSection,
  verticalRuleSection,
} from "./simple.ts";
import { tablesSection } from "./tables.ts";
import {
  applyDeferredTextStyles,
  newDeferredTextStyles,
  textStylesSection,
} from "./text-styles.ts";

/** One `## ` block's line reader; a fresh one starts at each `## ` header. */
type LineHandler = (line: string, raw: string) => void;

/** Parse THEME.md text. Never throws; what does not read keeps its default. */
export function parseTheme(text: string): ResolvedTheme {
  const theme = newTheme();
  const deferred = newDeferredTextStyles();
  const emojiVariants = newEmojiVariants();
  const codeVariants = newCodeVariants();
  const styling = new StylingScope(theme);

  const sectionFor = (name: string): LineHandler | undefined => {
    switch (name) {
      case "root":
        return rootSection(theme);
      case "sections":
        return sectionsSection(theme);
      case "styling & spacing":
      case "styling and spacing":
      case "background styles and spacing":
        styling.reset();
        return (line, raw) => styling.parse(line, raw);
      case "content arrangement":
        return contentArrangementSection(theme);
      case "tables":
        return tablesSection(theme);
      case "drawing elements":
      case "datapoints":
        return datapointsSection(theme);
      case "charts":
        return chartsSection(theme);
      case "text styles":
        return textStylesSection(theme, deferred);
      case "links":
        return linksSection(theme);
      case "inline code":
        return inlineCodeSection(theme, codeVariants);
      case "code blocks":
        return codeBlocksSection(theme);
      case "content weight":
        return contentWeightSection(theme);
      case "images":
        return imagesSection(theme);
      case "fixed colors":
        return fixedColorsSection(theme);
      case "color replacements":
      case "text color replacements":
        return colorReplacementsSection(theme);
      case "horizontal rule":
        return horizontalRuleSection(theme);
      case "separators":
        return separatorsSection(theme);
      case "vertical rule":
        return verticalRuleSection(theme);
      case "emoji styles":
        return emojiStylesSection(theme, emojiVariants);
      case "fonts":
        return fontsSection(theme);
      case "motion":
        return motionSection(theme);
      default:
        return undefined;
    }
  };

  let section: LineHandler | undefined;
  // Whole comments go first, so the body of a multi-line `<!-- … -->` never reads as keys.
  for (const raw of splitlines(text.replaceAll(/<!--[\s\S]*?-->/g, ""))) {
    const line = strip(raw);
    if (line === "" || line.startsWith("<!--")) continue;
    if (line.startsWith("## ")) {
      section = sectionFor(strip(line.slice(3)).toLowerCase());
      continue;
    }
    if (line.startsWith("# ")) {
      theme.name = strip(line.slice(2));
      continue;
    }
    section?.(line, raw);
  }

  // What md2ui settles once the whole file is read, so block order never matters.
  applyDeferredTextStyles(theme, deferred);
  finishEmojis(theme, emojiVariants);
  styling.resolveFixedOverrides();
  finishInlineCode(theme, codeVariants, deferred);
  return theme;
}
