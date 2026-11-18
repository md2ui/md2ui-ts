// C2 — Resolved theme: what a THEME.md becomes once parsed, every default filled in.
// Not public.
//
// The shape is md2ui's `Theme` dataclass tree (`pipeline/theme_model.py`), field for
// field and with md2ui's snake_case names, so the layout and scene ports read the
// same names as the Python they port, and a resolved theme compares directly with
// md2ui's exported `theme/*.json` fixtures. Two departures from the fixture form,
// both because the fixture writes a Python-only key or value as text:
// - `fixed_section_levels` is nested, fixed-style key then heading level, where
//   md2ui keys one dict on a `(key, level)` tuple;
// - a non-finite number is a number here, where the fixture writes it as a string.
//
// Colours are ARGB integers, unsigned 32-bit (`0xAARRGGBB`), as md2ui's Skia colours.
// A colour key that takes "one value or a bullet list" keeps the list beside the
// scalar, and the scalar is the list's first entry.
//
// One field is md2ui-ts vocabulary, with no md2ui counterpart: `motion` (motion keys
// are TS-first). md2ui's fixtures never hold it, so the
// conformance check leaves it out of the comparison.

/** A heading level, 1–6. */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/** An unsigned 32-bit ARGB colour. */
export type Argb = number;

export type HorizontalAlign = "left" | "center" | "right";
export type LineAlign = "top" | "baseline" | "center" | "bottom";
export type OrphanRow = "left" | "center" | "stretch";
export type StrokeAlign = "center" | "inside" | "outside";

/** A rotation channel a heading level can gate with `Rotate <kind> colors`. */
export type RotateChannel =
  | "background"
  | "card"
  | "emoji"
  | "link"
  | "chip"
  | "heading"
  | "placeholder";

/** A `Spacer <step> [row|col]` key: a step, or a step for one direction. */
export type SpacerKey =
  | "small"
  | "medium"
  | "large"
  | `${"small" | "medium" | "large"} ${"row" | "col"}`;

export interface TextStyle {
  readonly font_name: string;
  readonly font_size: number;
  /** `""` is regular; otherwise the authored weight text, unvalidated. */
  readonly font_weight: string;
  readonly color: Argb;
  readonly colors: readonly Argb[];
  readonly marker_text_color: Argb | null;
  readonly marker_bg_color: Argb | null;
  readonly marker_text_colors: readonly Argb[];
  readonly marker_bg_colors: readonly Argb[];
}

/** A `TextStyle` field a local text-role patch can declare. */
export type TextPatchProperty =
  | "color"
  | "font_name"
  | "font_size"
  | "font_weight"
  | "marker_bg_color"
  | "marker_text_color";

/** Only the text-style properties declared at one styling scope. */
export interface TextStylePatch {
  readonly style: TextStyle;
  /** Sorted, without repeats. */
  readonly declared: readonly TextPatchProperty[];
}

export interface PaddingBox {
  readonly top: number;
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
}

export interface GradientTheme {
  /** `"linear"` by default; otherwise the authored type, lowercased and unvalidated. */
  readonly type: string;
  readonly colors: readonly Argb[];
  readonly ratios: readonly number[];
  readonly start: readonly [number, number];
  readonly end: readonly [number, number];
}

export interface ShadowSpec {
  readonly inner: boolean;
  readonly offset_x: number;
  readonly offset_y: number;
  readonly color: Argb;
  readonly radius: number;
}

export interface RootTheme {
  readonly bg_color: Argb;
  readonly bg_image: string | null;
  readonly padding: PaddingBox;
  readonly box: boolean;
  readonly box_fill_color: Argb;
  readonly box_radius: number;
  readonly gradient: GradientTheme | null;
  readonly shadows: readonly ShadowSpec[];
  readonly align: HorizontalAlign;
  readonly spacers: Readonly<Partial<Record<SpacerKey, number>>>;
  readonly line_align: LineAlign;
  readonly orphan_row: OrphanRow;
  readonly max_width: number;
  readonly centered: boolean;
  /**
   * `Layout:`: stacked, the bento mosaic, or `auto`, where the engine tiles a document
   * only when that leaves clearly less of the page empty, decided once per document and
   * width band (md2ui `layout_auto`).
   */
  readonly layout: "default" | "bento" | "auto";
  readonly pack_unique: boolean;
  readonly row_spacing: number | null;
  readonly col_spacing: number | null;
}

