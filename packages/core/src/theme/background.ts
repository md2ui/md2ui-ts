// A background level's lines: the image, gradient and shadow layers every background
// painter shares, and the full `SectionStyle` vocabulary (fills, strokes, radius,
// padding, spacing, alignment, rotation). Ported from md2ui's
// `_parse_layered_background_line` and `_parse_section_style_line`.
import type { GradientTheme, RotateChannel, SectionStyle, ShadowSpec } from "@md2ui/contracts";
import { partition, strip } from "../group/py/str.ts";
import { type Draft, newGradient } from "./model.ts";
import {
  applyPadding,
  applySpacer,
  type BlockState,
  groupSpacing,
  HORIZONTAL_ALIGN_KEYS,
  hex,
  horizontalAlign,
  imageSpacing,
  isYes,
  keyValue,
  lineAlign,
  num,
  openShadow,
  orphanRow,
  point,
  shadowBullet,
  shadowKey,
  spacing,
  strokeAlign,
  VERTICAL_ALIGN_KEYS,
} from "./values.ts";

/** Any style with the three shared background layers. */
export interface Layered {
  bg_image: string | null;
  gradient: Draft<GradientTheme> | null;
  shadows: Draft<ShadowSpec>[];
}

/**
 * One image, gradient or shadow line. True when the line belonged to those layers;
 * solid colour, stroke, radius and padding are left to the owning style's parser.
 */
export function parseLayeredLine(
  target: Layered,
  line: string,
  raw: string,
  state: BlockState,
): boolean {
  if (state.sh !== null && raw.startsWith("- ")) {
    shadowBullet(state.sh, strip(raw.slice(2)));
    return true;
  }
  const gradient = target.gradient;
  if (raw.startsWith("  - ") && gradient !== null) {
    gradientBullet(gradient, strip(raw.slice(4)), state.gl);
    return true;
  }
  if (raw.startsWith("- ") && gradient !== null) {
    const value = strip(raw.slice(2)).replace(/:+$/, "");
    const key = strip(partition(value, ":")[0]).toLowerCase();
    if (key === "ratios" || key === "colors" || key === "parameters") {
      state.gl = key;
      return true;
    }
    if (key === "type") {
      const [, found, rest] = partition(value, ":");
      if (found) gradient.type = strip(rest).toLowerCase();
      return true;
    }
  }
  if (!line.includes(":") || raw.startsWith("- ")) return false;
  const [key, val] = keyValue(line);
  state.sh = null;
  const inner = shadowKey(key);
  if (inner !== undefined) {
    state.sh = openShadow(target.shadows, inner);
    state.gl = "";
    state.sl = "";
    return true;
  }
  if (key === "background image") {
    if (val !== "" && !val.startsWith("(")) target.bg_image = val;
    return true;
  }
  if (key === "background gradient") {
    target.gradient = newGradient();
    state.gl = "";
    return true;
  }
  return false;
}

/** A `  - value` line under a gradient's open `Ratios`, `Colors` or `Parameters` list. */
export function gradientBullet(gradient: Draft<GradientTheme>, value: string, list: string): void {
  if (list === "ratios") {
    const ratio = num(value);
    if (ratio !== undefined && ratio >= 0) gradient.ratios.push(ratio);
  } else if (list === "colors") {
    const color = hex(value);
    if (color !== undefined) gradient.colors.push(color);
  } else if (list === "parameters" && value.includes(":")) {
    const [key, val] = keyValue(value);
    if (key === "start") gradient.start = point(val, gradient.start);
    else if (key === "end") gradient.end = point(val, gradient.end);
  }
}

// The word an author writes in `Rotate <kind> colors`, and the channel it gates.
const ROTATE_CHANNELS: Readonly<Record<string, RotateChannel>> = Object.freeze({
  background: "background",
  backgrounds: "background",
  section: "background",
  card: "card",
  cards: "card",
  element: "card",
  elements: "card",
  emoji: "emoji",
  emojis: "emoji",
  icon: "emoji",
  icons: "emoji",
  link: "link",
  links: "link",
  button: "link",
  buttons: "link",
  chip: "chip",
  chips: "chip",
  placeholder: "placeholder",
  placeholders: "placeholder",
  code: "chip",
  "inline code": "chip",
  heading: "heading",
  headings: "heading",
  text: "heading",
});

// Every channel, in the order md2ui's blanket `Rotate colors` sets them.
const ALL_CHANNELS: readonly RotateChannel[] = Object.freeze([
  "background",
  "card",
  "emoji",
  "link",
  "chip",
  "heading",
  "placeholder",
]);

