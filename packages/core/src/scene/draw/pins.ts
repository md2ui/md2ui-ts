// `## Fixed colors`, resolved once before painting (md2ui: render_colors.py,
// `stamp_fixed_colors` and its helpers).
//
// md2ui stamps `fixed_text` / `fixed_fill` / `fixed_stroke` / `fixed_text_spans` onto the
// grouping tree's node dicts; here the tree stays untouched and the same stamps come back
// keyed by node id. A pin is resolved on the tree, not in a drawer, because it can spread
// to a leaf's siblings.
//
// md2ui's offsets are Python string indices (code points). This tree's `data_points`
// offsets, and so the stamped `spans`, are UTF-16 offsets into the node's `content`
// (ADR-002: converted at the fixture boundary), which is what the text painter compares
// against. Every test md2ui makes on them (bounds, slices, order, the stripped extent)
// keeps its answer under that conversion, so they are compared as they are.

import type {
  Argb,
  FixedEmojiWord,
  GroupingDataPoint,
  GroupingNode,
  ResolvedTheme,
  RoleColors,
} from "@md2ui/contracts";
import { parseInlineSpans, plainLinkLabel } from "../../actions/inline-spans.ts";
import type { RegexKit } from "../../group/py/re.ts";
import { first, lstrip, rstrip, strip } from "../../group/py/str.ts";
import type { Pins } from "./colors.ts";

type Fixed = ResolvedTheme["fixed"];
type DpPin = readonly [GroupingDataPoint, Argb];
type Span = NonNullable<Pins["spans"]>[number];

/** A node's stamps while the walk writes them (md2ui's mutable node dict). */
interface Stamp {
  text?: Argb;
  fill?: Argb;
  stroke?: Argb;
  spans?: Span[];
}

/** The walk's state: the stamps so far, and what resolving one needs. */
interface Stamps {
  readonly out: Map<string, Stamp>;
  readonly theme: ResolvedTheme;
  readonly kit: RegexKit;
}

/** Python's `x in "+-"`: true for `+`, `-`, `+-` and the empty string. */
const inSigns = (s: string): boolean => "+-".includes(s);

/** md2ui `("+", "-")`: what a previous sibling holds, stripped, to be a lone sign. */
const LONE_SIGNS: readonly string[] = Object.freeze(["+", "-"]);

/** `dict.get(key)` on a theme table: own keys only. */
function lookup<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** The node's stamp record, created on first write. */
function stampOf(s: Stamps, node: GroupingNode): Stamp {
  let stamp = s.out.get(node.node_id);
  if (stamp === undefined) {
    stamp = {};
    s.out.set(node.node_id, stamp);
  }
  return stamp;
}

/** md2ui `bare_glyph`: `text` without its variation selectors (U+FE00–U+FE0F). */
export const bareGlyph = (text: string): string => text.replace(/[\uFE00-\uFE0F]/gu, "");

/**
 * md2ui `emoji_pin`: the `## Fixed colors` entry for `glyph`, written with or without its
 * variation selector on either side, since `☀️` and `☀` are one glyph to the author. An
 * entry spelled exactly as the document wins over one that differs only by its selector.
 */
export function emojiPin<T>(pins: Readonly<Record<string, T>>, glyph: string): T | undefined {
  const hit = lookup(pins, glyph);
  if (hit !== undefined) return hit;
  const bare = bareGlyph(glyph);
  for (const [key, value] of Object.entries(pins)) {
    if (bareGlyph(key) === bare) return value;
  }
  return undefined;
}

/** md2ui `FixedColors.is_active`: whether any `## Fixed colors` table has an entry. */
function isActive(fixed: Fixed): boolean {
  return [
    fixed.emoji,
    fixed.emoji_bg,
    fixed.pill_exact,
    fixed.pill_contains,
    fixed.button_exact,
    fixed.button_contains,
    fixed.datapoints,
  ].some((table) => Object.keys(table).length > 0);
}

