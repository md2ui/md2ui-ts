// The tap rules, against md2ui's window (`app.py` `dispatch`): what each kind reports,
// the state it leaves, and what silences it.
import type {
  ActionTarget,
  HitTarget,
  HostState,
  SliderTarget,
  TargetPayload,
} from "@md2ui/contracts";
import { expect, test } from "vitest";
import { linkOpening, sliderValue, stepped, type TapContext, tap } from "../src/actions.ts";

const rect = { x: 0, y: 0, width: 100, height: 20 };
const target = (ordinal: number): ActionTarget => ({
  kind: "agent",
  ordinal,
  nodeId: `n${ordinal}`,
  rect,
  card: false,
});
const slider: SliderTarget = { kind: "slider", ordinal: 3, nodeId: "n3", rect, axis: "horizontal" };

const context = (
  states: ReadonlyMap<number, HostState> = new Map(),
  extra: Partial<TapContext> = {},
): TapContext => ({
  messageId: "c7.12",
  states,
  targets: [],
  table: [],
  disabled: false,
  ...extra,
});

const agent: TargetPayload = { kind: "agent", label: "Yes", slug: "confirm", commit: false };
const box: TargetPayload = { kind: "checkbox", label: "Milk", checked: false, commit: false };
const link: TargetPayload = { kind: "link", label: "Docs", href: "/docs", commit: false };

test("an agent action reports its slug by ordinal and shows pending", () => {
  expect(tap(target(1), agent, context())).toEqual({
    kind: "action",
    action: { kind: "agent", ordinal: 1, messageId: "c7.12", label: "Yes", slug: "confirm" },
    state: { kind: "pending" },
  });
});

test("a pending target reports nothing", () => {
  const states = new Map<number, HostState>([[1, { kind: "pending" }]]);
  expect(tap(target(1), agent, context(states))).toEqual({ kind: "none" });
});

test("a pending card holds every tap inside it; a pending button never falls to its card", () => {
  // md2ui `test_inert_nodes_report_nothing`: the painter gives the button (the innermost
  // target), and the host state decides it waits.
  const card: ActionTarget = {
    ...target(0),
    rect: { x: 0, y: 0, width: 100, height: 100 },
    card: true,
  };
  const button: ActionTarget = { ...target(1), rect: { x: 20, y: 20, width: 10, height: 10 } };
  const outside: ActionTarget = { ...target(2), rect: { x: 120, y: 20, width: 10, height: 10 } };
  const targets: HitTarget[] = [card, button, outside];
  const cardPending = context(new Map([[0, { kind: "pending" }]]), { targets });
  expect(tap(button, agent, cardPending)).toEqual({ kind: "none" });
  expect(tap(button, link, cardPending)).toEqual({ kind: "none" });
  expect(tap(outside, agent, cardPending).kind).toBe("action");
  const buttonPending = context(new Map([[1, { kind: "pending" }]]), { targets });
  expect(tap(button, agent, buttonPending)).toEqual({ kind: "none" });
  expect(tap(card, agent, buttonPending).kind).toBe("action");
});

test("a task box asks for the opposite of what it shows, the host's tick first", () => {
  const first = tap(target(2), box, context());
  expect(first.kind === "action" && first.action).toMatchObject({
    kind: "checkbox",
    checked: true,
  });
  const ticked = new Map<number, HostState>([[2, { kind: "checked", checked: true }]]);
  const second = tap(target(2), box, context(ticked));
  expect(second.kind === "action" && second.action).toMatchObject({ checked: false });
  expect(second.kind === "action" && second.state).toEqual({ kind: "checked", checked: false });
});

test("a disabled view silences agent-bound kinds, not links or anchors", () => {
  const off = context(new Map(), { disabled: true });
  expect(tap(target(1), agent, off).kind).toBe("none");
  expect(tap(target(2), box, off).kind).toBe("none");
  expect(tap(target(0), link, off).kind).toBe("action");
  const anchor: TargetPayload = { kind: "anchor", label: "Top", href: "#top", commit: false };
  expect(tap(target(5), anchor, off)).toEqual({ kind: "anchor", id: "top" });
});

test("a slider reports only a released value, in its authored domain", () => {
  const payload: TargetPayload = {
    kind: "slider",
    label: "Volume",
    slider: { value: 3, max: 10, decimals: 0, count: false },
    commit: false,
  };
  expect(tap(slider, payload, context()).kind).toBe("none");
  const result = tap(slider, payload, context(), 7);
  expect(result.kind === "action" && result.action).toMatchObject({ kind: "slider", value: 7 });
  expect(sliderValue(rect, "horizontal", 25, 5, 10, 0)).toBe(3);
  expect(sliderValue(rect, "horizontal", 33, 5, 100, null)).toBeCloseTo(33);
  expect(sliderValue(rect, "horizontal", 500, 5, 10, 0)).toBe(10);
  expect(sliderValue(rect, "vertical", 0, 5, 100, 0)).toBe(75);
});

