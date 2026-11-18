// The muted state (`~~`) of a badge, a chip and a button (md2ui `theme_model.muted_color`,
// `muted_gradient`, `EmojiBadgeStyle.muted`, `InlineCodeTheme.resolved` with a leaf, and
// `render_style._disabled_link_style`). Muting changes paint and nothing else: the
// element keeps the size and place sizing gave it, which never reads the state.
import type {
  Argb,
  EmojiBadgeStyle,
  GradientTheme,
  InlineCodeTheme,
  LinkStyle,
  ShadowSpec,
  TextStyle,
} from "@md2ui/contracts";
import { chipTextStyle } from "../../measure/theme-styles.ts";

/**
 * The opacity a muted element paints its own colours at when its theme states none of its
 * `Disabled …` colours, and its shadows and theme background image always.
 */
export const MUTED_OPACITY = 0.4;

/**
 * One channel of an element's muted state. `stated` is whether the theme gave the element
 * any `Disabled …` colour: if it did, a stated colour replaces the channel and an unstated
 * one keeps `enabled`; if it gave none, the channel is `enabled` at `MUTED_OPACITY`, so the
 * state is never invisible. A channel the element does not paint stays unpainted.
 */
function mutedColor(enabled: Argb | null, disabled: Argb | null, stated: boolean): Argb | null {
  if (enabled === null) return null;
  if (stated) return disabled ?? enabled;
  const alpha = Math.round(((enabled >>> 24) & 0xff) * MUTED_OPACITY);
  return ((alpha << 24) | (enabled & 0xffffff)) >>> 0;
}

/** `mutedColor` for a channel the element always paints. */
const mutedOf = (enabled: Argb, disabled: Argb | null, stated: boolean): Argb =>
  mutedColor(enabled, disabled, stated) ?? enabled;

/** A muted element's gradient: faded with the default mute, else kept as it is. */
function mutedGradient(gradient: GradientTheme | null, stated: boolean): GradientTheme | null {
  if (gradient === null || stated) return gradient;
  return { ...gradient, colors: gradient.colors.map((c) => mutedOf(c, null, false)) };
}

/**
 * A muted element's shadows, always at `MUTED_OPACITY`: no `Disabled …` key names a
 * shadow, so a theme's stated colours never decide it. Each keeps its side, offset and
 * reach, so nothing moves.
 */
const mutedShadows = (shadows: readonly ShadowSpec[]): ShadowSpec[] =>
  shadows.map((s) => ({ ...s, color: mutedOf(s.color, null, false) }));

const anyStated = (...colors: readonly (Argb | null)[]): boolean => colors.some((c) => c !== null);

/**
 * A disabled button (`~~[x](/y)~~`): its fill, stroke and label muted. A variant that
 * states none of its `Disabled …` colours takes the default mute, so a Text button, which
 * resolves onto bare defaults rather than Primary's, is never drawn enabled. Its shadows
 * fade as a muted chip's and badge's do, always, and so does its background image, where
 * it is painted.
 */
export function disabledLinkStyle(style: LinkStyle): LinkStyle {
  const stated = anyStated(
    style.disabled_fill_color,
    style.disabled_text_color,
    style.disabled_stroke_color,
  );
  const ts = style.text_style;
  return {
    ...style,
    fill_color: mutedColor(style.fill_color, style.disabled_fill_color, stated),
    stroke_color: mutedColor(style.stroke_color, style.disabled_stroke_color, stated),
    text_style:
      ts === null ? ts : { ...ts, color: mutedOf(ts.color, style.disabled_text_color, stated) },
    shadows: mutedShadows(style.shadows),
  };
}

/**
 * A muted badge (`~~⭐~~`): its background, border and glyph muted, its shadows faded, and
 * `is_muted` set so its background image fades where it is painted. `ink` is the glyph's
 * colour when the badge states no icon colour of its own. One colour per channel, so no
 * rotation paints over the state.
 */
export function mutedBadge(style: EmojiBadgeStyle, ink: Argb): EmojiBadgeStyle {
  const stated = anyStated(
    style.disabled_bg_color,
    style.disabled_icon_color,
    style.disabled_stroke_color,
  );
  const f = style.fill;
  const bg = mutedColor(f.bg_colors[0] ?? null, style.disabled_bg_color, stated);
  const stroke = mutedColor(
    f.stroke_colors[0] ?? f.stroke_color,
    style.disabled_stroke_color,
    stated,
  );
  const icon = mutedOf(style.icon_colors[0] ?? ink, style.disabled_icon_color, stated);
  return {
    ...style,
    fill: {
      ...f,
      bg_colors: bg === null ? [] : [bg],
      stroke_colors: [],
      stroke_color: stroke,
      gradient: mutedGradient(f.gradient, stated),
      shadows: mutedShadows(f.shadows),
    },
    icon_colors: [icon],
    is_muted: true,
  };
}

const chipStated = (code: InlineCodeTheme): boolean =>
  anyStated(code.disabled_fill_color, code.disabled_text_color, code.disabled_stroke_color);

/**
 * A muted chip (`` ~~`x`~~ ``): its fill, stroke and gradient muted, its shadows faded,
 * its rotation lists emptied so a cycle cannot paint over the state, and `muted` set so
 * its label mutes where its colour is read (`chipLabelStyle`) and its background image
 * where it is painted.
 */
export function mutedChip(code: InlineCodeTheme): InlineCodeTheme {
  const stated = chipStated(code);
  return {
    ...code,
    fill_color: mutedOf(code.fill_color, code.disabled_fill_color, stated),
    stroke_color: mutedOf(code.stroke_color, code.disabled_stroke_color, stated),
    fill_colors: [],
    stroke_colors: [],
    gradient: mutedGradient(code.gradient, stated),
    shadows: mutedShadows(code.shadows),
    muted: true,
  };
}

/** md2ui `InlineCodeTheme.effective_text_style` as painted: a muted chip's label muted too. */
export function chipLabelStyle(code: InlineCodeTheme, body: TextStyle): TextStyle {
  const ts = chipTextStyle(code, body);
  if (!code.muted) return ts;
  return { ...ts, color: mutedOf(ts.color, code.disabled_text_color, chipStated(code)) };
}
