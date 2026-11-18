// A tap becomes an action (ADR-003, md2ui ADR-404): the rules of md2ui's window
// (`app.py` `dispatch`, `render_actions.requested`, `stepped`, `slider_value_in_rect`;
// `render_choices.show_locally`, `settled_rows`), as pure functions of the target, its payload and the host
// state. No DOM: the view applies what these return.
import type {
  ActionTarget,
  HitTarget,
  HostState,
  Md2uiAction,
  Rect,
  SettledValue,
  SliderTarget,
  TargetPayload,
  TargetTable,
} from "@md2ui/contracts";

/** The most other targets one event commits (protocol: `vs`, at most 32 entries). */
const MAX_SETTLED = 32;

/** What a tap on a target means, before the host has had its say. */
export type Tap =
  | {
      readonly kind: "action";
      readonly action: Md2uiAction;
      /** The state to show on the target (`action.ordinal`) unless cancelled. */
      readonly state: HostState | null;
      /** A choice option's group: the other options, shown unchosen unless cancelled. */
      readonly unchosen?: readonly number[];
    }
  | { readonly kind: "anchor"; readonly id: string }
  | { readonly kind: "none" };

/** What the view knows when a target is tapped. */
export interface TapContext {
  readonly messageId: string | null;
  /** Host state by target ordinal. */
  readonly states: ReadonlyMap<number, HostState>;
  /** The list's targets: the commit button reads the other controls through them. */
  readonly targets: readonly HitTarget[];
  /** What each ordinal reports: a choice option finds its group through it. */
  readonly table: TargetTable;
  /** Silences the agent-bound kinds (ADR-003). */
  readonly disabled: boolean;
}

/** A target the agent hears about. */
function agentBound(payload: TargetPayload): boolean {
  return payload.kind === "agent" || payload.kind === "checkbox" || payload.kind === "slider";
}

/**
 * Whether `target` waits on the agent: it is pending, or a pending link card holds it
 * (md2ui `hit_region`: an inert card swallows every click inside it, so the buttons it
 * holds wait with it). A card holds what its rect holds the centre of, the half-open
 * rect a tap lands in.
 */
export function waiting(
  target: ActionTarget | SliderTarget,
  states: ReadonlyMap<number, HostState>,
  targets: readonly HitTarget[],
): boolean {
  const pending = (t: ActionTarget | SliderTarget) => states.get(t.ordinal)?.kind === "pending";
  const x = target.rect.x + target.rect.width / 2;
  const y = target.rect.y + target.rect.height / 2;
  return (
    pending(target) ||
    targets.some(
      (card) =>
        "card" in card &&
        card.card &&
        pending(card) &&
        x >= card.rect.x &&
        x < card.rect.x + card.rect.width &&
        y >= card.rect.y &&
        y < card.rect.y + card.rect.height,
    )
  );
}

/** The tick a tap asks for: the opposite of the one shown, the host's own if it shows one. */
function requested(authored: boolean, state: HostState | undefined): boolean {
  return state?.kind === "checked" ? !state.checked : !authored;
}

/**
 * The value a point on a slider's track asks for (md2ui `slider_value_in_rect`):
 * 0 to `max` along the track, rounded to the precision the author wrote.
 */
export function sliderValue(
  rect: Rect,
  axis: SliderTarget["axis"],
  x: number,
  y: number,
  max: number,
  decimals: number | null,
): number {
  const ratio =
    axis === "vertical"
      ? (rect.y + rect.height - y) / Math.max(1, rect.height)
      : (x - rect.x) / Math.max(1, rect.width);
  const value = Math.min(max, Math.max(0, ratio * max));
  if (decimals === null) return value;
  const scale = 10 ** decimals;
  return Math.round(value * scale) / scale;
}

/**
 * The values the user set on the other controls, for a commit button (the wire's `vs`;
 * md2ui `settled_rows`): each value and tick shown, and each group's chosen option as
 * `[ordinal, true]`, never `false`. A count's two buttons are two targets of one ordinal,
 * listed once.
 */
