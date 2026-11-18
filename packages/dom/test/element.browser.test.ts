// `<md2ui-view>` in a real page, on the real core, text layer and painter: painting, taps
// to actions, the link default, `disabled`, `streaming`, host state, sliders, anchors,
// copy, the accessibility layer, wheel, both sizing modes, width changes, two views,
// attributes, properties set before registration, and load errors. Here the pipeline runs
// in the element's own Worker, the default; the same suite runs it on the main thread
// (element-main.browser.test.ts) and in a host's Worker (element-worker.browser.test.ts).
import type { Md2uiAction, Md2uiLoadError } from "@md2ui/contracts";
import { parseTheme } from "@md2ui/core";
import { afterEach, beforeAll, expect, onTestFinished, test, vi } from "vitest";
import { userEvent } from "vitest/browser";
import { defineMd2uiView, type Md2uiViewElement } from "../src/index.ts";
import {
  CODE,
  FILLER_PARAGRAPHS,
  LINK_COLOR,
  MARKDOWN,
  ORDINAL,
  PADDING,
  PENDING_COLOR,
  THEME,
} from "./document.ts";
import { WARM_TIMEOUT_MS, warmPipelineWorker } from "./warm-worker.ts";

interface Mounted {
  readonly view: Md2uiViewElement;
  readonly actions: Md2uiAction[];
}

const mounted: Md2uiViewElement[] = [];

beforeAll(warmPipelineWorker, WARM_TIMEOUT_MS);

afterEach(() => {
  for (const view of mounted.splice(0)) view.remove();
  vi.restoreAllMocks();
});

function mount(
  style = "width: 500px; height: 300px",
  parent: HTMLElement = document.body,
): Mounted {
  defineMd2uiView();
  const view = document.createElement("md2ui-view");
  view.style.cssText = style;
  view.themeText = THEME;
  view.markdown = MARKDOWN;
  view.messageId = "c7.12";
  const actions: Md2uiAction[] = [];
  view.addEventListener("md2ui-action", (e) => actions.push(e.detail));
  parent.append(view);
  mounted.push(view);
  return { view, actions };
}

const shadow = (view: HTMLElement): ShadowRoot => {
  if (view.shadowRoot === null) throw new Error("no shadow root");
  return view.shadowRoot;
};
const canvasOf = (view: HTMLElement): HTMLCanvasElement => {
  const canvas = shadow(view).querySelector("canvas");
  if (canvas === null) throw new Error("no canvas");
  return canvas;
};
/** The canvas the page background is painted on, fixed to the visible part. */
const backOf = (view: HTMLElement): HTMLCanvasElement => {
  const canvas = shadow(view).querySelector<HTMLCanvasElement>("canvas.back");
  if (canvas === null) throw new Error("no background canvas");
  return canvas;
};
const contentOf = (view: HTMLElement): HTMLElement => {
  const content = shadow(view).querySelector<HTMLElement>(".content");
  if (content === null) throw new Error("no content");
  return content;
};
const layerOf = (view: HTMLElement): HTMLElement[] =>
  [...(shadow(view).querySelector(".layer")?.children ?? [])] as HTMLElement[];

/** A target's control in the layer: placed over its region, so its box is the tap area. */
function control(view: HTMLElement, label: string): HTMLElement {
  const el = layerOf(view).find(
    (e) => e.matches("a, button, [role=slider]") && e.getAttribute("aria-label") === label,
  );
  if (el === undefined) throw new Error(`no control "${label}"`);
  return el;
}

async function ready(view: HTMLElement): Promise<void> {
  await vi.waitFor(
    () => {
      expect(layerOf(view).length).toBeGreaterThan(0);
      // An unpainted canvas is 300 × 150; the view sizes it by style when it paints.
      expect(canvasOf(view).style.width).not.toBe("");
    },
    { timeout: 10_000 },
  );
}

function centre(view: HTMLElement, label: string): { clientX: number; clientY: number } {
  const box = control(view, label).getBoundingClientRect();
  return { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2 };
}

function tapOn(view: HTMLElement, label: string): void {
  canvasOf(view).dispatchEvent(new MouseEvent("click", { bubbles: true, ...centre(view, label) }));
}

