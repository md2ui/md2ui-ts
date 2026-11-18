// The faces a theme's text is measured in (md2ui `FontSet`, `session.load_fonts`,
// `configure_text_typefaces`, `configure_chip_typefaces`, `configure_link_typefaces`). A face is what md2ui asks
// `resolve_typeface` for: a family, a weight and a slant. Which loaded font answers is
// the browser's business, so a face here is the request, never the font that met it.
// md2ui keeps four of these tables in module globals; here they are fields of one
// object built per theme.
import type { EmojiAxes, FontSpec, LinkStyle, ResolvedTheme, TextStyle } from "@md2ui/contracts";
import { isdigit, strip, toInt } from "../group/py/str.ts";
import { LINK_BUTTON_VARIANTS } from "../theme/links.ts";
import { CHIP_VARIANTS } from "../theme/text-styles.ts";
import { chipStyle, chipTextStyle, emojiBadgeStyle, linkStyle } from "./theme-styles.ts";

// md2ui `render_text_scopes._LINK_VARIANTS`.
const LINK_VARIANTS = ["primary", ...LINK_BUTTON_VARIANTS, "text"] as const;

/** A face as md2ui's `resolve_typeface` is asked for it. */
export interface Face {
  readonly family: string;
  readonly weight: number;
  readonly italic: boolean;
}

/** The four faces `_span_font` picks among (`FontSet`'s first four fields). */
export interface TextFaces {
  readonly typeface: Face;
  readonly bold: Face;
  readonly italic: Face;
  readonly bold_italic: Face;
}

/** The family the host loaded for an emoji font path (`null`: the theme's default emoji font). */
export type EmojiFamily = (fontPath: string | null) => string;

/**
 * An element's emoji keys: `Emoji weight`, and `Emoji fill` / `grade` / `optical size`.
 * Badge, button and chip styles each carry them.
 */
export type EmojiKeys = Pick<LinkStyle, "emoji_weight" | "emoji_axes">;

/** A button label's emoji keys, and the gap beside its emoji. */
interface LinkEmoji {
  readonly keys: EmojiKeys;
  readonly gap: number | null;
}

export interface FontSet extends TextFaces {
  /** The base inline-code chip face. */
  readonly mono: Face;
  /** The family of the theme's emoji font (`fonts.emoji`). */
  readonly emoji: string;
  /** md2ui `FontSet.text_emoji`: the family prose emoji draw in (`### Text`'s `Font:`, else `emoji`). */
  readonly textEmoji: string;
  /** md2ui `FontSet.link_emoji`: the family link-label emoji draw in (`### Link`'s `Font:`, else `emoji`). */
  readonly linkEmoji: string;
  /** md2ui `_load_emoji_typeface(path, fonts.emoji)`: a per-context override's family. */
  readonly emojiAt: (fontPath: string | null) => string;
  readonly headings: ReadonlyMap<number, TextFaces>;
  /** md2ui `_TEXT_TYPEFACES`: (folded family, weight) → faces, for local font patches. */
  readonly local: ReadonlyMap<string, TextFaces>;
  /** md2ui `_TABLE_TYPEFACES`: table text role → (regular, italic). */
  readonly tables: ReadonlyMap<"header" | "cells" | "keys", readonly [Face, Face]>;
  /** md2ui `_CHIP_TYPEFACES`: (folded family, weight) → face, for chip variants with their own. */
  readonly chips: ReadonlyMap<string, Face>;
  /**
   * md2ui `link_faces`: link variant → the faces its label draws in, for the variants
   * whose text style names a family or weight other than the body's.
   */
  readonly links: ReadonlyMap<string, TextFaces>;
  /**
   * Per link variant, the emoji keys and `Emoji gap` of its resolved style, which
   * md2ui's `link_label_fonts` reads beside the faces.
   */
  readonly linkEmojiKeys: ReadonlyMap<string, LinkEmoji>;
  /** md2ui `_INLINE_CODE_SIZE`: the base inline-code size. */
  readonly inlineCodeSize: number;
}

const WEIGHT_NAMES: Readonly<Record<string, number>> = Object.freeze({
  thin: 100,
  extralight: 200,
  "extra light": 200,
  "ultra light": 200,
  light: 300,
  regular: 400,
  normal: 400,
  "": 400,
  medium: 500,
  semibold: 600,
  "semi bold": 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  "extra bold": 800,
  ultrabold: 800,
  black: 900,
  heavy: 900,
});

