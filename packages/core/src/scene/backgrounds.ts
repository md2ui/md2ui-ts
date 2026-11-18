// What every box sits on (md2ui `render_backgrounds`: `_emit_wrap_boxes`, `_bg_selector`,
// `_push_bg`, `_root_bg_stack`, `_paint_style_for`; and `render_colors._replace_color`,
// `_table_background_color`). A wrapped node gets one section box per layer, outer to
// inner, each inset by the one before it; and every box records the surfaces behind it,
// innermost first, so `## Color Replacements` can key a colour on what it is painted
// over. Each layer is named by the very style that paints it, so the two cannot drift.
import type {
  Argb,
  ColorRole,
  HeadingLevel,
  PaddingBox,
  ResolvedTheme,
  SectionStyle,
} from "@md2ui/contracts";
import type { Layer, LayerKind } from "../measure/layers.ts";
import { filled } from "../measure/layers.ts";
import { mergedPaintStyle } from "../measure/list-surfaces.ts";
import { rotateColor, sectionIsActive, syncedSlot } from "../theme/query.ts";
import type { BgStack, SectionBox, SectionKind } from "./boxes.ts";

/** md2ui `BG_IMAGE`: a layer painted with a photo, which has no one colour to key on. */
export const BG_IMAGE = "image";

/**
 * md2ui `_photo`: a photo surface, named by the fixed style that paints it when one does,
 * so `On background color: image <style>` can tell one photo from another.
 */
export function photoSurface(fixedStyleKey: string | null): string {
  return fixedStyleKey ? `${BG_IMAGE}:${fixedStyleKey}` : BG_IMAGE;
}

/** md2ui `_opaque_or_none`: a colour only when it covers anything. */
export function opaque(color: Argb | null | undefined): Argb | null {
  return color === null || color === undefined || color >>> 24 === 0 ? null : color;
}

/** md2ui `_push_bg`: push a visible selector; an absent or transparent one leaves the stack. */
export function pushBg(stack: BgStack, selector: Argb | string | null): BgStack {
  if (selector === null || (typeof selector === "number" && selector >>> 24 === 0)) return stack;
  return [selector, ...stack];
}

/** md2ui `_root_bg_stack`: the page itself, the outermost entry every box inherits. */
export function rootBgStack(theme: ResolvedTheme): BgStack {
  const root = theme.root;
  if (filled(root.bg_image)) return [BG_IMAGE];
  return [root.box ? root.box_fill_color : root.bg_color];
}

/**
 * md2ui `_paint_style_for`: the style a section box of this kind paints with. A named
 * (fixed) style replaces its heading level's, merged with the level's override when the
 * theme has one. A merged list's row paints nothing.
 */
export function paintStyleFor(
  kind: SectionKind,
  level: number,
  theme: ResolvedTheme,
  fixedStyleKey: string | null,
): SectionStyle | undefined {
  const merged = mergedPaintStyle(kind, theme);
  if (merged !== undefined) return merged ?? undefined;
  switch (kind) {
    case "image_card":
      return sectionIsActive(theme.image_cards) ? theme.image_cards : theme.elements;
    case "card":
      // `### Elements` holds layout keys only (md2ui ADR-409): it paints nothing.
      return theme.elements;
    case "unordered_list":
      return theme.unordered_lists;
    case "task_list":
      return sectionIsActive(theme.task_lists) ? theme.task_lists : theme.unordered_lists;
    case "numbered_list":
      return theme.numbered_lists;
    case "quote":
      return theme.quotes;
    case "date_chip":
      return theme.datapoints.date_chip.chip;
    case "table_header":
      return theme.tables.header;
    case "table_row":
      return theme.tables.cells;
    case "table":
      return theme.tables.table;
    default:
      break;
  }
  if (fixedStyleKey && Object.hasOwn(theme.fixed_sections, fixedStyleKey)) {
    const own = theme.fixed_sections[fixedStyleKey] as SectionStyle;
    return theme.fixed_section_levels[fixedStyleKey]?.[level as HeadingLevel] ?? own;
  }
  return theme.sections[level as HeadingLevel];
}

/**
 * md2ui `_replace_color`: `color`, swapped when a `## Color Replacements` rule covers it.
 * Only the nearest visible background is the context (a fixed style's photo by its own
 * rules, else by the theme's `image` ones); within it an exact entry beats the role's
 * default.
 */
export function replaceColor(
  color: Argb,
  stack: BgStack,
  theme: ResolvedTheme,
  role: ColorRole = "text",
): Argb {
  const table = theme.color_replacements;
  const nearest = stack[0];
  if (nearest === undefined) return color;
  const key = String(nearest);
  // A style's photo with no rules of its own takes the theme's `image` ones.
  const rules = table[key] ?? (key.startsWith(`${BG_IMAGE}:`) ? table[BG_IMAGE] : undefined);
  const group = rules?.[role];
  if (group === undefined || Object.keys(group).length === 0) return color;
  return group[String(color)] ?? group["null"] ?? color;
}