/** The canvas pixel just inside a button's left edge (its padding), as `#rrggbbaa`. */
async function fillOf(view: HTMLElement, label: string): Promise<string> {
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const canvas = canvasOf(view);
  const box = canvas.getBoundingClientRect();
  const target = control(view, label).getBoundingClientRect();
  const ratio = canvas.width / box.width;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("no 2d context");
  const x = Math.floor((target.left + 4 - box.left) * ratio);
  const y = Math.floor((target.top + target.height / 2 - box.top) * ratio);
  const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(x, y, 1, 1).data;
  return `#${[r, g, b, a].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// First, while nothing is registered: a framework creates the node and sets its
// properties before the host calls `defineMd2uiView()`.
test("properties set before registration are taken over when the element upgrades", async () => {
  const early = document.createElement("md2ui-view") as Md2uiViewElement;
  expect(customElements.get("md2ui-view")).toBeUndefined();
  early.style.cssText = "width: 500px; height: 300px";
  early.themeText = THEME;
  early.markdown = MARKDOWN;
  document.body.append(early);
  mounted.push(early);
  defineMd2uiView();
  defineMd2uiView();
  expect(Object.hasOwn(early, "markdown")).toBe(false);
  expect(early.markdown).toBe(MARKDOWN);
  await ready(early);
  expect(control(early, "Yes")).toBeDefined();
});

test("in plain HTML: mounted, given Markdown, it reports an action from a tap", async () => {
  const { view, actions } = mount();
  await ready(view);
  tapOn(view, "Yes");
  expect(actions).toEqual([
    { kind: "agent", ordinal: ORDINAL.agent, messageId: "c7.12", label: "Yes", slug: "confirm" },
  ]);
});

test("it lays out at its width, paints the list and sizes the canvas by the pixel ratio", async () => {
  const { view } = mount();
  await ready(view);
  expect(contentOf(view).style.width).toBe(`${view.clientWidth}px`);
  const canvas = canvasOf(view);
  expect(canvas.width).toBe(Math.round(view.clientWidth * devicePixelRatio));
  expect(await fillOf(view, "Yes")).toBe(LINK_COLOR);
});

test("a tap shows the action pending until the next document, which relabels the message", async () => {
  const { view, actions } = mount();
  await ready(view);
  tapOn(view, "Yes");
  // The pending paint comes back from the session: a Worker answers a few frames later.
  await vi.waitFor(async () => expect(await fillOf(view, "Yes")).toBe(PENDING_COLOR));
  expect(control(view, "Yes").getAttribute("aria-disabled")).toBe("true");
  tapOn(view, "Yes");
  expect(actions).toHaveLength(1);

  view.markdown = MARKDOWN;
  view.messageId = "c7.13";
  await vi.waitFor(() => expect(control(view, "Yes").getAttribute("aria-disabled")).toBeNull());
  tapOn(view, "Yes");
  expect(actions.at(-1)).toMatchObject({ messageId: "c7.13" });
});

test("a pending link inside a sentence mutes only itself; the sentence's other links stay live", async () => {
  const { view, actions } = mount();
  await ready(view);
  view.markdown = "Pick [one](agent:one) or [two](agent:two) today.\n";
  await vi.waitFor(() => expect(control(view, "two")).toBeDefined());
  // The canvas once the new document has moved into place (the view's tween).
  const painted = async () => {
    await new Promise((resolve) => setTimeout(resolve, parseTheme(THEME).motion.duration));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    return canvasOf(view).toDataURL();
  };
  const before = await painted();
  tapOn(view, "one");
  tapOn(view, "one");
  tapOn(view, "two");
  expect(actions.map((a) => (a.kind === "agent" ? a.slug : a.kind))).toEqual(["one", "two"]);
  // The layer tells the state once the paint shows it.
  await vi.waitFor(() => expect(control(view, "one").getAttribute("aria-disabled")).toBe("true"));
  // md2ui draws a link inside prose with no pending paint: the sentence is unchanged.
  expect(await painted()).toBe(before);
});

test("while streaming, the open block is held until it closes, and the rest once the stream ends", async () => {
  const { view } = mount();
  await ready(view);
  const texts = () => layerOf(view).map((e) => e.textContent);
  const settled = async () => {
    for (let i = 0; i < 4; i++) await new Promise(requestAnimationFrame);
  };
  view.streaming = true;
  view.markdown = "# Streamed\n\nThe first paragraph is done.\n\nThe second is still arr";
  await vi.waitFor(() => expect(texts()).toContain("The first paragraph is done."));
  expect(texts().some((t) => t?.startsWith("The second"))).toBe(false);
  // A delta that closes no block changes nothing shown.
  view.markdown += "iving.";
  await settled();
  expect(texts().some((t) => t?.startsWith("The second"))).toBe(false);
  // A blank line closes it.
  view.markdown += "\n\nA third, unfinished";
  await vi.waitFor(() => expect(texts()).toContain("The second is still arriving."));
  expect(texts().some((t) => t?.startsWith("A third"))).toBe(false);
  // The end of the stream lays out the whole message.
  view.streaming = false;
  await vi.waitFor(() => expect(texts()).toContain("A third, unfinished"));
});

test("a cancelled action leaves no state", async () => {
  const { view, actions } = mount();
  await ready(view);
  view.addEventListener("md2ui-action", (e) => e.preventDefault());
  tapOn(view, "Yes");
  tapOn(view, "Yes");
  expect(actions).toHaveLength(2);
  expect(await fillOf(view, "Yes")).toBe(LINK_COLOR);
});

test("a link opens in a new tab unless the host cancels it", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const { view, actions } = mount();
  await ready(view);
  tapOn(view, "Docs");
  expect(open).toHaveBeenCalledWith("https://other.example/docs", "_blank", "noopener");
  expect(actions.at(-1)).toMatchObject({ kind: "link", href: "https://other.example/docs" });
  view.addEventListener("md2ui-action", (e) => e.preventDefault());
  tapOn(view, "Docs");
  expect(open).toHaveBeenCalledTimes(1);
  expect(actions).toHaveLength(2);
});

test("a disabled view silences agent-bound actions; links still report", async () => {
  vi.spyOn(window, "open").mockReturnValue(null);
  const { view, actions } = mount();
  await ready(view);
  view.disabled = true;
  tapOn(view, "Yes");
  tapOn(view, "Milk");
  tapOn(view, "Docs");
  expect(actions.map((a) => a.kind)).toEqual(["link"]);
  expect(control(view, "Milk").getAttribute("aria-disabled")).toBe("true");
});

test("a task box ticks optimistically, and a second tap asks to undo what it shows", async () => {
  const { view, actions } = mount();
  await ready(view);
  tapOn(view, "Milk");
  await vi.waitFor(() => expect(control(view, "Milk").getAttribute("aria-checked")).toBe("true"));
  tapOn(view, "Milk");
  expect(actions.map((a) => (a.kind === "checkbox" ? a.checked : null))).toEqual([true, false]);
});

test("a replacement keeps the user's tick and value where it left the target as it was", async () => {
  // md2ui 2cbd8489: the agent's `mark` of another target lands after the user ticked.
  const { view } = mount();
  await ready(view);
  tapOn(view, "Milk");
  const volume = control(view, "Volume");
  volume.focus();
  volume.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  volume.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await vi.waitFor(() => expect(control(view, "Milk").getAttribute("aria-checked")).toBe("true"));
  // The mark disables Yes and arrives as the wire delivers it: its head, then its end.
  const marked = MARKDOWN.replace("[Yes](agent:confirm)", "~~[Yes](agent:confirm)~~");
  view.streaming = true;
  view.markdown = marked;
  view.messageId = "c7.13";
  const theEnd = () => layerOf(view).some((e) => e.textContent === "The end.");
  // Until its end, the message's last block is held back, and the tick stays shown.
  await vi.waitFor(() => expect(() => control(view, "Yes")).toThrow());
  expect(theEnd()).toBe(false);
  expect(control(view, "Milk").getAttribute("aria-checked")).toBe("true");
  view.streaming = false;
  await vi.waitFor(() => expect(theEnd()).toBe(true));
  expect(control(view, "Milk").getAttribute("aria-checked")).toBe("true");
  expect(control(view, "Volume").getAttribute("aria-valuenow")).toBe("51");
  // The agent's "no change": the same Markdown again clears every state.
  view.markdown = marked;
  view.messageId = "c7.14";
  await vi.waitFor(() => expect(control(view, "Milk").getAttribute("aria-checked")).toBe("false"));
  expect(control(view, "Volume").getAttribute("aria-valuenow")).toBe("50");
});

// The user may tap the streamed part of a message: between two deltas, or after its end
// has arrived but before the view has laid out the whole of it (0s). What the tap set is
// the user's, on the same targets, and stays.
test("a tap on a streamed message keeps its state through the next delta and the message's end", async () => {
  const { view, actions } = mount();
  view.streaming = true;
  view.markdown = MARKDOWN.replace("The end.\n", "The e");
  const has = (text: string) => layerOf(view).some((e) => e.textContent === text);
  await vi.waitFor(() => expect(control(view, "Milk")).toBeDefined(), { timeout: 10_000 });
  await ready(view);
  tapOn(view, "Milk");
  await vi.waitFor(() => expect(control(view, "Milk").getAttribute("aria-checked")).toBe("true"), {
    timeout: 10_000,
  });
  view.markdown += "nd.\n\nMore to come";
  await vi.waitFor(() => expect(has("The end.")).toBe(true), { timeout: 10_000 });
  expect(control(view, "Milk").getAttribute("aria-checked")).toBe("true");
  // The end arrives; the tap lands before the whole message is laid out.
  view.streaming = false;
  tapOn(view, "Yes");
  await vi.waitFor(() => expect(has("More to come")).toBe(true), { timeout: 10_000 });
  await new Promise(requestAnimationFrame);
  expect(control(view, "Yes").getAttribute("aria-disabled")).toBe("true");
  expect(control(view, "Milk").getAttribute("aria-checked")).toBe("true");
  expect(actions.map((a) => a.kind)).toEqual(["checkbox", "agent"]);
});

// md2ui `released` (md2ui ADR-601): the agent answered by listening again.
test("release frees a pending button and leaves a tick and a set value as they are", async () => {
  const { view, actions } = mount();
  await ready(view);
  tapOn(view, "Yes");
  tapOn(view, "Milk");
  const volume = control(view, "Volume");
  volume.focus();
  volume.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  volume.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await vi.waitFor(() => expect(control(view, "Yes").getAttribute("aria-disabled")).toBe("true"));
  await vi.waitFor(() => expect(control(view, "Milk").getAttribute("aria-checked")).toBe("true"));
  view.release([ORDINAL.agent, ORDINAL.checkbox, ORDINAL.slider, 99]);
  await vi.waitFor(() => expect(control(view, "Yes").getAttribute("aria-disabled")).toBeNull());
  expect(await fillOf(view, "Yes")).not.toBe(PENDING_COLOR);
  expect(control(view, "Milk").getAttribute("aria-checked")).toBe("true");
  expect(control(view, "Volume").getAttribute("aria-valuenow")).toBe("51");
  tapOn(view, "Yes");
  expect(actions.filter((a) => a.kind === "agent")).toHaveLength(2);
});

test("a button released while its replacement streams stays released at the end", async () => {
  const { view } = mount();
  await ready(view);
  tapOn(view, "Yes");
  await vi.waitFor(() => expect(control(view, "Yes").getAttribute("aria-disabled")).toBe("true"));
  // The agent's patch changes Save, not Yes, and arrives as the wire delivers it.
  view.streaming = true;
  view.markdown = MARKDOWN.replace(
    "[Save](agent:save?md2ui.commit=1)",
    "~~[Save](agent:save?md2ui.commit=1)~~",
  );
  view.messageId = "c7.13";
  await vi.waitFor(() => expect(() => control(view, "Save")).toThrow());
  expect(control(view, "Yes").getAttribute("aria-disabled")).toBe("true");
  view.release([ORDINAL.agent]);
  await vi.waitFor(() => expect(control(view, "Yes").getAttribute("aria-disabled")).toBeNull());
  view.streaming = false;
  await vi.waitFor(() =>
    expect(layerOf(view).some((e) => e.textContent === "The end.")).toBe(true),
  );
  expect(control(view, "Yes").getAttribute("aria-disabled")).toBeNull();
});

test("a slider reports once, on release, and not again at the same value", async () => {
  const { view, actions } = mount();
  await ready(view);
  const canvas = canvasOf(view);
  const track = control(view, "Volume").getBoundingClientRect();
  const y = track.top + track.height / 2;
  const at = (fraction: number) => track.left + track.width * fraction;
  const pointer = (type: string, x: number) =>
    canvas.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerId: 7, clientX: x, clientY: y }),
    );
  for (const round of [0, 1]) {
    pointer("pointerdown", at(0.2));
    pointer("pointermove", at(0.5));
    pointer("pointermove", at(0.75));
    expect(actions).toHaveLength(round);
    pointer("pointerup", at(0.75));
  }
  expect(actions).toEqual([
    { kind: "slider", ordinal: ORDINAL.slider, messageId: "c7.12", label: "Volume", value: 75 },
  ]);
  await vi.waitFor(() => expect(control(view, "Volume").getAttribute("aria-valuenow")).toBe("75"));
});

// md2ui `mouse_button_callback`: any region whose action carries a value is dragged, so a
// slider linked to an agent (the site's whipsaw `[[62%]](agent:set-volume)`) drags too,
// and stays live after it is let go: its state is the value, never pending.
test("a slider linked to an agent drags, reports the agent action, and drags again", async () => {
  const { view, actions } = mount();
  view.markdown = "Volume: [[50/100]](agent:set-volume)";
  await vi.waitFor(() => expect(control(view, "Volume").ariaLabel).toBe("Volume"));
  await ready(view);
  const canvas = canvasOf(view);
  const track = control(view, "Volume").getBoundingClientRect();
  const y = track.top + track.height / 2;
  const at = (fraction: number) => track.left + track.width * fraction;
  const pointer = (type: string, x: number) =>
    canvas.dispatchEvent(
      new PointerEvent(type, { bubbles: true, pointerId: 7, clientX: x, clientY: y }),
    );
  for (const to of [0.75, 0.25]) {
    pointer("pointerdown", at(0.5));
    pointer("pointermove", at(to));
    pointer("pointerup", at(to));
  }
  expect(actions).toEqual([
    {
      kind: "agent",
      slug: "set-volume",
      ordinal: 0,
      messageId: "c7.12",
      label: "Volume",
      value: 75,
    },
    {
      kind: "agent",
      slug: "set-volume",
      ordinal: 0,
      messageId: "c7.12",
      label: "Volume",
      value: 25,
    },
  ]);
  await vi.waitFor(() => expect(control(view, "Volume").getAttribute("aria-valuenow")).toBe("25"));
});

// A pan cancels the pointer, so a touch that starts on a live slider must not pan, and
// any other touch must. The browser decides that from `touch-action` alone: a listener
// that cancels `touchstart` would make it wait on the page before every scroll (0v).
test("a touch on a live slider never pans, a touch elsewhere does, and no touch or wheel listener blocks a scroll", async () => {
  const blocking: string[] = [];
  const add = EventTarget.prototype.addEventListener;
  vi.spyOn(EventTarget.prototype, "addEventListener").mockImplementation(function (
    this: EventTarget,
    type,
    listener,
    options,
  ) {
    const passive = typeof options === "object" && options.passive === true;
    if (/^(touchstart|touchmove|wheel|mousewheel)$/.test(type) && !passive) blocking.push(type);
    add.call(this, type, listener, options);
  });
  const { view } = mount();
  await ready(view);
  const touchAction = (label: string): string => {
    const { clientX, clientY } = centre(view, label);
    const under = shadow(view).elementFromPoint(clientX, clientY);
    return under === null ? "" : getComputedStyle(under).touchAction;
  };
  expect(touchAction("Volume")).toBe("none");
  expect(touchAction("Save")).not.toBe("none");
  view.disabled = true;
  await vi.waitFor(() =>
    expect(control(view, "Volume").getAttribute("aria-disabled")).toBe("true"),
  );
  expect(touchAction("Volume")).not.toBe("none");
  expect(blocking).toEqual([]);
});

test("a commit button carries what the user set on the other controls", async () => {
  const { view, actions } = mount();
  await ready(view);
  tapOn(view, "Milk");
  const volume = control(view, "Volume");
  volume.focus();
  volume.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
  volume.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  tapOn(view, "Save");
  expect(actions.at(-2)).toMatchObject({ kind: "slider", value: 51 });
  expect(actions.at(-1)).toMatchObject({
    kind: "agent",
    slug: "save",
    settled: [
      [ORDINAL.checkbox, true],
      [ORDINAL.slider, 51],
    ],
  });
});

test("an #anchor scrolls the view to its heading and reports nothing", async () => {
  const { view, actions } = mount();
  await ready(view);
  tapOn(view, "Jump");
  expect(actions).toEqual([]);
  await vi.waitFor(() => expect(view.scrollTop).toBeGreaterThan(0));
  const heading = layerOf(view).find((e) => e.localName === "h2" && e.textContent === "The end");
  const top = heading?.getBoundingClientRect().top ?? Number.NaN;
  const atEnd = view.scrollTop >= view.scrollHeight - view.clientHeight - 1;
  expect(atEnd || Math.abs(top - view.getBoundingClientRect().top) < 2).toBe(true);
});

test("a new document keeps the scroll", async () => {
  const { view } = mount();
  await ready(view);
  view.scrollTop = 200;
  view.markdown = MARKDOWN.replace("# Title", "# Title, again");
  await vi.waitFor(() =>
    expect(layerOf(view).some((e) => e.textContent === "Title, again")).toBe(true),
  );
  await new Promise(requestAnimationFrame);
  expect(view.scrollTop).toBe(200);
});

// A view whose document fits it is no scroll container; one whose document
// overflows scrolls itself again. WebKit missed the switch back while it was an edit of
// the shadow stylesheet's rule, and a long page after a short one could not scroll until
// something else restyled the page (iPhone). Only for a view the
// page sizes from its stylesheet: an inline style on the view hides it.
test("a long document after one that fits scrolls, every time", async () => {
  const sheet = document.createElement("style");
  sheet.textContent = ".sized { width: 500px; height: 300px; }";
  document.head.append(sheet);
  onTestFinished(() => sheet.remove());
  const { view } = mount();
  view.removeAttribute("style");
  view.className = "sized";
  await ready(view);
  const short = "# Short\n\nFits.\n";
  const scrolls = (): boolean => getComputedStyle(view).overflowY !== "clip";
  for (let i = 0; i < 12; i++) {
    view.markdown = short;
    await vi.waitFor(() => expect(view.scrollHeight).toBe(view.clientHeight), {
      timeout: 10_000,
    });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    expect(scrolls(), `fits, switch ${i}`).toBe(false);
    view.markdown = MARKDOWN;
    await vi.waitFor(() => expect(view.scrollHeight).toBeGreaterThan(view.clientHeight), {
      timeout: 10_000,
    });
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    expect(scrolls(), `overflows, switch ${i}`).toBe(true);
    view.scrollTop = 100;
    expect(view.scrollTop, `scrolled, switch ${i}`).toBe(100);
  }
});

test("copy puts the code on the clipboard and announces it, without an event", async () => {
  const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const { view, actions } = mount();
  await ready(view);
  view.scrollTop = 200;
  await new Promise(requestAnimationFrame);
  tapOn(view, "Copy code");
  expect(write).toHaveBeenCalledWith(CODE);
  expect(actions).toEqual([]);
  await vi.waitFor(() =>
    expect(shadow(view).querySelector("[role=status]")?.textContent).toBe("Copied"),
  );
});

test("the accessibility layer lists headings, text and controls in document order, each label once", async () => {
  const { view, actions } = mount();
  await ready(view);
  // Words no item holds (a button's label) are hidden from assistive technology.
  const named = layerOf(view).filter((el) => el.getAttribute("aria-hidden") !== "true");
  const snapshot = named.map((el) => {
    const role = el.getAttribute("role");
    const name = el.getAttribute("aria-label") ?? el.textContent;
    return `${el.localName}${role === null ? "" : `[${role}]`} ${name}`;
  });
  expect(snapshot.filter((line) => !line.startsWith("p Paragraph"))).toEqual([
    "h1 Title",
    "a Docs",
    "a Jump",
    "button Yes",
    "button[checkbox] Milk",
    "div[slider] Volume",
    "button Save",
    "h2 Code",
    "div[region] Code",
    "button Copy code",
    "h2 Filler",
    "h2 The end",
    "p The end.",
  ]);
  expect(snapshot.filter((line) => line.startsWith("p Paragraph"))).toHaveLength(FILLER_PARAGRAPHS);
  const yes = control(view, "Yes");
  yes.focus();
  yes.click();
  expect(actions).toMatchObject([{ kind: "agent", ordinal: ORDINAL.agent }]);
  expect(shadow(view).activeElement).toBe(yes);
});

// The block's own scroller takes a sideways wheel; a downward gesture, which the block
// cannot use, the browser hands to the view.
test("a sideways wheel over a code block scrolls the block, not the page", async () => {
  const { view } = mount();
  await ready(view);
  const code = layerOf(view).find((e) => e.textContent === CODE);
  if (code === undefined) throw new Error("no code text");
  code.scrollIntoView({ block: "center" });
  const top = view.scrollTop;
  await userEvent.wheel(code, { delta: { x: 60 } });
  await vi.waitFor(() => expect(code.scrollLeft).toBeGreaterThan(0));
  expect(view.scrollTop).toBe(top);
  // A new gesture: Firefox keeps a wheel transaction on its first target for 1.5 s.
  await new Promise((r) => setTimeout(r, 2000));
  await userEvent.wheel(code, { delta: { y: 60 } });
  await vi.waitFor(() => expect(view.scrollTop).toBeGreaterThan(top));
  expect(code.scrollTop).toBe(0);
});

test("two views on one page do not interfere", async () => {
  const a = mount("width: 500px; height: 200px");
  const b = mount("width: 360px; height: 200px");
  await ready(a.view);
  await ready(b.view);
  tapOn(a.view, "Yes");
  expect(a.actions).toHaveLength(1);
  expect(b.actions).toHaveLength(0);
  expect(control(b.view, "Yes").getAttribute("aria-disabled")).toBeNull();
  expect(await fillOf(b.view, "Yes")).toBe(LINK_COLOR);
  expect(contentOf(a.view).style.width).toBe(`${a.view.clientWidth}px`);
  expect(contentOf(b.view).style.width).toBe(`${b.view.clientWidth}px`);
});

test("with auto height it grows to the document and paints only around what the window shows", async () => {
  emulateScreen();
  const { view } = mount("width: 500px");
  await ready(view);
  expect(
    Math.abs(view.clientHeight - Number.parseFloat(contentOf(view).style.height)),
  ).toBeLessThan(1);
  expect(view.clientHeight).toBeGreaterThan(window.innerHeight);
  expect(Number.parseFloat(backOf(view).style.height)).toBeLessThanOrEqual(
    window.innerHeight + 2 * BEYOND,
  );
  // The visible part and as much again above and below it, so the page's scroll shows
  // painted content before the view's next frame.
  expect(Number.parseFloat(canvasOf(view).style.height)).toBeLessThanOrEqual(
    3 * window.innerHeight,
  );
  await new Promise(requestAnimationFrame);
  window.scrollTo(0, window.innerHeight / 2);
  const ink = canvasOf(view).getBoundingClientRect();
  window.scrollTo(0, 0);
  expect(ink.top).toBeLessThanOrEqual(0);
  expect(ink.bottom).toBeGreaterThanOrEqual(window.innerHeight);
});

// The background is fixed to the window (md2ui `draw_document`). The page scrolls on the
// compositor, frames ahead of the view, so the browser itself must hold the background
// there: placed by the view on a scroll event, it trailed the page by a frame (0v).
test("with auto height, the page's scroll keeps the background on the window before the view's next frame", async () => {
  emulateScreen();
  const { view } = mount("width: 500px");
  await ready(view);
  const back = backOf(view);
  const top = view.getBoundingClientRect().top + window.scrollY;
  const room = view.clientHeight - window.innerHeight;
  expect(room).toBeGreaterThan(300);
  window.scrollTo(0, top + 100);
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  const placed: number[] = [];
  for (const y of [160, 40, 300, 220]) {
    // Nothing of the view's runs between the scroll and the read but layout.
    window.scrollTo(0, top + y);
    const box = back.getBoundingClientRect();
    // As far above the window as the screen shows, or from the view's top.
    const from = Math.max(-BEYOND, view.getBoundingClientRect().top);
    placed.push(box.top - from, from + window.innerHeight + 2 * BEYOND - box.bottom);
  }
  window.scrollTo(0, 0);
  for (const gap of placed) expect(Math.abs(gap)).toBeLessThan(1);
});

/** How far past the window the emulated screen shows the page, above and below (CSS px). */
const BEYOND = 60;

// A phone shows the page past the window: under the status bar and under a translucent
// toolbar (iPhone Safari 26). The screen's height, emulated here, bounds how far; the
// engines Playwright drives show nothing there, so the test reads where the background
// lies rather than what the screen shows.
function emulateScreen(): void {
  const height = window.innerHeight + BEYOND;
  Object.defineProperty(screen, "height", { configurable: true, get: () => height });
  onTestFinished(() => {
    Reflect.deleteProperty(screen, "height");
  });
}

/** Whether `view`'s background covers what of its box the screen may show (`BEYOND`). */
function backCovers(view: HTMLElement): boolean {
  const box = view.getBoundingClientRect();
  const top = Math.max(box.top + view.clientTop, -BEYOND);
  const bottom = Math.min(
    box.top + view.clientTop + view.clientHeight,
    window.innerHeight + BEYOND,
  );
  const back = backOf(view).getBoundingClientRect();
  return back.top <= top + 0.5 && back.bottom >= bottom - 0.5;
}

test("the background reaches as far past the window as the screen may show it", async () => {
  emulateScreen();
  // The page's scroll moves each: a view it holds sticky, one in an `overflow: hidden`
  // ancestor, and one that scrolls itself.
  const wrapper = document.createElement("div");
  wrapper.style.overflow = "hidden";
  document.body.append(wrapper);
  // Room below, so the page scrolls each view's end up the window.
  const room = document.createElement("div");
  room.style.height = `${window.innerHeight}px`;
  onTestFinished(() => {
    wrapper.remove();
    room.remove();
  });
  for (const [style, parent] of [
    ["width: 500px", document.body],
    ["width: 500px", wrapper],
    ["width: 500px; height: 600px", document.body],
  ] as const) {
    const { view } = mount(style, parent);
    document.body.append(room);
    await ready(view);
    const top = view.getBoundingClientRect().top + window.scrollY;
    // Its top past what the screen shows above the window, then its end coming up the window.
    for (const y of [2 * BEYOND, view.clientHeight - window.innerHeight / 2]) {
      window.scrollTo(0, top + y);
      await new Promise(requestAnimationFrame);
      await new Promise(requestAnimationFrame);
      expect(backCovers(view), `${style} in ${parent.localName}, scrolled ${y}`).toBe(true);
    }
    window.scrollTo(0, 0);
    view.remove();
  }
});

/** Whether `canvas`'s box covers the part of `view` it scrolls in, as the compositor shows it. */
function covers(view: HTMLElement, canvas: HTMLCanvasElement): boolean {
  const box = view.getBoundingClientRect();
  const top = box.top + view.clientTop;
  const ink = canvas.getBoundingClientRect();
  return ink.top <= top && ink.bottom >= top + view.clientHeight;
}

test("a scroll shows painted pixels before the view's next frame, and one within the room paints nothing", async () => {
  const { view } = mount();
  await ready(view);
  await new Promise(requestAnimationFrame);
  const canvas = canvasOf(view);
  const transform = canvas.style.transform;
  // The browser moves the content at once, on its compositor; the view hears of it a
  // frame or more later. Nothing has run here since the scroll but layout.
  view.scrollTop = 150;
  expect(covers(view, canvas)).toBe(true);
  expect(covers(view, backOf(view))).toBe(true);
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  expect(canvas.style.transform).toBe(transform);
  // Past the room, the canvas is painted again around the part scrolled to.
  view.scrollTop = view.scrollHeight;
  await vi.waitFor(() => expect(canvas.style.transform).not.toBe(transform));
  expect(covers(view, canvas)).toBe(true);
  expect(covers(view, backOf(view))).toBe(true);
});

/** How far the view's canvases and layer elements reach into its content (CSS px). */
function reachOf(view: HTMLElement): { right: number; bottom: number } {
  const origin = contentOf(view).getBoundingClientRect();
  let right = 0;
  let bottom = 0;
  for (const el of [canvasOf(view), backOf(view), ...layerOf(view)]) {
    const box = el.getBoundingClientRect();
    right = Math.max(right, box.right - origin.left);
    bottom = Math.max(bottom, box.bottom - origin.top);
  }
  return { right, bottom };
}

// A rubber band past the end: WebKit reports the scroll beyond its range for as long as a
// trackpad or a finger holds it there. Placed from that scroll, a canvas lengthened the
// scroll area, so the bounce reached further each frame. The engines
// Playwright drives keep the scroll in range, so the view is shown the scroll WebKit
// reports, a little further past the end each frame.
test("a bounce past the end leaves the scroll area the document's", async () => {
  const { view } = mount();
  await ready(view);
  const doc = Number.parseFloat(contentOf(view).style.height);
  view.scrollTop = view.scrollHeight;
  await new Promise(requestAnimationFrame);
  const size = { width: view.scrollWidth, height: view.scrollHeight };
  let past = 0;
  Object.defineProperty(view, "scrollTop", {
    configurable: true,
    get: () => view.scrollHeight - view.clientHeight + past,
  });
  Object.defineProperty(view, "scrollLeft", { configurable: true, get: () => past });
  const frames: { width: number; height: number; right: number; bottom: number }[] = [];
  for (let i = 0; i < 12; i++) {
    past += 20;
    view.dispatchEvent(new Event("scroll"));
    await new Promise(requestAnimationFrame);
    await new Promise(requestAnimationFrame);
    frames.push({ width: view.scrollWidth, height: view.scrollHeight, ...reachOf(view) });
  }
  for (const f of frames) {
    expect(f).toMatchObject(size);
    expect(f.right).toBeLessThanOrEqual(view.clientWidth);
    expect(f.bottom).toBeLessThanOrEqual(doc);
  }
});

// With `height: auto` the page scrolls; the view, as tall as its document, never does.
test("with auto height, scrolling past the end scrolls neither the view nor more page", async () => {
  const { view } = mount("width: 500px");
  await ready(view);
  window.scrollTo(0, document.documentElement.scrollHeight);
  await new Promise(requestAnimationFrame);
  const page = document.documentElement.scrollHeight;
  for (let i = 0; i < 6; i++) {
    await userEvent.wheel(view, { delta: { y: 200 } });
    await new Promise(requestAnimationFrame);
  }
  await new Promise(requestAnimationFrame);
  window.scrollTo(0, 0);
  expect(view.scrollHeight).toBe(view.clientHeight);
  expect(view.scrollTop).toBe(0);
  expect(document.documentElement.scrollHeight).toBe(page);
  expect(reachOf(view).bottom).toBeLessThanOrEqual(Number.parseFloat(contentOf(view).style.height));
});

test("a new width lays out again; a new height only repaints", async () => {
  const { view } = mount();
  await ready(view);
  const before = contentOf(view).style.height;
  view.style.width = "420px";
  await vi.waitFor(() => expect(contentOf(view).style.width).toBe(`${view.clientWidth}px`));
  expect(contentOf(view).style.height).not.toBe(before);
  const laidOut = contentOf(view).style.height;
  view.style.height = "350px";
  await vi.waitFor(() => expect(backOf(view).style.height).toBe("350px"));
  expect(contentOf(view).style.height).toBe(laidOut);
});

test("past the theme's Max width the scene stands, centred", async () => {
  const { view } = mount("width: 500px; height: 300px");
  view.themeText = THEME.replace("Stack sections: yes", "Stack sections: yes\nMax width: 400");
  const scene = `${PADDING + 400 + PADDING}px`;
  await vi.waitFor(() => expect(contentOf(view).style.width).toBe(scene));
  const before = control(view, "Yes").getBoundingClientRect().left;
  view.style.width = "700px";
  await vi.waitFor(() =>
    expect(control(view, "Yes").getBoundingClientRect().left).toBeCloseTo(before + 100, 0),
  );
  expect(contentOf(view).style.width).toBe(scene);
});

test("the attributes set their properties", () => {
  defineMd2uiView();
  const view = document.createElement("md2ui-view");
  view.setAttribute("theme-src", "/themes/a/THEME.md");
  view.setAttribute("asset-base", "/assets/");
  view.setAttribute("message-id", "m1");
  view.setAttribute("disabled", "");
  view.setAttribute("streaming", "");
  expect([view.themeSrc, view.assetBase, view.messageId, view.disabled, view.streaming]).toEqual([
    "/themes/a/THEME.md",
    "/assets/",
    "m1",
    true,
    true,
  ]);
  view.removeAttribute("disabled");
  view.removeAttribute("streaming");
  view.removeAttribute("message-id");
  expect([view.disabled, view.streaming, view.messageId]).toEqual([false, false, null]);
});

test("a misused property throws a typed error", () => {
  defineMd2uiView();
  const view = document.createElement("md2ui-view");
  expect(() => {
    view.fonts = "Inter" as unknown as [];
  }).toThrow(TypeError);
  expect(() => {
    view.fonts = [{ family: "Inter" }] as unknown as [];
  }).toThrow(TypeError);
  expect(() => view.release(2 as unknown as [])).toThrow(TypeError);
});

test("a theme or font that fails to load is reported; the view still renders", async () => {
  const errors: Md2uiLoadError[] = [];
  const { view } = mount();
  view.addEventListener("md2ui-error", (e) => errors.push(e.detail));
  view.themeText = null;
  view.themeSrc = "/no/such/THEME.md";
  // md2ui's default theme, which the view falls back to, draws in Arial.
  view.fonts = [{ family: "Arial", url: "/no/such/font.woff2" }];
  // A missing font is known once the server answers, which a loaded machine can delay.
  await vi.waitFor(() => expect(errors.map((e) => e.resource).sort()).toEqual(["font", "theme"]), {
    timeout: 10_000,
  });
  expect(errors.find((e) => e.resource === "theme")?.url).toBe(
    new URL("/no/such/THEME.md", document.baseURI).href,
  );
  expect(errors.find((e) => e.resource === "font")?.url).toBe("/no/such/font.woff2");
  await ready(view);
});

test("a family the theme draws in that no font gives is reported once per theme, by name", async () => {
  const errors: Md2uiLoadError[] = [];
  const { view } = mount();
  view.addEventListener("md2ui-error", (e) => errors.push(e.detail));
  const absent = "md2ui-test-absent";
  // The page has it only through its own `@font-face`: a Worker would not see it.
  const pageFace = new FontFace(absent, "local(Arial)");
  document.fonts.add(pageFace);
  view.themeText = THEME.replace("Font Name: sans-serif", `Font Name: ${absent}`);
  await vi.waitFor(() => expect(errors).toHaveLength(1), { timeout: 10_000 });
  expect(errors[0]).toEqual({
    resource: "font",
    url: "",
    family: absent,
    message: expect.stringContaining(`"${absent}"`),
  });
  // Fonts set again, still without it, under the same theme: not again.
  view.fonts = [{ family: "md2ui-test-other", url: "/no/such/other.woff2" }];
  await ready(view);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(errors.filter((e) => e.url === "")).toHaveLength(1);
  document.fonts.delete(pageFace);
});

test("theme text's assets resolve against the asset base, and the view fetches them", async () => {
  const fetched = vi.spyOn(globalThis, "fetch");
  const { view } = mount();
  view.themeText = `${THEME}\n## Styling & Spacing\n### Root\nBackground image: hero.png\n`;
  view.assetBase = "https://cdn.example/a/";
  // Fetched once the document is shown, which waits for its first layout, as `ready` does.
  await vi.waitFor(
    () =>
      expect(fetched.mock.calls.map(([input]) => String(input))).toContain(
        "https://cdn.example/a/hero.png",
      ),
    { timeout: 10_000 },
  );
});
