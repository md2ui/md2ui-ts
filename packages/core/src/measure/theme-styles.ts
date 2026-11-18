// The text styles a leaf resolves to, before any face is picked: md2ui's `Theme`
// variant lookups (`LinksTheme.resolved`, `InlineCodeTheme.resolved`,
// `EmojisTheme.resolved`, `tier_style`) and the scope cascade of `render_text_scopes`
// (`scoped_text_style`, `_has_local_font`).
import type {
  EmojiBadgeStyle,
  InlineCodeTheme,
  LinkStyle,
  LocalTextRole,
  ResolvedTheme,
  TextStyle,
  TextStylePatch,
} from "@md2ui/contracts";
import { isLinkButtonVariant } from "../theme/links.ts";
import { type Draft, MUTED_TEXT_COLOR, newTextStyle, unpaintedLinkStyle } from "../theme/model.ts";
import { applyPatch, type ChipVariant, isChipVariant } from "../theme/text-styles.ts";
import { inheritShadows } from "../theme/values.ts";

/** md2ui `InlineCodeTheme.resolved`: a variant's complete chip style, else the base. */
export function chipStyle(theme: ResolvedTheme, variant: string | null): InlineCodeTheme {
  if (variant && isChipVariant(variant)) {
    return theme.inline_code[variant as ChipVariant] ?? theme.inline_code;
  }
  return theme.inline_code;
}

/** md2ui `EmojisTheme.resolved`: a badge variant's style, else Primary. */
export function emojiBadgeStyle(theme: ResolvedTheme, variant: string | null): EmojiBadgeStyle {
  if (variant === "secondary" || variant === "tertiary" || variant === "quaternary") {
    return theme.emojis[variant] ?? theme.emojis.primary;
  }
  return theme.emojis.primary;
}

/** md2ui `LinksTheme.resolved` (with `_resolve_link_style`): a variant merged onto its base. */
export function linkStyle(theme: ResolvedTheme, variant: string): LinkStyle {
  // Primary, Inline (a text-run style, not a button) or an unknown name: Primary.
  if (!isLinkButtonVariant(variant) && variant !== "text") return theme.links.primary;
  const o = theme.links[variant];
  const base = variant === "text" ? unpaintedLinkStyle() : theme.links.primary;
  return {
    corner_radius: o.corner_radius ?? base.corner_radius,
    padding: o.padding ?? base.padding,
    fill_color: o.fill_color ?? base.fill_color,
    text_style: o.text_style ?? base.text_style,
    stroke_width: o.stroke_width ?? base.stroke_width,
    stroke_align: o.stroke_align || base.stroke_align,
    stroke_color: o.stroke_color ?? base.stroke_color,
    fill_colors: [...(o.fill_colors.length > 0 ? o.fill_colors : base.fill_colors)],
    stroke_colors: [...(o.stroke_colors.length > 0 ? o.stroke_colors : base.stroke_colors)],
    bg_image: o.bg_image ?? base.bg_image,
    gradient: o.gradient ?? base.gradient,
    shadows: inheritShadows(base.shadows, o.shadows),
    emoji_shape: o.emoji_shape ?? base.emoji_shape,
    disabled_fill_color: o.disabled_fill_color ?? base.disabled_fill_color,
    disabled_text_color: o.disabled_text_color ?? base.disabled_text_color,
    disabled_stroke_color: o.disabled_stroke_color ?? base.disabled_stroke_color,
    emoji_gap: o.emoji_gap ?? base.emoji_gap,
    emoji_weight: o.emoji_weight || base.emoji_weight,
    emoji_axes: {
      fill: o.emoji_axes.fill ?? base.emoji_axes.fill,
      grade: o.emoji_axes.grade ?? base.emoji_axes.grade,
      optical_size: o.emoji_axes.optical_size ?? base.emoji_axes.optical_size,
    },
  };
}

const TIER_DEFAULTS = Object.freeze({
  muted: [0.85, "", MUTED_TEXT_COLOR],
  lead: [1.25, "", null],
  display: [2.0, "bold", null],
} as const);