export interface BentoTheme {
  readonly heading_level: HeadingLevel | null;
}

export interface BulletedListStyle {
  /** `"circle"` / `"square"` draw; any other authored text is kept, lowercased. */
  readonly shape: string | null;
  readonly size: number;
  readonly color: Argb | null;
  readonly colors: readonly Argb[];
  readonly emoji: string | null;
  readonly space: number;
  readonly aside: boolean;
  readonly alignment: LineAlign;
}

export interface NumberedListStyle {
  readonly text_style: TextStyle | null;
  /** A template with an `{n}` placeholder. */
  readonly number_format: string;
  readonly space: number;
  readonly aside: boolean;
  readonly alignment: LineAlign;
}

export interface QuoteStyle {
  readonly bar_width: number;
  readonly bar_length: number;
  readonly bar_color: Argb | null;
  readonly bar_colors: readonly Argb[];
  readonly quote_char: string | null;
  /** The default text style unless a `Font *` key sets one. */
  readonly char_text_style: TextStyle;
  readonly space: number;
  readonly aside: boolean;
  readonly alignment: LineAlign;
}

/**
 * A level's gutter marker. md2ui tells the three apart by class; here, by the
 * field only one of them has (`shape`, `number_format`, `bar_width`).
 */
export type MarkerStyle = BulletedListStyle | NumberedListStyle | QuoteStyle;

/** A background level: root-like paint, spacing and behaviour for one surface. */
export interface SectionStyle {
  readonly padding: PaddingBox;
  readonly corner_radius: number;
  readonly corner_radius_authored: boolean;
  readonly image_corner_radius: number;
  readonly image_bleed: boolean;
  readonly emoji_aside: boolean | null;
  readonly align: HorizontalAlign | null;
  readonly line_align: LineAlign | null;
  readonly orphan_row: OrphanRow | null;
  readonly spacers: Readonly<Partial<Record<SpacerKey, number>>>;
  readonly marker: MarkerStyle | null;
  readonly bg_colors: readonly Argb[];
  readonly bg_image: string | null;
  readonly gradient: GradientTheme | null;
  readonly shadows: readonly ShadowSpec[];
  readonly stroke_width: number;
  readonly stroke_color: Argb | null;
  readonly stroke_align: StrokeAlign;
  readonly stroke_colors: readonly Argb[];
  readonly rotate: Readonly<Partial<Record<RotateChannel, boolean>>>;
  readonly sync_slot: boolean;
  readonly row_spacing: number | null;
  readonly col_spacing: number | null;
  readonly group_row_spacing: number | null;
  readonly group_col_spacing: number | null;
  readonly image_row_spacing: number | null;
  readonly image_col_spacing: number | null;
  readonly merge_rows: boolean;
  /** A list level's `List card: yes`: the element card around a run of its items alone stays. */
  readonly list_card: boolean;
}

export interface TableTheme {
  readonly table: SectionStyle;
  readonly header: SectionStyle;
  readonly header_text: TextStyle | null;
  readonly cells: SectionStyle;
  readonly cells_text: TextStyle | null;
  readonly stacking: boolean;
  readonly card_layout: "title" | "keys";
  readonly keys_text: TextStyle | null;
  readonly key_spacing: number;
}

export interface BarTheme {
  readonly enabled: boolean;
  readonly thickness: number;
  readonly position: "above" | "below";
  readonly text_side: "left" | "right";
  readonly show_key: boolean;
  readonly show_value: boolean;
  readonly track_enabled: boolean;
  readonly bar: SectionStyle;
  readonly track: SectionStyle;
  /** The fill of a value below zero; `null` paints it in the bar's own colour. */
  readonly negative_color: Argb | null;
}

