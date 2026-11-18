// The accessibility layer (ADR-402: it lives in the host). Visually hidden DOM over
// the canvas, in document order: headings, text, images, and one control per target,
// each placed over its region so touch exploration and the focus ring land on the
// ink. Keyboard activation goes through the same rules as a tap.
//
// It is also the text layer (selectable.ts): a heading's or text's element holds that
// item's painted words, each a transparent span on its glyphs, so the browser selects,
// copies and finds them. One layer, not two: a word in a layer of its own as well would
// be found twice by find-in-page and read twice by a screen reader, and the outline item
// is already the element that should hold it. Words no item holds (a button's label, a
// list marker, a chart's labels) lie in reading order before the next item, hidden from
// assistive technology. A control is named by its label (`aria-label`), not by text of
// its own, so every painted word is in the layer once, where it is painted.
//
// A code block that scrolls is a scroller here (block-scroll.ts); its words lie in it and
// scroll with it.
//
// Elements are keyed and updated in place, never rebuilt, so a control keeps focus
// when its state changes under it (a press shows it pending), and a scroller its offset.
import type {
  DisplayList,
  HitTarget,
  HostState,
  OutlineItem,
  Rect,
  ScrollEntry,
  TargetPayload,
} from "@md2ui/contracts";
import type { SceneText } from "@md2ui/core";
import type { ScrollOffset } from "@md2ui/painter-canvas";
import { waiting } from "./actions.ts";
import { followOffsets, scrollerOver } from "./block-scroll.ts";
import { createWords, type Unfitted } from "./selectable.ts";

/** What the layer shows. */
export interface LayerModel {
  readonly list: DisplayList;
  readonly outline: readonly OutlineItem[];
  /**
   * The outline's painted words; null while they wait (the view lays them out when idle),
   * when each element keeps the words it holds and a new one shows its item's text.
   */
  readonly text: SceneText | null;
  readonly payload: (ordinal: number) => TargetPayload | undefined;
  /** Host state by target ordinal. */
  readonly states: ReadonlyMap<number, HostState>;
  /** Agent-bound controls are announced unavailable. */
  readonly disabled: boolean;
  /** Where content space's x origin sits in the view (the painter's centring). */
  readonly originX: number;
  /** How far the user has scrolled each code block, by node id. */
  readonly offsets: ReadonlyMap<string, ScrollOffset>;
}

/** What a control does, which the view decides. */
export interface LayerHandlers {
  activate(ordinal: number): void;
  copy(nodeId: string): void;
  /** A slider moved from the keyboard: shown at once, reported on `commitSlider`. */
  moveSlider(ordinal: number, value: number): void;
  commitSlider(ordinal: number): void;
  /** A code block's scroller moved. */
  scrolled(nodeId: string, offset: ScrollOffset): void;
}

export interface AccessibilityLayer {
  update(model: LayerModel): void;
  /** Says `text` through the live region (a copy is announced, never reported). */
  announce(text: string): void;
}

function place(el: HTMLElement, rect: Rect, originX: number, top: number): void {
  el.style.left = `${originX + rect.x}px`;
  el.style.top = `${top + rect.y}px`;
  el.style.width = `${Math.max(1, rect.width)}px`;
  el.style.height = `${Math.max(1, rect.height)}px`;
}

/** A rect's place and size, the key a box's outline item and its scroll entry share. */
const boxKey = (r: Rect): string => `${r.x},${r.y},${r.width},${r.height}`;

