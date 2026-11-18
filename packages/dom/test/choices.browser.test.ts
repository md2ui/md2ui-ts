// Choices and counts in the view (md2ui ADR-405; md2ui `app.py` `dispatch`, `stepped`,
// `render_choices.show_locally`, `settled_rows`): an option tap chooses it over its group
// at once, a count's ➖ and ➕ each step it, and a commit press carries both. The count's
// accessible control is one slider over the whole count, named by its label.
import type { Md2uiAction } from "@md2ui/contracts";
import { afterEach, expect, test, vi } from "vitest";
import { page, userEvent } from "vitest/browser";
import { defineMd2uiView, type Md2uiViewElement } from "../src/index.ts";
import { THEME } from "./document.ts";

const FORM = `_Size_
[S](agent:size?v=s&md2ui.choice=size) | *[M](agent:size?v=m&md2ui.choice=size)* | *[L](agent:size?v=l&md2ui.choice=size)*

Quantity: ➖ [1/9] ➕

[Add to cart](agent:add?id=7&md2ui.commit=1)
`;

const mounted: Md2uiViewElement[] = [];

afterEach(() => {
  for (const view of mounted.splice(0)) view.remove();
});

function mount(): { view: Md2uiViewElement; actions: Md2uiAction[] } {
  defineMd2uiView({ worker: false });
  const view: Md2uiViewElement = document.createElement("md2ui-view");
  view.style.cssText = "width: 500px; height: 400px";
  view.themeText = THEME;
  view.markdown = FORM;
  const actions: Md2uiAction[] = [];
  view.addEventListener("md2ui-action", (e) => actions.push(e.detail));
  document.body.append(view);
  mounted.push(view);
  return { view, actions };
}

function control(view: HTMLElement, label: string): HTMLElement {
  const el = [...(view.shadowRoot?.querySelector(".layer")?.children ?? [])].find(
    (e) => e.getAttribute("aria-label") === label,
  );
  if (!(el instanceof HTMLElement)) throw new Error(`no control "${label}"`);
  return el;
}

/**
 * A real mouse click (Playwright, through `userEvent`) on the canvas at `dx` px in from the
 * left (or, negative, the right) of a control, at its middle: whatever is on top there
 * takes the press, as on a device.
 */
async function press(view: HTMLElement, label: string, dx?: number): Promise<void> {
  const canvas = view.shadowRoot?.querySelector("canvas");
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error("no canvas");
  const box = control(view, label).getBoundingClientRect();
  const at = canvas.getBoundingClientRect();
  const x = dx === undefined ? box.width / 2 : dx < 0 ? box.width + dx : dx;
  // `force`: a canvas repainted on every state never reads as "stable"; the click is
  // still Playwright's mouse at that point.
  await userEvent.click(canvas, {
    force: true,
    position: { x: box.left - at.left + x, y: box.top - at.top + box.height / 2 },
  });
}

/**
 * The count's digits as painted: the pixels between its two buttons in a screenshot of
 * the view, once it rests (two frames apart, the same pixels).
 */
async function digits(view: HTMLElement): Promise<ImageData> {
  const shot = async () => {
    for (let i = 0; i < 2; i++) await new Promise(requestAnimationFrame);
    return page.screenshot({ element: view, save: false });
  };
  let last = await shot();
  for (let now = await shot(); now !== last; now = await shot()) last = now;
  const image = await createImageBitmap(
    await (await fetch(`data:image/png;base64,${last}`)).blob(),
  );
  const scale = image.width / view.getBoundingClientRect().width;
  const box = control(view, "Quantity").getBoundingClientRect();
  const at = view.getBoundingClientRect();
  // The slot is the middle third of the count: the buttons are its ends.
  const x = (box.left - at.left + box.width / 3) * scale;
  const y = (box.top - at.top) * scale;
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2d context");
  context.drawImage(image, 0, 0);
  return context.getImageData(x, y, (box.width / 3) * scale, box.height * scale);
}

/** How many pixels of `a` and `b` differ clearly (some channel by more than 96). */
function changed(a: ImageData, b: ImageData): number {
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    const d = [0, 1, 2].some((k) => Math.abs((a.data[i + k] ?? 0) - (b.data[i + k] ?? 0)) > 96);
    if (d) n++;
  }
  return n;
}

const checked = (view: HTMLElement) =>
  ["S", "M", "L"].map((l) => control(view, l).getAttribute("aria-checked"));

test("an option chooses over its group, a count steps, and a commit carries both", async () => {
  const { view, actions } = mount();
  await vi.waitFor(() => expect(control(view, "Quantity")).toBeDefined(), { timeout: 10_000 });
  expect(control(view, "M").getAttribute("role")).toBe("radio");
  expect(checked(view)).toEqual(["true", "false", "false"]);
  const quantity = control(view, "Quantity");
  expect(quantity.getAttribute("role")).toBe("slider");
  expect(quantity.getAttribute("aria-valuenow")).toBe("1");

  await press(view, "M");
  expect(actions.at(-1)).toMatchObject({ kind: "agent", slug: "size", ordinal: 1, checked: true });
  await vi.waitFor(() => expect(checked(view)).toEqual(["false", "true", "false"]));
  const one = await digits(view);

  // ➕ is at the count's right end, ➖ at its left; the digits between step nothing.
  await press(view, "Quantity", -6);
  expect(actions.at(-1)).toMatchObject({ kind: "slider", ordinal: 3, value: 2 });
  await vi.waitFor(() => expect(control(view, "Quantity").getAttribute("aria-valuenow")).toBe("2"));
  // The digits redrawn: "2" where "1" was. Anti-aliasing aside, a stepped-back count
  // paints its old digits again.
  const two = await digits(view);
  expect(changed(one, two)).toBeGreaterThan(20);
  const before = actions.length;
  await press(view, "Quantity");
  expect(actions.length).toBe(before);
  await press(view, "Quantity", 6);
  expect(actions.at(-1)).toMatchObject({ kind: "slider", ordinal: 3, value: 1 });
  expect(changed(one, await digits(view))).toBeLessThan(5);
  await press(view, "Quantity", -6);
  expect(changed(two, await digits(view))).toBeLessThan(5);

  await press(view, "Add to cart");
  expect(actions.at(-1)).toMatchObject({
    kind: "agent",
    slug: "add",
    settled: [
      [1, true],
      [3, 2],
    ],
  });
  // Six screenshots of the view: generous under a loaded machine.
}, 60_000);