type Tier = keyof typeof TIER_DEFAULTS;

/** md2ui `tier_style`: an unset tier derives from the body style. */
function tierStyle(name: Tier, theme: ResolvedTheme): TextStyle {
  const ts = theme[name];
  if (ts !== null) return ts;
  const [scale, weight, color] = TIER_DEFAULTS[name];
  return newTextStyle({
    font_name: theme.text.font_name,
    font_size: theme.text.font_size * scale,
    font_weight: weight,
    color: color ?? theme.text.color,
  });
}

/**
 * md2ui `_base_role_style`: the global style behind one locally overridable role. Any
 * role it does not name falls to the key branch, as md2ui's does.
 */
export function baseRoleStyle(theme: ResolvedTheme, role: string): TextStyle {
  switch (role) {
    case "text":
      return theme.text;
    case "muted":
    case "lead":
    case "display":
      return tierStyle(role, theme);
    case "value":
      return theme.value_style ?? theme.text;
    default:
      // `Key` / `Value`: the two sides of a display's pair (ADR-205); unset, body text.
      return theme.key_style ?? theme.text;
  }
}

const patchAt = (theme: ResolvedTheme, scope: string, role: string): TextStylePatch | undefined => {
  const patches = Object.hasOwn(theme.text_style_overrides, scope)
    ? theme.text_style_overrides[scope]
    : undefined;
  return patches !== undefined && Object.hasOwn(patches, role)
    ? patches[role as LocalTextRole]
    : undefined;
};

/** md2ui `scoped_text_style`: one role through its outer-to-inner scope cascade. */
export function scopedTextStyle(
  theme: ResolvedTheme,
  role: string,
  scopes: readonly string[],
): TextStyle {
  let style = baseRoleStyle(theme, role);
  for (const scope of scopes) {
    const patch = patchAt(theme, scope, role);
    // `applyPatch` copies what it reads and never writes its arguments.
    if (patch !== undefined) {
      style = applyPatch(patch as Draft<TextStylePatch>, style as Draft<TextStyle>);
    }
  }
  return style;
}

/** md2ui `_has_local_font`: whether the cascade overrides family or weight. */
export function hasLocalFont(
  theme: ResolvedTheme,
  role: string,
  scopes: readonly string[],
): boolean {
  return scopes.some((scope) => {
    const patch = patchAt(theme, scope, role);
    return (
      patch !== undefined &&
      (patch.declared.includes("font_name") || patch.declared.includes("font_weight"))
    );
  });
}

/** md2ui `_table_text_style`: a table cell role's style. */
export function tableTextStyle(theme: ResolvedTheme, role: string): TextStyle | null {
  if (role === "header") return theme.tables.header_text;
  if (role === "keys") return theme.tables.keys_text;
  return theme.tables.cells_text;
}

/** md2ui `InlineCodeTheme.effective_text_style`. */
export function chipTextStyle(code: InlineCodeTheme, body: TextStyle): TextStyle {
  return (
    code.text_style ??
    newTextStyle({
      font_name: body.font_name,
      font_size: 14,
      font_weight: body.font_weight,
      color: body.color,
    })
  );
}

/** md2ui `_ring_text_style`: a ring role's style. */
export function ringTextStyle(theme: ResolvedTheme, role: string): TextStyle {
  const rt = theme.datapoints.ring;
  if (role === "value") {
    return (
      rt.value_text ??
      newTextStyle({
        font_size: theme.text.font_size * 1.8,
        font_weight: "bold",
        color: theme.text.color,
      })
    );
  }
  return rt.unit_text ?? theme.labels;
}

/** md2ui `_date_chip_text_style`: a date-chip role's style. */
export function dateChipTextStyle(theme: ResolvedTheme, role: string): TextStyle {
  const dc = theme.datapoints.date_chip;
  if (role === "key") return dc.key_text ?? theme.labels;
  return (
    dc.day_text ??
    newTextStyle({
      font_size: theme.text.font_size * 1.5,
      font_weight: "bold",
      color: theme.text.color,
    })
  );
}