function settledValues(fired: number, context: TapContext): SettledValue[] {
  const rows = new Map<number, SettledValue>();
  for (const target of context.targets) {
    if (target.kind === "copy" || target.ordinal === fired) continue;
    const state = context.states.get(target.ordinal);
    const choice = context.table[target.ordinal]?.choice !== undefined;
    if (state?.kind === "value") rows.set(target.ordinal, [target.ordinal, state.value]);
    else if (state?.kind === "checked" && (!choice || state.checked)) {
      rows.set(target.ordinal, [target.ordinal, state.checked]);
    }
  }
  return [...rows.values()].sort((a, b) => a[0] - b[0]).slice(0, MAX_SETTLED);
}

/**
 * md2ui `stepped`: what a tap on a count's ➖ or ➕ asks for, the value shown one step on,
 * or null when that step leaves 0 to the count's maximum.
 */
export function stepped(
  target: ActionTarget | SliderTarget,
  payload: TargetPayload,
  states: ReadonlyMap<number, HostState>,
): number | null {
  if (target.step === undefined || payload.slider === undefined) return null;
  const shown = states.get(target.ordinal);
  const value = (shown?.kind === "value" ? shown.value : payload.slider.value) + target.step;
  return value < 0 || value > payload.slider.max ? null : value;
}

/**
 * What tapping `target` means. `value` is a slider's released value; any other kind
 * ignores it. A waiting target, and an agent-bound one in a disabled view, mean nothing.
 */
export function tap(
  target: ActionTarget | SliderTarget,
  payload: TargetPayload,
  context: TapContext,
  value?: number,
): Tap {
  if (waiting(target, context.states, context.targets)) return { kind: "none" };
  if (context.disabled && agentBound(payload)) return { kind: "none" };
  const base = { ordinal: target.ordinal, messageId: context.messageId, label: payload.label };
  const shown = context.states.get(target.ordinal);
  switch (payload.kind) {
    case "anchor":
      return { kind: "anchor", id: (payload.href ?? "#").slice(1) };
    case "link":
      return {
        kind: "action",
        action: { ...base, kind: "link", href: payload.href ?? "" },
        state: null,
      };
    case "checkbox": {
      const checked = requested(payload.checked ?? false, shown);
      return {
        kind: "action",
        action: { ...base, kind: "checkbox", checked },
        state: { kind: "checked", checked },
      };
    }
    case "slider": {
      if (value === undefined) return { kind: "none" };
      return {
        kind: "action",
        action: { ...base, kind: "slider", value },
        state: { kind: "value", value },
      };
    }
    case "agent": {
      const slug = payload.slug ?? "";
      if (payload.slider !== undefined) {
        if (value === undefined) return { kind: "none" };
        return {
          kind: "action",
          action: { ...base, kind: "agent", slug, value },
          state: { kind: "value", value },
        };
      }
      if (payload.choice !== undefined) {
        // md2ui `show_locally`: an option is chosen and its group's others are not (a
        // radio); a tap always asks for its option, never to clear it.
        const unchosen = context.table.flatMap((other, ordinal) =>
          other?.choice === payload.choice && ordinal !== target.ordinal ? [ordinal] : [],
        );
        return {
          kind: "action",
          action: { ...base, kind: "agent", slug, checked: true },
          state: { kind: "checked", checked: true },
          unchosen,
        };
      }
      if (payload.checked !== undefined) {
        const checked = requested(payload.checked, shown);
        return {
          kind: "action",
          action: { ...base, kind: "agent", slug, checked },
          state: { kind: "checked", checked },
        };
      }
      const settled = payload.commit ? settledValues(target.ordinal, context) : [];
      return {
        kind: "action",
        action:
          settled.length > 0
            ? { ...base, kind: "agent", slug, settled }
            : { ...base, kind: "agent", slug },
        state: { kind: "pending" },
      };
    }
  }
}

/**
 * Where a link opens when the host does not cancel it, as a plain `<a>` would: http(s)
 * and `mailto:` only; an http(s) link to another origin in a new tab (ADR-003).
 * Null for anything else, which nothing opens.
 */
export function linkOpening(
  href: string,
  page: string,
): { readonly url: string; readonly newTab: boolean } | null {
  let url: URL;
  try {
    url = new URL(href, page);
  } catch {
    return null;
  }
  if (url.protocol === "mailto:") return { url: url.href, newTab: false };
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  return { url: url.href, newTab: url.origin !== new URL(page).origin };
}
