// The theme model's defaults: what every field is when THEME.md is silent.
//
// Ported from md2ui's `pipeline/theme_model.py`. An unthemed document renders
// because these defaults are the design; a THEME.md only overrides them. The parser
// builds a theme as a `Draft` (the C2 shape, writable) and hands it out as the
// read-only `ResolvedTheme`.
import type {
  Argb,
  BarTheme,
  BulletedListStyle,
  DateChipTheme,
  EmojiAxes,
  EmojiBadgeStyle,
  EmojiTextStyle,
  GradientTheme,
  InlineCodeTheme,
  LinkStyle,
  NumberedListStyle,
  PaddingBox,
  QuoteStyle,
  ResolvedTheme,
  RingTheme,
  SectionStyle,
  ShadowSpec,
  SliderTheme,
  TaskControlsTheme,
  TextStyle,
} from "@md2ui/contracts";

/** The C2 shape with every `readonly` removed, all the way down. */
export type Draft<T> = T extends object ? { -readonly [K in keyof T]: Draft<T[K]> } : T;

/** md2ui's `skia.ColorSetARGB`: an unsigned 32-bit ARGB integer. */
export function argb(a: number, r: number, g: number, b: number): Argb {
  return a * 0x1000000 + r * 0x10000 + g * 0x100 + b;
}

const TEXT_COLOR = argb(255, 60, 60, 60);
const BG_COLOR = argb(255, 245, 245, 245);
const RULE_COLOR = argb(255, 192, 192, 192);
const TRANSPARENT = 0;
export const MUTED_TEXT_COLOR = argb(255, 154, 154, 154);
// md2ui GREY_*: the built-in paint, what an element draws in where THEME.md leaves it
// unstyled, grayscale only. A theme that wants colour states it.
export const GREY_INK: Argb = 0xff222222; // fills, the main button, a ticked box, a line
export const GREY_TRACK: Argb = 0xffe5e5e5; // tracks, an open box's ground, the tertiary button
export const GREY_MID: Argb = 0xff8c8c8c; // handles, a second series
export const GREY_LIGHT: Argb = 0xffbdbdbd; // an open box's ring, a third series
export const GREY_DARK: Argb = 0xff5a5a5a; // a fourth series
export const GREY_WHITE: Argb = 0xffffffff;
export const CONTENT_WIDTH_MIN = 320;

/** `Emoji fill` / `grade` / `optical size` all unset: the font's own axes. */
function newEmojiAxes(): EmojiAxes {
  return { fill: null, grade: null, optical_size: null };
}

/** A deep copy of plain theme data, as md2ui's `copy.deepcopy`. */
export function deepCopy<T>(value: T): T {
  if (Array.isArray(value)) return value.map(deepCopy) as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepCopy(v);
    return out as T;
  }
  return value;
}

/**
 * `record[key] = value` as an own data property, so an authored key such as
 * `__proto__` (a glyph or label in THEME.md) is data, never the object's prototype.
 */
export function setOwn<V>(record: Record<string, V>, key: string, value: V): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

export function newTextStyle(fields: Partial<Draft<TextStyle>> = {}): Draft<TextStyle> {
  return {
    font_name: "Arial",
    font_size: 13,
    font_weight: "",
    color: TEXT_COLOR,
    colors: [],
    marker_text_color: null,
    marker_bg_color: null,
    marker_text_colors: [],
    marker_bg_colors: [],
    ...fields,
  };
}

export function newPadding(all = 0): Draft<PaddingBox> {
  return { top: all, left: all, right: all, bottom: all };
}

export function newGradient(): Draft<GradientTheme> {
  return { type: "linear", colors: [], ratios: [], start: [0, 0], end: [0, 1] };
}

export function newShadow(inner: boolean): Draft<ShadowSpec> {
  return { inner, offset_x: 0, offset_y: 0, color: 0, radius: 0 };
}

