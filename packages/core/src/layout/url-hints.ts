// Render hints an author writes into an image URL (`![a](p.jpg?md2ui.shape=circle)`):
// md2ui's `pipeline/render_hints.py` (`sanitize_url_props`, `render_properties_from`
// with its `_wide` twin, `RenderProperties.to_render_dict`), the generator's
// `_collect_url_props`, and `render_metrics.image_floor` and `height_sized`. Invalid
// params are dropped silently: md2ui's warnings have no reader here.
import type { GroupNode } from "../group/node.ts";
import { pyRound } from "../group/py/math.ts";
import { compile, type RegexKit } from "../group/py/re.ts";
import { pyFloat, toInt } from "../group/py/str.ts";
import { imageParams, urlLayoutParams } from "../utils/image-params.ts";

/** A validated param value: a string from a closed set or a ratio, an integer, a boolean. */
type UrlValue = string | number | boolean;

/** One image's validated params, in the order written; `_wide` twins under their own name. */
export type UrlProps = ReadonlyMap<string, UrlValue>;

/** md2ui `WIDE_BREAKPOINT`: from this width a space takes its `_wide` values. */
export const WIDE_BREAKPOINT = 768;

// One `W:H`, neither side zero (md2ui `_RATIO`).
const RATIO = String.raw`(?!0+(\.0+)?:)[0-9]+(\.[0-9]+)?:(?!0+(\.0+)?(,|@|$))[0-9]+(\.[0-9]+)?`;
// py: re.compile(rf"^{_RATIO}(,{_RATIO}@[0-9]+)*$"): a ratio, then `,W:H@px` ranges.
const ASPECT_RE = compile(`^${RATIO}(,${RATIO}@[0-9]+)*$`);

/** md2ui `_parse_ratio`: a `"W:H"` string as W/H, or `null`. */
function parseRatio(spec: string): number | null {
  const parts = spec.split(":");
  if (parts.length !== 2) return null;
  const w = pyFloat(parts[0]);
  const h = pyFloat(parts[1]);
  if (w === null || h === null) return null;
  return h > 0 ? w / h : null;
}

/**
 * md2ui `ratio_ranges`: an authored `aspect_ratio` as `[fromWidth, ratio]` pairs,
 * narrowest first, or `null` when it does not parse. `3:4,1:1@600,16:9@960` is 3:4, then
 * 1:1 once the image is 600px wide, then 16:9 from 960px.
 */
