// The target table against md2ui: for every fixture document, the table built from the
// final grouping equals the one read off md2ui's exported `action` dicts. md2ui's
// `checked` is the state a click asks for, so the authored state is its opposite.
// Runs only when MD2UI_FIXTURES names the fixtures.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";
import type { GroupingNode, TargetPayload } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { targetTable } from "../src/actions/targets.ts";

const fixtures = env["MD2UI_FIXTURES"] ?? "";

/** md2ui's `Action` as the fixtures hold it (`plain(action)`). */
interface FixtureAction {
  readonly kind: TargetPayload["kind"];
  readonly label: string;
  readonly href: string | null;
  readonly action: string | null;
  readonly checked: boolean | null;
  readonly value: number | null;
  readonly value_max: number | null;
  readonly value_decimals: number | null;
  readonly commit: boolean;
  readonly count: boolean;
  readonly hints: readonly (readonly [string, string])[];
}

function expected(a: FixtureAction): TargetPayload {
  const payload: {
    -readonly [K in keyof TargetPayload]: TargetPayload[K];
  } = { kind: a.kind, label: a.label, commit: a.commit };
  if (a.href !== null) payload.href = a.href;
  if (a.action !== null) payload.slug = a.action;
  if (a.checked !== null) payload.checked = !a.checked;
  // md2ui `choice_name`: an agent action with a checked state and a `choice` hint.
  const choice = a.hints.find(([key]) => key === "choice")?.[1];
  if (a.kind === "agent" && a.checked !== null && choice) payload.choice = choice;
  if (a.value !== null && a.value_max !== null) {
    const { value, value_max: max, value_decimals: decimals, count } = a;
    payload.slider = { value, max, decimals, count };
  }
  return payload;
}

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, "utf8"));

test.skipIf(fixtures === "")("the target table matches md2ui's actions on every document", () => {
  const docs = readdirSync(join(fixtures, "targets"))
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.slice(0, -".json".length))
    .sort();
  expect(docs.length).toBeGreaterThan(0);
  let sliders = 0;
  let boxes = 0;
  let options = 0;
  let counts = 0;
  for (const doc of docs) {
    const targets = readJson(join(fixtures, "targets", `${doc}.json`)) as {
      readonly action: FixtureAction | null;
    }[];
    const root = readJson(join(fixtures, "grouper", "final", `${doc}.json`)) as GroupingNode;
    const want = targets.map((t) => (t.action === null ? undefined : expected(t.action)));
    const table = targetTable(root);
    expect(table, doc).toStrictEqual(want);
    sliders += table.filter((p) => p?.slider !== undefined).length;
    boxes += table.filter((p) => p?.checked !== undefined).length;
    options += table.filter((p) => p?.choice !== undefined).length;
    counts += table.filter((p) => p?.slider?.count === true).length;
  }
  // The corpus exercises both controls, plain and linked, options and counts.
  expect(sliders).toBeGreaterThan(0);
  expect(boxes).toBeGreaterThan(0);
  expect(options).toBeGreaterThan(0);
  expect(counts).toBeGreaterThan(0);
});