export function newSectionStyle(fields: Partial<Draft<SectionStyle>> = {}): Draft<SectionStyle> {
  return {
    padding: newPadding(),
    corner_radius: 0,
    corner_radius_authored: false,
    image_corner_radius: 0,
    image_bleed: false,
    emoji_aside: null,
    align: null,
    line_align: null,
    orphan_row: null,
    spacers: {},
    marker: null,
    bg_colors: [],
    bg_image: null,
    gradient: null,
    shadows: [],
    stroke_width: 0,
    stroke_color: null,
    stroke_align: "center",
    stroke_colors: [],
    rotate: {},
    sync_slot: false,
    row_spacing: null,
    col_spacing: null,
    group_row_spacing: null,
    group_col_spacing: null,
    image_row_spacing: null,
    image_col_spacing: null,
    merge_rows: false,
    list_card: false,
    ...fields,
  };
}

export function newBulletedList(): Draft<BulletedListStyle> {
  return {
    shape: null,
    size: 8,
    color: null,
    colors: [],
    emoji: null,
    space: 10,
    aside: true,
    alignment: "top",
  };
}

export function newNumberedList(): Draft<NumberedListStyle> {
  return { text_style: null, number_format: "{n}", space: 10, aside: true, alignment: "top" };
}

export function newQuote(): Draft<QuoteStyle> {
  return {
    bar_width: 0,
    bar_length: 50,
    bar_color: null,
    bar_colors: [],
    quote_char: null,
    char_text_style: newTextStyle(),
    space: 12,
    aside: true,
    alignment: "top",
  };
}

function newLinkStyle(fields: Partial<Draft<LinkStyle>> = {}): Draft<LinkStyle> {
  return {
    corner_radius: null,
    padding: null,
    fill_color: null,
    text_style: null,
    stroke_width: null,
    stroke_color: null,
    stroke_align: null,
    fill_colors: [],
    stroke_colors: [],
    bg_image: null,
    gradient: null,
    shadows: [],
    emoji_shape: null,
    disabled_fill_color: null,
    disabled_text_color: null,
    disabled_stroke_color: null,
    emoji_gap: null,
    emoji_weight: null,
    emoji_axes: newEmojiAxes(),
    ...fields,
  };
}

/**
 * md2ui `_unpainted_link_style`: the base a theme that styles links starts from: no fill
 * and no stroke, so under its `## Links` a link draws as text until the block asks for a
 * background. A Text link always resolves against this.
 */
export function unpaintedLinkStyle(): Draft<LinkStyle> {
  return newLinkStyle({
    corner_radius: 16,
    padding: newPadding(10),
    fill_color: TRANSPARENT,
    // "" is the body family: an unstyled link label draws in the body's face.
    text_style: newTextStyle({ font_name: "" }),
    stroke_width: 0,
    stroke_color: TRANSPARENT,
    stroke_align: "center",
    emoji_shape: "circle",
  });
}

/**
 * md2ui `_default_primary_link_style`: Primary while a theme leaves the Links family
 * unstyled, a pill in the built-in greys, so a button reads as one with no theme too.
 */
function defaultPrimaryLinkStyle(): Draft<LinkStyle> {
  return {
    ...unpaintedLinkStyle(),
    corner_radius: 999,
    padding: { top: 10, left: 16, right: 16, bottom: 10 },
    fill_color: GREY_INK,
    text_style: newTextStyle({ font_name: "", color: GREY_WHITE }),
  };
}

/**
 * The Links family as md2ui `LinksTheme.take_over` leaves it once a theme styles links:
 * the built-in grey buttons dropped for the unpainted base the theme builds on, once,
 * before any of its own keys apply.
 */
export function takeOverLinks(links: Draft<ResolvedTheme["links"]>): void {
  if (links.themed) return;
  links.themed = true;
  links.primary = unpaintedLinkStyle();
  links.secondary = newLinkStyle();
  links.tertiary = newLinkStyle();
}

function newEmojiText(): Draft<EmojiTextStyle> {
  return { color: null, font_path: null, fixed_colors: {} };
}