/** md2ui `font_loader.weight_from_str`. */
export function weightFromStr(s: string): number {
  const t = strip(s).toLowerCase();
  if (isdigit(t)) return toInt(t);
  return Object.hasOwn(WEIGHT_NAMES, t) ? (WEIGHT_NAMES[t] as number) : 400;
}

/**
 * md2ui keys its face tables on `str.casefold()`. Lower case stands in: both sides of
 * every lookup fold the same way, and theme family names are ASCII.
 */
const fold = (name: string): string => name.toLowerCase();

export const faceKey = (name: string, weight: number): string => `${fold(name)}|${weight}`;

const face = (family: string, weight: number, italic: boolean): Face => ({
  family,
  weight,
  italic,
});

/** The C3 font of a face at a size. */
export function fontOf(f: Face, size: number): FontSpec {
  return { families: [f.family], size, weight: f.weight, italic: f.italic };
}

/**
 * The font an emoji run draws in: the emoji family first, then the face it sits in
 * (md2ui `font_runs`: the emoji face, then the text face, then the system's). An element
 * that states emoji keys asks for the instance of the emoji font they set
 * (`emojiVariant`); with no `Emoji weight`, the run asks at its text's weight. This is
 * the one place measuring and painting take an emoji's font from (ADR-403).
 */
export function emojiFontOf(
  emoji: string,
  f: Face,
  size: number,
  keys: EmojiKeys | null = null,
): FontSpec {
  return {
    families: [keys === null ? emoji : emojiVariant(emoji, keys).family, f.family],
    size,
    weight: keys?.emoji_weight ?? f.weight,
    italic: f.italic,
  };
}

/**
 * An instance of an emoji font, as one element's emoji keys set it (md2ui
 * `font_loader.varied_face`): a family of its own, which the host side registers from
 * the base family's font file with these coordinates. An axis the font lacks changes
 * nothing, and the font clamps each value to its range.
 */
export interface EmojiVariation {
  /** The family an emoji run asks for. */
  readonly family: string;
  /** The family of the font it is an instance of. */
  readonly base: string;
  /** The weight asked, or `null` for the font's own. */
  readonly weight: number | null;
  readonly axes: EmojiAxes;
  /**
   * The axes other than weight as CSS `font-variation-settings` (`"FILL" 1, "GRAD" -25`),
   * empty when none is set to a value. An `auto` optical size states none: the engine's
   * automatic optical sizing follows the drawn size (CSS `font-optical-sizing: auto`).
   * The weight is the face's own `font-weight`, which sets a variable font's weight axis.
   */
  readonly settings: string;
}

/** The CSS generic family the host names when it has no emoji font (`EmojiFamily`). */
const PLATFORM_EMOJI = "emoji";

/**
 * The instance of `base` that `keys` ask for. The family name states the keys, so two
 * elements asking alike share one instance; with nothing stated, or the platform's own
 * emoji face, it is `base` itself.
 */
function emojiVariant(base: string, keys: EmojiKeys): EmojiVariation {
  const { fill, grade, optical_size: opsz } = keys.emoji_axes;
  const weight = keys.emoji_weight;
  const stated: [string, number | string | null][] = [
    ["wght", weight],
    ["FILL", fill],
    ["GRAD", grade],
    ["opsz", opsz],
  ];
  const parts = stated.flatMap(([tag, value]) => (value === null ? [] : [`${tag} ${value}`]));
  const family =
    parts.length === 0 || base === PLATFORM_EMOJI ? base : `${base} (${parts.join(" ")})`;
  const settings = stated
    .slice(1)
    .flatMap(([tag, value]) => (typeof value === "number" ? [`"${tag}" ${value}`] : []))
    .join(", ");
  return { family, base, weight, axes: keys.emoji_axes, settings };
}

/**
 * Every emoji font instance the theme's badges, buttons and chips ask for, each once
 * (md2ui `render_text_scopes.emoji_paths`): what the host registers before measuring.
 */
export function emojiVariations(
  theme: ResolvedTheme,
  emojiFamily: EmojiFamily,
): readonly EmojiVariation[] {
  const emoji = emojiFamily(theme.emojis.font_path);
  const own = (path: string | null): string => (path ? emojiFamily(path) : emoji);
  const asked: [string, EmojiKeys][] = [
    ...[null, "secondary", "tertiary", "quaternary"].map((v): [string, EmojiKeys] => [
      emoji,
      emojiBadgeStyle(theme, v),
    ]),
    ...LINK_VARIANTS.map((v): [string, EmojiKeys] => [
      own(theme.emojis.link.font_path),
      linkStyle(theme, v),
    ]),
    ...[null, ...CHIP_VARIANTS].map((v): [string, EmojiKeys] => [
      own(theme.emojis.inline.font_path),
      chipStyle(theme, v),
    ]),
  ];
  const variations = new Map<string, EmojiVariation>();
  for (const [base, keys] of asked) {
    const variation = emojiVariant(base, keys);
    if (variation.family !== base) variations.set(variation.family, variation);
  }
  return [...variations.values()];
}