/** The channel a `Rotate <kind> colors` key gates, read leniently, or `undefined`. */
function rotateChannel(key: string): RotateChannel | undefined {
  if (!key.startsWith("rotate ")) return undefined;
  let mid = strip(key.slice("rotate ".length));
  for (const suffix of [" colors", " color"]) {
    if (mid.endsWith(suffix)) {
      mid = strip(mid.slice(0, -suffix.length));
      break;
    }
  }
  return Object.hasOwn(ROTATE_CHANNELS, mid) ? ROTATE_CHANNELS[mid] : undefined;
}

/** One line of a background level. */
export function parseSectionLine(
  st: Draft<SectionStyle>,
  line: string,
  raw: string,
  state: BlockState,
): void {
  if (parseLayeredLine(st, line, raw, state)) return;
  if (raw.startsWith("- ")) {
    // A bare `- #RRGGBB` bullet: the list form of the background or stroke colour.
    const cval = strip(raw.slice(2));
    const c = cval.startsWith("#") ? hex(cval) : undefined;
    if (c !== undefined) {
      if (state.sl === "bg") {
        st.bg_colors.push(c);
      } else if (state.sl === "stroke") {
        st.stroke_colors.push(c);
        st.stroke_color = st.stroke_colors[0] ?? null;
      }
    }
    return;
  }
  if (!line.includes(":")) return;
  const [key, val] = keyValue(line);
  const group = groupSpacing(key, val);
  const image = imageSpacing(key, val);
  const element = spacing(key, val);
  const align = strokeAlign(val);
  const channel = rotateChannel(key);
  if (key === "corner radius") {
    st.corner_radius = num(val) ?? st.corner_radius;
    st.corner_radius_authored = true;
  } else if (key === "image corner radius") {
    st.image_corner_radius = num(val) ?? st.image_corner_radius;
  } else if (key === "image bleed") {
    st.image_bleed = isYes(val);
  } else if (key === "emoji aside") {
    st.emoji_aside = isYes(val);
  } else if (HORIZONTAL_ALIGN_KEYS.includes(key)) {
    st.align = horizontalAlign(val);
  } else if (VERTICAL_ALIGN_KEYS.includes(key)) {
    st.line_align = lineAlign(val);
  } else if (key === "orphan row") {
    st.orphan_row = orphanRow(val);
  } else if (applySpacer(st.spacers, key, val) || applyPadding(st.padding, key, val)) {
    // Applied.
  } else if (group !== undefined) {
    const [axis, v] = group;
    if (axis !== "col") st.group_row_spacing = v;
    if (axis !== "row") st.group_col_spacing = v;
  } else if (image !== undefined) {
    const [axis, v] = image;
    if (axis !== "col") st.image_row_spacing = v;
    if (axis !== "row") st.image_col_spacing = v;
  } else if (element !== undefined) {
    const [axis, v] = element;
    if (axis !== "col") st.row_spacing = v;
    if (axis !== "row") st.col_spacing = v;
  } else if (key === "merge rows") {
    st.merge_rows = isYes(val);
  } else if (key === "list card") {
    st.list_card = isYes(val);
  } else if (key === "adjacent section spacing") {
    // A removed concept, ignored so old themes still read.
  } else if (key === "stroke width") {
    st.stroke_width = num(val) ?? st.stroke_width;
  } else if (key === "stroke align" && align !== undefined) {
    st.stroke_align = align;
  } else if (key === "stroke color" || key === "stroke colors") {
    state.sl = "stroke";
    const c = val.startsWith("#") ? hex(val) : undefined;
    if (c !== undefined) {
      st.stroke_colors.push(c);
      st.stroke_color = st.stroke_colors[0] ?? null;
    }
  } else if (key === "background color" || key === "background colors") {
    state.sl = "bg";
    const c = val.startsWith("#") ? hex(val) : undefined;
    if (c !== undefined) st.bg_colors.push(c);
  } else if (key === "rotate colors" || key === "rotate color") {
    // `sync` shares this level's slot downward; yes/no gate every channel at once.
    if (strip(val).toLowerCase() === "sync") {
      st.sync_slot = true;
    } else {
      const on = isYes(val);
      for (const channel of ALL_CHANNELS) st.rotate[channel] = on;
    }
  } else if (channel !== undefined) {
    st.rotate[channel] = isYes(val);
  } else {
    // An unrecognised key ends the active bullet list, so a stray key between a list
    // key and its bullets cannot swallow them into the previous list.
    state.sl = "";
  }
}