function ratioRanges(spec: string): [number, number][] | null {
  const [first = "", ...rest] = spec.split(",");
  const base = parseRatio(first);
  if (base === null) return null;
  const ranges: [number, number][] = [[0, base]];
  for (const entry of rest) {
    const at = entry.indexOf("@");
    const parsed = parseRatio(at < 0 ? entry : entry.slice(0, at));
    if (parsed === null || at < 0) return null;
    const from = pyFloat(entry.slice(at + 1));
    if (from === null) return null;
    ranges.push([from, parsed]);
  }
  // Python's `sorted` on the pairs.
  return ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** md2ui `ratio_at`: the ratio `spec` gives an image `width` wide, or `null`. */
export function ratioAt(spec: string, width: number): number | null {
  const ranges = ratioRanges(spec);
  if (ranges === null) return null;
  let ratio: number | null = null;
  for (const [from, r] of ranges) if (from <= width) ratio = r;
  return ratio;
}

/** md2ui `DEFAULT_IMAGE_RATIOS`: an image with no authored ratio, written as an author would. */
const DEFAULT_IMAGE_RATIOS = "3:2,16:9@768,2.35:1@1024";

/** md2ui `default_image_ratio`: the ratio an image with none authored draws at, `width` wide. */
export function defaultImageRatio(width: number): number {
  return ratioAt(DEFAULT_IMAGE_RATIOS, width) as number;
}

/** The value rule of each property (md2ui `_URL_VALIDATORS`); anything else is rejected. */
type Rule = "ratio" | "int" | "nonneg-int" | "bool" | readonly string[];
const RULES: Readonly<Record<string, Rule>> = Object.freeze({
  aspect_ratio: "ratio",
  max_width: "int",
  min_width: "int",
  max_height: "int",
  shape: Object.freeze(["circle"]),
  fit: Object.freeze(["contain", "cover"]),
  corner_radius: "nonneg-int",
  bleed: "bool",
  content_align: Object.freeze(["left", "center", "right"]),
});

/** md2ui `RenderProperties` fields, in `to_render_dict` order (`_RENDER_FIELDS`). */
export const RENDER_FIELDS = Object.freeze([
  "aspect_ratio",
  "max_width",
  "min_width",
  "max_height",
  "shape",
  "fit",
  "corner_radius",
  "bleed",
  "content_align",
] as const);

/** Python's `int(s)` on a string without white space; `undefined` is its `ValueError`. */
function pyInt(raw: string): number | undefined {
  const m = /^([+-]?)(\p{Nd}+(?:_\p{Nd}+)*)$/u.exec(raw);
  if (m === null) return undefined;
  const value = toInt((m[2] ?? "").replaceAll("_", ""));
  return m[1] === "-" ? -value : value;
}

/** One value checked against its rule, or `undefined` when md2ui would reject it. */
function validate(kit: RegexKit, rule: Rule, raw: string): UrlValue | undefined {
  if (rule === "int" || rule === "nonneg-int") {
    const value = pyInt(raw);
    const floor = rule === "nonneg-int" ? 0 : 1;
    return value === undefined || value < floor ? undefined : value;
  }
  if (rule === "bool") {
    const low = raw.toLowerCase();
    if (["yes", "true", "1"].includes(low)) return true;
    if (["no", "false", "0"].includes(low)) return false;
    return undefined;
  }
  if (rule === "ratio") return kit.re(ASPECT_RE).match(raw) === null ? undefined : raw;
  return rule.includes(raw) ? raw : undefined;
}

/**
 * md2ui `sanitize_url_props`: the params md2ui keeps, typed. An unknown name, a value
 * outside its rule, `default` on anything but a `_wide` twin, and a `max_height` its
 * image cannot honour are dropped.
 */
export function sanitizeUrlProps(
  kit: RegexKit,
  params: ReadonlyMap<string, string>,
): Map<string, UrlValue> {
  const props = new Map<string, UrlValue>();
  for (const [name, raw] of params) {
    const base = name.endsWith("_wide") ? name.slice(0, -"_wide".length) : name;
    const rule = Object.hasOwn(RULES, base) ? RULES[base] : undefined;
    if (rule === undefined) continue;
    if (raw === "default") {
      if (base !== name) props.set(name, raw);
      continue;
    }
    const value = validate(kit, rule, raw);
    if (value !== undefined) props.set(name, value);
  }
  dropUnsoundHeights(props);
  return props;
}

/**
 * md2ui `_drop_unsound_heights`: drop a `max_height` its own image cannot honour, per
 * variant. A height sizes the picture only through one ratio of its own, so it cannot
 * share an image with a width that sizes it too, nor with ratio steps chosen by the very
 * width it would produce. Dropping it leaves the width behaviour the image would have
 * had without it.
 */
function dropUnsoundHeights(props: Map<string, UrlValue>): void {
  for (const wide of [false, true]) {
    const rp = urlRenderDict(props, wide);
    if (rp["max_height"] === undefined) continue;
    const ratio = rp["aspect_ratio"];
    const sized = rp["max_width"] !== undefined || rp["min_width"] !== undefined;
    if (!sized && typeof ratio === "string" && !ratio.includes(",")) continue;
    if (wide) props.set("max_height_wide", "default");
    else props.delete("max_height");
  }
}

/**
 * md2ui `height_sized`: `rp` with a `max_height` turned into the width cap it means,
 * that height times the picture's ratio, so the box shrinks keeping its shape where the
 * space is narrower. A run shares one height while each picture keeps `ownRatio`, its
 * own `aspect_ratio`, when it wrote one.
 */
export function heightSized(
  rp: Readonly<Record<string, unknown>>,
  ownRatio: unknown,
): Record<string, unknown> {
  const height = rp["max_height"];
  const ratio = ownRatio || rp["aspect_ratio"];
  const parsed = ratio ? parseRatio(String(ratio)) : null;
  if (!height || parsed === null) return { ...rp };
  const { max_height: _, ...out } = rp;
  return { ...out, aspect_ratio: ratio, max_width: pyRound(Number(height) * parsed) };
}

/**
 * md2ui `render_properties_from(props, wide).to_render_dict()`: the render hints
 * at a space that is `wide` or not. A `_wide` twin replaces its base there (`default`
 * removes it); unset hints are left out.
 */
export function urlRenderDict(props: UrlProps, wide: boolean): Record<string, UrlValue> {
  const out: Record<string, UrlValue> = {};
  for (const field of RENDER_FIELDS) {
    let value = props.get(field);
    const twin = `${field}_wide`;
    if (wide && props.has(twin)) {
      const wv = props.get(twin);
      value = wv === "default" ? undefined : wv;
    }
    if (value !== undefined) out[field] = value;
  }
  return out;
}

/** md2ui `_collect_url_props`: every image's validated params, by node. */
export function collectUrlProps(kit: RegexKit, root: GroupNode): Map<GroupNode, UrlProps> {
  const out = new Map<GroupNode, UrlProps>();
  const walk = (node: GroupNode): void => {
    if (node.type === "image" && node.content) {
      const raw = imageParams(kit, node.content);
      if (raw.size > 0) {
        const props = sanitizeUrlProps(kit, raw);
        if (props.size > 0) out.set(node, props);
      }
    }
    for (const child of node.children) walk(child);
  };
  walk(root);
  return out;
}

/** md2ui `_collect_url_props`'s `_card_urls`: whether some photo card's url writes a layout param. */
export function hasCardParams(kit: RegexKit, node: GroupNode): boolean {
  return (
    (node.card_bg_url !== null && urlLayoutParams(kit, node.card_bg_url).size > 0) ||
    node.children.some((c) => hasCardParams(kit, c))
  );
}

/**
 * md2ui's image floors (`generate`, with `render_metrics.image_floor`): each image's
 * `min_width`, capped by its `max_width`, read at the narrow values; images without
 * one are left out.
 */
export function imageFloors(urlProps: ReadonlyMap<GroupNode, UrlProps>): Map<GroupNode, number> {
  const out = new Map<GroupNode, number>();
  for (const [node, props] of urlProps) {
    const rp = urlRenderDict(props, false);
    const floor = rp["min_width"];
    if (typeof floor !== "number" || floor === 0) continue;
    const cap = rp["max_width"];
    out.set(node, typeof cap === "number" && cap !== 0 ? Math.min(floor, cap) : floor);
  }
  return out;
}
