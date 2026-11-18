// Which faces and size a text leaf is measured in (md2ui `render_style`:
// `_effective_text_fonts`, `_heading_fonts`, `_style_fonts`, `_apply_kv_role`,
// `_apply_date_role`, `_marker_font`). Each answer is the four faces `_span_font` picks
// among, so a role that swaps only the regular pair keeps the base bold pair, as md2ui's
// `dataclasses.replace` does.
import type { ResolvedTheme, TextStyle } from "@md2ui/contracts";
import {
  type Face,
  type FontSet,
  faceKey,
  ownFace,
  type TextFaces,
  weightFromStr,
} from "./font-set.ts";
import {
  dateChipTextStyle,
  hasLocalFont,
  scopedTextStyle,
  tableTextStyle,
} from "./theme-styles.ts";

/** Faces and the size they are measured at. */
interface Faced {
  readonly faces: TextFaces;
  readonly size: number;
}

/** Faces, the size they are measured at, and the family their emoji draw in. */
export interface SizedFaces extends Faced {
  readonly emoji: string;
}

/** The authored selectors md2ui's `_node_text_context` reads off a node. */
export interface TextContext {
  readonly table_role: string | null;
  readonly heading_ctx: number;
  readonly text_style: string | null;
  readonly text_style_chain: readonly string[];
}

// md2ui `render_style.HEADING_SIZES`.
const HEADING_SIZES: Readonly<Record<number, number>> = Object.freeze({
  1: 28,
  2: 22,
  3: 18,
  4: 15,
  5: 13,
  6: 12,
});

/** md2ui `_span_font`'s pick: the face one styled span draws with. */
export function spanFace(faces: TextFaces, bold: boolean, italic: boolean): Face {
  if (bold && italic) return faces.bold_italic;
  if (bold) return faces.bold;
  if (italic) return faces.italic;
  return faces.typeface;
}

/** The regular pair at a weight: the base bold pair from 700 up, else the base pair. */
function weightedPair(faces: TextFaces, base: FontSet, weight: number): TextFaces {
  return weight >= 700
    ? { ...faces, typeface: base.bold, italic: base.bold_italic }
    : { ...faces, typeface: base.typeface, italic: base.italic };
}

/** md2ui `_style_fonts`: a style's family and weight, through the local face table. */
export function styleFonts(ts: TextStyle, fonts: FontSet): TextFaces {
  const weight = weightFromStr(ts.font_weight);
  const local = fonts.local.get(faceKey(ts.font_name || "", weight));
  if (local !== undefined) return local;
  return weightedPair(fonts, fonts, weight);
}

/**
 * md2ui `_sizing_tier`: the authored tier that picks a leaf's faces and size. On a K-V
 * key, Muted is a state, not a size: the key keeps its own style and only its colour
 * changes, so a selected and an unselected card line up.
 */
function sizingTier(nodeType: string, tier: string | null): string | null {
  return nodeType === "key" && tier === "muted" ? null : tier;
}

/** md2ui `_heading_level`: the trailing number of a heading type, clamped to 1–6. */
function headingLevel(label: string): number {
  const m = /(\d+)$/.exec(label);
  return m === null ? 1 : Math.max(1, Math.min(6, Number(m[1])));
}

/** md2ui `_heading_fonts`: a heading level's four faces and size. */
function headingFonts(level: number, fonts: FontSet, theme: ResolvedTheme): Faced {
  const ts = theme.headings[level as keyof ResolvedTheme["headings"]];
  const size = ts !== undefined ? ts.font_size : (HEADING_SIZES[level] as number);
  const own = fonts.headings.get(level);
  if (own !== undefined) return { faces: own, size };
  const weight = ts !== undefined ? weightFromStr(ts.font_weight) : 400;
  return {
    faces: {
      typeface: weight >= 700 ? fonts.bold : fonts.typeface,
      italic: weight >= 700 ? fonts.bold_italic : fonts.italic,
      bold: fonts.bold,
      bold_italic: fonts.bold_italic,
    },
    size,
  };
}

/**
 * md2ui `_effective_text_fonts`: a leaf's faces and base size. A table cell takes its
 * table style, a heading its level, an authored tier its tier, a display pair's key
 * the `Key` style (body text when the theme sets none), a piece of a heading line that heading, and anything else the body style.
 * Everything but a heading is prose, whose emoji draw in `### Text`'s face.
 */
