// Questions asked of a resolved theme (C2) by layout and sizing: md2ui's `Theme` methods
// and the small lookups in `theme.py` that its renderer and generator share. Names follow
// md2ui's; each says where it comes from.
import type {
  BulletedListStyle,
  HeadingLevel,
  HorizontalRuleTheme,
  NumberedListStyle,
  PaddingBox,
  QuoteStyle,
  ResolvedTheme,
  RotateChannel,
  SectionStyle,
} from "@md2ui/contracts";
import { strip } from "../group/py/str.ts";

/** md2ui `PaddingBox.x`: the horizontal inset. */
export function paddingX(p: PaddingBox): number {
  return p.left + p.right;
}

/** md2ui `PaddingBox.y`: the vertical inset. */
export function paddingY(p: PaddingBox): number {
  return p.top + p.bottom;
}

/** md2ui `PaddingBox.any`. */
function paddingAny(p: PaddingBox): boolean {
  return p.top > 0 || p.left > 0 || p.right > 0 || p.bottom > 0;
}

/** md2ui `SectionStyle.is_active`: the level has something to inset or paint. */
export function sectionIsActive(st: SectionStyle): boolean {
  return (
    paddingAny(st.padding) ||
    st.bg_colors.length > 0 ||
    st.bg_image !== null ||
    st.gradient !== null ||
    st.shadows.some((sh) => ((sh.color >>> 24) & 0xff) > 0) ||
    (st.stroke_width > 0 && st.stroke_color !== null)
  );
}

/**
 * md2ui `theme.resolve_section_style`: the style a heading section of `level` takes. A
 * matching fixed style (`Mode: override` merged per level first, then whole) replaces
 * `Heading N`; anything else keeps the level's own.
 */
export function resolveSectionStyle(
  theme: ResolvedTheme,
  level: number,
  fixedStyleKey: string | null = null,
): SectionStyle | undefined {
  if (fixedStyleKey) {
    const merged = theme.fixed_section_levels[fixedStyleKey]?.[level as HeadingLevel];
    if (merged !== undefined) return merged;
    const fixed = theme.fixed_sections[fixedStyleKey];
    if (fixed !== undefined) return fixed;
  }
  return theme.sections[level as HeadingLevel];
}

/** A rotation chain: heading levels, and `fixed:<key>|<level>[|<slot>]` tokens for named styles. */
export type RotationChain = readonly (number | string)[];

const FIXED_PREFIX = "fixed:";

/** Python's `int(s)` for the ASCII spellings a chain token carries; `undefined` is `ValueError`. */
function pyInt(s: string): number | undefined {
  const t = strip(s);
  return /^[+-]?[0-9](?:_?[0-9])*$/.test(t) ? Number(t.replaceAll("_", "")) : undefined;
}

/** A `fixed:<key>|<fallback>…` token split the way md2ui splits it. */
function fixedToken(token: string): { key: string; fallback: string[] } {
  const [key = "", ...fallback] = token.slice(FIXED_PREFIX.length).split("|");
  return { key, fallback };
}

/**
 * md2ui `render_colors._chain_style`: the section style one token of a rotation chain
 * stands for. A `fixed:` token names a fixed style, and its `|<level>` part picks that
 * level's `Mode: override` merge; a name the theme lacks falls back to the heading level.
 */
function chainStyle(theme: ResolvedTheme, token: number | string): SectionStyle | undefined {
  if (typeof token === "string" && token.startsWith(FIXED_PREFIX)) {
    const { key, fallback } = fixedToken(token);
    const fixed = Object.hasOwn(theme.fixed_sections, key) ? theme.fixed_sections[key] : undefined;
    if (fixed !== undefined) {
      const first = fallback[0];
      // `str.isdigit()` here; only ASCII digits are read (md2ui writes ints).
      if (first !== undefined && /^[0-9]+$/.test(first)) {
        return theme.fixed_section_levels[key]?.[Number(first) as HeadingLevel] ?? fixed;
      }
      return fixed;
    }
    if (fallback.length > 0) {
      const level = pyInt(fallback[0] ?? "");
      return level === undefined ? undefined : theme.sections[level as HeadingLevel];
    }
  }
  return typeof token === "number" ? theme.sections[token as HeadingLevel] : undefined;
}

/**
 * md2ui `render_colors._rotation_enabled`: whether `channel` may cycle inside the
 * section ancestry `chain`. The innermost level that states `Rotate <kind> colors`
 * wins; silence defers outward, and a document that says nothing cycles.
 */
export function rotationEnabled(
  theme: ResolvedTheme,
  channel: RotateChannel,
  chain: RotationChain,
): boolean {
  for (let i = chain.length - 1; i >= 0; i--) {
    const st = chainStyle(theme, chain[i] as number | string);
    const stated = st?.rotate[channel];
    if (stated !== undefined) return stated;
  }
  return true;
}

/**
 * md2ui `render_colors._synced_slot`: the rotation slot an element paints with. A level
 * marked `Rotate colors: sync` hands its own slot (from `path`) to everything inside it,
 * so an element takes "the colour of the card I am in"; the nearest sharing ancestor
 * wins, and the node's own level never counts. A fixed style's `|<level>|<slot>` token
 * carries its slot itself.
 */