/**
 * md2ui `_own_face`: whether a role style names a family of its own, or a weight between
 * the body's regular and its bold: a face the body's two cannot draw.
 */
export function ownFace(ts: TextStyle, body: TextStyle): boolean {
  const weight = weightFromStr(ts.font_weight);
  const family = fold(ts.font_name || "");
  return (
    (family !== "" && family !== fold(body.font_name || "")) ||
    (weight < 700 && weight !== weightFromStr(body.font_weight))
  );
}

/**
 * md2ui `configure_text_typefaces`: every family/weight pair a local patch can reach, or a
 * global tier that draws a face of its own (`ownFace`).
 */
function localFaces(theme: ResolvedTheme, baseName: string, baseWeight: number) {
  const names = new Set<string>();
  const weights = new Set<number>();
  let localFontProperty = false;
  for (const patches of Object.values(theme.text_style_overrides)) {
    for (const patch of Object.values(patches)) {
      if (patch === undefined) continue;
      if (patch.declared.includes("font_name")) {
        names.add(patch.style.font_name || baseName);
        localFontProperty = true;
      }
      if (patch.declared.includes("font_weight")) {
        weights.add(weightFromStr(patch.style.font_weight));
        localFontProperty = true;
      }
    }
  }
  const local = new Map<string, TextFaces>();
  const tiers = [theme.muted, theme.lead, theme.display];
  if (!localFontProperty && !tiers.some((t) => t !== null && ownFace(t, theme.text))) return local;
  names.add(baseName);
  for (const w of [baseWeight, 400, 700]) weights.add(w);
  const roles: (TextStyle | null)[] = [
    theme.text,
    theme.muted,
    theme.lead,
    theme.display,
    theme.key_style,
    theme.value_style,
  ];
  for (const style of roles) {
    if (style === null) continue;
    names.add(style.font_name || baseName);
    weights.add(weightFromStr(style.font_weight));
  }
  for (const name of names) {
    for (const weight of weights) {
      const boldWeight = Math.max(weight, 700);
      local.set(faceKey(name, weight), {
        typeface: face(name, weight, false),
        italic: face(name, weight, true),
        bold: face(name, boldWeight, false),
        bold_italic: face(name, boldWeight, true),
      });
    }
  }
  return local;
}

/** md2ui `_chip_face_key`: the (family, weight) a chip text style resolves. */
export function chipFaceKey(ts: TextStyle, theme: ResolvedTheme): readonly [string, number] {
  const name = ts.font_name || theme.text.font_name || "Arial";
  const weight = weightFromStr(ts.font_weight) || weightFromStr(theme.text.font_weight);
  return [name, weight];
}

/** md2ui `configure_chip_typefaces`. */
function chipFaces(theme: ResolvedTheme): Map<string, Face> {
  const chips = new Map<string, Face>();
  const [baseName, baseWeight] = chipFaceKey(chipTextStyle(theme.inline_code, theme.text), theme);
  const base = faceKey(baseName, baseWeight);
  for (const style of chipStyles(theme)) {
    const [name, weight] = chipFaceKey(style, theme);
    const key = faceKey(name, weight);
    if (key !== base && !chips.has(key)) chips.set(key, face(name, weight, false));
  }
  return chips;
}

/** md2ui `_link_face_key`: the (family, weight) a link text style resolves; unstated is the body's. */
function linkFaceKey(ts: TextStyle, theme: ResolvedTheme): readonly [string, number] {
  const name = ts.font_name || theme.text.font_name || "Arial";
  return [name, weightFromStr(ts.font_weight || theme.text.font_weight)];
}