export interface RingTheme {
  readonly thickness: number;
  readonly diameter: number;
  readonly spacing: number;
  readonly ring: SectionStyle;
  readonly track: SectionStyle;
  readonly value_text: TextStyle | null;
  readonly unit_text: TextStyle | null;
}

export interface DateChipTheme {
  readonly enabled: boolean;
  readonly fill: "single" | "split";
  readonly spacing: number;
  readonly chip: SectionStyle;
  readonly key_bg: SectionStyle;
  readonly day_bg: SectionStyle;
  readonly key_text: TextStyle | null;
  readonly day_text: TextStyle | null;
}

export interface TaskControlsTheme {
  readonly enabled: boolean;
  readonly type: "checkbox" | "switch";
  readonly size: number | null;
  readonly padding: number;
  readonly corner_radius: number | null;
  readonly space: number;
  readonly checked_outer: SectionStyle;
  readonly checked_inner: SectionStyle;
  readonly unchecked_outer: SectionStyle;
  readonly unchecked_inner: SectionStyle;
  /**
   * A glyph centred in each state's inner shape (`Symbol:` in its `### … inner` block),
   * drawn in the emoji face; `null` draws none.
   */
  readonly checked_symbol: string | null;
  /** `Symbol color:`; `null` takes the state's outer fill. Replaced like text. */
  readonly checked_symbol_color: Argb | null;
  readonly unchecked_symbol: string | null;
  readonly unchecked_symbol_color: Argb | null;
}

export interface SliderTheme {
  readonly enabled: boolean;
  readonly style: "thick" | "line";
  readonly axis: "horizontal" | "vertical";
  readonly length: number;
  readonly thickness: number | null;
  readonly corner_radius: number | null;
  readonly circle_diameter: number;
  readonly drag_bar_length: number;
  readonly drag_bar_thickness: number;
  /** `Drag bar gap:` how far inside the fill the thick style's drag bar sits from the value edge (≥ 0). */
  readonly drag_bar_gap: number;
  readonly bar: SectionStyle;
  readonly track: SectionStyle;
  readonly handle: SectionStyle;
}

/**
 * A count's round ➖/➕ buttons (`### Count Button` under `## Drawing elements`), one
 * layer as a slider handle is. A `button` that paints nothing inherits the quieter
 * button's paint; `symbol_color` `null` takes that paint's label colour. Named only here:
 * the index exports no `CountTheme` (it is reached as `DatapointsTheme.counts`).
 */
interface CountTheme {
  readonly button: SectionStyle;
  /** `Symbol color:` the ink of the ➖ and ➕, replaced against the button's fill. */
  readonly symbol_color: Argb | null;
}

export interface DatapointsTheme {
  readonly ratio_bar: BarTheme;
  readonly kv_bar: BarTheme;
  readonly unit_ratio_enabled: boolean;
  readonly unit_ratio_style: "bar" | "ring";
  readonly unit_ratio_show_total: boolean;
  readonly unit_ratio_show_key: boolean;
  readonly ring: RingTheme;
  readonly date_chip: DateChipTheme;
  readonly task_controls: TaskControlsTheme;
  readonly sliders: SliderTheme;
  readonly counts: CountTheme;
}

export interface ChartsTheme {
  readonly enabled: boolean;
  readonly mode: "bar" | "line";
  readonly bar_thickness: number;
  readonly bar_spacing: number;
  readonly bar_width: "fixed" | "fill";
  readonly track_enabled: boolean;
  readonly bar: SectionStyle;
  readonly track: SectionStyle;
  readonly series_colors: readonly Argb[];
  /** The fill of a bar below zero; `null` paints it in its series colour. */
  readonly negative_color: Argb | null;
  /** `"100"`: a percentage chart reads as progress against 100%; `"peak"`: against its largest row. */
  readonly percent_scale: "100" | "peak";
  /** Where a declared unit shows on bare values (`Value format`); `"1"` leaves them bare. */
  readonly value_format: "1" | "1 unit" | "1unit" | "unit 1";
  readonly grid: ChartGridTheme;
  readonly line: LineChartTheme;
  readonly label_text: TextStyle | null;
  readonly value_text: TextStyle | null;
}

