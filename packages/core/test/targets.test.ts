// Action targets and their ordinals. Expected values were read from md2ui's
// `render_actions.action_targets` over the same hand-built tree.
import type { GroupingNode } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { actionTargets } from "../src/actions/targets.ts";

function node(
  node_id: string,
  type: string,
  content: string,
  extra: Record<string, unknown> = {},
  children: GroupingNode[] = [],
): GroupingNode {
  return { node_id, type, content, children, ...extra } as unknown as GroupingNode;
}

const tree = node("0", "section", "", {}, [
  node("0.0", "link", "[Book](/book)", { link_label: "Book" }),
  node("0.1", "link", "~~[Later](/later)~~", { link_label: "Later", link_disabled: true }),
  node("0.2", "text", "See [docs](/docs) or [ask](agent:ask?topic=a+b&md2ui.commit=1)."),
  node("0.3", "link", "[Go](agent:)", { link_label: "Go" }),
]);

test("targets take ordinals in document order, a link inside a text keyed `<id>#<k>`", () => {
  const targets = actionTargets(tree);
  expect(targets.map((t) => [t.ordinal, t.key, t.node_id, t.inline_link])).toEqual([
    [0, "0.0", "0.0", null],
    [1, "0.1", "0.1", null],
    [2, "0.2#1", "0.2", 1],
    [3, "0.2#2", "0.2", 2],
    [4, "0.3", "0.3", null],
  ]);
  const agent = targets[3]?.action;
  expect([agent?.kind, agent?.label, agent?.action, agent?.params, agent?.commit]).toEqual([
    "agent",
    "ask",
    "ask",
    [["topic", "a b"]],
    true,
  ]);
});

test("a disabled link keeps its slot and reports nothing; so does a bare `agent:`", () => {
  const targets = actionTargets(tree);
  expect([targets[1]?.disabled, targets[1]?.action]).toEqual([true, null]);
  expect([targets[4]?.disabled, targets[4]?.action]).toEqual([false, null]);
});

// md2ui: the click label is the plain words of a button's label.
test("a button's click label drops its emphasis, but not a Text link's or a strike's", () => {
  const labels = actionTargets(
    node("0", "section", "", {}, [
      node("0.0", "link", "[**Bold** _it_](/a)", { link_label: "**Bold** _it_" }),
      node("0.1", "link", "[~~old~~ **new**](/b)", { link_label: "~~old~~ **new**" }),
      node("0.2", "link", "[`**x**`](/c)", { link_label: "**x**", link_variant: "text" }),
    ]),
  ).map((t) => (t.action as { label?: string } | null)?.label);
  expect(labels).toEqual(["Bold it", "~~old~~ new", "**x**"]);
});