/**
 * md2ui `_label_pins`: a chip's or button's entry — the exact label first, then the
 * first key the label contains.
 */
function labelPins(
  label: string,
  exact: Fixed["pill_exact"],
  contains: Fixed["pill_contains"],
): RoleColors | undefined {
  const hit = lookup(exact, strip(label));
  if (hit !== undefined) return hit;
  for (const [key, roles] of Object.entries(contains)) {
    if (label.includes(key)) return roles;
  }
  return undefined;
}

/** The sign a lone previous sibling carries (`prev_content.strip() in "+-"`), else `""`. */
function prevSign(prevContent: string | null): string {
  return prevContent && inSigns(strip(prevContent)) ? strip(prevContent) : "";
}

/**
 * md2ui `_dp_pin_for`: one annotation's `### Datapoints` pin, by its type, or by its
 * direction when the match, the leaf or a lone previous sibling carries a sign.
 */
function dpPinFor(
  dp: GroupingDataPoint,
  content: string,
  prevContent: string | null,
  theme: ResolvedTheme,
): Argb | undefined {
  const table = theme.fixed.datapoints;
  if (Object.keys(table).length === 0) return undefined;
  const matched = first(strip(dp.matched));
  const leaf = first(strip(content));
  const sign = inSigns(matched) ? matched : inSigns(leaf) ? leaf : prevSign(prevContent);
  const kind = dp.label.replaceAll("dp_", "");
  if (kind === "emoji") return undefined;
  if (sign !== "") {
    const direction = sign === "+" ? "up" : "down";
    for (const key of [kind, "change"]) {
      const hit = lookup(table, `${key} ${direction}`);
      if (hit !== undefined) return hit;
    }
  }
  return lookup(table, kind);
}

/**
 * md2ui `_dp_pin`: a whole leaf's `### Datapoints` pin, by its detected types and the
 * sign on the leaf or on a lone previous sibling.
 */
