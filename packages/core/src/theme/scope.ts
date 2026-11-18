// `## Sections` and `## Styling & Spacing`: background levels, their gutter markers,
// fixed styles selected by a heading id, and level-local text and rule patches.
// Ported from md2ui's `_StylingScopeParser`, `_parse_marker_style_line` and the
// `## Sections` branch of `parse_theme`.
import type {
  HeadingLevel,
  HorizontalRulePatch,
  LocalTextRole,
  MarkerStyle,
  ResolvedTheme,
  SectionStyle,
  TextStylePatch,
} from "@md2ui/contracts";
import { pyMax, pyMin } from "../group/py/math.ts";
import { firstInt, partition, strip } from "../group/py/str.ts";
import { parseSectionLine } from "./background.ts";
import {
  type Draft,
  deepCopy,
  newBulletedList,
  newNumberedList,
  newQuote,
  newSectionStyle,
  newTextStyle,
} from "./model.ts";
import { parseRootLine } from "./root.ts";
import {
  applyPatchBullet,
  markerTextBullet,
  newTextStylePatch,
  setTextStyleField,
} from "./text-styles.ts";
import {
  type BlockState,
  hex,
  isYes,
  keyValue,
  newState,
  num,
  shadowKey,
  styleSlug,
} from "./values.ts";

type MarkerKind = "" | "bullet" | "number" | "quote";

// md2ui `_CARD_PAINT_KEYS`: what `### Elements` would paint. A card is laid out, never
// drawn: a box comes from a heading style (md2ui ADR-409), so the block keeps its
// spacing, padding and the other layout keys and reads nothing that fills or outlines.
const CARD_PAINT_KEYS: readonly string[] = Object.freeze([
  "background color",
  "background colors",
  "background image",
  "background gradient",
  "stroke width",
  "stroke align",
  "stroke color",
  "stroke colors",
  "corner radius",
]);

/**
 * md2ui `_is_card_paint_line`: a `### Elements` line only paint keys read: a paint key, a
 * shadow, a colour rotation, or a bullet of one of their lists.
 */
function isCardPaintLine(line: string, raw: string): boolean {
  if (raw.trimStart().startsWith("- ")) return true;
  const key = strip(partition(line, ":")[0]).toLowerCase();
  return CARD_PAINT_KEYS.includes(key) || shadowKey(key) !== undefined || key.startsWith("rotate ");
}

const LOCAL_TEXT_ROLES: readonly string[] = Object.freeze([
  "text",
  "muted",
  "lead",
  "display",
  "key",
  "value",
]);

function isLocalTextRole(role: string): role is LocalTextRole {
  return LOCAL_TEXT_ROLES.includes(role);
}

function newMarker(kind: Exclude<MarkerKind, "">): Draft<MarkerStyle> {
  if (kind === "bullet") return newBulletedList();
  if (kind === "number") return newNumberedList();
  return newQuote();
}

/** `### Heading N` → N, clamped to 1–6; `undefined` for any other block title. */
function headingLevel(sub: string): HeadingLevel | undefined {
  const n = firstInt(sub);
  if (!sub.includes("heading") || n === undefined) return undefined;
  return pyMax(1, pyMin(6, n)) as HeadingLevel;
}

/** `Number format` example (`1.`, `(1)`) → a template with `{n}` where the digits were. */
function numberFormat(val: string): string {
  const m = /\p{Nd}+/u.exec(val);
  if (m === null) return "{n}";
  return `${val.slice(0, m.index)}{n}${val.slice(m.index + m[0].length)}`;
}

