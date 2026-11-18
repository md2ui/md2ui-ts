// `## Fixed colors` and `## Color Replacements`, ported from md2ui's `pipeline/theme.py`
// (`_parse_fixed_*`, `_parse_color_replacement`, `_bg_selector_key` and their two
// `parse_theme` branches). Each handler keeps its block state (open `###` / `####`
// heading, open background group) in its closure, so a new `## ` header starts clean.
import type {
  Argb,
  ColorRole,
  FixedEmojiScope,
  FixedEmojiWord,
  ResolvedTheme,
} from "@md2ui/contracts";
import { partition, split, strip } from "../group/py/str.ts";
import { type Draft, setOwn } from "./model.ts";
import { hex, styleSlug } from "./values.ts";

const REPLACEMENT_ROLES: Readonly<Record<string, ColorRole>> = Object.freeze({
  "text color": "text",
  text: "text",
  color: "text",
  from: "text",
  "fill color": "fill",
  fill: "fill",
  background: "fill",
  "background color": "fill",
  "stroke color": "stroke",
  stroke: "stroke",
  "border color": "stroke",
  border: "stroke",
});
const REPLACEMENT_TO: readonly string[] = Object.freeze([
  "replacement",
  "replace with",
  "to",
  "replacement color",
]);

const FIXED_ROLE_KEYS: Readonly<Record<string, ColorRole>> = Object.freeze({
  "text color": "text",
  text: "text",
  color: "text",
  "fill color": "fill",
  fill: "fill",
  "background color": "fill",
  "stroke color": "stroke",
  stroke: "stroke",
  "border color": "stroke",
});
// md2ui: _FIXED_SCOPES, with _FIXED_KINDS: the words a fixed emoji
// pin may end in, each as the scope word it means; `glyph` means the glyph alone.
const FIXED_WORDS: Readonly<Record<string, FixedEmojiWord | "">> = Object.freeze({
  datapoints: "datapoints",
  datapoint: "datapoints",
  line: "line",
  glyph: "",
  text: "text",
  emojis: "emojis",
  buttons: "buttons",
  chips: "chips",
});

/**
 * The lookup key for a background: its ARGB in decimal, `image`, `image:<style>` for
 * the photo one fixed style paints (`image Music player`), or `undefined`.
 */
function bgSelectorKey(val: string): string | undefined {
  const [v, , style] = partition(strip(val).toLowerCase(), " ");
  if (v === "image" || v === "photo") {
    const slug = styleSlug(style);
    return slug === "" ? "image" : `image:${slug}`;
  }
  const c = hex(strip(val));
  return c === undefined ? undefined : String(c);
}

/**
 * `- 📈 #22C55E datapoints` as glyph, colour, scope. The scope words are optional and
 * default to the glyph alone; several add up.
 */
function parseFixedEmoji(bullet: string): [string, Argb, FixedEmojiScope] | null {
  const parts = split(bullet);
  if (parts.length < 2) return null;
  const words = new Set<FixedEmojiWord>();
  while (parts.length >= 3) {
    const last = (parts.at(-1) ?? "").toLowerCase();
    if (!Object.hasOwn(FIXED_WORDS, last)) break;
    parts.pop();
    const word = FIXED_WORDS[last];
    if (word) words.add(word);
  }
  const color = hex(parts[parts.length - 1] ?? "");
  const key = strip(parts.slice(0, -1).join(" "));
  if (color === undefined || key === "") return null;
  return [key, color, [...words].sort()];
}

/** `- Sold out: Text color: #A, Fill color: #B` as key and colours by role. */
function parseFixedElement(bullet: string): [string, Partial<Record<ColorRole, Argb>>] | null {
  const roles: Partial<Record<ColorRole, Argb>> = {};
  const [head, , rest] = partition(bullet, ":");
  const key = strip(head);
  if (key === "" || strip(rest) === "") return null;
  let any = false;
  for (const part of rest.split(",")) {
    const [rk, , rv] = partition(part, ":");
    const roleKey = strip(rk).toLowerCase();
    const role = Object.hasOwn(FIXED_ROLE_KEYS, roleKey) ? FIXED_ROLE_KEYS[roleKey] : undefined;
    const c = hex(strip(rv));
    if (role !== undefined && c !== undefined) {
      roles[role] = c;
      any = true;
    }
  }
  return any ? [key, roles] : null;
}

