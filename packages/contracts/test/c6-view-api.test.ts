import { expect, test } from "vitest";
import type { ForwardedAction, Md2uiAction, Md2uiViewProperties } from "../src/index.ts";

/** One of every action: the contract is plain data, so it crosses a Worker or a JSON log. */
const actions: readonly Md2uiAction[] = [
  { kind: "link", ordinal: 0, messageId: "c7.12", label: "Docs", href: "/docs" },
  { kind: "agent", ordinal: 1, messageId: "c7.12", label: "Yes", slug: "confirm" },
  {
    kind: "agent",
    ordinal: 2,
    messageId: "c7.12",
    label: "Save",
    slug: "save",
    settled: [
      [3, true],
      [4, 7],
    ],
  },
  { kind: "checkbox", ordinal: 3, messageId: null, label: "Milk", checked: true },
  { kind: "slider", ordinal: 4, messageId: null, label: "Volume", value: 7 },
];

/** Only the kinds the wire carries narrow to `ForwardedAction`. */
const forwarded = (action: Md2uiAction): ForwardedAction | null =>
  action.kind === "link" ? null : action;

test("actions are plain data", () => {
  expect(JSON.parse(JSON.stringify(actions))).toEqual(actions);
});

test("a link is never forwarded; every other kind is", () => {
  expect(actions.map(forwarded).map((a) => a?.kind ?? null)).toEqual([
    null,
    "agent",
    "agent",
    "checkbox",
    "slider",
  ]);
});

test("the view's properties are plain data", () => {
  const props: Md2uiViewProperties = {
    markdown: "# Hello",
    messageId: null,
    themeSrc: "/themes/THEME.md",
    themeText: null,
    assetBase: null,
    fonts: [{ family: "Inter", url: "/fonts/inter.woff2", weight: 400 }],
    disabled: false,
    streaming: false,
    motion: "auto",
  };
  expect(JSON.parse(JSON.stringify(props))).toEqual(props);
});