export function effectiveTextFonts(
  nodeType: string,
  atxLevel: number,
  fonts: FontSet,
  theme: ResolvedTheme,
  ctx: TextContext,
): SizedFaces {
  if (atxLevel !== 0 || nodeType.startsWith("heading")) {
    const level = atxLevel || headingLevel(nodeType);
    return { ...headingFonts(level, fonts, theme), emoji: fonts.emoji };
  }
  return { ...proseFonts(nodeType, fonts, theme, ctx), emoji: fonts.textEmoji };
}

/** `effectiveTextFonts` of a leaf that is not a heading. */
function proseFonts(
  nodeType: string,
  fonts: FontSet,
  theme: ResolvedTheme,
  ctx: TextContext,
): Faced {
  const scopes = ctx.text_style_chain;
  if (ctx.table_role) {
    const ts = tableTextStyle(theme, ctx.table_role);
    if (ts !== null) {
      const pair = fonts.tables.get(ctx.table_role === "header" ? "header" : "cells");
      if (pair !== undefined) {
        return { faces: { ...fonts, typeface: pair[0], italic: pair[1] }, size: ts.font_size };
      }
      return {
        faces: weightedPair(fonts, fonts, weightFromStr(ts.font_weight)),
        size: ts.font_size,
      };
    }
  }
  const tier = sizingTier(nodeType, ctx.text_style);
  if (tier) {
    const ds = scopedTextStyle(theme, tier, scopes);
    const body = scopedTextStyle(theme, "text", scopes);
    if (hasLocalFont(theme, tier, scopes) || ownFace(ds, body)) {
      return { faces: styleFonts(ds, fonts), size: ds.font_size };
    }
    return { faces: weightedPair(fonts, fonts, weightFromStr(ds.font_weight)), size: ds.font_size };
  }
  if (nodeType === "key") {
    const ks = scopedTextStyle(theme, "key", scopes);
    if (hasLocalFont(theme, "key", scopes)) {
      return { faces: styleFonts(ks, fonts), size: ks.font_size };
    }
    return { faces: weightedPair(fonts, fonts, weightFromStr(ks.font_weight)), size: ks.font_size };
  }
  if (ctx.heading_ctx) return headingFonts(ctx.heading_ctx, fonts, theme);
  const body = scopedTextStyle(theme, "text", scopes);
  if (hasLocalFont(theme, "text", scopes))
    return { faces: styleFonts(body, fonts), size: body.font_size };
  return { faces: fonts, size: body.font_size };
}

/**
 * md2ui `_apply_kv_role`: one side of a key-value pair takes the `Key` / `Value` style,
 * unless a heading line or an authored tier already decided the leaf's style. A muted
 * key still takes the `Key` faces and size; its colour is the painter's.
 */
export function applyKvRole(
  role: string | null,
  sized: SizedFaces,
  theme: ResolvedTheme,
  fonts: FontSet,
  ctx: TextContext,
): SizedFaces {
  if (!role || ctx.heading_ctx || sizingTier(role, ctx.text_style)) return sized;
  const scopes = ctx.text_style_chain;
  const ts = scopedTextStyle(theme, role, scopes);
  // A role with its own family keeps the leaf's emoji face.
  if (hasLocalFont(theme, role, scopes))
    return { ...sized, faces: styleFonts(ts, fonts), size: ts.font_size };
  if (weightFromStr(ts.font_weight) >= 700) {
    return { ...sized, faces: weightedPair(sized.faces, fonts, 700), size: ts.font_size };
  }
  return { ...sized, size: ts.font_size };
}

/** md2ui `_apply_date_role`: a date chip's key or day leaf takes its chip style. */
export function applyDateRole(
  role: string | null,
  sized: SizedFaces,
  theme: ResolvedTheme,
  fonts: FontSet,
): SizedFaces {
  if (!role) return sized;
  const ts = dateChipTextStyle(theme, role);
  if (weightFromStr(ts.font_weight) >= 700) {
    return { ...sized, faces: weightedPair(sized.faces, fonts, 700), size: ts.font_size };
  }
  return { ...sized, size: ts.font_size };
}

// md2ui `render_style._BOLD_WEIGHTS`.
const BOLD_WEIGHTS: readonly string[] = Object.freeze([
  "bold",
  "semibold",
  "extrabold",
  "black",
  "600",
  "700",
  "800",
  "900",
]);

/** md2ui `_marker_font`: the face and size a text gutter marker draws with. */
export function markerFace(
  props: Readonly<Record<string, unknown>>,
  fonts: FontSet,
  theme: ResolvedTheme,
): readonly [Face, number] {
  const size = Number(props["font_size"] ?? theme.text.font_size);
  const weight = String(props["font_weight"] ?? "").toLowerCase();
  return [BOLD_WEIGHTS.includes(weight) ? fonts.bold : fonts.typeface, size];
}