/** `## Fixed colors`. */
export function fixedColorsSection(
  theme: Draft<ResolvedTheme>,
): (line: string, raw: string) => void {
  let block = "";
  let sub = "";
  return (line) => {
    if (line.startsWith("#### ")) {
      sub = strip(line.slice(5)).toLowerCase();
      return;
    }
    if (line.startsWith("### ")) {
      block = strip(line.slice(4)).toLowerCase();
      sub = "";
      return;
    }
    if (!line.startsWith("- ")) return;
    const bullet = strip(line.slice(2));
    if (block === "emoji" || block === "emojis") {
      const got = parseFixedEmoji(bullet);
      if (got) setOwn(theme.fixed.emoji, got[0], [got[1], got[2]]);
    } else if (block === "emoji background" || block === "emoji backgrounds") {
      const got = parseFixedEmoji(bullet);
      if (got) setOwn(theme.fixed.emoji_bg, got[0], got[1]);
    } else if (
      block === "badges" ||
      block === "badge" ||
      block === "buttons" ||
      block === "button"
    ) {
      const got = parseFixedElement(bullet);
      if (got) {
        const button = block.startsWith("button");
        const contains = sub.startsWith("contain");
        const target = button
          ? contains
            ? theme.fixed.button_contains
            : theme.fixed.button_exact
          : contains
            ? theme.fixed.pill_contains
            : theme.fixed.pill_exact;
        setOwn(target, got[0], got[1]);
      }
    } else if (block === "datapoints" || block === "datapoint") {
      const [key, , val] = partition(bullet, ":");
      const c = hex(strip(val));
      if (c !== undefined && strip(key) !== "") {
        setOwn(theme.fixed.datapoints, split(key).join(" ").toLowerCase(), c);
      }
    }
  };
}

/** One `<Role> color: X, Replacement: Y` bullet, applied to a background's group. */
function parseColorReplacement(
  group: Partial<Record<ColorRole, Record<string, Argb>>>,
  bullet: string,
): void {
  let role: ColorRole = "text";
  let src: Argb | null = null;
  let dst: Argb | null = null;
  for (const part of bullet.split(",")) {
    const [rawKey, , val] = partition(part, ":");
    const key = strip(rawKey).toLowerCase();
    const c = hex(strip(val));
    if (c === undefined) continue;
    if (Object.hasOwn(REPLACEMENT_ROLES, key)) {
      role = REPLACEMENT_ROLES[key] ?? role;
      src = c;
    } else if (REPLACEMENT_TO.includes(key)) {
      dst = c;
    }
  }
  if (dst !== null) {
    const bucket = group[role] ?? {};
    group[role] = bucket;
    bucket[String(src)] = dst;
  }
}

/** `## Color Replacements` (legacy `## Text Color Replacements`). */
export function colorReplacementsSection(
  theme: Draft<ResolvedTheme>,
): (line: string, raw: string) => void {
  let bg: string | undefined;
  return (line) => {
    if (line.startsWith("- ")) {
      if (bg !== undefined) {
        const group = theme.color_replacements[bg];
        if (group) parseColorReplacement(group, line.slice(2));
      }
    } else if (line.includes(":")) {
      const [key, , val] = partition(line, ":");
      if (
        ["on background color", "on background", "background color"].includes(
          strip(key).toLowerCase(),
        )
      ) {
        bg = bgSelectorKey(strip(val));
        if (bg !== undefined && !Object.hasOwn(theme.color_replacements, bg)) {
          theme.color_replacements[bg] = {};
        }
      }
    }
  };
}
