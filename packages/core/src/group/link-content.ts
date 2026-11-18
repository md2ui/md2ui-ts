// What a LINK node's markup says about how it is drawn (md2ui:
// grouper_types._classify_link_content): the variant its wrapper selects, the label,
// and the disabled state and emoji shape that ride on top of the variant.
import type { GroupingNode } from "@md2ui/contracts";
import { EMOJI_CHAR_PATTERN } from "./detect/vocabulary.ts";
import { compile, type RegexKit } from "./py/re.ts";
import { cpLen, strip } from "./py/str.ts";
import { LINK_DESTINATION, LINK_LABEL, OVERFLOW_MARKS } from "./split/link-syntax.ts";

type LinkVariant = NonNullable<GroupingNode["link_variant"]>;
type LinkEmphasis = NonNullable<GroupingNode["link_emphasis"]>;

/** md2ui `_classify_link_content`'s tuple, named. */
export interface LinkContent {
  readonly variant: LinkVariant;
  readonly label: string;
  readonly is_emoji: boolean;
  readonly is_disabled: boolean;
  /** The wrapper a backtick label displaced, kept as the label's face. */
  readonly emphasis: LinkEmphasis | null;
}

/** md2ui: `_LINK_CONTENT_RE` (grouper_types). A whole `[label](url)`. */
// py: re.compile(rf"^\[({LINK_LABEL})\]\({LINK_DESTINATION}\)$", re.DOTALL)
export const LINK_CONTENT_RE = compile(String.raw`^\[(${LINK_LABEL})\]\(${LINK_DESTINATION}\)$`, {
  s: true,
});

// md2ui: _LINK_VARIANT_WRAPPERS, from _LINK_LADDERS — longest wrapper first. A button
// reads `*` as the element ladder and `_` as the small one, as a chip does.
const LINK_VARIANT_WRAPPERS = [
  ["***", "quaternary"],
  ["___", "septenary"],
  ["**", "tertiary"],
  ["__", "senary"],
  ["*", "secondary"],
  ["_", "quinary"],
] as const;

// md2ui: _EMPHASIS_FROM_VARIANT — the face a displaced wrapper leaves, by its length.
const EMPHASIS_FROM_VARIANT: Readonly<Partial<Record<LinkVariant, LinkEmphasis>>> = Object.freeze({
  secondary: "italic",
  tertiary: "bold",
  quaternary: "bold_italic",
  quinary: "italic",
  senary: "bold",
  septenary: "bold_italic",
});

/** md2ui: `_strip_wrap`. `s` without a symmetric `marker` wrapper, or null. */
export function stripWrap(s: string, marker: string): string | null {
  const n = marker.length;
  if (cpLen(s) >= 2 * n + 1 && s.startsWith(marker) && s.endsWith(marker)) {
    return strip(s.slice(n, -n));
  }
  return null;
}

/** md2ui: `grouper_types._classify_link_content`. */
export function classifyLinkContent(kit: RegexKit, content: string): LinkContent {
  let s = strip(content);

  const disabled = stripWrap(s, "~~");
  if (disabled !== null) s = disabled;

  let variant: LinkVariant = "primary";
  for (const [marker, name] of LINK_VARIANT_WRAPPERS) {
    const inner = stripWrap(s, marker);
    if (inner !== null) {
      variant = name;
      s = inner;
      break;
    }
  }

  const m = kit.re(LINK_CONTENT_RE).match(s);
  let label = m === null ? s : m.text(1);

  let emphasis: LinkEmphasis | null = null;
  if (label.startsWith("`") && label.endsWith("`") && cpLen(label) >= 2) {
    emphasis = EMPHASIS_FROM_VARIANT[variant] ?? null;
    variant = "text";
    label = strip(label.slice(1, -1));
  }

  // ZWJ joiners and spaces do not stop a label from being one emoji, and a "more" mark
  // alone is an icon button's label.
  const stripped = label.replaceAll("\u200d", "").replaceAll(" ", "");
  const is_emoji =
    OVERFLOW_MARKS.includes(stripped) ||
    (stripped !== "" && kit.re(EMOJI_CHAR_PATTERN).fullmatch(stripped) !== null);
  return { variant, label, is_emoji, is_disabled: disabled !== null, emphasis };
}

// md2ui: grouper_types._LINK_DESTINATION_RE
// py: re.compile(rf"^\[(?:{LINK_LABEL})\]\(({LINK_DESTINATION})\)$", re.DOTALL)
const LINK_DESTINATION_RE = compile(String.raw`^\[(?:${LINK_LABEL})\]\((${LINK_DESTINATION})\)$`, {
  s: true,
});

/** md2ui: `grouper_types.link_destination`. The raw destination of a LINK node's content, or null. */
export function linkDestination(kit: RegexKit, content: string): string | null {
  let s = strip(content);
  const disabled = stripWrap(s, "~~");
  if (disabled !== null) s = disabled;
  for (const [marker] of LINK_VARIANT_WRAPPERS) {
    const inner = stripWrap(s, marker);
    if (inner !== null) {
      s = inner;
      break;
    }
  }
  const m = kit.re(LINK_DESTINATION_RE).match(s);
  return m === null ? null : m.text(1);
}
