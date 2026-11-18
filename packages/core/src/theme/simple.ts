// The small `## ` blocks of THEME.md, ported from md2ui's `pipeline/theme.py`: Content
// arrangement (Bento targeting), Content Weight, Horizontal Rule, Separators, Vertical
// Rule and Fonts. Each handler keeps its block state in its closure.
import type { HeadingLevel, ResolvedTheme } from "@md2ui/contracts";
import { pyMax, pyMin } from "../group/py/math.ts";
import { firstInt, partition, strip } from "../group/py/str.ts";
import type { Draft } from "./model.ts";
import { parseHorizontalRuleLine } from "./scope.ts";
import { hex, isYes, keyValue, num } from "./values.ts";

type Section = (line: string, raw: string) => void;

function headingLevel(n: number): HeadingLevel {
  return pyMax(1, pyMin(6, n)) as HeadingLevel;
}

/** `## Content arrangement`: `### Bento` then `Heading level: N`. */
export function contentArrangementSection(theme: Draft<ResolvedTheme>): Section {
  let mode = "";
  return (line) => {
    if (line.startsWith("### ")) {
      mode = strip(line.slice(4)).toLowerCase();
      return;
    }
    if (mode === "bento") {
      const [key, , val] = partition(line, ":");
      if (["heading level", "level"].includes(strip(key).toLowerCase())) {
        const n = firstInt(val);
        if (n !== undefined) theme.bento.heading_level = headingLevel(n);
      }
    }
  };
}

/** `## Content Weight`. */
export function contentWeightSection(theme: Draft<ResolvedTheme>): Section {
  return (line) => {
    if (!line.includes(":") || line.startsWith("- ")) return;
    const [key, val] = keyValue(line);
    const w = theme.content_weight;
    if (key === "first scale") w.first_scale = num(val) ?? w.first_scale;
    else if (key === "second scale") w.second_scale = num(val) ?? w.second_scale;
    else if (key === "less scale") w.less_scale = num(val) ?? w.less_scale;
    else if (key === "less color") w.less_color = hex(val) ?? w.less_color;
  };
}

/** `## Horizontal Rule`. */
export function horizontalRuleSection(theme: Draft<ResolvedTheme>): Section {
  return (line) => parseHorizontalRuleLine(theme.horizontal_rule, line);
}

/** `## Separators`. */
export function separatorsSection(theme: Draft<ResolvedTheme>): Section {
  return (line) => {
    if (!line.includes(":") || line.startsWith("- ")) return;
    const [key, val] = keyValue(line);
    const shown = val.toLowerCase() === "show" || isYes(val);
    if (key === "dash") theme.separators.dash = shown;
    else if (key === "bar") theme.separators.bar = shown;
  };
}

/** `## Vertical Rule`. */
export function verticalRuleSection(theme: Draft<ResolvedTheme>): Section {
  return (line) => {
    if (!line.includes(":") || line.startsWith("- ")) return;
    const [key, val] = keyValue(line);
    const v = theme.vertical_rule;
    if (key === "draw") v.draw = isYes(val);
    else if (key === "stroke color") v.stroke_color = hex(val) ?? v.stroke_color;
    else if (key === "stroke width") v.stroke_width = num(val) ?? v.stroke_width;
  };
}

/** `## Fonts`: one path or URL per bullet. */
export function fontsSection(theme: Draft<ResolvedTheme>): Section {
  return (line) => {
    if (!line.startsWith("- ")) return;
    const val = strip(line.slice(2));
    if (val !== "" && !val.toLowerCase().startsWith("url or path")) theme.font_paths.push(val);
  };
}