/**
 * The scale and lines a vertical chart draws behind its bars (`### Chart Grid`),
 * all off by default. The zero line of a chart holding a negative always takes
 * `color` and `width`, never `dash`.
 */
export interface ChartGridTheme {
  readonly axis_labels: boolean;
  /** About how many steps the scale is cut into, 1 to 20; ticks land on round values. */
  readonly ticks: number;
  readonly horizontal: boolean;
  readonly vertical: boolean;
  readonly color: Argb;
  readonly width: number;
  /** On/off lengths; empty draws solid. */
  readonly dash: readonly number[];
  /** Tick labels; `null` falls back to the chart values' style. */
  readonly text: TextStyle | null;
}

/**
 * A value over time, `Key: a → b → c`, drawn as a line (`### Line Chart`). Off
 * until a theme declares the block.
 */
export interface LineChartTheme {
  readonly enabled: boolean;
  /** The line's area; tick labels below it are extra. */
  readonly height: number;
  /** The area of several lines on one axis; `null` takes `height`. */
  readonly group_height: number | null;
  readonly width: number;
  /** `null` takes the first series colour. */
  readonly color: Argb | null;
  /** The dot's diameter; 0 draws none. */
  readonly point_size: number;
  /** Which points get a dot: each labelled point and the last, or only the last. */
  readonly points: "labelled" | "last";
}

/**
 * `Emoji fill` / `Emoji grade` / `Emoji optical size`: where a variable emoji font's
 * FILL, GRAD and opsz axes are set for an element's emoji. `null` leaves an axis at the
 * font's default; an optical size of `"auto"` is the size the glyph is drawn at.
 */
export interface EmojiAxes {
  /** 0–1: the outline (0) or the filled icon (1). */
  readonly fill: number | null;
  readonly grade: number | null;
  /** Above 0, in px, or `"auto"`. */
  readonly optical_size: number | "auto" | null;
}

/**
 * One button/link style. `null` means "not configured": a button variant resolves
 * it against Primary, and Primary itself is always concrete.
 */
export interface LinkStyle {
  readonly corner_radius: number | null;
  readonly padding: PaddingBox | null;
  readonly fill_color: Argb | null;
  readonly text_style: TextStyle | null;
  readonly stroke_width: number | null;
  readonly stroke_color: Argb | null;
  readonly stroke_align: StrokeAlign | null;
  readonly fill_colors: readonly Argb[];
  readonly stroke_colors: readonly Argb[];
  readonly bg_image: string | null;
  readonly gradient: GradientTheme | null;
  readonly shadows: readonly ShadowSpec[];
  readonly emoji_shape: "circle" | "square" | null;
  readonly disabled_fill_color: Argb | null;
  readonly disabled_text_color: Argb | null;
  readonly disabled_stroke_color: Argb | null;
  /**
   * `Emoji gap`: the space between a leading or trailing emoji and the label's words,
   * in place of the spaces typed there; `null` keeps the typed spaces.
   */
  readonly emoji_gap: number | null;
  /** `Emoji weight`: the weight (100–900) the label's emoji draws in; `null` keeps the font. */
  readonly emoji_weight: number | null;
  readonly emoji_axes: EmojiAxes;
}

/** A link left inside a text run (`### Inline` under `## Links`). */
export interface InlineLinkStyle {
  readonly text_color: Argb | null;
  readonly underline: boolean;
}

/**
 * The seven buttons, one per Markdown wrapper (bare Primary; `*` `**` `***` Secondary to
 * Quaternary; `_` `__` `___` the small Quinary to Septenary), the backtick-label Text
 * link, and Inline. Every button but Primary inherits Primary; Text inherits nothing.
 */
