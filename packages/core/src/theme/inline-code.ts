// `## Inline Code` and its `### <Variant>` chip blocks. Ported from md2ui's
// `_parse_inline_code_line`, the `inline code` branch of `parse_theme` and its chip
// variant replay.
import type { ResolvedTheme } from "@md2ui/contracts";
import { partition, split, strip } from "../group/py/str.ts";
import { parseLayeredLine } from "./background.ts";
import { type Draft, deepCopy } from "./model.ts";
import {
  applyPatch,
  CHIP_VARIANTS,
  type DeferredTextStyles,
  effectiveInlineCodeStyle,
  isChipVariant,
} from "./text-styles.ts";
import {
  appendColorBullet,
  applyPadding,
  type BlockState,
  dropInheritedShadows,
  EMOJI_KEYS,
  hex,
  keyValue,
  newState,
  num,
  setEmojiKey,
  strokeAlign,
} from "./values.ts";

/** The `### <Variant>` blocks of `## Inline Code`, buffered for replay after the file. */
export interface CodeVariants {
  current: string | null;
  readonly lines: Map<string, [string, string][]>;
}

export function newCodeVariants(): CodeVariants {
  return { current: null, lines: new Map() };
}

type InlineCode = Draft<ResolvedTheme>["inline_code"];

type DisabledChipField = "disabled_fill_color" | "disabled_text_color" | "disabled_stroke_color";

const DISABLED_CHIP_KEYS: Readonly<Record<string, DisabledChipField>> = Object.freeze({
  "disabled fill color": "disabled_fill_color",
  "disabled text color": "disabled_text_color",
  "disabled stroke color": "disabled_stroke_color",
});

/** One `## Inline Code` line, in place; shared by the base block and each variant replay. */
function parseInlineCodeLine(ic: InlineCode, line: string, state: BlockState, raw: string): void {
  if (parseLayeredLine(ic, line, raw, state)) return;
  if (line.startsWith("- ")) {
    appendColorBullet(line, state, { fill: ic.fill_colors, stroke: ic.stroke_colors });
    if (ic.fill_colors.length > 0) ic.fill_color = ic.fill_colors[0] ?? ic.fill_color;
    if (ic.stroke_colors.length > 0) ic.stroke_color = ic.stroke_colors[0] ?? ic.stroke_color;
    return;
  }
  if (!line.includes(":")) return;
  const [key, val] = keyValue(line);
  if (key === "corner radius") {
    ic.corner_radius = num(val) ?? ic.corner_radius;
  } else if (applyPadding(ic.padding, key, val)) {
    // Applied.
  } else if (
    key === "fill color" ||
    key === "fill colors" ||
    key === "background color" ||
    key === "background colors"
  ) {
    state.sl = "fill";
    const c = val.startsWith("#") ? hex(val) : undefined;
    if (c !== undefined) {
      ic.fill_colors.push(c);
      ic.fill_color = ic.fill_colors[0] ?? ic.fill_color;
    }
  } else if (key === "stroke color" || key === "stroke colors") {
    state.sl = "stroke";
    const c = val.startsWith("#") ? hex(val) : undefined;
    if (c !== undefined) {
      ic.stroke_colors.push(c);
      ic.stroke_color = ic.stroke_colors[0] ?? ic.stroke_color;
    }
  } else if (key === "stroke width") {
    ic.stroke_width = num(val) ?? ic.stroke_width;
  } else if (key === "stroke align" && strokeAlign(val) !== undefined) {
    ic.stroke_align = strokeAlign(val) ?? ic.stroke_align;
  } else if (Object.hasOwn(DISABLED_CHIP_KEYS, key)) {
    // The muted chip (`` ~~`x`~~ ``), keyed as `## Links` keys it.
    const c = hex(val);
    if (c !== undefined) ic[DISABLED_CHIP_KEYS[key] as DisabledChipField] = c;
  } else if (EMOJI_KEYS.includes(key)) {
    setEmojiKey(ic, key, val);
  } else {
    state.sl = ""; // an unrecognised key ends the active bullet list
  }
}

/** `## Inline Code`. */
export function inlineCodeSection(
  theme: Draft<ResolvedTheme>,
  variants: CodeVariants,
): (line: string, raw: string) => void {
  let state = newState();
  return (line, raw) => {
    if (line.startsWith("### ")) {
      // `### Primary` configures the base, as the flat block did before variants.
      const sub = split(strip(line.slice(4)).toLowerCase())[0] ?? "";
      variants.current = isChipVariant(sub) ? sub : null;
      if (variants.current !== null && !variants.lines.has(variants.current)) {
        variants.lines.set(variants.current, []);
      }
      state = newState();
      return;
    }
    if (variants.current !== null) {
      const buffered = variants.lines.get(variants.current);
      if (buffered === undefined) variants.lines.set(variants.current, [[line, raw]]);
      else buffered.push([line, raw]);
    } else {
      parseInlineCodeLine(theme.inline_code, line, state, raw);
    }
  };
}

/** Each chip variant, replayed onto a copy of the base once the file is read. */
export function finishInlineCode(
  theme: Draft<ResolvedTheme>,
  variants: CodeVariants,
  deferred: DeferredTextStyles,
): void {
  for (const name of CHIP_VARIANTS) {
    const lines = variants.lines.get(name);
    const patch = deferred.inlineCode.get(name);
    if (lines === undefined && patch === undefined) continue;
    const style = deepCopy(theme.inline_code);
    for (const other of CHIP_VARIANTS) style[other] = null;
    // An `Inline Code <Variant>` text style overrides a copy of the base's, so an
    // unstated key inherits.
    if (patch !== undefined) {
      style.text_style = applyPatch(
        patch,
        effectiveInlineCodeStyle(theme.inline_code.text_style, theme.text),
      );
    }
    const state = newState();
    const declared = new Set<boolean>();
    for (const [line, raw] of lines ?? []) {
      // A variant that opens a colour list replaces the inherited one, not extends it.
      // Shadows likewise, kind by kind.
      const key = strip(partition(line, ":")[0]).toLowerCase();
      style.shadows = dropInheritedShadows(style.shadows, declared, key, raw || line);
      if (
        key === "fill color" ||
        key === "fill colors" ||
        key === "background color" ||
        key === "background colors"
      ) {
        style.fill_colors = [];
      } else if (key === "stroke color" || key === "stroke colors") {
        style.stroke_colors = [];
      }
      parseInlineCodeLine(style, line, state, raw);
    }
    theme.inline_code[name] = style;
  }
}
