// The action targets of a grouped document, and the ordinals events name them by
// (md2ui: pipeline/render_actions.py; ADR-003, md2ui ADR-404 / ADR-601).
//
// Reads the grouping tree only: no theme, fonts, layout or width, so a server that
// knows the content and not the layout can index what a message offers.
import type { GroupingNode, TargetPayload, TargetTable } from "@md2ui/contracts";
import { linkDestination } from "../group/link-content.ts";
import { RegexKit } from "../group/py/re.ts";
import { split, strip } from "../group/py/str.ts";
import { destinationUrl, splitMd2uiParams } from "../utils/image-params.ts";
import { choiceName, held } from "./choices.ts";
import { inlineLinkUrls, parseInlineSpans, plainLinkLabel } from "./inline-spans.ts";

const AGENT_SCHEME = "agent:";

/** What a document target reports: every kind but a code block's copy button, which is local. */
type TargetKind = "link" | "anchor" | "agent" | "checkbox" | "slider";

/** md2ui: `Action`, in its JSON form (`plain(action)`): what a click reports. */
export interface Action {
  readonly kind: TargetKind | "copy";
  readonly node_id: string;
  readonly label: string;
  readonly href: string | null;
  readonly action: string | null;
  readonly params: readonly (readonly [string, string])[];
  readonly checked: boolean | null;
  readonly value: number | null;
  readonly index: number | null;
  readonly value_decimals: number | null;
  readonly value_max: number | null;
  readonly value_unit: string;
  /** A slider between ➖ and ➕: a whole number (md2ui `render_choices`). */
  readonly count: boolean;
  readonly commit: boolean;
  readonly text: string | null;
  /**
   * The `md2ui.*` params the destination carried, split off: never reported, read for
   * `commit` and for a choice option's group (`choiceName`).
   */
  readonly hints: readonly (readonly [string, string])[];
}

/** An action a document target can report. */
type TargetAction = Action & { readonly kind: TargetKind };

/** md2ui: `Target`, with the wire fields the exporter derives from its key. */
export interface DocumentTarget {
  readonly ordinal: number;
  /** The node id; `<node id>#<k>` for the k-th link inside a text. */
  readonly key: string;
  readonly node_id: string;
  readonly inline_link: number | null;
  /** Written `~~…~~`: silent on purpose, not by mistake. */
  readonly disabled: boolean;
  /** Null: a slot that reports nothing (disabled, empty). */
  readonly action: TargetAction | null;
}

// Leaves a link card's name never reads: they draw no words.
// md2ui: render_actions._NOT_WORDS
const NOT_WORDS: readonly string[] = Object.freeze([
  "image",
  "horizontal_rule",
  "content_break",
  "spacer",
  "bullet_point",
  "drawing_element",
  "code_block",
]);

// Leaves painted by something other than the text drawer: no sentence, no links.
// md2ui: render_actions._NOT_PROSE
export const NOT_PROSE: readonly string[] = Object.freeze([
  "emoji",
  "inline_code",
  "code_block",
  "image",
  "horizontal_rule",
  "content_break",
  "spacer",
  "bullet_point",
  "drawing_element",
]);

// The platform's WHATWG URLSearchParams (ADR-007). The core's ES-only lib does not declare
// it; every supported runtime has it.
declare const URLSearchParams: new (query: string) => Iterable<[string, string]>;

/** md2ui `Action(kind, node_id, label)`: an action with every other field at its default. */
export function makeAction<K extends Action["kind"]>(
  kind: K,
  node_id: string,
  label: string,
): Action & { readonly kind: K } {
  return {
    kind,
    node_id,
    label,
    href: null,
    action: null,
    params: [],
    checked: null,
    value: null,
    index: null,
    value_decimals: null,
    value_max: null,
    value_unit: "",
    count: false,
    commit: false,
    text: null,
    hints: [],
  };
}

/** md2ui: `render_actions.action_for`. Classifies a link destination; null when it reports nothing. */
export function actionFor(
  kit: RegexKit,
  url: string | null,
  label: string,
  node_id: string,
): TargetAction | null {
  if (url === null) return null;
  // `md2ui.*` params are instructions to the client, never part of where a link goes, so
  // they are split off every destination exactly as an image's are: the agent never sees
  // its own plumbing quoted back, and a browser never sends it to a site.
  const [u, hints] = splitMd2uiParams(kit, destinationUrl(url));
  if (u === "") return null;
  const seen = [...hints];
  if (u.startsWith("#"))
    return u.length > 1 ? { ...makeAction("anchor", node_id, label), href: u, hints: seen } : null;
  if (u.slice(0, AGENT_SCHEME.length).toLowerCase() === AGENT_SCHEME) {
    const rest = u.slice(AGENT_SCHEME.length);
    const q = rest.indexOf("?");
    const slug = strip(q < 0 ? rest : rest.slice(0, q));
    if (slug === "") return null;
    return {
      ...makeAction("agent", node_id, label),
      action: slug,
      // md2ui: `urllib.parse.parse_qsl(query, keep_blank_values=True)`.
      params: [...new URLSearchParams(q < 0 ? "" : rest.slice(q + 1))],
      commit: !["", "0", "none", "false"].includes((hints.get("commit") ?? "").toLowerCase()),
      hints: seen,
    };
  }
  return { ...makeAction("link", node_id, label), href: u, hints: seen };
}

