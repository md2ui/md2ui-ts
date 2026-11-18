// Text styles: `- Font name|size|weight|color` and `- Marker text|background color`
// entries, the `## Text Styles` block that routes them to a style, and the
// level-local patches of `## Styling & Spacing`. Ported from md2ui's
// `_set_text_style_field`, `_apply_text_style_patch_bullet` and
// `_apply_text_style_bullet`.
import type {
  HeadingLevel,
  ResolvedTheme,
  TextPatchProperty,
  TextStyle,
  TextStylePatch,
} from "@md2ui/contracts";
import { partition, strip } from "../group/py/str.ts";
import { isLinkButtonVariant } from "./links.ts";
import { argb, type Draft, MUTED_TEXT_COLOR, newTextStyle, takeOverLinks } from "./model.ts";
import { type BlockState, type ColorsAttr, hex, newState, num } from "./values.ts";

/** Text-style bullets md2ui collects whole and applies after the file is read. */
export interface DeferredTextStyles {
  /** `Muted` / `Lead` / `Display` bullets: tier → key → value. */
  readonly tiers: Map<Tier, Map<string, string>>;
  /** `Inline Code <Variant>` bullets, as a patch of what each variant stated. */
  readonly inlineCode: Map<string, Draft<TextStylePatch>>;
}

type Tier = "muted" | "lead" | "display";

export function newDeferredTextStyles(): DeferredTextStyles {
  return { tiers: new Map(), inlineCode: new Map() };
}

// The chip wrapper variants, by wrapper: `*x*` `**x**` `***x***`, then `_x_` `__x__`
// `___x___`.
export const CHIP_VARIANTS = Object.freeze([
  "secondary",
  "tertiary",
  "quaternary",
  "quinary",
  "senary",
  "septenary",
] as const);
export type ChipVariant = (typeof CHIP_VARIANTS)[number];

export function isChipVariant(name: string): name is ChipVariant {
  return (CHIP_VARIANTS as readonly string[]).includes(name);
}

// The list a valueless colour key opens, and the scalar that mirrors its first entry.
const LIST_KEYS: Readonly<Record<string, ColorsAttr>> = Object.freeze({
  "font color": "colors",
  "font colors": "colors",
  "marker text color": "marker_text_colors",
  "marker background color": "marker_bg_colors",
});
const SCALAR_OF = Object.freeze({
  colors: "color",
  marker_text_colors: "marker_text_color",
  marker_bg_colors: "marker_bg_color",
} as const);

/**
 * One `Font X: value` / `Marker X: value` entry, in place. A valueless colour key opens
 * that colour's list form, recorded in `state`, for the nested `  - #RRGGBB` bullets.
 */
export function setTextStyleField(
  ts: Draft<TextStyle>,
  key: string,
  val: string,
  state?: BlockState,
): void {
  if (state !== undefined && val === "" && Object.hasOwn(LIST_KEYS, key)) {
    state.colors_ts = ts;
    state.colors_attr = LIST_KEYS[key] ?? "colors";
  }
  const c = val.startsWith("#") ? hex(val) : undefined;
  switch (key) {
    case "font name":
      if (val !== "") ts.font_name = val;
      break;
    case "font size":
      ts.font_size = num(val) ?? ts.font_size;
      break;
    case "font weight":
      if (val !== "") ts.font_weight = val;
      break;
    case "font color":
      if (c !== undefined) {
        ts.colors.push(c);
        ts.color = ts.colors[0] ?? ts.color;
      } else {
        ts.color = hex(val) ?? ts.color;
      }
      break;
    case "marker text color":
      if (c !== undefined) {
        ts.marker_text_colors.push(c);
        ts.marker_text_color = ts.marker_text_colors[0] ?? null;
      }
      break;
    case "marker background color":
      if (c !== undefined) {
        ts.marker_bg_colors.push(c);
        ts.marker_bg_color = ts.marker_bg_colors[0] ?? null;
      }
      break;
    default:
      // `font colors` only opens its list; anything else is not a text-style key.
      break;
  }
}

/** A `#RRGGBB` bullet under an open colour list, appended to that list. */
function appendOpenColor(line: string, state: BlockState): void {
  const ts = state.colors_ts;
  const c = hex(strip(line));
  if (ts === null || c === undefined) return;
  const attr = state.colors_attr ?? "colors";
  const values = ts[attr];
  values.push(c);
  ts[SCALAR_OF[attr]] = values[0] ?? c;
}

const PATCH_PROPERTIES: Readonly<Record<string, TextPatchProperty>> = Object.freeze({
  "font name": "font_name",
  "font size": "font_size",
  "font weight": "font_weight",
  "font color": "color",
  "font colors": "color",
  "marker text color": "marker_text_color",
  "marker background color": "marker_bg_color",
});

