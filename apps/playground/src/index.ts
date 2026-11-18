// @md2ui/playground — the dev page (ADR-004). Never published. A chat thread: each
// message the in-memory server streams through @md2ui/wire is one <md2ui-view>, a reply
// that replaces a message updates its view in place, every action goes back over the
// wire, and a button the agent answered is released in its view. The agent's words for the
// chrome (md2ui ADR-613) show beside the thread: the question it waits on as the field's
// placeholder, the step it is on as a working line. Nothing runs on import;
// index.html calls `startPlayground`.
import { defineMd2uiView, type Md2uiAction, type Md2uiViewElement } from "@md2ui/dom";
import { type AnsweredEvent, createWireClient, type WireClient } from "@md2ui/wire";
import { keepComposing } from "./composing.ts";
import { SCRIPT, THEME } from "./script.ts";
import { createMemoryServer } from "./server.ts";

/** Sends an agent-bound action; false when the protocol refuses it now. */
function forward(client: WireClient, action: Md2uiAction): boolean {
  if (action.kind === "link" || action.messageId === null) return true;
  const result = client.sendEvent({
    message: action.messageId,
    target: action.ordinal,
    kind: action.kind,
    ...(action.kind === "agent" && { slug: action.slug }),
    ...("checked" in action && action.checked !== undefined && { checked: action.checked }),
    ...("value" in action && action.value !== undefined && { value: action.value }),
    ...(action.kind === "agent" && action.settled !== undefined && { settled: action.settled }),
  });
  return result.sent;
}

/**
 * Runs the playground in `thread` (the message views), `field` (the user's own prompt
 * input) and `working` (the line naming the agent's step). Returns what stops it.
 * `delayMs` paces the stream.
 */
export function startPlayground(
  thread: HTMLElement,
  field: HTMLInputElement,
  working: HTMLElement,
  delayMs = 30,
): () => void {
  defineMd2uiView();
  const ownPlaceholder = field.placeholder;
  const views = new Map<string, Md2uiViewElement>();
  /** Messages whose end has not arrived: their actions stay off (ADR-003). */
  const streaming = new Set<string>();

  const refresh = (): void => {
    for (const [id, view] of views) view.disabled = streaming.has(id) || client.blocked;
  };

  const viewFor = (id: string, replaces: string | undefined): Md2uiViewElement => {
    const old = replaces === undefined ? undefined : views.get(replaces);
    if (old !== undefined && replaces !== undefined) {
      views.delete(replaces);
      views.set(id, old);
      return old;
    }
    const view = views.get(id) ?? document.createElement("md2ui-view");
    if (!views.has(id)) {
      view.themeText = THEME;
      // What a view could not load shows in a fallback; the console says what fell back.
      view.addEventListener("md2ui-error", (event) => console.warn("md2ui-error", event.detail));
      view.addEventListener("md2ui-action", (event) => {
        if (!forward(client, event.detail)) event.preventDefault();
        refresh();
      });
      views.set(id, view);
      thread.append(view);
    }
    return view;
  };

  /** Releases each answered button in the view of the message it now stands on. */
  const release = (answered: readonly AnsweredEvent[]): void => {
    const byMessage = Map.groupBy(answered, (event) => event.message);
    for (const [message, events] of byMessage) {
      views.get(message)?.release(events.map((event) => event.target));
    }
  };

  const client = createWireClient({
    transport: { send: (text) => server.receive(text) },
    onEvent: (event) => {
      if (event.type === "message") {
        const view = viewFor(event.id, event.replaces);
        if (event.complete) streaming.delete(event.id);
        else streaming.add(event.id);
        // Until its end, only the message's closed blocks are laid out.
        view.streaming = !event.complete;
        // A replacement, and the rest of a message streaming in, moves node by node; a new
        // message in a view that showed another is a new page.
        view.motion = event.replaces === undefined && view.messageId !== event.id ? "page" : "edit";
        view.markdown = event.markdown;
        view.messageId = event.id;
      } else if (event.type === "state") {
        // Each state's words hold until the next state, which replaces or clears them.
        field.placeholder = (event.state === "l" && event.placeholder) || ownPlaceholder;
        working.textContent = event.state === "w" ? (event.note ?? "") : "";
        if (event.answered !== undefined) release(event.answered);
      }
      refresh();
    },
  });
  const server = createMemoryServer(
    SCRIPT,
    (text) => {
      void client.receive(text);
    },
    { delayMs },
  );

  const onKey = (event: KeyboardEvent): void => {
    if (event.key !== "Enter" || field.value.trim() === "") return;
    if (client.sendPrompt(field.value).sent) field.value = "";
  };
  // Each change the field takes says the user is typing; the client throttles it.
  const onInput = (): void => client.sendTyping();
  field.addEventListener("keydown", onKey);
  field.addEventListener("input", onInput);
  // A draft left unsent keeps saying so through a pause.
  const stopComposing = keepComposing(field, client);
  client.hello();

  return () => {
    stopComposing();
    field.removeEventListener("keydown", onKey);
    field.removeEventListener("input", onInput);
    for (const view of views.values()) view.remove();
    views.clear();
    field.placeholder = ownPlaceholder;
    working.textContent = "";
  };
}
