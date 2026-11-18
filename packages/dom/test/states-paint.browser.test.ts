// A host state reaches the accessibility layer and the paint together (ADR-003), however
// long the session takes to paint it: here a session whose `withStates` answers late, as
// a busy Worker's does.
import { expect, test, vi } from "vitest";
import { defineMd2uiView, type Md2uiViewElement } from "../src/index.ts";
import { MARKDOWN, ORDINAL, PENDING_COLOR, THEME } from "./document.ts";

const LATE_MS = 300;

vi.mock(import("../src/session.ts"), async (original) => {
  const actual = await original();
  return {
    ...actual,
    createSession: (...args: Parameters<typeof actual.createSession>) => {
      const session = actual.createSession(...args);
      return {
        ...session,
        withStates: async (states: Parameters<typeof session.withStates>[0]) => {
          await new Promise((resolve) => setTimeout(resolve, LATE_MS));
          return session.withStates(states);
        },
      };
    },
  };
});

const shadow = (view: HTMLElement): ShadowRoot => {
  if (view.shadowRoot === null) throw new Error("no shadow root");
  return view.shadowRoot;
};

function control(view: HTMLElement, label: string): HTMLElement {
  const el = [...(shadow(view).querySelector(".layer")?.children ?? [])].find(
    (e) => e.matches("button") && e.getAttribute("aria-label") === label,
  );
  if (!(el instanceof HTMLElement)) throw new Error(`no control "${label}"`);
  return el;
}

/** The canvas pixel just inside a button's left edge, as `#rrggbbaa`, two frames on. */
async function fillOf(view: HTMLElement, label: string): Promise<string> {
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const canvas = shadow(view).querySelector("canvas");
  const ctx = canvas?.getContext("2d");
  if (canvas == null || ctx == null) throw new Error("no canvas");
  const box = canvas.getBoundingClientRect();
  const target = control(view, label).getBoundingClientRect();
  const ratio = canvas.width / box.width;
  const x = Math.floor((target.left + 4 - box.left) * ratio);
  const y = Math.floor((target.top + target.height / 2 - box.top) * ratio);
  const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(x, y, 1, 1).data;
  return `#${[r, g, b, a].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

test("a button shows pending, and released, in the layer and the paint together", async () => {
  defineMd2uiView({ worker: false });
  const view: Md2uiViewElement = document.createElement("md2ui-view");
  view.style.cssText = "width: 500px; height: 300px";
  view.themeText = THEME;
  view.markdown = MARKDOWN;
  document.body.append(view);
  await vi.waitFor(() => expect(control(view, "Yes")).toBeDefined(), { timeout: 10_000 });
  const box = control(view, "Yes").getBoundingClientRect();
  shadow(view)
    .querySelector("canvas")
    ?.dispatchEvent(
      new MouseEvent("click", {
        bubbles: true,
        clientX: box.left + box.width / 2,
        clientY: box.top + box.height / 2,
      }),
    );
  await vi.waitFor(() => expect(control(view, "Yes").getAttribute("aria-disabled")).toBe("true"));
  expect(await fillOf(view, "Yes")).toBe(PENDING_COLOR);
  view.release([ORDINAL.agent]);
  await vi.waitFor(() => expect(control(view, "Yes").getAttribute("aria-disabled")).toBeNull());
  expect(await fillOf(view, "Yes")).not.toBe(PENDING_COLOR);
  view.remove();
});
