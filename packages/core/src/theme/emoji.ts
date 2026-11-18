// `## Emoji styles`: the badge (`### Primary` and its variants) and text-context
// (`### Text|Link|Inline`) blocks. Ported from md2ui's `_parse_emoji_badge_line`,
// `_parse_emoji_text_line`, the `emoji styles` branch of `parse_theme`, and the
// emoji variant replay and fixed-emoji seeding that follow the file.
import type { EmojiBadgeStyle, EmojiTextStyle, ResolvedTheme } from "@md2ui/contracts";
import { partition, split, strip } from "../group/py/str.ts";
import { parseSectionLine } from "./background.ts";
import { type Draft, deepCopy, setOwn } from "./model.ts";
import {
  type BlockState,
  dropInheritedShadows,
  EMOJI_KEYS,
  hex,
  keyValue,
  newState,
  num,
  setEmojiKey,
} from "./values.ts";

/** The badge-variant blocks of `## Emoji styles`, buffered for replay after the file. */
export interface EmojiVariants {
  current: string | null;
  readonly lines: Map<string, [string, string][]>;
}

export function newEmojiVariants(): EmojiVariants {
  return { current: null, lines: new Map() };
}

type BadgeVariant = "secondary" | "tertiary" | "quaternary";

function isBadgeVariant(name: string): name is BadgeVariant {
  return name === "secondary" || name === "tertiary" || name === "quaternary";
}

type DisabledBadgeField = "disabled_bg_color" | "disabled_icon_color" | "disabled_stroke_color";

const DISABLED_BADGE_KEYS: Readonly<Record<string, DisabledBadgeField>> = Object.freeze({
  "disabled background color": "disabled_bg_color",
  "disabled icon color": "disabled_icon_color",
  "disabled stroke color": "disabled_stroke_color",
});

function parseEmojiBadgeLine(
  style: Draft<EmojiBadgeStyle>,
  line: string,
  raw: string,
  state: BlockState,
): void {
  // A top-level `- #RRGGBB` bullet under an open `Icon color` list.
  if (raw.startsWith("- ") && state.sl === "icon") {
    const cval = strip(raw.slice(2));
    if (cval.startsWith("#")) {
      const c = hex(cval);
      if (c !== undefined) style.icon_colors.push(c);
    }
    return;
  }
  if (line.includes(":") && !raw.startsWith("- ")) {
    const [key, val] = keyValue(line);
    if (key === "icon size" || key === "size") {
      style.icon_size = num(val) ?? style.icon_size;
      return;
    }
    if (key === "icon color" || key === "icon colors") {
      state.sl = "icon";
      if (val.startsWith("#")) {
        const c = hex(val);
        if (c !== undefined) style.icon_colors.push(c);
      }
      return;
    }
    if (key === "shape") {
      const v = val.toLowerCase();
      if (v === "circle" || v === "square") style.shape = v;
      return;
    }
    if (Object.hasOwn(DISABLED_BADGE_KEYS, key)) {
      // The muted badge (`~~⭐~~`), named after the badge's own keys.
      const c = hex(val);
      if (c !== undefined) style[DISABLED_BADGE_KEYS[key] as DisabledBadgeField] = c;
      return;
    }
    if (EMOJI_KEYS.includes(key)) {
      setEmojiKey(style, key, val);
      return;
    }
  }
  // Everything else (fill, padding, gradient, stroke) is a section background's.
  parseSectionLine(style.fill, line, raw, state);
}

function parseEmojiTextLine(
  style: Draft<EmojiTextStyle>,
  line: string,
  raw: string,
  state: BlockState,
): void {
  if (raw.startsWith("- ") && state.sl === "fixed") {
    const item = strip(raw.slice(2));
    const words = split(item);
    const last = words[words.length - 1];
    if (words.length >= 2 && last !== undefined) {
      const glyph = strip(item.slice(0, item.length - last.length));
      const c = hex(strip(last));
      if (glyph !== "" && c !== undefined) setOwn(style.fixed_colors, glyph, c);
    }
    return;
  }
  if (line.includes(":") && !raw.startsWith("- ")) {
    const [key, val] = keyValue(line);
    if (key === "color") {
      const c = hex(val);
      if (c !== undefined) style.color = c;
    } else if (key === "font") {
      if (val !== "" && !val.startsWith("(")) style.font_path = val;
    } else if (key === "fixed colors") {
      state.sl = "fixed";
    }
  }
}

