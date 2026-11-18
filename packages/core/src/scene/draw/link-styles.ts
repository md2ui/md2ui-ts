// A button's resolved style (md2ui `render_style._resolve_link`), and a choice option's
// colours on it (md2ui `render_segmented.choice_style`, `render_choices.shown_chosen`,
// ADR-405). Shared by the button's drawer, a segmented run's surface and a count's two
// buttons, which md2ui all paint in a button variant's colours.
import type { Argb, GroupingNode, LinkStyle } from "@md2ui/contracts";
import type { SizedNode } from "../../measure/node-index.ts";
import { linkStyle } from "../../measure/theme-styles.ts";
import { rotateColor } from "../../theme/query.ts";
import { rotationSlot } from "./colors.ts";
import type { Draw } from "./context.ts";
import { disabledLinkStyle } from "./muted.ts";

/** md2ui `_rotated_link_style`: this link's slot picked out of its colour lists. */
function rotatedLinkStyle(d: Draw, style: LinkStyle, node: GroupingNode | undefined): LinkStyle {
  const ts = style.text_style;
  const rotates =
    style.fill_colors.length > 0 ||
    style.stroke_colors.length > 0 ||
    (ts !== null && ts.colors.length > 0);
  if (!rotates || node === undefined) return style;
  const { theme } = d.sizer;
  const { index, chain } = rotationSlot(node, theme);
  const rotate = (colors: readonly Argb[], fallback: Argb | null) =>
    rotateColor(colors, fallback, index, theme, "link", chain);
  return {
    ...style,
    fill_color: rotate(style.fill_colors, style.fill_color),
    stroke_color: rotate(style.stroke_colors, style.stroke_color),
    text_style:
      ts !== null && ts.colors.length > 0
        ? { ...ts, color: rotate(ts.colors, ts.color) ?? ts.color }
        : ts,
  };
}

/** md2ui `_resolve_link`'s style: the variant, rotated, then disabled when the node is. */
export function resolvedLinkStyle(
  d: Draw,
  sized: SizedNode,
  node: GroupingNode | undefined,
): LinkStyle {
  const base = linkStyle(d.sizer.theme, sized.link_variant || "primary");
  const rotated = rotatedLinkStyle(d, base, node);
  return sized.link_disabled ? disabledLinkStyle(rotated) : rotated;
}

/** md2ui `shown_chosen`: whether an option is drawn chosen, as the host shows it, else as written. */
export function shownChosen(d: Draw, sized: SizedNode): boolean {
  return d.choices.get(sized.node_id) ?? (sized.link_variant || "primary") === "primary";
}

/**
 * md2ui `choice_style`: `style` as a choice option is shown. An unchosen segment is its
 * label only, in the quieter ink; an option the host's tap moved takes the other
 * variant's colours in its own box. Anything else is unchanged. An option is known by
 * what was stamped on it, a segmented run (`d.segments`) or the host's tap
 * (`d.choices`), never by reading its destination here.
 */
export function choiceStyle(
  d: Draw,
  sized: SizedNode,
  node: GroupingNode | undefined,
  style: LinkStyle,
): LinkStyle {
  const id = sized.node_id;
  const segment = d.segments.has(id);
  if (!(segment || d.choices.has(id))) return style;
  // A disabled or pending option outside a run is a separate pill, disabled whole; inside
  // one it is drawn as a segment, in its disabled colours.
  if (sized.link_disabled && !segment) return style;
  const chosen = shownChosen(d, sized);
  const authored = (sized.link_variant || "primary") === "primary";
  if (!segment && chosen === authored) return style;
  const variant = chosen ? "primary" : "secondary";
  const other = resolvedLinkStyle(d, { ...sized, link_variant: variant }, node);
  const ts = style.text_style;
  const text_style =
    ts !== null && other.text_style !== null ? { ...ts, color: other.text_style.color } : ts;
  if (segment && !chosen) {
    return {
      ...style,
      fill_color: 0,
      stroke_width: 0,
      shadows: [],
      gradient: null,
      bg_image: null,
      text_style,
    };
  }
  return {
    ...style,
    fill_color: other.fill_color,
    stroke_color: other.stroke_color,
    stroke_width: other.stroke_width,
    shadows: other.shadows,
    gradient: other.gradient,
    bg_image: other.bg_image,
    text_style,
  };
}