export interface LinksTheme {
  readonly primary: LinkStyle;
  readonly secondary: LinkStyle;
  readonly tertiary: LinkStyle;
  readonly quaternary: LinkStyle;
  readonly quinary: LinkStyle;
  readonly senary: LinkStyle;
  readonly septenary: LinkStyle;
  readonly text: LinkStyle;
  readonly inline: InlineLinkStyle;
  /**
   * `Segmented: yes`, from any block of the section: a choice run is drawn as one
   * segmented control rather than separate pills (md2ui ADR-405, `render_segmented`).
   */
  readonly segmented: boolean;
  /**
   * Whether THEME.md styles links (`## Links`, or a `Links …` text style). Until it does,
   * buttons draw in md2ui's built-in greys; once it does, Primary starts unpainted and
   * Secondary and Tertiary inherit it (md2ui `LinksTheme.take_over`).
   */
  readonly themed: boolean;
}

export interface EmojiBadgeStyle {
  readonly icon_size: number;
  readonly icon_colors: readonly Argb[];
  readonly fill: SectionStyle;
  readonly shape: "circle" | "square" | null;
  /** The muted badge (`~~⭐~~`): `Disabled background/icon/stroke color`. */
  readonly disabled_bg_color: Argb | null;
  readonly disabled_icon_color: Argb | null;
  readonly disabled_stroke_color: Argb | null;
  /** `Emoji weight`: the glyph's weight (100–900); `null` keeps the font. */
  readonly emoji_weight: number | null;
  readonly emoji_axes: EmojiAxes;
  /** A muted badge's resolved style, whose background image fades too; false as parsed. */
  readonly is_muted: boolean;
}

export interface EmojiTextStyle {
  readonly color: Argb | null;
  readonly font_path: string | null;
  /** Glyph → colour. */
  readonly fixed_colors: Readonly<Record<string, Argb>>;
}

export interface EmojisTheme {
  readonly font_path: string | null;
  readonly primary: EmojiBadgeStyle;
  readonly text: EmojiTextStyle;
  readonly link: EmojiTextStyle;
  readonly inline: EmojiTextStyle;
  readonly secondary: EmojiBadgeStyle | null;
  readonly tertiary: EmojiBadgeStyle | null;
  readonly quaternary: EmojiBadgeStyle | null;
}

export interface InlineCodeTheme {
  readonly corner_radius: number;
  readonly padding: PaddingBox;
  readonly fill_color: Argb;
  readonly stroke_color: Argb;
  readonly stroke_width: number;
  readonly stroke_align: StrokeAlign;
  readonly fill_colors: readonly Argb[];
  readonly stroke_colors: readonly Argb[];
  readonly bg_image: string | null;
  readonly gradient: GradientTheme | null;
  readonly shadows: readonly ShadowSpec[];
  readonly text_style: TextStyle | null;
  /** `Emoji weight`: the weight (100–900) an emoji in the chip draws in; `null` keeps the font. */
  readonly emoji_weight: number | null;
  readonly emoji_axes: EmojiAxes;
  /** The muted chip (`` ~~`x`~~ ``): `Disabled fill/text/stroke color`. */
  readonly disabled_fill_color: Argb | null;
  readonly disabled_text_color: Argb | null;
  readonly disabled_stroke_color: Argb | null;
  /** A muted chip's resolved style, whose label and background image mute too; false as parsed. */
  readonly muted: boolean;
  /** Wrapper variants; each is a complete style, `null` when not configured. */
  readonly secondary: InlineCodeTheme | null;
  readonly tertiary: InlineCodeTheme | null;
  readonly quaternary: InlineCodeTheme | null;
  readonly quinary: InlineCodeTheme | null;
  readonly senary: InlineCodeTheme | null;
  readonly septenary: InlineCodeTheme | null;
}

export interface CodeBlockTheme {
  readonly text_style: TextStyle;
  readonly syntax_style: string;
  readonly background_color: Argb;
  readonly corner_radius: number;
  readonly padding: PaddingBox;
  readonly line_spacing: number;
  readonly min_width: number;
  /** Whole lines; `null` shows every line. */
  readonly max_lines: number | null;
  readonly fade: boolean;
  readonly copy_icon: string | null;
  readonly copy_icon_size: number;
  readonly copy_button: LinkStyle;
}

