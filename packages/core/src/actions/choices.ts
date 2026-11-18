// Choices and counts: the targets that hold a value until a commit (md2ui:
// pipeline/render_choices.py, ADR-405). A task box and a slider already hold what the
// user set until a `md2ui.commit` press carries it; two more do the same, both read off
// what the author wrote, neither a new kind of target:
//
// - a choice option is an `agent:` button whose destination carries
//   `md2ui.choice=<name>`. The options sharing a name are one group, and the one written
//   as the main variant (no emphasis wrapper) is the chosen one. It is a target with a
//   checked state, as a linked task box is: md2ui's `checked` is the state a click asks
//   for, so it is true on every option but the chosen one;
// - a count is a ratio slider between a minus and a plus sign (`Quantity: ➖ [2/9] ➕`),
//   stamped by the grouper; its action is a slider's, flagged `count`, so its value is a
//   whole number from 0 to the denominator.
//
// A link inside a sentence, a plain link and an `#anchor` are never options: only a
// button can show which one is chosen.
import type { GroupingNode } from "@md2ui/contracts";
import { CHOICE_HINT } from "../group/choices.ts";

/** What these rules read of md2ui's `Action` (`targets.ts`), named here so the two do not import each other. */
interface Held {
  readonly kind: string;
  readonly checked: boolean | null;
  readonly count: boolean;
  readonly hints: readonly (readonly [string, string])[];
}

/**
 * md2ui: `choice_name`. The group `action` is an option of, or null. Only an action
 * `held` made an option has one: the hint alone is not enough (an inline link or a plain
 * link carries it and is no option).
 */
export function choiceName(action: Held | null): string | null {
  if (action === null || action.kind !== "agent" || action.checked === null) return null;
  return action.hints.find(([key]) => key === CHOICE_HINT)?.[1] || null;
}

/**
 * md2ui: `held`. `action` as the value-holding target `nd` is: an option of a choice with
 * its checked state, a count flagged; anything else unchanged.
 */
export function held<A extends Held>(action: A | null, nd: GroupingNode): A | null {
  if (action === null) return null;
  const payload = nd.drawing_element;
  if (payload?.kind === "slider") return { ...action, count: payload.count === true };
  const name = action.hints.find(([key]) => key === CHOICE_HINT)?.[1];
  if (action.kind !== "agent" || !name || nd.type !== "link") return action;
  return { ...action, checked: (nd.link_variant || "primary") !== "primary" };
}