/** One line inside a background level's `#### Marker` block. */
function parseMarkerLine(marker: Draft<MarkerStyle>, line: string, state: BlockState): void {
  if (line.startsWith("- ")) {
    const value = strip(line.slice(2));
    const c = value.startsWith("#") ? hex(value) : undefined;
    if ("shape" in marker) {
      if (state.sl === "color" && c !== undefined) {
        marker.colors.push(c);
        marker.color = marker.colors[0] ?? null;
      }
    } else if ("bar_width" in marker && state.sl === "bar") {
      if (c !== undefined) {
        marker.bar_colors.push(c);
        marker.bar_color = marker.bar_colors[0] ?? null;
      }
    } else {
      markerTextBullet(value, state);
    }
    return;
  }
  if (!line.includes(":")) return;
  const [key, val] = keyValue(line);
  if (key === "aside") {
    marker.aside = isYes(val);
    return;
  }
  if (key === "alignment" || key === "align") {
    const mode = val.toLowerCase();
    if (mode === "top" || mode === "baseline" || mode === "center" || mode === "bottom") {
      marker.alignment = mode;
    }
    return;
  }
  if (key === "space") {
    marker.space = num(val) ?? marker.space;
    return;
  }
  const c = val.startsWith("#") ? hex(val) : undefined;
  if ("shape" in marker) {
    if (key === "shape") {
      marker.shape = val.toLowerCase() || null;
    } else if (key === "size") {
      marker.size = num(val) ?? marker.size;
    } else if (key === "color") {
      state.sl = "color";
      if (c !== undefined) {
        marker.colors.push(c);
        marker.color = marker.colors[0] ?? null;
      }
    } else if (key === "emoji") {
      marker.emoji = val || null;
    }
  } else if ("number_format" in marker) {
    if (key === "number format") {
      marker.number_format = numberFormat(val);
    } else {
      // Any other key styles the number, and switches the marker on.
      marker.text_style ??= newTextStyle();
      state.colors_ts = null;
      setTextStyleField(marker.text_style, key, val, state);
    }
  } else if (key === "bar width") {
    marker.bar_width = num(val) ?? marker.bar_width;
  } else if (key === "bar length") {
    marker.bar_length = num(val) ?? marker.bar_length;
  } else if (key === "bar color") {
    state.sl = "bar";
    if (c !== undefined) {
      marker.bar_colors.push(c);
      marker.bar_color = marker.bar_colors[0] ?? null;
    }
  } else if (key === "quote char") {
    marker.quote_char = val || null;
  } else {
    state.sl = "";
    state.colors_ts = null;
    setTextStyleField(marker.char_text_style, key, val, state);
  }
}

/** One global or level-local `## Horizontal Rule` paint line. */
export function parseHorizontalRuleLine(
  target: { stroke_color: number | null; stroke_width: number | null },
  line: string,
): void {
  if (!line.includes(":") || line.startsWith("- ")) return;
  const [key, val] = keyValue(line);
  if (key === "stroke color") {
    target.stroke_color = hex(val) ?? target.stroke_color;
  } else if (key === "stroke width") {
    target.stroke_width = num(val) ?? target.stroke_width;
  }
}

/** `## Sections`: `### Heading N` picks the level, the lines under it style it. */
export function sectionsSection(theme: Draft<ResolvedTheme>): (line: string, raw: string) => void {
  let target: Draft<SectionStyle> | undefined;
  let state = newState("stroke");
  return (line, raw) => {
    if (line.startsWith("### ")) {
      const level = headingLevel(strip(line.slice(4)).toLowerCase());
      if (level !== undefined) {
        target = theme.sections[level] ?? newSectionStyle();
        theme.sections[level] = target;
        state = newState("stroke");
      }
      return;
    }
    if (target !== undefined) parseSectionLine(target, line, raw, state);
  };
}

// Section-style list keys a `Mode: override` block replaces rather than extends.
const OVERRIDE_LISTS: Readonly<Record<string, "bg_colors" | "stroke_colors">> = Object.freeze({
  "background color": "bg_colors",
  "background colors": "bg_colors",
  "stroke color": "stroke_colors",
  "stroke colors": "stroke_colors",
});

/** The nested `## Styling & Spacing` grammar: surfaces, roles, markers, fixed styles. */
export class StylingScope {
  readonly #theme: Draft<ResolvedTheme>;
  #mode: "" | "root" | "elements" | "section" | "fixed" = "";
  #scope = "";
  #sectionTarget: Draft<SectionStyle> | null = null;
  #markerKind: MarkerKind = "";
  #markerTarget: Draft<MarkerStyle> | null = null;
  #textPatchTarget: Draft<TextStylePatch> | null = null;
  #ruleTarget: Draft<HorizontalRulePatch> | null = null;
  #rootState = newState();
  #sectionState = newState("stroke");
  #markerState = newState();
  #textState = newState();
  // Each fixed style's own section lines, replayed per heading level for `Mode: override`.
  readonly #fixedLines = new Map<string, [string, string][]>();
  readonly #fixedOverride = new Set<string>();