function newEmojiBadge(): Draft<EmojiBadgeStyle> {
  return {
    icon_size: 20,
    icon_colors: [],
    fill: newSectionStyle(),
    shape: null,
    disabled_bg_color: null,
    disabled_icon_color: null,
    disabled_stroke_color: null,
    emoji_weight: null,
    emoji_axes: newEmojiAxes(),
    is_muted: false,
  };
}

function newInlineCode(): Draft<InlineCodeTheme> {
  return {
    corner_radius: 4,
    padding: newPadding(2),
    fill_color: argb(255, 230, 230, 230),
    stroke_color: TRANSPARENT,
    stroke_width: 0,
    stroke_align: "center",
    fill_colors: [],
    stroke_colors: [],
    bg_image: null,
    gradient: null,
    shadows: [],
    text_style: null,
    emoji_weight: null,
    emoji_axes: newEmojiAxes(),
    disabled_fill_color: null,
    disabled_text_color: null,
    disabled_stroke_color: null,
    muted: false,
    secondary: null,
    tertiary: null,
    quaternary: null,
    quinary: null,
    senary: null,
    septenary: null,
  };
}

function newBar(): Draft<BarTheme> {
  return {
    enabled: true,
    thickness: 10,
    position: "below",
    text_side: "right",
    show_key: true,
    show_value: true,
    track_enabled: true,
    bar: newSectionStyle(),
    track: newSectionStyle(),
    negative_color: null,
  };
}

function newRing(): Draft<RingTheme> {
  return {
    thickness: 12,
    diameter: 96,
    spacing: 0,
    ring: newSectionStyle(),
    track: newSectionStyle(),
    value_text: null,
    unit_text: null,
  };
}

function newDateChip(): Draft<DateChipTheme> {
  return {
    enabled: true,
    fill: "single",
    spacing: 0,
    chip: newSectionStyle(),
    key_bg: newSectionStyle(),
    day_bg: newSectionStyle(),
    key_text: null,
    day_text: null,
  };
}

function newTaskControls(): Draft<TaskControlsTheme> {
  return {
    enabled: true,
    type: "checkbox",
    size: null,
    padding: 4,
    corner_radius: null,
    space: 10,
    checked_outer: newSectionStyle(),
    checked_inner: newSectionStyle(),
    unchecked_outer: newSectionStyle(),
    unchecked_inner: newSectionStyle(),
    checked_symbol: null,
    checked_symbol_color: null,
    unchecked_symbol: null,
    unchecked_symbol_color: null,
  };
}

function newSliders(): Draft<SliderTheme> {
  return {
    enabled: true,
    style: "thick",
    axis: "horizontal",
    length: 240,
    thickness: null,
    corner_radius: null,
    circle_diameter: 28,
    drag_bar_length: 22,
    drag_bar_thickness: 3,
    drag_bar_gap: 5,
    bar: newSectionStyle(),
    track: newSectionStyle(),
    handle: newSectionStyle(),
  };
}