/** The action a drawing element's payload makes of its node's link, or of itself. */
export function controlAction(
  kit: RegexKit,
  nd: GroupingNode,
  payload: NonNullable<GroupingNode["drawing_element"]>,
  kind: "slider" | "checkbox",
): TargetAction | null {
  const label = payload.label ?? "";
  const action =
    nd.link_url !== undefined
      ? actionFor(kit, nd.link_url, label, nd.node_id)
      : makeAction(kind, nd.node_id, label);
  if (action === null) return null;
  if (kind === "slider") {
    return held(
      {
        ...action,
        value: payload.value ?? 0,
        index: payload.index ?? null,
        value_decimals: payload.decimals ?? null,
        value_max: payload.max ?? null,
        value_unit: payload.unit ?? "%",
      },
      nd,
    );
  }
  return { ...action, checked: !payload.checked, index: payload.index ?? null };
}

function firstHeading(nd: GroupingNode): GroupingNode | null {
  for (const child of nd.children) {
    if (child.type.startsWith("heading")) return child;
    const found = firstHeading(child);
    if (found !== null) return found;
  }
  return null;
}

function cardWords(kit: RegexKit, nd: GroupingNode, words: string[]): void {
  if (NOT_WORDS.includes(nd.type)) return;
  if (nd.children.length === 0) {
    if (nd.type === "link") words.push(plainLinkLabel(kit, nd.link_label ?? "", nd.link_variant));
    else for (const span of parseInlineSpans(kit, nd.content)) words.push(span.text);
  }
  for (const child of nd.children) cardWords(kit, child, words);
  words.push(" ");
}

/** md2ui: `render_actions.card_label`. The name a link card's click reports, from the words it shows. */
export function cardLabel(kit: RegexKit, nd: GroupingNode): string {
  const words: string[] = [];
  cardWords(kit, firstHeading(nd) ?? nd, words);
  return split(words.join("")).join(" ");
}

/** md2ui: `render_actions._inline_targets`. The links inside one text, in the order written. */
function inlineTargets(
  kit: RegexKit,
  content: string,
  node_id: string,
): Omit<DocumentTarget, "ordinal">[] {
  if (!content.includes("](") && !content.includes("<")) return [];
  const labels = new Map<number, string[]>();
  for (const span of parseInlineSpans(kit, content)) {
    if (span.link !== 0) labels.set(span.link, [...(labels.get(span.link) ?? []), span.text]);
  }
  return inlineLinkUrls(kit, content).map((url, i) => {
    const k = i + 1;
    const key = `${node_id}#${k}`;
    const label = split((labels.get(k) ?? []).join(" ")).join(" ");
    // A null destination is a `~~[…](…)~~` link: disabled.
    return {
      key,
      node_id,
      inline_link: k,
      disabled: url === null,
      action: actionFor(kit, url, label, key),
    };
  });
}

/**
 * md2ui: `render_actions.action_targets`. Every actionable target of a grouped
 * document, in document order: a link card before what it contains, then buttons,
 * task controls and each link inside a text in the order written. A disabled target (a
 * `~~` link, slider or task box) keeps its slot, reporting nothing, so ordinals do not shift when a re-send disables
 * a choice.
 */
export function actionTargets(
  root: GroupingNode,
  kit: RegexKit = new RegexKit(),
): DocumentTarget[] {
  const found: Omit<DocumentTarget, "ordinal">[] = [];
  const whole = (node_id: string, action: TargetAction | null, disabled = false) =>
    found.push({ key: node_id, node_id, inline_link: null, disabled, action });

  const walk = (nd: GroupingNode): void => {
    const payload = nd.drawing_element;
    // `~~[65%]~~`, `~~[ ]~~`: a control muted, a slot that reports nothing.
    if (payload?.["disabled"]) whole(nd.node_id, null, true);
    else if (payload?.kind === "slider")
      whole(nd.node_id, controlAction(kit, nd, payload, "slider"));
    else if (payload?.kind === "task_control")
      whole(nd.node_id, controlAction(kit, nd, payload, "checkbox"));
    else if (nd.type === "link") {
      const disabled = nd.link_disabled === true;
      const action = disabled
        ? null
        : held(
            actionFor(
              kit,
              linkDestination(kit, nd.content),
              plainLinkLabel(kit, nd.link_label ?? "", nd.link_variant),
              nd.node_id,
            ),
            nd,
          );
      whole(nd.node_id, action, disabled);
    } else if (nd.link_url !== undefined)
      whole(nd.node_id, actionFor(kit, nd.link_url, cardLabel(kit, nd), nd.node_id));
    else if (!NOT_PROSE.includes(nd.type))
      found.push(...inlineTargets(kit, nd.content, nd.node_id));
    for (const child of nd.children) walk(child);
  };
  walk(root);
  return found.map((t, ordinal) => ({ ordinal, ...t }));
}

/** What the host reads of an action (the target table's contract maps the names). */
function payloadOf(action: TargetAction): TargetPayload {
  const { kind, label, href, action: slug, checked, value, value_max, value_decimals } = action;
  const choice = choiceName(action);
  return {
    kind,
    label,
    ...(href !== null && { href }),
    ...(slug !== null && { slug }),
    // md2ui's `checked` is the state the click asks for; the table holds the one shown.
    ...(checked !== null && { checked: !checked }),
    ...(choice !== null && { choice }),
    ...(value !== null &&
      value_max !== null && {
        slider: { value, max: value_max, decimals: value_decimals, count: action.count },
      }),
    commit: action.commit,
  };
}

/** The target table: what the target at each ordinal reports, from `actionTargets`. */
export function targetTable(root: GroupingNode, kit: RegexKit = new RegexKit()): TargetTable {
  return actionTargets(root, kit).map((t) => (t.action === null ? undefined : payloadOf(t.action)));
}
