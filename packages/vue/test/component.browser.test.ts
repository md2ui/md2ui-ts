// The Vue binding in a real page: it mounts <md2ui-view>, passes props on as
// properties, and emits the element's actions.
import type { Md2uiAction } from "@md2ui/dom";
import { expect, test, vi } from "vitest";
import { createApp, h, nextTick, ref } from "vue";
import { Md2uiView } from "../src/index.ts";

const THEME = "## Text Styles\nText\n- Font Name: sans-serif\n- Font size: 15\n";

/** The layer control for `label`; its box is where a tap on the target lands. */
function control(view: HTMLElement, label: string): HTMLElement | undefined {
  return [...(view.shadowRoot?.querySelectorAll<HTMLElement>(".layer > *") ?? [])].find(
    (el) => el.getAttribute("aria-label") === label,
  );
}

test("mounted with Markdown, it emits an action from a tap, and its root is the element", async () => {
  const host = document.createElement("div");
  host.style.cssText = "width: 400px";
  document.body.append(host);
  const actions: Md2uiAction[] = [];
  const markdown = ref("[Yes](agent:yes)");
  const streaming = ref(false);
  const component = ref<InstanceType<typeof Md2uiView> | null>(null);
  const app = createApp({
    render: () =>
      h(Md2uiView, {
        ref: component,
        markdown: markdown.value,
        streaming: streaming.value,
        themeText: THEME,
        messageId: "m1",
        style: "display: block; height: 200px",
        onAction: (event: CustomEvent<Md2uiAction>) => actions.push(event.detail),
      }),
  });
  app.mount(host);
  const view: unknown = component.value?.$el;
  if (!(view instanceof HTMLElement)) throw new Error("no element");
  expect(view.localName).toBe("md2ui-view");

  await vi.waitFor(() => expect(control(view, "Yes")).toBeDefined(), { timeout: 10_000 });
  const box = control(view, "Yes")?.getBoundingClientRect();
  if (box === undefined) throw new Error("no control");
  view.shadowRoot?.querySelector("canvas")?.dispatchEvent(
    new MouseEvent("click", {
      bubbles: true,
      clientX: box.left + box.width / 2,
      clientY: box.top + box.height / 2,
    }),
  );
  expect(actions).toEqual([
    { kind: "agent", ordinal: 0, messageId: "m1", label: "Yes", slug: "yes" },
  ]);

  markdown.value = "[No](agent:no)";
  await nextTick();
  await vi.waitFor(() => expect(control(view, "No")).toBeDefined());

  // `streaming` holds the block still arriving until the stream ends.
  streaming.value = true;
  markdown.value = "[No](agent:no)\n\n[Maybe](agent:maybe)";
  await nextTick();
  expect(Reflect.get(view, "streaming")).toBe(true);
  streaming.value = false;
  await nextTick();
  await vi.waitFor(() => expect(control(view, "Maybe")).toBeDefined());

  app.unmount();
  host.remove();
});