/** `## Emoji styles`. */
export function emojiStylesSection(
  theme: Draft<ResolvedTheme>,
  variants: EmojiVariants,
): (line: string, raw: string) => void {
  type Target =
    | { kind: "badge"; style: Draft<EmojiBadgeStyle> }
    | { kind: "text"; style: Draft<EmojiTextStyle> };
  let target: Target | null = null;
  let state = newState("stroke");
  return (line, raw) => {
    if (line.startsWith("### ")) {
      const sub = strip(line.slice(4)).toLowerCase();
      state = newState();
      if (sub.startsWith("primary")) {
        target = { kind: "badge", style: theme.emojis.primary };
      } else if (sub.startsWith("text")) {
        target = { kind: "text", style: theme.emojis.text };
      } else if (sub.startsWith("link")) {
        target = { kind: "text", style: theme.emojis.link };
      } else if (sub.startsWith("inline")) {
        target = { kind: "text", style: theme.emojis.inline };
      } else {
        const first = split(sub)[0] ?? "";
        if (isBadgeVariant(first)) {
          // A badge variant: buffered raw, replayed onto a copy of Primary after the file.
          variants.current = first;
          if (!variants.lines.has(first)) variants.lines.set(first, []);
          target = null;
          return;
        }
        target = null;
      }
      variants.current = null;
      return;
    }
    // A variant block buffers every line verbatim, ahead of the top-level `Font:` below.
    if (variants.current !== null) {
      const buffered = variants.lines.get(variants.current);
      if (buffered === undefined) variants.lines.set(variants.current, [[line, raw]]);
      else buffered.push([line, raw]);
    } else if (target === null && line.includes(":") && !line.startsWith("- ")) {
      const [key, , val] = partition(line, ":");
      const v = strip(val);
      if (strip(key).toLowerCase() === "font" && v !== "" && !v.startsWith("(")) {
        theme.emojis.font_path = v;
      }
    } else if (target?.kind === "badge") {
      parseEmojiBadgeLine(target.style, line, raw, state);
    } else if (target?.kind === "text") {
      parseEmojiTextLine(target.style, line, raw, state);
    }
  };
}

/** Badge variants replayed onto Primary, and fixed emoji pins seeded into the text styles. */
export function finishEmojis(theme: Draft<ResolvedTheme>, variants: EmojiVariants): void {
  for (const [name, lines] of variants.lines) {
    if (!isBadgeVariant(name)) continue;
    const style = deepCopy(theme.emojis.primary);
    const state = newState();
    const declared = new Set<boolean>();
    for (const [line, raw] of lines) {
      // A list-valued key replaces what it inherited: a variant that states its own
      // palette means that palette, not Primary's plus its own. Shadows too, kind by kind.
      const key = strip(partition(line, ":")[0]).toLowerCase();
      style.fill.shadows = dropInheritedShadows(style.fill.shadows, declared, key, raw);
      if (key === "background color" || key === "background colors") style.fill.bg_colors = [];
      else if (key === "icon color" || key === "icon colors") style.icon_colors = [];
      else if (key === "stroke color" || key === "stroke colors") style.fill.stroke_colors = [];
      parseEmojiBadgeLine(style, line, raw, state);
    }
    theme.emojis[name] = style;
  }

  // A fixed emoji pin is about the glyph, so the inline-run styles inherit it unless
  // they state their own. The pin's scope has no meaning for one glyph in a run.
  for (const style of [theme.emojis.text, theme.emojis.link, theme.emojis.inline]) {
    for (const [glyph, [color]] of Object.entries(theme.fixed.emoji)) {
      if (!Object.hasOwn(style.fixed_colors, glyph)) setOwn(style.fixed_colors, glyph, color);
    }
  }
}