function dpPin(
  nd: GroupingNode,
  prevContent: string | null,
  theme: ResolvedTheme,
): Argb | undefined {
  const table = theme.fixed.datapoints;
  if (Object.keys(table).length === 0) return undefined;
  const leaf = first(strip(nd.content));
  const sign = inSigns(leaf) ? leaf : prevSign(prevContent);
  const types = (nd.data_points ?? [])
    .map((p) => p.label.replaceAll("dp_", ""))
    .filter((t) => t !== "emoji");
  if (sign !== "") {
    const direction = sign === "+" ? "up" : "down";
    for (const kind of [...types, "change"]) {
      const hit = lookup(table, `${kind} ${direction}`);
      if (hit !== undefined) return hit;
    }
  }
  for (const kind of types) {
    const hit = lookup(table, kind);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

/**
 * md2ui `_stamp_dp_spans`: each pinned annotation as a range of the leaf, or the whole
 * leaf in one colour when a range cannot be trusted (stale offsets, Markdown the painter
 * would strip, overlapping ranges) or covers the whole stripped leaf. Returns the colour
 * the leaf opens with; `undefined` when nothing is pinned.
 */
function stampDpSpans(
  s: Stamps,
  nd: GroupingNode,
  pins: readonly DpPin[],
  fallbackColor: Argb | undefined,
): Argb | undefined {
  const head = pins[0];
  if (head === undefined) return undefined;
  const stamp = stampOf(s, nd);
  const wholeLeaf = (color: Argb): Argb => {
    stamp.text = color;
    delete stamp.spans;
    return color;
  };
  const fallback = fallbackColor !== undefined ? fallbackColor : head[1];
  const content = nd.content;
  const spans: Span[] = [];
  for (const [dp, color] of pins) {
    const { start, end } = dp;
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      !(0 <= start && start < end && end <= content.length) ||
      content.slice(start, end) !== dp.matched
    ) {
      return wholeLeaf(fallback);
    }
    // A detector may leave a leading sign just outside a numeric match; it is painted
    // with the value, as the whole-leaf pin painted it.
    let paintStart = start;
    if (
      start > 0 &&
      inSigns(content.charAt(start - 1)) &&
      strip(content.slice(0, start - 1)) === ""
    ) {
      paintStart -= 1;
    }
    spans.push({ start: paintStart, end, color });
  }
  const visible = parseInlineSpans(s.kit, content)
    .map((span) => span.text)
    .join("");
  if (visible !== content) {
    return wholeLeaf(fallback);
  }
  spans.sort((a, b) => a.start - b.start || a.end - b.end);
  if (spans.some((left, i) => left.end > (spans[i + 1]?.start ?? Number.POSITIVE_INFINITY))) {
    return wholeLeaf(fallback);
  }
  const lo = content.length - lstrip(content).length;
  const hi = rstrip(content).length;
  const only = spans.length === 1 ? spans[0] : undefined;
  if (only !== undefined && only.start === lo && only.end === hi) {
    return wholeLeaf(only.color);
  }
  delete stamp.text;
  stamp.spans = spans;
  return (spans[0] as Span).color;
}

/**
 * md2ui `_datapoint_pins`: a leaf's per-annotation pins and its whole-leaf fall-back; an
 * emoji annotation scoped `datapoints` takes over every other annotation of the leaf,
 * emojis among them. Its own glyph already takes its pin where the run is painted.
 */
function datapointPins(
  nd: GroupingNode,
  prevContent: string | null,
  theme: ResolvedTheme,
): readonly [readonly DpPin[], Argb | undefined] {
  const dps = nd.data_points ?? [];
  const pins: DpPin[] = [];
  for (const dp of dps) {
    const pin = dpPinFor(dp, nd.content, prevContent, theme);
    if (pin !== undefined) pins.push([dp, pin]);
  }
  let scoped: Argb | undefined;
  const scoping = new Set<GroupingDataPoint>();
  for (const dp of dps) {
    if (dp.label !== "dp_emoji") continue;
    const hit = emojiPin(theme.fixed.emoji, strip(dp.matched));
    if (hit?.[1].includes("datapoints")) {
      scoped = hit[0];
      scoping.add(dp);
    }
  }
  if (scoped === undefined) return [pins, dpPin(nd, prevContent, theme)];
  const color = scoped;
  return [dps.filter((dp) => !scoping.has(dp)).map((dp) => [dp, color] as const), color];
}

// md2ui: _TEXT_PIECES, _ELEMENT_KINDS. The piece types an emoji pin's scope names: the
// words of a line, whatever datapoints they hold, are `text`; a heading is text too.
const TEXT_PIECES: readonly string[] = Object.freeze([
  "text",
  "segment",
  "datapoint",
  "key",
  "value",
]);
const ELEMENT_KINDS: Readonly<Record<string, FixedEmojiWord>> = Object.freeze({
  emoji: "emojis",
  link: "buttons",
  inline_code: "chips",
});

/**
 * md2ui `_piece_kind`: the kind an emoji pin's scope names `node` by (a text link is a
 * button variant); `undefined` for a piece no kind names, such as a picture.
 */
function pieceKind(node: GroupingNode): FixedEmojiWord | undefined {
  if (TEXT_PIECES.includes(node.type) || node.type.startsWith("heading")) return "text";
  return lookup(ELEMENT_KINDS, node.type);
}

/**
 * md2ui `_stamp_signed_chip`: a chip that is one signed value colours by its direction,
 * as the value does in text: the pin on its label, a light tint of the pin behind it.
 */
function stampSignedChip(
  s: Stamps,
  chip: GroupingNode,
  label: string,
  prevContent: string | null,
): void {
  const [pins] = datapointPins(chip, prevContent, s.theme);
  const only = pins.length === 1 ? pins[0] : undefined;
  if (only === undefined || strip(only[0].matched) !== label) return;
  const [, color] = only;
  const stamp = stampOf(s, chip);
  stamp.text = color;
  stamp.fill = (color & 0xffffff) | 0x19000000;
}

/**
 * md2ui `stamp_fixed_colors` below one node: its children's datapoint, pill and button
 * pins first, then each scoped emoji's reach over its siblings, which overwrites them
 * because naming a glyph is more specific.
 */
function stampChildren(s: Stamps, node: GroupingNode): void {
  const { fixed } = s.theme;
  const kids = node.children;

  kids.forEach((kid, i) => {
    const content = kid.content;
    const prevKid = i > 0 ? kids[i - 1] : undefined;
    // A muted element paints its own state, never a pin, as a disabled link does.
    if (kid.element_muted) return;
    if (kid.type === "emoji") {
      const pin = emojiPin(fixed.emoji, strip(content));
      if (pin !== undefined) stampOf(s, kid).text = pin[0];
      const bg = emojiPin(fixed.emoji_bg, strip(content));
      if (bg !== undefined) stampOf(s, kid).fill = bg;
    } else if (kid.type === "inline_code" || kid.type === "link") {
      const isButton = kid.type === "link";
      const label = isButton
        ? plainLinkLabel(s.kit, kid.link_label ?? "", kid.link_variant)
        : strip(strip(content), "`");
      const roles = labelPins(
        label || content,
        isButton ? fixed.button_exact : fixed.pill_exact,
        isButton ? fixed.button_contains : fixed.pill_contains,
      );
      if (roles !== undefined && Object.keys(roles).length > 0) {
        if (roles.text !== undefined) stampOf(s, kid).text = roles.text;
        if (roles.fill !== undefined) stampOf(s, kid).fill = roles.fill;
        if (roles.stroke !== undefined) stampOf(s, kid).stroke = roles.stroke;
      } else if (!isButton) {
        stampSignedChip(s, kid, label, prevKid?.content ?? null);
      }
    } else {
      const [pins, fallback] = datapointPins(kid, prevKid?.content ?? null, s.theme);
      const lead = stampDpSpans(s, kid, pins, fallback);
      // A lone sign belongs to the number it signs, so it takes the colour the number
      // opens with: `+2,588` is never a grey + and a green number.
      if (
        lead !== undefined &&
        prevKid !== undefined &&
        LONE_SIGNS.includes(strip(prevKid.content))
      ) {
        stampOf(s, prevKid).text = lead;
      }
    }
  });

  // An emoji's scope reaches its siblings, so it is resolved per parent.
  kids.forEach((kid, i) => {
    if (kid.type !== "emoji") return;
    const pin = lookup(fixed.emoji, strip(kid.content));
    if (pin === undefined || pin[1].length === 0) return;
    const [color, words] = pin;
    kids.forEach((sib, j) => {
      if (j === i || sib.children.length > 0) return;
      const kind = pieceKind(sib);
      if (words.includes("line") || (kind !== undefined && words.includes(kind))) {
        const stamp = stampOf(s, sib);
        stamp.text = color;
        delete stamp.spans;
      } else if (words.includes("datapoints")) {
        const pins = (sib.data_points ?? []).map((p) => [p, color] as const);
        stampDpSpans(s, sib, pins, color);
      }
    });
  });

  for (const kid of kids) stampChildren(s, kid);
}

/**
 * md2ui `stamp_fixed_colors`: every node's `## Fixed colors` pins, by node id; none when
 * the theme has no `## Fixed colors` entry.
 */
export function fixedPins(
  root: GroupingNode,
  theme: ResolvedTheme,
  kit: RegexKit,
): Map<string, Pins> {
  const out = new Map<string, Stamp>();
  if (isActive(theme.fixed)) stampChildren({ out, theme, kit }, root);
  return out;
}