export function syncedSlot(
  index: number,
  chain: RotationChain,
  path: readonly number[],
  theme: ResolvedTheme,
): number {
  for (let i = Math.min(chain.length, path.length) - 1; i >= 0; i--) {
    const token = chain[i] as number | string;
    if (chainStyle(theme, token)?.sync_slot) {
      if (typeof token === "string" && token.startsWith(FIXED_PREFIX)) {
        const { key, fallback } = fixedToken(token);
        if (Object.hasOwn(theme.fixed_sections, key) && fallback.length >= 2) {
          const slot = pyInt(fallback[1] ?? "");
          if (slot !== undefined) return slot;
        }
      }
      return path[i] as number;
    }
  }
  return index;
}

/**
 * md2ui `render_colors._rotate_color`: `index`'s colour out of a THEME.md colour list,
 * the one entry point for every rotating property. An empty list keeps the style's own
 * scalar; one colour, or a channel gated off, pins to the first.
 */
export function rotateColor(
  colors: readonly number[],
  fallback: number | null,
  index: number,
  theme: ResolvedTheme,
  channel: RotateChannel,
  chain: RotationChain = [],
): number | null {
  const first = colors[0];
  if (first === undefined) return fallback;
  if (colors.length === 1 || !rotationEnabled(theme, channel, chain)) return first;
  // Python's `%` takes the divisor's sign.
  const n = colors.length;
  return colors[((index % n) + n) % n] as number;
}

type Axis = "row" | "col";

/**
 * md2ui `render_spacing._resolve_element_spacing`: the gap inside an end-group, from the
 * global element style; 0 when unset.
 */
export function resolveElementSpacing(axis: Axis, theme: ResolvedTheme): number {
  return (axis === "row" ? theme.elements.row_spacing : theme.elements.col_spacing) ?? 0;
}

/**
 * md2ui `render_spacing._resolve_group_spacing`: the gap for pairs involving a plain
 * group; unset, it is the element gap.
 */
export function resolveGroupSpacing(axis: Axis, theme: ResolvedTheme): number {
  const v = axis === "row" ? theme.elements.group_row_spacing : theme.elements.group_col_spacing;
  return v ?? resolveElementSpacing(axis, theme);
}

/**
 * md2ui `render_spacing._resolve_section_spacing`: the gap between the child sections of
 * the nearest enclosing section `ownerLevel` (0 is the root, which reads `## Root`). A
 * level that states a spacing wins, `0` included; one that does not takes the group gap.
 */
export function resolveSectionSpacing(
  ownerLevel: number,
  axis: Axis,
  theme: ResolvedTheme,
  fixedStyleKey: string | null = null,
): number {
  if (ownerLevel === 0) {
    const v = axis === "row" ? theme.root.row_spacing : theme.root.col_spacing;
    return v ?? resolveGroupSpacing(axis, theme);
  }
  const st = resolveSectionStyle(theme, ownerLevel, fixedStyleKey);
  if (st !== undefined) {
    const v = axis === "row" ? st.row_spacing : st.col_spacing;
    if (v !== null) return v;
  }
  return resolveGroupSpacing(axis, theme);
}

/**
 * md2ui `render_spacing._resolve_image_spacing`: the gap between two adjacent image
 * leaves. Unset, images abut (0), not the element gap.
 */
export function resolveImageSpacing(axis: Axis, theme: ResolvedTheme): number {
  const v = axis === "row" ? theme.elements.image_row_spacing : theme.elements.image_col_spacing;
  return v ?? 0;
}

/** md2ui `BulletedListStyle.is_active`: a shape or an emoji turns the bullet marker on. */
export function bulletedListIsActive(m: BulletedListStyle): boolean {
  return m.shape !== null || m.emoji !== null;
}

/** md2ui `NumberedListStyle.is_active`: a styled number turns the marker on. */
export function numberedListIsActive(m: NumberedListStyle): boolean {
  return m.text_style !== null;
}

/** md2ui `QuoteStyle.is_bar`: a bar needs both a width and a colour. */
export function quoteIsBar(m: QuoteStyle): boolean {
  return m.bar_width > 0 && m.bar_color !== null;
}

/** md2ui `QuoteStyle.is_active`: a bar or a quote character. */
export function quoteIsActive(m: QuoteStyle): boolean {
  return quoteIsBar(m) || m.quote_char !== null;
}

/**
 * md2ui `scoped_horizontal_rule_style`: the rule's paint through its styling scopes, outer
 * to inner; a patch's unset field keeps what the outer scope had.
 */
export function scopedHorizontalRuleStyle(
  theme: ResolvedTheme,
  scopes: readonly string[],
): HorizontalRuleTheme {
  let style = theme.horizontal_rule;
  for (const scope of scopes) {
    const patch = theme.horizontal_rule_overrides[scope];
    if (patch === undefined) continue;
    style = {
      stroke_color: patch.stroke_color ?? style.stroke_color,
      stroke_width: patch.stroke_width ?? style.stroke_width,
    };
  }
  return style;
}