export interface ContentWeightTheme {
  readonly first_scale: number;
  readonly second_scale: number;
  readonly less_scale: number;
  readonly less_color: Argb;
}

export interface HorizontalRuleTheme {
  readonly stroke_color: Argb;
  readonly stroke_width: number;
}

/** Only the horizontal-rule paint properties authored at one scope. */
export interface HorizontalRulePatch {
  readonly stroke_color: Argb | null;
  readonly stroke_width: number | null;
}

/** `## Separators`: whether a consumed ` - ` or ` | ` is drawn back between the pieces. */
export interface SeparatorsTheme {
  readonly dash: boolean;
  readonly bar: boolean;
}

export interface VerticalRuleTheme {
  readonly draw: boolean;
  readonly stroke_color: Argb;
  readonly stroke_width: number;
}

/**
 * A word of a fixed emoji pin's scope (`- 📈 #22C55E chips datapoints`): `datapoints`
 * also colours the datapoints beside the glyph, `line` the whole run, and a kind (`text`,
 * `emojis`, `buttons`, `chips`) the pieces of the run of that kind, text colour only.
 */
export type FixedEmojiWord = "datapoints" | "line" | "text" | "emojis" | "buttons" | "chips";

/**
 * How far a fixed emoji colour reaches: its words, which add up, sorted and unique. No
 * word is the glyph alone. md2ui keeps the same words as one space-joined string.
 */
export type FixedEmojiScope = readonly FixedEmojiWord[];

/** A colour channel of a fixed pin or a replacement. */
export type ColorRole = "text" | "fill" | "stroke";

/** A fixed pin's colours, by channel. */
export type RoleColors = Readonly<Partial<Record<ColorRole, Argb>>>;

export interface FixedColors {
  readonly emoji: Readonly<Record<string, readonly [Argb, FixedEmojiScope]>>;
  readonly emoji_bg: Readonly<Record<string, Argb>>;
  readonly pill_exact: Readonly<Record<string, RoleColors>>;
  readonly pill_contains: Readonly<Record<string, RoleColors>>;
  readonly button_exact: Readonly<Record<string, RoleColors>>;
  readonly button_contains: Readonly<Record<string, RoleColors>>;
  /** Keyed by detected datapoint type, plus `"change up"` / `"change down"`. */
  readonly datapoints: Readonly<Record<string, Argb>>;
}

/** A text role a styling scope can restyle locally. */
export type LocalTextRole = "text" | "muted" | "lead" | "display" | "key" | "value";

/**
 * `## Color Replacements`, three keys deep: background → role → colour to replace →
 * replacement. The background key is an ARGB in decimal, `"image"` for a photo-backed
 * card, or `"image:<style>"` for the photo one fixed style paints (`<style>` is its key in
 * `fixed_sections`; a style with no group of its own uses `"image"`). The colour key is
 * an ARGB in decimal, or `"null"` for the role's default ("every colour this background
 * does not name").
 */
export type ColorReplacements = Readonly<
  Record<string, Readonly<Partial<Record<ColorRole, Readonly<Record<string, Argb>>>>>>
>;

/** A placeholder's text or icon size: `[value, is a percentage]`, a share of the box's shorter side or px. */
export type PlaceholderSize = readonly [number, boolean];

/**
 * One image placeholder (`## Images` → `### Placeholders` → `#### Name`, a state's name for
 * a default; md2ui ADR-406): what an image with no picture to show paints in its own clip.
 */
