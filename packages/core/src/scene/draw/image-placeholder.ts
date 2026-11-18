// The theme's placeholder where an image has no picture (md2ui `render_image_placeholder`,
// ADR-406). An image that writes `?md2ui.placeholder=<name>` or `<name>:<text>` and has no
// picture to show (left out, loading, failed) paints the theme's placeholder of that name:
// its fill, its `Image:` cover-fitted over it, and centred on top the image's text
// (initials, one emoji) or else the placeholder's icon. An image that names none, or a
// name the theme does not declare, paints the theme's default for its state (`#### Loading`,
// `Broken`, `Missing`) when there is one, and md2ui's own otherwise; a theme that declares
// no placeholders at all still shows the image's text, on a default placeholder. All
// paint inside the picture's own clip; the box was laid out for the picture and does not move.
import type { Argb, GroupingNode, ImagePlaceholder, Paint, ResolvedTheme } from "@md2ui/contracts";
import type { Face, FontSet } from "../../measure/font-set.ts";
import { fontOf } from "../../measure/font-set.ts";
import { styleFonts } from "../../measure/text-fonts.ts";
import { baseRoleStyle } from "../../measure/theme-styles.ts";
import { newPlaceholder } from "../../theme/placeholders.ts";
import { rotateColor } from "../../theme/query.ts";
import { placeholderRef } from "../../utils/image-params.ts";
import { rotationSlot } from "./colors.ts";
import type { Draw } from "./context.ts";
import { type Box, css, type StandInDraft } from "./pen.ts";
import { labelRuns } from "./text.ts";

/** Why an image has no picture: md2ui `_state`. */
type PictureState = "loading" | "broken" | "missing";

const ROLES: readonly string[] = Object.freeze(["muted", "lead", "display", "key", "value"]);
const BOLD: readonly string[] = Object.freeze(["bold", "700", "800", "900"]);

/** md2ui `_typeface`: the face and colour of the text style `name` (text, lead, heading 2…). */
function styleFace(name: string, theme: ResolvedTheme, fonts: FontSet): [Face, Argb] {
  const level = (name.startsWith("heading") ? name.slice(7) : name).trim();
  const style = /^\d+$/.test(level)
    ? theme.headings[Number(level) as keyof ResolvedTheme["headings"]]
    : undefined;
  if (style !== undefined) {
    const faces = fonts.headings.get(Number(level));
    const bold = BOLD.includes((style.font_weight || "").toLowerCase());
    return [faces ? (bold ? faces.bold : faces.typeface) : fonts.typeface, style.color];
  }
  const own = baseRoleStyle(theme, ROLES.includes(name) ? name : "text");
  return [styleFonts(own, fonts).typeface, own.color];
}

/** md2ui `_size`: a share of the shorter side, or px. */
const sizeOf = ([value, share]: readonly [number, boolean], side: number): number =>
  share ? (side * value) / 100 : value;

/** md2ui `_paint`: `ph` painted over `dst` with `text` (or its icon), at the node's slot. */
function draft(
  d: Draw,
  ph: ImagePlaceholder,
  text: string,
  node: GroupingNode | undefined,
  dst: Box,
  quiet: Argb,
): StandInDraft {
  const { theme, leaves } = d.sizer;
  const { index, chain } = node === undefined ? { index: 0, chain: [] } : rotationSlot(node, theme);
  // `Rotate placeholder colors` gates the fill and the text alike.
  const fill = rotateColor(ph.fill_colors, quiet, index, theme, "placeholder", chain) ?? quiet;
  const paints: Paint[] = [{ kind: "color", color: css(fill) }];
  if (ph.bg_image) paints.push({ kind: "image", src: ph.bg_image, fallbackSrc: null });
  const glyphs = text || ph.icon;
  if (!glyphs) return { paints, label: null };
  const [face, styleColor] = styleFace(ph.text_style, theme, leaves.fonts);
  const color =
    rotateColor(ph.text_colors, styleColor, index, theme, "placeholder", chain) ?? styleColor;
  const size = sizeOf(text ? ph.text_size : ph.icon_size, Math.min(dst.width, dst.height));
  const measured = labelRuns(d, glyphs, 0, face, leaves.fonts.emoji, size, color);
  const m = leaves.text.fontMetrics(fontOf(face, size));
  const x = dst.x + (dst.width - measured.width) / 2;
  const top = dst.y + (dst.height - (m.ascent + m.descent)) / 2;
  return {
    paints,
    label: { y: top + m.ascent, runs: measured.runs.map((r) => ({ ...r, x: r.x + x })) },
  };
}

/**
 * md2ui `named_placeholder`: what stands in for `content`'s picture in `state`, the
 * placeholder it names or the theme's default for that state; null for md2ui's own.
 */
export function standIn(
  d: Draw,
  content: string,
  node: GroupingNode | undefined,
  dst: Box,
  state: PictureState,
  quiet: Argb,
): StandInDraft | null {
  const { theme, leaves } = d.sizer;
  const ref = placeholderRef(leaves.kit, content);
  const named =
    ref !== null && Object.hasOwn(theme.image_placeholders, ref.name)
      ? theme.image_placeholders[ref.name]
      : undefined;
  const ph =
    named ??
    (Object.hasOwn(theme.image_placeholder_defaults, state)
      ? theme.image_placeholder_defaults[state]
      : undefined);
  if (ph !== undefined) {
    return draft(d, ph, named !== undefined && ref !== null ? ref.text : "", node, dst, quiet);
  }
  // The theme styles no placeholders at all: the written text (initials, an emoji) still
  // shows, in the built-in grey, rather than a bare circle. A theme that declares
  // placeholders keeps an undeclared name quiet.
  if (ref?.text && Object.keys(theme.image_placeholders).length === 0) {
    return draft(d, newPlaceholder(), ref.text, node, dst, quiet);
  }
  return null;
}