test("a commit button carries the other controls the user set, by ordinal", () => {
  const targets: HitTarget[] = [target(1), target(2), slider, target(4)];
  const states = new Map<number, HostState>([
    [3, { kind: "value", value: 7 }],
    [2, { kind: "checked", checked: true }],
    [1, { kind: "pending" }],
  ]);
  const save: TargetPayload = { kind: "agent", label: "Save", slug: "save", commit: true };
  const result = tap(target(4), save, context(states, { targets }));
  expect(result.kind === "action" && result.action).toMatchObject({
    settled: [
      [2, true],
      [3, 7],
    ],
  });
  const plain = tap(target(4), { ...save, commit: false }, context(states, { targets }));
  expect(plain.kind === "action" && "settled" in plain.action).toBe(false);
});

test("a link opens as an <a> would: http(s) and mailto only, other origins in a new tab", () => {
  const page = "https://app.example/chat";
  expect(linkOpening("/docs", page)).toEqual({ url: "https://app.example/docs", newTab: false });
  expect(linkOpening("https://other.example/", page)).toEqual({
    url: "https://other.example/",
    newTab: true,
  });
  expect(linkOpening("mailto:a@b.c", page)).toEqual({ url: "mailto:a@b.c", newTab: false });
  expect(linkOpening("javascript:alert(1)", page)).toBeNull();
  expect(linkOpening("agent:go", page)).toBeNull();
});

// --- choices and counts (md2ui ADR-405, `tests/choices_tests.py`) -----------------------

const option = (label: string, chosen: boolean): TargetPayload => ({
  kind: "agent",
  label,
  slug: "size",
  checked: chosen,
  choice: "size",
  commit: false,
});
// S chosen as written; then a count, a commit button and a box.
const table = [
  option("S", true),
  option("M", false),
  option("L", false),
  {
    kind: "slider",
    label: "Quantity",
    slider: { value: 2, max: 9, decimals: 0, count: true },
    commit: false,
  },
  { kind: "agent", label: "Add", slug: "add", commit: true },
] as const satisfies readonly TargetPayload[];

test("an option tap chooses it and shows its group's others unchosen, never pending", () => {
  // md2ui `show_locally`: a tap on the chosen option still asks for it, never to clear it.
  for (const [ordinal, payload] of [
    [0, table[0]],
    [2, table[2]],
  ] as const) {
    const result = tap(target(ordinal), payload, context(new Map(), { table }));
    expect(result).toEqual({
      kind: "action",
      action: {
        kind: "agent",
        ordinal,
        messageId: "c7.12",
        label: payload.label,
        slug: "size",
        checked: true,
      },
      state: { kind: "checked", checked: true },
      unchosen: [0, 1, 2].filter((o) => o !== ordinal),
    });
  }
});

test("a commit carries each group's shown choice once as true, and a count's value once", () => {
  // md2ui `settled_rows`: the option the radio unchose is not sent `false`; the count's two
  // targets share an ordinal.
  const minus: SliderTarget = { ...slider, step: -1 };
  const plus: SliderTarget = { ...slider, rect: { ...rect, x: 50 }, step: 1 };
  const targets: HitTarget[] = [target(0), target(1), target(2), minus, plus, target(4)];
  const states = new Map<number, HostState>([
    [0, { kind: "checked", checked: false }],
    [1, { kind: "checked", checked: false }],
    [2, { kind: "checked", checked: true }],
    [3, { kind: "value", value: 3 }],
  ]);
  const result = tap(target(4), table[4], context(states, { targets, table }));
  expect(result.kind === "action" && result.action).toMatchObject({
    settled: [
      [2, true],
      [3, 3],
    ],
  });
});

test("a count's button steps the value shown by one, inside 0 to its maximum", () => {
  const minus: SliderTarget = { ...slider, step: -1 };
  const plus: SliderTarget = { ...slider, step: 1 };
  const count = table[3];
  expect(stepped(plus, count, new Map())).toBe(3);
  expect(stepped(minus, count, new Map([[3, { kind: "value", value: 0 }]]))).toBeNull();
  expect(stepped(plus, count, new Map([[3, { kind: "value", value: 9 }]]))).toBeNull();
  expect(stepped(minus, count, new Map([[3, { kind: "value", value: 9 }]]))).toBe(8);
  // A plain slider's target has no step.
  expect(stepped(slider, count, new Map())).toBeNull();
});