function setAttr(el: HTMLElement, name: string, value: string | null): void {
  if (value === null) el.removeAttribute(name);
  else if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

/** The rect holding both. */
function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * The step a key moves a slider by: one unit of the precision the author wrote; a count's
 * one, its buttons' step.
 */
function sliderStep(slider: NonNullable<TargetPayload["slider"]>): number {
  if (slider.count) return 1;
  return slider.decimals === null ? slider.max / 100 : 10 ** -slider.decimals;
}

function clamp(value: number, max: number): number {
  return Math.min(max, Math.max(0, value));
}

/** The element a target's control is: its tag and role follow what it is. */
function controlFor(payload: TargetPayload): { tag: string; role: string | null } {
  if (payload.slider !== undefined) return { tag: "div", role: "slider" };
  if (payload.kind === "link" || payload.kind === "anchor") return { tag: "a", role: null };
  // A choice option is one of a group of which a tap chooses one.
  if (payload.choice !== undefined) return { tag: "button", role: "radio" };
  if (payload.checked !== undefined) return { tag: "button", role: "checkbox" };
  return { tag: "button", role: null };
}

/** A layer inside `container`; `live` is the live region. */
export function createAccessibilityLayer(
  container: HTMLElement,
  live: HTMLElement,
  handlers: LayerHandlers,
): AccessibilityLayer {
  const elements = new Map<string, HTMLElement>();
  const words = createWords();
  /** The slider value each keyboard control shows, by ordinal, for the next key. */
  const sliderValues = new Map<number, number>();

  const make = (key: string, tag: string): HTMLElement => {
    const existing = elements.get(key);
    if (existing !== undefined && existing.localName === tag) return existing;
    existing?.remove();
    const el = document.createElement(tag);
    elements.set(key, el);
    return el;
  };

  const targetControl = (
    target: Exclude<HitTarget, { kind: "copy" }>,
    payload: TargetPayload,
    name: string,
    model: LayerModel,
    top: number,
  ): HTMLElement => {
    const { tag, role } = controlFor(payload);
    const el = make(`t:${target.ordinal}`, tag);
    place(el, target.rect, model.originX, top);
    setAttr(el, "role", role);
    setAttr(el, "aria-label", name);
    const state = model.states.get(target.ordinal);
    const agentBound = payload.kind !== "link" && payload.kind !== "anchor";
    const unavailable =
      (agentBound && model.disabled) || waiting(target, model.states, model.list.targets);
    setAttr(el, "aria-disabled", unavailable ? "true" : null);
    if (tag === "a") {
      setAttr(el, "href", payload.href ?? "#");
    }
    if (role === "checkbox" || role === "radio") {
      const checked = state?.kind === "checked" ? state.checked : (payload.checked ?? false);
      setAttr(el, "aria-checked", String(checked));
    }
    if (payload.slider !== undefined) {
      const value = state?.kind === "value" ? state.value : payload.slider.value;
      sliderValues.set(target.ordinal, value);
      setAttr(el, "tabindex", "0");
      setAttr(el, "aria-valuemin", "0");
      setAttr(el, "aria-valuemax", String(payload.slider.max));
      setAttr(el, "aria-valuenow", String(value));
      // A count is tapped at its ➖ and ➕ on the canvas; this control serves the keyboard
      // and assistive technology only.
      setAttr(el, "data-count", payload.slider.count ? "" : null);
      el.onkeydown = (event) => {
        const slider = payload.slider;
        if (slider === undefined) return;
        const now = sliderValues.get(target.ordinal) ?? slider.value;
        const step = sliderStep(slider);
        const moves: Record<string, number> = {
          ArrowRight: now + step,
          ArrowUp: now + step,
          ArrowLeft: now - step,
          ArrowDown: now - step,
          PageUp: now + step * 10,
          PageDown: now - step * 10,
          Home: 0,
          End: slider.max,
        };
        const next = moves[event.key];
        if (next !== undefined) {
          event.preventDefault();
          handlers.moveSlider(target.ordinal, clamp(next, slider.max));
        } else if (event.key === "Enter") {
          event.preventDefault();
          handlers.commitSlider(target.ordinal);
        }
      };
      el.onblur = () => handlers.commitSlider(target.ordinal);
    } else {
      el.onclick = (event) => {
        event.preventDefault();
        handlers.activate(target.ordinal);
      };
    }
    return el;
  };

  return {
    update(model) {
      const top = model.list.padding.top;
      const byOrdinal = new Map<number, Exclude<HitTarget, { kind: "copy" }>>();
      const copies = new Map<string, Extract<HitTarget, { kind: "copy" }>>();
      for (const target of model.list.targets) {
        if (target.kind === "copy") copies.set(target.nodeId, target);
        else {
          // A count's ➖ and ➕ are one control, over the whole count.
          const other = target.step === undefined ? undefined : byOrdinal.get(target.ordinal);
          byOrdinal.set(
            target.ordinal,
            other === undefined ? target : { ...other, rect: union(other.rect, target.rect) },
          );
        }
      }
      // A scrollable code block's outline item has its box's bounds, as its entry has.
      const blocks = new Map<string, ScrollEntry>();
      for (const entry of model.list.entries) {
        if (entry.type === "scroll") blocks.set(boxKey(entry.bounds), entry);
      }
      const scrollers = new Map<HTMLElement, string>();
      const order: HTMLElement[] = [];
      const unfitted: Unfitted[] = [];
      /** Fills `el` with item `index`'s words, placed from `at`, or with `text` when it paints none. */
      const fill = (el: HTMLElement, index: number, at: Rect, text: string): void => {
        if (model.text === null) {
          if (!el.hasChildNodes()) words.plain(el, text);
          return;
        }
        const group = model.text.items.get(index);
        if (group === undefined) words.plain(el, text);
        else words.fill(el, model.text, group, at.x, at.y, unfitted);
      };
      /** The words before item `index` that no item holds. */
      const loose = (index: number): void => {
        const key = `l:${index}`;
        if (model.text === null) {
          const kept = elements.get(key);
          if (kept !== undefined) order.push(kept);
          return;
        }
        const group = model.text.loose.get(index);
        if (group === undefined) return;
        const el = make(key, "div");
        el.style.left = `${model.originX}px`;
        el.style.top = `${top}px`;
        setAttr(el, "aria-hidden", "true");
        words.fill(el, model.text, group, 0, 0, unfitted);
        order.push(el);
      };
      model.outline.forEach((item, index) => {
        loose(index);
        const block = item.role === "text" ? blocks.get(boxKey(item.bounds)) : undefined;
        if (block !== undefined && item.role === "text") {
          // Keyed by node, so it keeps its offset when a new document replaces this one.
          const el = make(`s:${block.nodeId}`, "div");
          place(el, block.bounds, model.originX, top);
          const lines = scrollerOver(el, block, (offset) =>
            handlers.scrolled(block.nodeId, offset),
          );
          fill(lines, index, block.bounds, item.text);
          scrollers.set(el, block.nodeId);
          order.push(el);
          return;
        }
        if (item.role === "target") {
          const target = byOrdinal.get(item.ordinal);
          const payload = model.payload(item.ordinal);
          // A disabled (`~~…~~`) target has no region: nothing to press.
          if (target !== undefined && payload !== undefined) {
            order.push(targetControl(target, payload, item.name, model, top));
          }
        } else if (item.role === "copy") {
          const target = copies.get(item.nodeId);
          if (target === undefined) return;
          const el = make(`c:${item.nodeId}`, "button");
          place(el, target.rect, model.originX, top);
          setAttr(el, "aria-label", "Copy code");
          el.onclick = (event) => {
            event.preventDefault();
            handlers.copy(item.nodeId);
          };
          order.push(el);
        } else {
          const tag =
            item.role === "heading" ? `h${item.level}` : item.role === "text" ? "p" : "div";
          const el = make(`n:${index}`, tag);
          place(el, item.bounds, model.originX, top);
          if (item.role === "image") {
            setAttr(el, "role", "img");
            setAttr(el, "aria-label", item.text);
          } else {
            fill(el, index, item.bounds, item.text);
          }
          order.push(el);
        }
      });
      loose(model.outline.length);
      const keep = new Set(order);
      for (const [key, el] of elements) {
        if (!keep.has(el)) {
          el.remove();
          elements.delete(key);
        }
      }
      // In document order, moving only what is out of place, so focus stays put.
      const placed = new Set<HTMLElement>();
      order.forEach((el, i) => {
        if (container.children[i] === el) return;
        container.insertBefore(el, container.children[i] ?? null);
        placed.add(el);
      });
      followOffsets(scrollers, placed, model.offsets, handlers.scrolled);
      words.fit(unfitted, container);
    },

    announce(text) {
      live.textContent = "";
      // A new text node after a clear is announced again, even when it repeats.
      queueMicrotask(() => {
        live.textContent = text;
      });
    },
  };
}
