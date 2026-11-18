// Host state across a replacement (md2ui `protocol/README.md`, *Lifecycle* 3;
// md2ui `wire_client.carried_states`). A replacement is the agent answering on the same page:
// what the user did that the agent has not answered yet stays shown. Pure, no DOM.
import type { HostState, TargetPayload, TargetTable } from "@md2ui/contracts";

/** A document as the view showed it whole: its Markdown and its target table. */
export interface ShownDocument {
  readonly markdown: string;
  readonly targets: TargetTable;
}

/**
 * Whether the replacement left a target as it was. The label is read from the target's
 * neighbours, so disabling the link beside a slider rewords the slider without changing it.
 */
function unchanged(before: TargetPayload, after: TargetPayload): boolean {
  return (
    before.kind === after.kind &&
    before.href === after.href &&
    before.slug === after.slug &&
    before.checked === after.checked &&
    before.choice === after.choice &&
    before.commit === after.commit &&
    before.slider?.value === after.slider?.value &&
    before.slider?.max === after.slider?.max &&
    before.slider?.decimals === after.slider?.decimals &&
    before.slider?.count === after.slider?.count
  );
}

/** The `states` on targets of `before` that `after` shows as they were, by ordinal. */
export function standingStates(
  before: ShownDocument,
  after: ShownDocument,
  states: ReadonlyMap<number, HostState>,
): Map<number, HostState> {
  const kept = new Map<number, HostState>();
  for (const [ordinal, state] of states) {
    const was = before.targets[ordinal];
    const now = after.targets[ordinal];
    if (was !== undefined && now !== undefined && unchanged(was, now)) kept.set(ordinal, state);
  }
  return kept;
}

/**
 * The `states` the user set on `before` that its replacement `after` leaves standing,
 * by ordinal.
 *
 * None when the Markdown is the same: that is the agent answering "no change" (declining
 * a tick by marking the box as it already is), so the page shows what it says. A state
 * stands where the replacement left its target as it was; where the agent changed the
 * target, its Markdown is the answer. Targets match by ordinal, the wire's identity, and
 * only when both documents offer the same number of them, as every `mark` does.
 */
export function carriedStates(
  before: ShownDocument,
  after: ShownDocument,
  states: ReadonlyMap<number, HostState>,
): Map<number, HostState> {
  if (before.markdown === after.markdown || before.targets.length !== after.targets.length) {
    return new Map();
  }
  return standingStates(before, after, states);
}