/** md2ui `configure_link_typefaces`, looked up per variant as `_link_typeface` does. */
function linkFaces(theme: ResolvedTheme): Map<string, TextFaces> {
  const links = new Map<string, TextFaces>();
  const base = faceKey(...linkFaceKey(theme.text, theme));
  const byKey = new Map<string, TextFaces>();
  for (const variant of LINK_VARIANTS) {
    const style = linkStyle(theme, variant).text_style;
    if (style === null) continue;
    const [name, weight] = linkFaceKey(style, theme);
    const key = faceKey(name, weight);
    if (key === base) continue;
    let faces = byKey.get(key);
    if (faces === undefined) {
      const bold = Math.max(weight, 700);
      faces = {
        typeface: face(name, weight, false),
        bold: face(name, bold, false),
        italic: face(name, weight, true),
        bold_italic: face(name, bold, true),
      };
      byKey.set(key, faces);
    }
    links.set(variant, faces);
  }
  return links;
}

function chipStyles(theme: ResolvedTheme): TextStyle[] {
  return CHIP_VARIANTS.map((variant) => chipTextStyle(chipStyle(theme, variant), theme.text));
}

/**
 * md2ui `font_loader.MONOSPACE`: the generic family code falls back to, which the platform
 * answers with its own monospaced face (Courier on macOS).
 */
const MONOSPACE = "monospace";

/**
 * A code-block font, measured and painted alike: `font`'s families, then `monospace`
 * (md2ui `font_loader.resolve_code_typeface`). A code family neither loaded nor installed
 * draws in a monospaced face, never the proportional one every other stack falls back to,
 * in which a code block would lose its columns; a family the browser
 * has is drawn as before.
 */
export function inMonospace(font: FontSpec): FontSpec {
  return { ...font, families: [...font.families, MONOSPACE] };
}

/** md2ui `FontSet.code_block` (`session.load_fonts`): the code-block face, before `inMonospace`. */
export function codeBlockFace(theme: ResolvedTheme): Face {
  const cb = theme.code_blocks.text_style;
  const fontName = theme.text.font_name || "Arial";
  const weight = weightFromStr(cb.font_weight) || weightFromStr(theme.text.font_weight);
  return face(cb.font_name || fontName, weight, false);
}

/** md2ui `session.load_fonts`, with the host's emoji families. */
export function fontSet(theme: ResolvedTheme, emojiFamily: EmojiFamily): FontSet {
  const fontName = theme.text.font_name || "Arial";
  const baseWeight = weightFromStr(theme.text.font_weight);
  const ic = chipTextStyle(theme.inline_code, theme.text);

  const headings = new Map<number, TextFaces>();
  for (const [level, ts] of Object.entries(theme.headings)) {
    if (ts === undefined) continue;
    const w = weightFromStr(ts.font_weight);
    // The bold pair is what `**x**` inside the heading draws with: at least 700.
    const bw = Math.max(w, 700);
    // A heading draws in its own `Font Name`; one that names none, in the body's.
    const name = ts.font_name || fontName;
    headings.set(Number(level), {
      typeface: face(name, w, false),
      italic: face(name, w, true),
      bold: face(name, bw, false),
      bold_italic: face(name, bw, true),
    });
  }

  const tables = new Map<"header" | "cells" | "keys", readonly [Face, Face]>();
  const tableStyles = [
    ["header", theme.tables.header_text],
    ["cells", theme.tables.cells_text],
    ["keys", theme.tables.keys_text],
  ] as const;
  for (const [key, ts] of tableStyles) {
    if (ts === null) continue;
    // Like headings, table styles honour their own family.
    const name = ts.font_name || fontName;
    const w = weightFromStr(ts.font_weight);
    tables.set(key, [face(name, w, false), face(name, w, true)]);
  }

  const emoji = emojiFamily(theme.emojis.font_path);
  return {
    typeface: face(fontName, baseWeight, false),
    bold: face(fontName, 700, false),
    italic: face(fontName, baseWeight, true),
    bold_italic: face(fontName, 700, true),
    mono: face(ic.font_name || fontName, weightFromStr(ic.font_weight) || baseWeight, false),
    emoji,
    textEmoji: theme.emojis.text.font_path ? emojiFamily(theme.emojis.text.font_path) : emoji,
    linkEmoji: theme.emojis.link.font_path ? emojiFamily(theme.emojis.link.font_path) : emoji,
    emojiAt: (path) => (path ? emojiFamily(path) : emoji),
    headings,
    local: localFaces(theme, fontName, baseWeight),
    tables,
    chips: chipFaces(theme),
    links: linkFaces(theme),
    linkEmojiKeys: new Map(
      LINK_VARIANTS.map((variant) => {
        const style = linkStyle(theme, variant);
        return [variant, { keys: style, gap: style.emoji_gap }];
      }),
    ),
    inlineCodeSize: ic.font_size,
  };
}
