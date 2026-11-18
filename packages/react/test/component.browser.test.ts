// The React binding in a real page (React 19): it mounts <md2ui-view>, passes props on
// as properties, and calls back with the element's actions.
import type { Md2uiAction, Md2uiViewElement } from "@md2ui/dom";
import { act, createElement, createRef } from "react";
import { createRoot } from "react-dom/client";
import { expect, test, vi } from "vitest";
import { Md2uiView } from "../src/index.ts";

const THEME = "## Text Styles\nText\n- Font Name: sans-serif\n- Font size: 15\n";

/** The layer control for `label`; its box is where a tap on the target lands. */
function control(view: HTMLElement, label: string): HTMLElement | undefined {
  return [...(view.shadowRoot?.querySelectorAll<HTMLElement>(".layer > *") ?? [])].find(
    (el) => el.getAttribute("aria-label") === label,
  );
}

test("mounted with Markdown, it reports an action from a tap, and the ref is the element", async () => {
  Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const actions: Md2uiAction[] = [];
  const ref = createRef<Md2uiViewElement>();
  const props = {
    ref,
    themeText: THEME,
    messageId: "m1",
    style: { display: "block", width: "400px", height: "200px" },
    onAction: (event: CustomEvent<Md2uiAction>) => actions.push(event.detail),
  };
  await act(async () =>
    root.render(createElement(Md2uiView, { ...props, markdown: "[Yes](agent:yes)" })),
  );
  const view = ref.current;
  if (view === null) throw new Error("no element");
  expect(view.localName).toBe("md2ui-view");

  await vi.waitFor(() => expect(control(view, "Yes")).toBeDefined(), { timeout: 10_000 });
  const box = control(view, "Yes")?.getBoundingClientRect();
  if (box === undefined) throw new Error("no control");
  const canvas = view.shadowRoot?.querySelector("canvas");
  canvas?.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    }),
  );
  expect(actions).toEqual([
    { kind: "agent", ordinal: 0, messageId: "m1", label: "Yes", slug: "yes" },
  ]);

  // A new prop reaches the element; the unchanged ones are not set again.
  await act(async () =>
    root.render(createElement(Md2uiView, { ...props, markdown: "[No](agent:no)" })),
  );
  await vi.waitFor(() => expect(control(view, "No")).toBeDefined());

  // `streaming` holds the block still arriving until the stream ends.
  const streamed = { ...props, markdown: "[No](agent:no)\n\n[Maybe](agent:maybe)" };
  await act(async () => root.render(createElement(Md2uiView, { ...streamed, streaming: true })));
  expect(view.streaming).toBe(true);
  await act(async () => root.render(createElement(Md2uiView, { ...streamed, streaming: false })));
  await vi.waitFor(() => expect(control(view, "Maybe")).toBeDefined());

  await act(async () => root.unmount());
  host.remove();
});
