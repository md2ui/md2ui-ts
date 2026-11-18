// A click the backend answers is released in any state (md2ui `protocol/README.md`
// *Lifecycle* 5, ADR-612; md2ui's `test_a_handled_click_is_released_in_any_state`): a host
// built as the playground is (@md2ui/wire into an <md2ui-view>, `answered` → `release`)
// frees the held button on `u` under `w` and `i`, and the frame still sets the state.
import { defineMd2uiView, type Md2uiViewElement } from "@md2ui/dom";
import { createWireClient, type WireClientEvent } from "@md2ui/wire";
import { expect, test, vi } from "vitest";
import { THEME } from "../src/script.ts";

const MARKDOWN = "# Order\n\n[Yes](agent:yes)\n";

function control(view: HTMLElement, label: string): HTMLElement | undefined {
  return [...(view.shadowRoot?.querySelectorAll<HTMLElement>(".layer > *") ?? [])].find(
    (el) => el.getAttribute("aria-label") === label,
  );
}

const held = (view: HTMLElement): string | null | undefined =>
  control(view, "Yes")?.getAttribute("aria-disabled");

async function hash16(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).subarray(0, 8), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

for (const state of ["w", "i"] as const) {
  test(`a handled click's u under ${state} releases the button and sets the state`, async () => {
    defineMd2uiView();
    const view = document.createElement("md2ui-view") as Md2uiViewElement;
    view.style.cssText = "width: 500px; height: 300px";
    view.themeText = THEME;
    const sent: string[] = [];
    const states: WireClientEvent[] = [];
    const client = createWireClient({
      transport: { send: (text) => sent.push(text) },
      onEvent: (event) => {
        if (event.type === "message" && event.complete) {
          view.markdown = event.markdown;
          view.messageId = event.id;
        } else if (event.type === "state") {
          states.push(event);
          if (event.answered !== undefined) view.release(event.answered.map((e) => e.target));
        }
      },
    });
    view.addEventListener("md2ui-action", (event) => {
      const action = event.detail;
      if (action.kind !== "agent" || action.messageId === null) return;
      const result = client.sendEvent({
        message: action.messageId,
        target: action.ordinal,
        kind: "agent",
        slug: action.slug,
      });
      if (!result.sent) event.preventDefault();
    });
    document.body.append(view);
    client.hello();
    const feed = (frame: object) => client.receive(JSON.stringify(frame));
    await feed({ t: "m", m: "c1", md: MARKDOWN });
    await feed({ t: "z", m: "c1", h: await hash16(MARKDOWN) });
    await feed({ t: "s", s: "l" });

    await vi.waitFor(() => expect(control(view, "Yes")).toBeDefined(), { timeout: 10_000 });
    const box = control(view, "Yes")?.getBoundingClientRect();
    if (box === undefined) throw new Error("no Yes");
    view.shadowRoot?.querySelector("canvas")?.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      }),
    );
    await vi.waitFor(() => expect(held(view)).toBe("true"));
    const event = sent.map((text) => JSON.parse(text)).find((f) => f.t === "e");
    expect(event?.a).toBe("yes");

    // The backend changed its data and says so without the agent: the state it is in, and
    // the click it answered.
    await feed({ t: "s", s: state, u: [event.q] });
    await vi.waitFor(() => expect(held(view)).toBeNull());
    expect(client.state).toBe(state);
    expect(states.at(-1)).toMatchObject({ type: "state", state });
    view.remove();
  });
}

const tap = (view: HTMLElement, label: string): void => {
  const box = control(view, label)?.getBoundingClientRect();
  if (box === undefined) throw new Error(`no ${label}`);
  view.shadowRoot?.querySelector("canvas")?.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    }),
  );
};

// md2ui ADR-614 (`protocol/README.md` *Lifecycle* 5): a handler may answer a tap
// with a new page of its includes, a new message, and then name the tap in `u`. That `u`
// names a button on a page no longer shown and changes nothing there: a button held on the
// new page at the same ordinal stays held. The host is built as the playground's is, one
// view per message, each answered button released in the view of its message.
test("a backend's new page keeps its held button when u names the page left", async () => {
  defineMd2uiView();
  const views = new Map<string, Md2uiViewElement>();
  const sent: string[] = [];
  const client = createWireClient({
    transport: { send: (text) => sent.push(text) },
    onEvent: (event) => {
      if (event.type === "message" && event.complete) {
        const view = document.createElement("md2ui-view") as Md2uiViewElement;
        view.style.cssText = "display: block; width: 500px; height: 200px";
        view.themeText = THEME;
        view.addEventListener("md2ui-action", (e) => {
          const action = e.detail;
          if (action.kind !== "agent" || action.messageId === null) return;
          const result = client.sendEvent({
            message: action.messageId,
            target: action.ordinal,
            kind: "agent",
            slug: action.slug,
          });
          if (!result.sent) e.preventDefault();
        });
        view.markdown = event.markdown;
        view.messageId = event.id;
        views.set(event.id, view);
        document.body.append(view);
      } else if (event.type === "state" && event.answered !== undefined) {
        for (const [message, events] of Map.groupBy(event.answered, (e) => e.message)) {
          views.get(message)?.release(events.map((e) => e.target));
        }
      }
    },
  });
  client.hello();
  const feed = (frame: object) => client.receive(JSON.stringify(frame));
  const page = async (id: string, markdown: string) => {
    await feed({ t: "m", m: id, md: markdown });
    await feed({ t: "z", m: id, h: await hash16(markdown) });
  };
  const heldOn = (id: string, label: string) =>
    control(views.get(id) as HTMLElement, label)?.getAttribute("aria-disabled");

  await page("c1", MARKDOWN);
  await feed({ t: "s", s: "l" });
  await vi.waitFor(() => expect(control(views.get("c1") as HTMLElement, "Yes")).toBeDefined(), {
    timeout: 10_000,
  });
  tap(views.get("c1") as HTMLElement, "Yes");
  await vi.waitFor(() => expect(heldOn("c1", "Yes")).toBe("true"));
  const first = sent.map((text) => JSON.parse(text)).find((f) => f.t === "e");

  // The backend shows a page of its includes: a new message, its button at the same ordinal.
  await page("c2", "# Sides\n\n[Fries](agent:fries)\n");
  await vi.waitFor(() => expect(control(views.get("c2") as HTMLElement, "Fries")).toBeDefined(), {
    timeout: 10_000,
  });
  tap(views.get("c2") as HTMLElement, "Fries");
  await vi.waitFor(() => expect(heldOn("c2", "Fries")).toBe("true"));

  await feed({ t: "s", s: "l", u: [first.q] });
  await vi.waitFor(() => expect(heldOn("c1", "Yes")).toBeNull());
  expect(heldOn("c2", "Fries")).toBe("true");
  for (const view of views.values()) view.remove();
});
