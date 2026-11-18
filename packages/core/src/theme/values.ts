// How one THEME.md value is read: colours, numbers, switches, alignments, padding,
// spacing, spacers and shadows. Ported from the helpers at the top of md2ui's
// `pipeline/theme.py`. A value that does not read leaves the field as it was.
import type {
  Argb,
  EmojiAxes,
  HorizontalAlign,
  LineAlign,
  OrphanRow,
  PaddingBox,
  ShadowSpec,
  SpacerKey,
  StrokeAlign,
  TextStyle,
} from "@md2ui/contracts";
import { pyMax, pyMin } from "../group/py/math.ts";
import { partition, pyFloat, strip } from "../group/py/str.ts";
import { argb, type Draft, newShadow } from "./model.ts";

/**
 * A fixed style's key: its title lower-cased, each run of other characters a `-`, the
 * ends trimmed (md2ui `re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")`). The same
 * slug names the style's photo in `On background color: image <title>`.
 */
export function styleSlug(title: string): string {
  return title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

/** The colour lists a valueless text colour key can open. */
export type ColorsAttr = "colors" | "marker_text_colors" | "marker_bg_colors";

/**
 * A block's parse state, md2ui's `state` dict: the open gradient list (`gl`), the open
 * bullet list (`sl`), the open shadow layer (`sh`), and the text style whose
 * valueless colour key opened a list (`colors_ts`, `colors_attr`).
 */
export interface BlockState {
  gl: string;
  sl: string;
  sh: Draft<ShadowSpec> | null;
  colors_ts: Draft<TextStyle> | null;
  colors_attr: ColorsAttr | null;
}

export function newState(sl = ""): BlockState {
  return { gl: "", sl, sh: null, colors_ts: null, colors_attr: null };
}

const HEX = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/;

/** `#RRGGBB` or `#RRGGBBAA` as ARGB, or `undefined`. */
export function hex(val: string): Argb | undefined {
  const h = strip(val);
  if (!HEX.test(h)) return undefined;
  const byte = (at: number): number => Number.parseInt(h.slice(at, at + 2), 16);
  return argb(h.length === 9 ? byte(7) : 255, byte(1), byte(3), byte(5));
}

/** A number as Python's `float()` reads it, or `undefined`. */
export function num(val: string): number | undefined {
  return pyFloat(val) ?? undefined;
}

/** md2ui's `_try_weight`: an `Emoji weight`, a CSS weight from 100 to 900, else `undefined`. */
function weight(val: string): number | undefined {
  const w = pyFloat(val) ?? 0;
  return w >= 100 && w <= 900 ? Math.trunc(w) : undefined;
}

/** The keys that set a style's emoji font: its weight and the three icon-font axes. */
export const EMOJI_KEYS: readonly string[] = Object.freeze([
  "emoji weight",
  "emoji fill",
  "emoji grade",
  "emoji optical size",
]);

/** A style that carries `Emoji weight` and the `Emoji fill` / `grade` / `optical size` axes. */
interface EmojiKeyed {
  emoji_weight: number | null;
  emoji_axes: EmojiAxes;
}

/**
 * md2ui `_set_emoji_key`: one of `EMOJI_KEYS` on a button, chip or badge style. A value
 * outside its key's range is no key and the previous value stays. The axes are replaced,
 * never edited, so styles that started as copies of one another do not share them.
 */
export function setEmojiKey(style: EmojiKeyed, key: string, val: string): void {
  const n = pyFloat(val) ?? Number.NaN;
  const auto = strip(val).toLowerCase() === "auto";
  if (key === "emoji weight") {
    style.emoji_weight = weight(val) ?? style.emoji_weight;
  } else if (key === "emoji fill" && n >= 0 && n <= 1) {
    style.emoji_axes = { ...style.emoji_axes, fill: n };
  } else if (key === "emoji grade" && Number.isFinite(n)) {
    style.emoji_axes = { ...style.emoji_axes, grade: n };
  } else if (key === "emoji optical size" && (auto || n > 0)) {
    style.emoji_axes = { ...style.emoji_axes, optical_size: auto ? "auto" : n };
  }
}

/** `key: value` as md2ui splits it: the key stripped and lowercased, the value stripped. */
export function keyValue(line: string): [string, string] {
  const [key, , val] = partition(line, ":");
  return [strip(key).toLowerCase(), strip(val)];
}

/** md2ui's `_parse_bool`: only an explicit yes is true. */
export function isYes(val: string): boolean {
  return ["yes", "true", "1"].includes(val.toLowerCase());
}

/** md2ui's `_try_bool`: an explicit no or yes, else `fallback`. */
export function yesNo(val: string, fallback: boolean): boolean {
  const v = strip(val).toLowerCase();
  if (["no", "false", "0"].includes(v)) return false;
  if (["yes", "true", "1"].includes(v)) return true;
  return fallback;
}

export function horizontalAlign(val: string): HorizontalAlign | null {
  const v = strip(val).toLowerCase();
  return v === "left" || v === "center" || v === "right" ? v : null;
}

export function lineAlign(val: string): LineAlign | null {
  const v = strip(val).toLowerCase();
  return v === "top" || v === "baseline" || v === "center" || v === "bottom" ? v : null;
}

export function orphanRow(val: string): OrphanRow | null {
  const v = strip(val).toLowerCase();
  return v === "left" || v === "center" || v === "stretch" ? v : null;
}

/** The `Align` and `Line align` keys, each with the spelling it first shipped under. */
export const HORIZONTAL_ALIGN_KEYS: readonly string[] = Object.freeze([
  "horizontal align",
  "align",
]);
export const VERTICAL_ALIGN_KEYS: readonly string[] = Object.freeze([
  "vertical align",
  "line align",
]);

/** `Stroke align` values and the aliases a theme may write for them. */
export function strokeAlign(val: string): StrokeAlign | undefined {
  switch (val.toLowerCase()) {
    case "center":
    case "centre":
      return "center";
    case "inside":
    case "inner":
      return "inside";
    case "outside":
    case "outer":
      return "outside";
    default:
      return undefined;
  }
}

/** `x, y` as a point, or `fallback`. */
export function point(val: string, fallback: [number, number]): [number, number] {
  const parts = val.split(",");
  const x = pyFloat(parts[0] ?? "");
  const y = parts.length > 1 ? pyFloat(parts[1] ?? "") : null;
  return x === null || y === null ? fallback : [x, y];
}

/** `Padding` sets every side, `Padding top|left|right|bottom` one. True when `key` matched. */
export function applyPadding(box: Draft<PaddingBox>, key: string, val: string): boolean {
  if (key === "padding") {
    const v = num(val) ?? 0;
    box.top = v;
    box.left = v;
    box.right = v;
    box.bottom = v;
    return true;
  }
  switch (key) {
    case "padding top":
      box.top = num(val) ?? box.top;
      return true;
    case "padding left":
      box.left = num(val) ?? box.left;
      return true;
    case "padding right":
      box.right = num(val) ?? box.right;
      return true;
    case "padding bottom":
      box.bottom = num(val) ?? box.bottom;
      return true;
    default:
      return false;
  }
}

/**
 * A bare `- #RRGGBB` bullet, into the list `state.sl` names. True when `raw` was such
 * a bullet, whether or not it landed anywhere.
 */
export function appendColorBullet(
  raw: string,
  state: BlockState,
  targets: Readonly<Record<string, Argb[]>>,
): boolean {
  if (!raw.startsWith("- ")) return false;
  const cval = strip(raw.slice(2));
  if (!cval.startsWith("#")) return false;
  const list = Object.hasOwn(targets, state.sl) ? targets[state.sl] : undefined;
  const c = hex(cval);
  if (list !== undefined && c !== undefined) list.push(c);
  return true;
}

export type Axis = "both" | "row" | "col";

/** `Spacing` / `Section spacing` (both axes), `Row spacing`, `Col spacing`. */
export function spacing(key: string, val: string): [Axis, number] | undefined {
  return axisKey(key, val, "");
}

/** `Group spacing`, `Group row spacing`, `Group col spacing`. */
export function groupSpacing(key: string, val: string): [Axis, number] | undefined {
  return axisKey(key, val, "group ");
}

/** `Image spacing`, `Image row spacing`, `Image col spacing`. */
export function imageSpacing(key: string, val: string): [Axis, number] | undefined {
  return axisKey(key, val, "image ");
}

function axisKey(key: string, val: string, prefix: string): [Axis, number] | undefined {
  const v = (): number => num(val) ?? 0;
  if (key === `${prefix}spacing` || (prefix === "" && key === "section spacing")) {
    return ["both", v()];
  }
  if (key === `${prefix}row spacing`) return ["row", v()];
  if (key === `${prefix}col spacing`) return ["col", v()];
  return undefined;
}

const SPACER_KEY = /^spacer (small|medium|large)(?: (row|col))?$/;

/**
 * `Spacer <step> [row|col]: <px>`. True when `key` is a spacer key, whether or not its
 * value was usable: an unusable value is dropped, so the level states nothing.
 */
export function applySpacer(
  spacers: Partial<Record<SpacerKey, number>>,
  key: string,
  val: string,
): boolean {
  const m = SPACER_KEY.exec(key);
  if (m === null) return key.startsWith("spacer ");
  const px = num(val);
  if (px !== undefined && px >= 0) {
    const step = m[1] as "small" | "medium" | "large";
    const axis = m[2] as "row" | "col" | undefined;
    const spacer: SpacerKey = axis === undefined ? step : `${step} ${axis}`;
    spacers[spacer] = px;
  }
  return true;
}

/** `Inner shadow` / `Outer shadow` / `Shadow`: the layer's `inner` flag, or `undefined`. */
export function shadowKey(key: string): boolean | undefined {
  const k = key.replaceAll(" ", "");
  if (k === "innershadow" || k === "innershadows") return true;
  if (k === "outershadow" || k === "outershadows" || k === "shadow" || k === "shadows") {
    return false;
  }
  return undefined;
}

// md2ui: theme_model.SHADOW_MAX_PER_KIND. Layers of each kind (inner, outer) one
// background may declare.
const SHADOW_MAX_PER_KIND = 4;
const SHADOW_RADIUS_MAX = 250;

/**
 * md2ui: `theme_model.inherit_shadows`. A button, chip or badge variant's shadows: its
 * own of a kind replace Primary's of that kind, as its colour lists do; a kind it
 * declares none of is inherited whole.
 */
export function inheritShadows(
  base: readonly ShadowSpec[],
  own: readonly ShadowSpec[],
): ShadowSpec[] {
  return [false, true].flatMap((inner) => {
    const mine = own.filter((s) => s.inner === inner);
    return mine.length > 0 ? mine : base.filter((s) => s.inner === inner);
  });
}

/**
 * A badge or chip variant replayed onto a copy of Primary (md2ui `parse_theme`): its
 * first layer of a kind drops the inherited ones of that kind, before the cap counts
 * them. `declared` holds the kinds the variant has opened so far.
 */
export function dropInheritedShadows<S extends { readonly inner: boolean }>(
  shadows: S[],
  declared: Set<boolean>,
  key: string,
  raw: string,
): S[] {
  const kind = raw.startsWith("- ") ? undefined : shadowKey(key);
  if (kind === undefined || declared.has(kind)) return shadows;
  declared.add(kind);
  return shadows.filter((s) => s.inner !== kind);
}

/**
 * Begin a shadow layer. Past the cap of one kind the layer is still returned, so its
 * bullets are absorbed, but never kept.
 */
export function openShadow(shadows: Draft<ShadowSpec>[], inner: boolean): Draft<ShadowSpec> {
  const sh = newShadow(inner);
  if (shadows.filter((s) => s.inner === inner).length < SHADOW_MAX_PER_KIND) shadows.push(sh);
  return sh;
}

/** One `- Key: value` line inside an open shadow block. */
export function shadowBullet(sh: Draft<ShadowSpec>, bullet: string): void {
  const [k, found, rest] = partition(bullet, ":");
  if (!found) return;
  const key = strip(k).toLowerCase().replaceAll(" ", "");
  const val = strip(rest);
  if (key === "offsetx" || key === "xoffset" || key === "x") {
    sh.offset_x = num(val) ?? sh.offset_x;
  } else if (key === "offsety" || key === "yoffset" || key === "y") {
    sh.offset_y = num(val) ?? sh.offset_y;
  } else if (key === "color") {
    sh.color = hex(val) ?? sh.color;
  } else if (key.startsWith("radius") || key.startsWith("blur")) {
    sh.radius = pyMax(0, pyMin(SHADOW_RADIUS_MAX, num(val) ?? sh.radius));
  }
}
