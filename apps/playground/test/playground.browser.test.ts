// The playground end to end: the in-memory server streams the welcome through
// @md2ui/wire into a <md2ui-view>, which lays out only closed blocks and keeps its actions
// off until the end frame, a tap goes back over the wire, the reply replaces the
// message in place, and a button the agent answered without changing it is released. The
// agent's question shows in the field and its step in the working line (md2ui ADR-613).
import { expect, test, vi } from "vitest";
import { startPlayground } from "../src/index.ts";

const views = (thread: HTMLElement) =>
  [...thread.querySelectorAll("md2ui-view")] as (HTMLElement & {
    disabled: boolean;
    streaming: boolean;
  })[];

function control(view: HTMLElement, label: string): HTMLElement | undefined {
  return [...(view.shadowRoot?.querySelectorAll<HTMLElement>(".layer > *") ?? [])].find(
    (el) => el.getAttribute("aria-label") === label,
  );
}

test("a streamed message, a tap over the wire, and a reply that replaces it", async () => {
  const thread = document.createElement("div");
  thread.style.width = "600px";
  const field = document.createElement("input");
  field.placeholder = "Type";
  const working = document.createElement("p");
  document.body.append(thread, working, field);
  // Paced so the stream outlasts a poll: its actions are seen off before its end.
  const stop = startPlayground(thread, field, working, 20);
  // Before the first reply the agent works on the welcome, naming its step.
  await vi.waitFor(() => expect(working.textContent).toBe("Read the request"));
  expect(field.placeholder).toBe("Type");

  await vi.waitFor(() => expect(views(thread)).toHaveLength(1));
  const [view] = views(thread);
  if (view === undefined) throw new Error("no view");
  expect(view.disabled).toBe(true);
  expect(view.streaming).toBe(true);
  await vi.waitFor(() => expect(control(view, "Show an order")).toBeDefined(), { timeout: 10_000 });
  await vi.waitFor(() => expect(view.disabled).toBe(false), { timeout: 10_000 });
  expect(view.streaming).toBe(false);
  // Listening, the field shows the agent's question and the working line is gone.
  expect(field.placeholder).toBe("What would you like to order?");
  expect(working.textContent).toBe("");

  const box = control(view, "Show an order")?.getBoundingClientRect();
  if (box === undefined) throw new Error("no control");
  view.shadowRoot?.querySelector("canvas")?.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    }),
  );
  // Working on the tap, the question is gone until the agent listens again.
  await vi.waitFor(() => expect(working.textContent).not.toBe(""));
  expect(field.placeholder).toBe("Type");
  await vi.waitFor(() => expect(control(view, "Milk")).toBeDefined(), { timeout: 10_000 });
  expect(views(thread)).toHaveLength(1);
  // The agent listens again once its reply has ended.
  await vi.waitFor(() => expect(view.disabled).toBe(false), { timeout: 10_000 });

  // The agent answers Louder by changing the volume and leaving the button as it was, so
  // the replacement alone would keep it held: the listening state's `u` releases it.
  // Place order is the last block: the whole message is shown, not its streamed part.
  await vi.waitFor(() => expect(control(view, "Place order")).toBeDefined(), { timeout: 10_000 });
  const louder = control(view, "Louder")?.getBoundingClientRect();
  if (louder === undefined) throw new Error("no Louder");
  view.shadowRoot?.querySelector("canvas")?.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      clientX: louder.left + louder.width / 2,
      clientY: louder.top + louder.height / 2,
    }),
  );
  await vi.waitFor(() =>
    expect(control(view, "Louder")?.getAttribute("aria-disabled")).toBe("true"),
  );
  const volume = () =>
    view.shadowRoot?.querySelector("[role=slider]")?.getAttribute("aria-valuenow");
  await vi.waitFor(() => expect(volume()).toBe("60"), { timeout: 10_000 });
  await vi.waitFor(() => expect(view.disabled).toBe(false), { timeout: 10_000 });
  await vi.waitFor(() => expect(control(view, "Louder")?.getAttribute("aria-disabled")).toBeNull());

  field.value = "hello";
  field.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
  await vi.waitFor(() => expect(views(thread)).toHaveLength(2), { timeout: 10_000 });

  stop();
  expect(field.placeholder).toBe("Type");
  thread.remove();
  working.remove();
  field.remove();
});
