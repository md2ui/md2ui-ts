// Host state across a replacement, against md2ui's `tests/wire_server_tests.py`
// (`test_a_replacement_keeps_the_clicks_it_left_unanswered`,
// `test_a_replacement_that_changes_nothing_clears_every_state`; md2ui 2cbd8489). The
// documents are md2ui's TASKS and the `mark`s it makes of them, as target tables.
import type { HostState, TargetPayload, TargetTable } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { carriedStates, standingStates } from "../src/carried.ts";

const box = (label: string, checked = false): TargetPayload => ({
  kind: "checkbox",
  label,
  checked,
  commit: false,
});
const go: TargetPayload = { kind: "agent", label: "Go", slug: "go", commit: false };
const slider = (label: string): TargetPayload => ({
  kind: "slider",
  label,
  slider: { value: 50, max: 100, decimals: 0, count: false },
  commit: false,
});

/** md2ui's TASKS: three boxes, a button and a slider. */
const TASKS = "- [ ] A\n- [ ] B\n- [ ] C\n\n[Go](agent:go) [50%]\n";
const c1 = { markdown: TASKS, targets: [box("A"), box("B"), box("C"), go, slider("Go 50%")] };
/** The agent's `mark` of A. */
const c2 = {
  markdown: TASKS.replace("[ ] A", "[x] A"),
  targets: [box("A", true), box("B"), box("C"), go, slider("Go 50%")],
};
/**
 * The agent's `mark` disabling Go: its slot reports nothing, and the slider beside it is
 * reworded, not changed.
 */
const c3 = {
  markdown: c2.markdown.replace("[Go](agent:go)", "~~[Go](agent:go)~~"),
  targets: [box("A", true), box("B"), box("C"), undefined, slider("50%")] as TargetTable,
};
/** A different page. */
const d1 = { markdown: "- [ ] A\n- [ ] B\n", targets: [box("A"), box("B")] };

const states = new Map<number, HostState>([
  [0, { kind: "checked", checked: true }],
  [1, { kind: "checked", checked: true }],
  [3, { kind: "pending" }],
  [4, { kind: "value", value: 70 }],
]);

test("a replacement keeps the clicks it left unanswered, and only those", () => {
  const kept = carriedStates(c1, c2, states);
  expect(kept).toEqual(
    new Map<number, HostState>([
      [1, { kind: "checked", checked: true }],
      [3, { kind: "pending" }],
      [4, { kind: "value", value: 70 }],
    ]),
  );
  expect(carriedStates(c2, c3, kept)).toEqual(
    new Map<number, HostState>([
      [1, { kind: "checked", checked: true }],
      [4, { kind: "value", value: 70 }],
    ]),
  );
});

test("a different page, with another number of targets, keeps nothing", () => {
  expect(carriedStates(c3, d1, states).size).toBe(0);
});

test("a replacement that changes nothing clears every state: the agent's no change", () => {
  const declined = { markdown: c1.markdown, targets: [...c1.targets] };
  expect(carriedStates(c1, declined, states).size).toBe(0);
});

test("while a replacement streams, its closed blocks keep the states on targets they show unchanged", () => {
  const head = { markdown: "- [ ] A\n- [ ] B\n", targets: [box("A"), box("B")] };
  expect(standingStates(c1, head, states)).toEqual(
    new Map<number, HostState>([
      [0, { kind: "checked", checked: true }],
      [1, { kind: "checked", checked: true }],
    ]),
  );
});

// md2ui ADR-206 / ADR-608: a feed writes a label slot's words as an ordinary replacement.
// md2ui's `carried_states` compares targets without their labels, so a button the user
// pressed keeps waiting when only its words were fed.
test("a replacement that changes only a button's words keeps its unanswered state", () => {
  const track = (label: string): TargetPayload => ({ ...go, label, slug: "track" });
  const before = {
    markdown: "[Track · Preparing](agent:track?md2ui.feed=track)\n",
    targets: [track("Track · Preparing")],
  };
  const after = {
    markdown: "[Track · On the way](agent:track?md2ui.feed=track)\n",
    targets: [track("Track · On the way")],
  };
  const pending = new Map<number, HostState>([[0, { kind: "pending" }]]);
  expect(carriedStates(before, after, pending)).toEqual(pending);
});