export function newTextStylePatch(): Draft<TextStylePatch> {
  return { style: newTextStyle(), declared: [] };
}

/** One bullet of a level-local text role, remembering which property was authored. */
export function applyPatchBullet(
  line: string,
  patch: Draft<TextStylePatch>,
  state: BlockState,
): void {
  if (line.startsWith("#")) {
    appendOpenColor(line, state);
    return;
  }
  const [k, found, val] = partition(line, ":");
  if (!found) return;
  const key = strip(k).toLowerCase();
  const declared = Object.hasOwn(PATCH_PROPERTIES, key) ? PATCH_PROPERTIES[key] : undefined;
  if (declared === undefined) {
    state.colors_ts = null;
    state.colors_attr = null;
    return;
  }
  if (!patch.declared.includes(declared)) {
    patch.declared.push(declared);
    patch.declared.sort();
  }
  setTextStyleField(patch.style, key, strip(val), state);
}

/** `TextStylePatch.apply`: `base` with only the declared properties replaced. */
export function applyPatch(patch: Draft<TextStylePatch>, base: Draft<TextStyle>): Draft<TextStyle> {
  const result: Draft<TextStyle> = {
    ...base,
    colors: [...base.colors],
    marker_text_colors: [...base.marker_text_colors],
    marker_bg_colors: [...base.marker_bg_colors],
  };
  const { style, declared } = patch;
  if (declared.includes("font_name")) result.font_name = style.font_name;
  if (declared.includes("font_size")) result.font_size = style.font_size;
  if (declared.includes("font_weight")) result.font_weight = style.font_weight;
  if (declared.includes("color")) {
    result.color = style.color;
    result.colors = [...style.colors];
  }
  if (declared.includes("marker_text_color")) {
    result.marker_text_color = style.marker_text_color;
    result.marker_text_colors = [...style.marker_text_colors];
  }
  if (declared.includes("marker_bg_color")) {
    result.marker_bg_color = style.marker_bg_color;
    result.marker_bg_colors = [...style.marker_bg_colors];
  }
  return result;
}

/** `- Font size: 12` → `["font size", "12"]`; anything else → `undefined`. */
export function fontBullet(line: string): [string, string] | undefined {
  if (!line.startsWith("- ")) return undefined;
  const bullet = strip(line.slice(2));
  const lower = bullet.toLowerCase();
  if (!(lower.startsWith("font") || lower.startsWith("marker")) || !bullet.includes(":")) {
    return undefined;
  }
  const [k, , v] = partition(bullet, ":");
  return [strip(k).toLowerCase(), strip(v)];
}

const HEADING_SIZES = Object.freeze([28, 22, 18, 15, 13, 12] as const);
const HEADING_GRAYS = Object.freeze([10, 25, 40, 55, 70, 85] as const);

/** A heading level's style before THEME.md says anything about it. */
function defaultHeadingStyle(level: HeadingLevel): Draft<TextStyle> {
  const gray = HEADING_GRAYS[level - 1] ?? 60;
  return newTextStyle({
    font_name: "", // the body family
    font_size: HEADING_SIZES[level - 1] ?? 13,
    color: argb(255, gray, gray, gray),
  });
}

/**
 * A display tier derived from the body style, so a theme that only restyles `Text`
 * keeps its tiers in proportion.
 */
function defaultTierStyle(tier: Tier, theme: Draft<ResolvedTheme>): Draft<TextStyle> {
  const text = theme.text;
  const [scale, weight, color] =
    tier === "muted"
      ? [0.85, "", MUTED_TEXT_COLOR]
      : tier === "lead"
        ? [1.25, "", text.color]
        : [2.0, "bold", text.color];
  return newTextStyle({
    font_name: text.font_name,
    font_size: text.font_size * scale,
    font_weight: weight,
    color,
  });
}

/** `InlineCodeTheme.effective_text_style`: the configured style, else the body at 14px. */
export function effectiveInlineCodeStyle(
  configured: Draft<TextStyle> | null,
  body: Draft<TextStyle>,
): Draft<TextStyle> {
  return (
    configured ??
    newTextStyle({
      font_name: body.font_name,
      font_size: 14,
      font_weight: body.font_weight,
      color: body.color,
    })
  );
}

/**
 * One `## Text Styles` bullet, routed by its subsection (lowercased, spaces removed).
 * `line` is the bullet without its `- `.
 */
