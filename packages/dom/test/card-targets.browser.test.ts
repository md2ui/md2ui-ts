// A tap inside a link card (md2ui `hit_region`, ADR-404): a button the
// card holds reports itself and the rest of the card reports the card; a pending card
// holds every tap inside it, and a pending button never falls through to its card.
import type { Md2uiAction } from "@md2ui/contracts";
import { afterEach, expect, test, vi } from "vitest";
import { defineMd2uiView, type Md2uiViewElement } from "../src/index.ts";
import { THEME } from "./document.ts";

const CARD = `[
Classic Smash ... [Like](agent:like)
Juicy beef, cheddar and pickles on a toasted bun.
](agent:product)
`;

const mounted: Md2uiViewElement[] = [];

afterEach(() => {
  for (const view of mounted.splice(0)) view.remove();
});

function mount(): { view: Md2uiViewElement; actions: Md2uiAction[] } {
  defineMd2uiView({ worker: false });
  const view: Md2uiViewElement = document.createElement("md2ui-view");
  view.style.cssText = "width: 500px; height: 300px";
  view.themeText = THEME;
  view.markdown = CARD;
  const actions: Md2uiAction[] = [];
  view.addEventListener("md2ui-action", (e) => actions.push(e.detail));
  document.body.append(view);
  mounted.push(view);
  return { view, actions };
}

const shadow = (view: HTMLElement): ShadowRoot => {
  if (view.shadowRoot === null) throw new Error("no shadow root");
  return view.shadowRoot;
};

/** The layer's control whose label starts with `label`: placed over its target's region. */
function control(view: HTMLElement, label: string): HTMLElement {
  const el = [...(shadow(view).querySelector(".layer")?.children ?? [])].find(
    (e) => e.matches("button") && e.getAttribute("aria-label")?.startsWith(label),
  );
  if (!(el instanceof HTMLElement)) throw new Error(`no control "${label}"`);
  return el;
}

/** A click on the canvas at `(dx, dy)` from the top-left of `label`'s control. */
function tapAt(view: HTMLElement, label: string, dx: number, dy: number): void {
  const box = control(view, label).getBoundingClientRect();
  shadow(view)
    .querySelector("canvas")
    ?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, clientX: box.left + dx, clientY: box.top + dy }),
    );
}

function tapCentre(view: HTMLElement, label: string): void {
  const box = control(view, label).getBoundingClientRect();
  tapAt(view, label, box.width / 2, box.height / 2);
}

const slugs = (actions: readonly Md2uiAction[]) =>
  actions.map((a) => (a.kind === "agent" ? a.slug : a.kind));

test("a button inside a link card reports itself; the card's body, the card", async () => {
  const { view, actions } = mount();
  await vi.waitFor(() => expect(control(view, "Like")).toBeDefined(), { timeout: 10_000 });
  tapCentre(view, "Like");
  expect(slugs(actions)).toEqual(["like"]);
  tapAt(view, "Classic", 2, 2);
  expect(slugs(actions)).toEqual(["like", "product"]);
});

test("a pending card holds the button inside it; a pending button never falls to its card", async () => {
  const { view, actions } = mount();
  await vi.waitFor(() => expect(control(view, "Like")).toBeDefined(), { timeout: 10_000 });
  tapCentre(view, "Like");
  await vi.waitFor(() => expect(control(view, "Like").getAttribute("aria-disabled")).toBe("true"));
  expect(control(view, "Classic").getAttribute("aria-disabled")).toBeNull();
  tapCentre(view, "Like");
  expect(slugs(actions)).toEqual(["like"]);

  view.release([0, 1]);
  await vi.waitFor(() => expect(control(view, "Like").getAttribute("aria-disabled")).toBeNull());
  tapAt(view, "Classic", 2, 2);
  await vi.waitFor(() => expect(control(view, "Like").getAttribute("aria-disabled")).toBe("true"));
  tapCentre(view, "Like");
  tapAt(view, "Classic", 2, 2);
  expect(slugs(actions)).toEqual(["like", "product"]);
});