  constructor(theme: Draft<ResolvedTheme>) {
    this.#theme = theme;
  }

  /** Forget the open surface, as at every `## ` header. */
  reset(): void {
    this.#mode = "";
    this.#scope = "";
    this.#sectionTarget = null;
    this.#markerKind = "";
    this.#markerTarget = null;
    this.#textPatchTarget = null;
    this.#ruleTarget = null;
    this.#rootState = newState();
    this.#sectionState = newState("stroke");
    this.#markerState = newState();
    this.#textState = newState();
  }

  #openRole(role: string): void {
    this.#textPatchTarget = null;
    this.#ruleTarget = null;
    this.#textState = newState();
    if (this.#scope === "") return;
    this.#markerTarget = null;
    if (role === "horizontal rule") {
      const patches = this.#theme.horizontal_rule_overrides;
      const patch = patches[this.#scope] ?? { stroke_color: null, stroke_width: null };
      patches[this.#scope] = patch;
      this.#ruleTarget = patch;
    } else if (isLocalTextRole(role)) {
      const roles = this.#theme.text_style_overrides[this.#scope] ?? {};
      this.#theme.text_style_overrides[this.#scope] = roles;
      const patch = roles[role] ?? newTextStylePatch();
      roles[role] = patch;
      this.#textPatchTarget = patch;
    }
  }

  parse(line: string, raw: string): void {
    if (line.startsWith("##### ") && this.#mode === "fixed" && this.#scope !== "") {
      this.#openRole(strip(line.slice(6)).toLowerCase());
      return;
    }
    const h4 = line.startsWith("#### ") ? strip(line.slice(5)) : undefined;
    if (h4 !== undefined && this.#mode !== "fixed") {
      const role = h4.toLowerCase();
      if (isLocalTextRole(role) || role === "horizontal rule") {
        this.#openRole(role);
        return;
      }
    }
    if (
      h4 !== undefined &&
      h4.toLowerCase() === "marker" &&
      this.#sectionTarget !== null &&
      this.#markerKind !== ""
    ) {
      this.#sectionTarget.marker ??= newMarker(this.#markerKind);
      this.#markerTarget = this.#sectionTarget.marker;
      this.#textPatchTarget = null;
      this.#ruleTarget = null;
      this.#markerState = newState();
      return;
    }
    if (h4 !== undefined && this.#mode === "fixed") {
      this.#openFixedStyle(h4);
      return;
    }
    if (line.startsWith("### ")) {
      this.#openSurface(strip(line.slice(4)).toLowerCase());
      return;
    }
    if (this.#ruleTarget !== null) {
      parseHorizontalRuleLine(this.#ruleTarget, line);
    } else if (this.#textPatchTarget !== null && line.startsWith("- ")) {
      applyPatchBullet(strip(line.slice(2)), this.#textPatchTarget, this.#textState);
    } else if (this.#mode === "root") {
      parseRootLine(this.#theme, line, raw, this.#rootState);
    } else if (this.#markerTarget !== null) {
      parseMarkerLine(this.#markerTarget, line, this.#markerState);
    } else if (this.#mode === "elements") {
      if (!isCardPaintLine(line, raw)) {
        parseSectionLine(this.#theme.elements, line, raw, this.#sectionState);
      }
    } else if (
      (this.#mode === "section" || this.#mode === "fixed") &&
      this.#sectionTarget !== null
    ) {
      const key = this.#scope.startsWith("fixed:") ? this.#scope.slice(6) : this.#scope;
      const lines = this.#mode === "fixed" ? this.#fixedLines.get(key) : undefined;
      if (lines !== undefined) {
        if (line.toLowerCase().startsWith("mode:")) {
          if (strip(partition(line, ":")[2]).toLowerCase() === "override") {
            this.#fixedOverride.add(key);
          }
          return;
        }
        lines.push([line, raw]);
      }
      parseSectionLine(this.#sectionTarget, line, raw, this.#sectionState);
    }
  }

  /** `#### <Title>` under `### Fixed styles`: a style selected by a `{#title-N}` id. */
  #openFixedStyle(title: string): void {
    const key = styleSlug(title);
    this.#sectionState = newState("stroke");
    this.#sectionTarget = newSectionStyle();
    this.#markerKind = "";
    this.#markerTarget = null;
    this.#textPatchTarget = null;
    this.#ruleTarget = null;
    this.#textState = newState();
    this.#scope = key === "" ? "" : `fixed:${key}`;
    if (key !== "") {
      this.#theme.fixed_sections[key] = this.#sectionTarget;
      this.#fixedLines.set(key, []);
    }
  }

  #openSurface(sub: string): void {
    this.#rootState = newState();
    this.#sectionState = newState("stroke");
    this.#markerKind = "";
    this.#markerTarget = null;
    this.#textPatchTarget = null;
    this.#ruleTarget = null;
    this.#textState = newState();
    this.#scope = "";
    const theme = this.#theme;
    const surface = (
      scope: string,
      target: Draft<SectionStyle>,
      markerKind: MarkerKind = "",
    ): void => {
      this.#mode = "section";
      this.#scope = scope;
      this.#sectionTarget = target;
      this.#markerKind = markerKind;
    };
    const level = headingLevel(sub);
    if (sub === "fixed styles") {
      this.#mode = "fixed";
      this.#sectionTarget = null;
    } else if (sub.startsWith("root")) {
      this.#mode = "root";
      this.#scope = "root";
      this.#sectionTarget = null;
    } else if (sub.startsWith("element")) {
      this.#mode = "elements";
      this.#sectionTarget = theme.elements;
    } else if (sub.startsWith("image card")) {
      surface("image_cards", theme.image_cards);
    } else if (sub.startsWith("unordered list") || sub.startsWith("bulleted list")) {
      surface("unordered_lists", theme.unordered_lists, "bullet");
    } else if (sub.startsWith("task list")) {
      surface("task_lists", theme.task_lists, "bullet");
    } else if (sub.startsWith("numbered list") || sub.startsWith("ordered list")) {
      surface("numbered_lists", theme.numbered_lists, "number");
    } else if (sub.startsWith("quote") || sub.startsWith("blockquote")) {
      surface("quotes", theme.quotes, "quote");
    } else if (level !== undefined) {
      const target = theme.sections[level] ?? newSectionStyle();
      theme.sections[level] = target;
      surface(`heading:${level}`, target, "number");
    } else {
      this.#mode = "";
      this.#sectionTarget = null;
    }
  }

  /**
   * Each `Mode: override` fixed style, once per heading level: its own lines replayed
   * onto a copy of that level's style, so a key it states wins and a list it states
   * replaces the level's list whole.
   */
  resolveFixedOverrides(): void {
    for (const key of this.#fixedOverride) {
      const levels: Partial<Record<HeadingLevel, Draft<SectionStyle>>> = {};
      for (const [name, base] of Object.entries(this.#theme.sections)) {
        const st = deepCopy(base);
        const state = newState("stroke");
        const cleared = new Set<string>();
        for (const [line, raw] of this.#fixedLines.get(key) ?? []) {
          const lineKey = strip(partition(line, ":")[0]).toLowerCase();
          const field = Object.hasOwn(OVERRIDE_LISTS, lineKey)
            ? OVERRIDE_LISTS[lineKey]
            : shadowKey(lineKey) !== undefined
              ? "shadows"
              : undefined;
          if (field !== undefined && !cleared.has(field)) {
            cleared.add(field);
            st[field] = [];
          }
          parseSectionLine(st, line, raw, state);
        }
        levels[Number(name) as HeadingLevel] = st;
      }
      if (Object.keys(levels).length > 0) this.#theme.fixed_section_levels[key] = levels;
    }
  }
}