/** md2ui `_table_background_color`: the fill a header or body row actually paints. */
export function tableBackgroundColor(
  style: SectionStyle,
  row: number,
  theme: ResolvedTheme,
): Argb | null {
  return rotateColor(style.bg_colors, style.bg_colors[0] ?? null, row, theme, "background");
}

/** What a wrapped node hands its layers: its photo, ring and colour-rotation slot. */
export interface WrapIdentity {
  readonly ring: unknown;
  readonly bgImageUrl: string | null;
  readonly rotationIndex: number | null;
  readonly rotationChain: readonly (number | string)[];
  readonly rotationPath: readonly number[];
  readonly fixedStyleKey: string | null;
}

/**
 * md2ui `_bg_selector`: what one wrap layer counts as for the content inside it: the photo
 * marker, the colour it paints (rotation resolved as the paint resolves it), or `null`
 * when it covers nothing a rule could key on.
 */
function bgSelector(
  kind: LayerKind,
  level: number,
  bgImageUrl: string | null,
  who: WrapIdentity,
  theme: ResolvedTheme,
): Argb | string | null {
  const st = paintStyleFor(kind, level, theme, who.fixedStyleKey);
  if (st === undefined) return null;
  if (filled(bgImageUrl) || filled(st.bg_image)) return photoSurface(who.fixedStyleKey);
  const first = st.bg_colors[0];
  if (first === undefined) return null;
  // A date chip paints its first colour; a box with no node behind it (a table row)
  // names the base colour, since its paint picks by a counter this side cannot see.
  if (kind === "date_chip" || who.rotationIndex === null) return opaque(first);
  const fixed = who.fixedStyleKey;
  const chain = [
    ...who.rotationChain,
    ...(fixed ? [`fixed:${fixed}|${level}`] : level ? [level] : []),
  ];
  const slot = syncedSlot(who.rotationIndex, who.rotationChain, who.rotationPath, theme);
  const channel = kind === "card" || kind === "image_card" ? "card" : "background";
  return opaque(rotateColor(st.bg_colors, null, slot, theme, channel, chain));
}

/** Where a wrapped node's content goes: its origin, width, and the surfaces behind it. */
export interface WrapInner {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly bgStack: BgStack;
}

/**
 * md2ui `_emit_wrap_boxes`: one section box per layer, outer to inner, each inset by the
 * layer before it. The photo rides the outermost layer, the one covering the node's full
 * extent; every layer shares the node's rotation slot.
 */
export function emitWrapBoxes(
  sections: SectionBox[],
  x: number,
  y: number,
  width: number,
  height: number,
  layers: readonly Layer[],
  who: WrapIdentity,
  theme: ResolvedTheme,
  bgStack: BgStack,
): WrapInner {
  let bx = x;
  let by = y;
  let rw = width;
  let rh = height;
  let stack = bgStack;
  layers.forEach(({ kind, level, style }, i) => {
    const enclosing = stack;
    const photo = i === 0 ? who.bgImageUrl : null;
    let selector = bgSelector(kind, level, photo, who, theme);
    if (typeof selector === "number") {
      // Its own fill is replaced first, as the paint loop replaces it.
      selector = replaceColor(selector, stack, theme, "fill");
    }
    stack = pushBg(stack, selector);
    sections.push(
      sectionBox(bx, by, rw, rh, level, style.padding, kind, {
        ring: kind === "ring" ? (who.ring ?? null) : null,
        bg_image_url: photo,
        rotation_index: who.rotationIndex,
        rotation_chain: [...who.rotationChain],
        rotation_path: [...who.rotationPath],
        bg_stack: enclosing,
        fixed_style_key: who.fixedStyleKey,
      }),
    );
    bx += style.padding.left;
    by += style.padding.top;
    rw -= style.padding.left + style.padding.right;
    rh -= style.padding.top + style.padding.bottom;
  });
  return { x: bx, y: by, width: rw, bgStack: stack };
}

/** md2ui `SectionBox(...)`: every optional field at its default unless given. */
export function sectionBox(
  x: number,
  y: number,
  width: number,
  height: number,
  level: number,
  padding: PaddingBox,
  kind: SectionKind,
  fields: Partial<SectionBox> = {},
): SectionBox {
  return {
    x,
    y,
    width,
    height,
    level,
    padding,
    kind,
    clip: null,
    ring: null,
    bg_image_url: null,
    rotation_index: null,
    rotation_chain: [],
    rotation_path: [],
    bg_stack: [],
    fixed_style_key: null,
    ...fields,
  };
}