export interface ImagePlaceholder {
  /** One colour, or a list that rotates; empty is the quiet box's grey. */
  readonly fill_colors: readonly Argb[];
  /** One colour, or a list that rotates; empty is the text style's colour. */
  readonly text_colors: readonly Argb[];
  /** A text style the theme declares, lower-cased: `text`, `lead`, `heading 2`… */
  readonly text_style: string;
  readonly text_size: PlaceholderSize;
  /** Drawn when the image gives no text; empty draws the fill alone. */
  readonly icon: string;
  readonly icon_size: PlaceholderSize;
  /** `Image:`, cover-fitted over the fill and under the text; empty is none. */
  readonly bg_image: string;
}

/**
 * `## Motion` (md2ui-ts only): how a re-sent or streamed document moves into place.
 * The two values Web Animations takes for a tween, as it takes them.
 */
export interface MotionTheme {
  /** Milliseconds, finite and not negative; 0 turns motion off. */
  readonly duration: number;
  /** A CSS `<easing-function>`, as written; the browser decides whether it runs. */
  readonly easing: string;
}

export interface ResolvedTheme {
  readonly name: string;
  readonly root: RootTheme;
  readonly bento: BentoTheme;
  /**
   * `### Elements`: the glued-content card's padding, spacing and other layout keys. A
   * card is never painted (md2ui ADR-409), so its paint fields keep their defaults.
   */
  readonly elements: SectionStyle;
  readonly image_cards: SectionStyle;
  readonly unordered_lists: SectionStyle;
  readonly task_lists: SectionStyle;
  readonly numbered_lists: SectionStyle;
  readonly quotes: SectionStyle;
  readonly headings: Readonly<Partial<Record<HeadingLevel, TextStyle>>>;
  readonly sections: Readonly<Partial<Record<HeadingLevel, SectionStyle>>>;
  readonly fixed_sections: Readonly<Record<string, SectionStyle>>;
  /** `Mode: override` fixed styles: fixed-style key → heading level → merged style. */
  readonly fixed_section_levels: Readonly<
    Record<string, Readonly<Partial<Record<HeadingLevel, SectionStyle>>>>
  >;
  readonly text: TextStyle;
  readonly labels: TextStyle;
  /** `Key` / `Value` under `## Text Styles`: the two sides of a display's pair; unset, body text. */
  readonly key_style: TextStyle | null;
  readonly value_style: TextStyle | null;
  readonly muted: TextStyle | null;
  readonly lead: TextStyle | null;
  readonly display: TextStyle | null;
  /**
   * Scope (`root`, `heading:2`, `fixed:<key>`, `image_cards`, `unordered_lists`,
   * `task_lists`, `numbered_lists`, `quotes`) → role → patch.
   */
  readonly text_style_overrides: Readonly<
    Record<string, Readonly<Partial<Record<LocalTextRole, TextStylePatch>>>>
  >;
  readonly links: LinksTheme;
  readonly emojis: EmojisTheme;
  readonly horizontal_rule: HorizontalRuleTheme;
  /** Scope (as in `text_style_overrides`) → patch. */
  readonly horizontal_rule_overrides: Readonly<Record<string, HorizontalRulePatch>>;
  readonly separators: SeparatorsTheme;
  readonly vertical_rule: VerticalRuleTheme;
  readonly inline_code: InlineCodeTheme;
  readonly code_blocks: CodeBlockTheme;
  readonly content_weight: ContentWeightTheme;
  readonly tables: TableTheme;
  readonly datapoints: DatapointsTheme;
  readonly charts: ChartsTheme;
  readonly fixed: FixedColors;
  /** `### Placeholders`, by the name an image writes in `?md2ui.placeholder=` (md2ui ADR-406). */
  readonly image_placeholders: Readonly<Record<string, ImagePlaceholder>>;
  /**
   * The reserved names `#### Loading`, `#### Broken` and `#### Missing` under
   * `### Placeholders`: md2ui's own placeholders restyled, by state.
   */
  readonly image_placeholder_defaults: Readonly<Record<string, ImagePlaceholder>>;
  readonly color_replacements: ColorReplacements;
  /** Font files: as written, or resolved against the host's asset base. */
  readonly font_paths: readonly string[];
  /** md2ui-ts only: not in md2ui's theme or its fixtures. */
  readonly motion: MotionTheme;
}