function applyTextStyleBullet(
  line: string,
  subsection: string,
  theme: Draft<ResolvedTheme>,
  deferred: DeferredTextStyles,
  state: BlockState,
): void {
  if (line.startsWith("#")) {
    appendOpenColor(line, state);
    return;
  }
  const [k, found, v] = partition(line, ":");
  if (!found) return;
  const key = strip(k).toLowerCase();
  const val = strip(v);
  // Any keyed bullet closes an open colour list; a valueless colour key reopens one.
  state.colors_ts = null;
  state.colors_attr = null;

  if (subsection.startsWith("heading") && /^[0-9]+$/.test(subsection.slice(7))) {
    const level = Number(subsection.slice(7));
    if (level >= 1 && level <= 6) {
      const h = level as HeadingLevel;
      const ts = theme.headings[h] ?? defaultHeadingStyle(h);
      theme.headings[h] = ts;
      setTextStyleField(ts, key, val, state);
    }
  } else if (subsection === "text") {
    setTextStyleField(theme.text, key, val, state);
  } else if (subsection === "labels") {
    setTextStyleField(theme.labels, key, val, state);
  } else if (subsection === "key" || subsection === "value") {
    const attr = subsection === "key" ? "key_style" : "value_style";
    const ts = theme[attr] ?? newTextStyle();
    theme[attr] = ts;
    setTextStyleField(ts, key, val, state);
  } else if (subsection === "muted" || subsection === "lead" || subsection === "display") {
    const fields = deferred.tiers.get(subsection) ?? new Map<string, string>();
    fields.set(key, val);
    deferred.tiers.set(subsection, fields);
  } else if (subsection.startsWith("inlinecode")) {
    const variant = subsection.slice("inlinecode".length);
    if (isChipVariant(variant)) {
      const patch = deferred.inlineCode.get(variant) ?? newTextStylePatch();
      deferred.inlineCode.set(variant, patch);
      // The patch bullet re-reads the whole line, as md2ui passes it the line.
      applyPatchBullet(line, patch, state);
      return;
    }
    const ts = theme.inline_code.text_style ?? newTextStyle();
    theme.inline_code.text_style = ts;
    setTextStyleField(ts, key, val, state);
  } else if (subsection === "codeblock") {
    setTextStyleField(theme.code_blocks.text_style, key, val, state);
  } else if (subsection === "links") {
    takeOverLinks(theme.links);
    const ts = theme.links.primary.text_style ?? newTextStyle();
    theme.links.primary.text_style = ts;
    setTextStyleField(ts, key, val, state);
  } else if (subsection.startsWith("links")) {
    const name = subsection.slice("links".length);
    if (isLinkButtonVariant(name) || name === "text") {
      takeOverLinks(theme.links);
      const link = theme.links[name];
      // "" is the body family: a variant names its own only by stating it.
      const ts = link.text_style ?? newTextStyle({ font_name: "" });
      link.text_style = ts;
      setTextStyleField(ts, key, val, state);
    }
  }
}

/**
 * The deferred styles, once the whole file is read: each tier on its body-derived
 * default (`Text` is final by then, so block order never matters).
 */
export function applyDeferredTextStyles(
  theme: Draft<ResolvedTheme>,
  deferred: DeferredTextStyles,
): void {
  for (const [tier, fields] of deferred.tiers) {
    const style = defaultTierStyle(tier, theme);
    for (const [key, val] of fields) setTextStyleField(style, key, val);
    theme[tier] = style;
  }
}

// md2ui's pattern ends in `:?\s*$`; the line is already stripped, so `\s*` matches nothing.
const SUBSECTION = /^[A-Za-z][A-Za-z0-9 ]*:?$/;

/** `## Text Styles`: a bare `Name:` line opens a subsection, `- ` bullets style it. */
export function textStylesSection(
  theme: Draft<ResolvedTheme>,
  deferred: DeferredTextStyles,
): (line: string, raw: string) => void {
  let subsection = "";
  let state = newState();
  return (line) => {
    if (line.startsWith("- ")) {
      applyTextStyleBullet(line.slice(2), subsection, theme, deferred, state);
    } else if (SUBSECTION.test(line)) {
      subsection = strip(line.replace(/:+$/, "")).toLowerCase().replaceAll(" ", "");
      state = newState();
    }
  };
}

/**
 * A marker block's bullet that is not one of its colour lists: a `#RRGGBB` under an
 * open text colour list lands in it, and any keyed bullet closes the list. (md2ui
 * routes it through `_apply_text_style_bullet` with no subsection, which styles nothing.)
 */
export function markerTextBullet(value: string, state: BlockState): void {
  if (value.startsWith("#")) {
    appendOpenColor(value, state);
  } else if (value.includes(":")) {
    state.colors_ts = null;
    state.colors_attr = null;
  }
}