/** md2ui's `Theme()`, plus md2ui-ts's own `motion`: the theme of a document with no THEME.md. */
export function newTheme(): Draft<ResolvedTheme> {
  return {
    name: "",
    root: {
      bg_color: BG_COLOR,
      bg_image: null,
      padding: newPadding(),
      box: false,
      box_fill_color: BG_COLOR,
      box_radius: 0,
      gradient: null,
      shadows: [],
      align: "left",
      spacers: {},
      line_align: "baseline",
      orphan_row: "left",
      max_width: 1280,
      centered: true,
      layout: "default",
      pack_unique: true,
      row_spacing: null,
      col_spacing: null,
    },
    bento: { heading_level: null },
    elements: newSectionStyle({ row_spacing: 8, col_spacing: 8 }),
    image_cards: newSectionStyle(),
    unordered_lists: newSectionStyle(),
    task_lists: newSectionStyle(),
    numbered_lists: newSectionStyle(),
    quotes: newSectionStyle(),
    headings: {},
    sections: {},
    fixed_sections: {},
    fixed_section_levels: {},
    text: newTextStyle(),
    labels: newTextStyle({ font_size: 11 }),
    key_style: null,
    value_style: null,
    muted: null,
    lead: null,
    display: null,
    text_style_overrides: {},
    links: {
      primary: defaultPrimaryLinkStyle(),
      // `*…*` while the theme leaves links unstyled: white, an ink outline.
      secondary: newLinkStyle({
        fill_color: GREY_WHITE,
        stroke_width: 1.5,
        stroke_color: GREY_INK,
        text_style: newTextStyle({ font_name: "", color: GREY_INK }),
      }),
      // `**…**` while the theme leaves links unstyled: a light-grey pill.
      tertiary: newLinkStyle({
        fill_color: GREY_TRACK,
        text_style: newTextStyle({ font_name: "", color: GREY_INK }),
      }),
      quaternary: newLinkStyle(),
      quinary: newLinkStyle(),
      senary: newLinkStyle(),
      septenary: newLinkStyle(),
      text: newLinkStyle(),
      inline: { text_color: null, underline: true },
      segmented: false,
      themed: false,
    },
    emojis: {
      font_path: null,
      primary: newEmojiBadge(),
      text: newEmojiText(),
      link: newEmojiText(),
      inline: newEmojiText(),
      secondary: null,
      tertiary: null,
      quaternary: null,
    },
    horizontal_rule: { stroke_color: RULE_COLOR, stroke_width: 1 },
    horizontal_rule_overrides: {},
    separators: { dash: false, bar: false },
    vertical_rule: { draw: false, stroke_color: RULE_COLOR, stroke_width: 1 },
    inline_code: newInlineCode(),
    code_blocks: {
      text_style: newTextStyle({ font_name: "monospace", font_size: 13 }),
      syntax_style: "bw", // grayscale; a theme names a coloured Pygments style
      background_color: BG_COLOR,
      corner_radius: 8,
      padding: newPadding(12),
      line_spacing: 4,
      min_width: 320,
      max_lines: 20,
      fade: true,
      copy_icon: "📋",
      copy_icon_size: 14,
      copy_button: newLinkStyle({
        corner_radius: 6,
        padding: newPadding(4),
        fill_color: argb(48, 128, 128, 128),
      }),
    },
    content_weight: {
      first_scale: 1.3,
      second_scale: 1.15,
      less_scale: 0.85,
      less_color: MUTED_TEXT_COLOR,
    },
    tables: {
      table: newSectionStyle(),
      header: newSectionStyle(),
      header_text: null,
      cells: newSectionStyle(),
      cells_text: null,
      stacking: false,
      card_layout: "title",
      keys_text: null,
      key_spacing: 4,
    },
    datapoints: {
      ratio_bar: newBar(),
      kv_bar: newBar(),
      unit_ratio_enabled: true,
      unit_ratio_style: "bar",
      unit_ratio_show_total: true,
      unit_ratio_show_key: true,
      ring: newRing(),
      date_chip: newDateChip(),
      task_controls: newTaskControls(),
      sliders: newSliders(),
      counts: { button: newSectionStyle(), symbol_color: null },
    },
    charts: {
      enabled: true,
      mode: "bar",
      bar_thickness: 14,
      bar_spacing: 8,
      bar_width: "fixed",
      track_enabled: true,
      bar: newSectionStyle(),
      track: newSectionStyle(),
      series_colors: [],
      negative_color: null,
      percent_scale: "100",
      value_format: "1",
      grid: {
        axis_labels: false,
        ticks: 4,
        horizontal: false,
        vertical: false,
        color: 0xffd0d0d0,
        width: 1,
        dash: [],
        text: null,
      },
      line: {
        // On with no theme, like every display; `Enabled: no` turns it off.
        enabled: true,
        height: 48,
        group_height: null,
        width: 2,
        color: null,
        point_size: 6,
        points: "labelled",
      },
      label_text: null,
      value_text: null,
    },
    fixed: {
      emoji: {},
      emoji_bg: {},
      pill_exact: {},
      pill_contains: {},
      button_exact: {},
      button_contains: {},
      datapoints: {},
    },
    image_placeholders: {},
    image_placeholder_defaults: {},
    color_replacements: {},
    font_paths: [],
    motion: { duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" },
  };
}
