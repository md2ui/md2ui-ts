// A repeated run decides as one (ADR-301): md2ui's `_unify_run`,
// `_unify_run_render` and `_unit_min_for`, with `render_hints`' `_mode` and
// `poll_render`. The members vote on the theme's `Emoji aside` and on their image URL
// hints; the winner is pinned on every member before the grid picks its column count.
import type { GroupNode } from "../group/node.ts";
import { urlLayoutParams, withLayoutParams } from "../utils/image-params.ts";
import { asideMinWidth, iconAsideCandidate, themeAsksIconAside } from "./asides.ts";
import type { Run } from "./run.ts";
import { RENDER_FIELDS, urlRenderDict, WIDE_BREAKPOINT } from "./url-hints.ts";

/** md2ui `_mode`: the most frequent value; ties go to the earliest. */
function mode<T>(values: readonly T[]): T {
  const counts = new Map<T, [count: number, first: number]>();
  values.forEach((v, i) => {
    const entry = counts.get(v);
    if (entry === undefined) counts.set(v, [1, i]);
    else entry[0] += 1;
  });
  let best: T = values[0] as T;
  let bestCount = -1;
  let bestFirst = 0;
  for (const [v, [count, first]] of counts) {
    if (count > bestCount || (count === bestCount && first < bestFirst)) {
      best = v;
      bestCount = count;
      bestFirst = first;
    }
  }
  return best;
}

/**
 * md2ui `poll_render(...).to_render_dict()`: each render hint is the mode of the
 * members' values (an absent hint is a vote too), the unset ones left out.
 */
function pollRender(votes: readonly Record<string, unknown>[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of RENDER_FIELDS) {
    const value = mode(votes.map((v) => v[field]));
    if (value !== undefined) out[field] = value;
  }
  return out;
}

/** Whether two param maps hold the same entries (md2ui compares the dicts). */
function sameParams(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  return a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
}

/**
 * md2ui `_unify_run_render`'s image cards: a card's picture is its background, not a
 * child, so it votes too, and the most frequent params (ties to the earliest) go onto
 * every card's url (ADR-301).
 */
function pollCards(run: Run, at: readonly GroupNode[]): void {
  const cards = at.filter((n) => n.card_bg_url);
  const votes = cards
    .map((n) => urlLayoutParams(run.kit, n.card_bg_url as string))
    .filter((p) => p.size > 0);
  if (votes.length === 0) return;
  const count = (p: ReadonlyMap<string, string>): number =>
    votes.filter((v) => sameParams(v, p)).length;
  let won = votes[0] as ReadonlyMap<string, string>;
  for (const v of votes) if (count(v) > count(won)) won = v;
  for (const n of cards) {
    run.pinnedCard.set(n, withLayoutParams(run.kit, n.card_bg_url as string, won));
  }
}

/**
 * md2ui `_unify_run_render`: per path inside the members (by child index), the members
 * that carry URL hints vote, and the mode is pinned on every member at that path. A
 * path only some members have gets no pin.
 */
export function unifyRunRender(run: Run, members: readonly GroupNode[], width: number): void {
  const paths = new Map<string, GroupNode[]>();
  const collect = (n: GroupNode, path: string): void => {
    const at = paths.get(path);
    if (at === undefined) paths.set(path, [n]);
    else at.push(n);
    n.children.forEach((c, i) => {
      collect(c, `${path}.${i}`);
    });
  };
  for (const m of members) collect(m, "");
  const wide = width >= WIDE_BREAKPOINT;
  for (const at of paths.values()) {
    if (at.length < 2) continue;
    pollCards(run, at);
    if (run.urlProps.size === 0) continue;
    const votes: Record<string, unknown>[] = [];
    for (const n of at) {
      const props = run.urlProps.get(n);
      if (props !== undefined) votes.push(urlRenderDict(props, wide));
    }
    if (votes.length === 0) continue;
    const unified = pollRender(votes);
    for (const n of at) run.pinnedRender.set(n, unified);
  }
}

/**
 * md2ui `_unify_run`: a repeated run's members vote (the theme's `Emoji aside` on their
 * level; their URL hints, per path) and the outcome is pinned on every member. `true`
 * when the run unified on the icon aside, else `null` (no source, or no vote).
 */
export function unifyRun(
  run: Run,
  members: readonly GroupNode[],
  ownerLevel: number,
  width: number,
): true | null {
  if (members.length < 2) return null;
  if (run.urlProps.size === 0 && !run.themeAsides && !run.cardUrls) return null;
  unifyRunRender(run, members, width);
  if (!members.some((m) => themeAsksIconAside(run, m, ownerLevel))) return null;
  for (const m of members) run.pinned.add(m);
  return true;
}

/**
 * md2ui `_unit_min_for`: a run's per-unit min width under its unified icon aside (the
 * widest member's icon, rest and gap), or `null` when the stacked measurement holds.
 */
export function unitMinFor(
  run: Run,
  members: readonly GroupNode[],
  asides: true | null,
  ownerLevel: number,
): number | null {
  if (asides === null) return null;
  let widest: number | null = null;
  for (const m of members) {
    if (!iconAsideCandidate(m)) continue;
    const head = m.children[0] as GroupNode;
    const icon =
      head.type === "emoji" && head.emoji_kind === "alone"
        ? head
        : (m.children[m.children.length - 1] as GroupNode);
    const w = asideMinWidth(run, icon, m.children, ownerLevel);
    if (widest === null || w > widest) widest = w;
  }
  return widest;
}
