// The host adapter (ADR-003): it connects a canvas to a page. It holds the view's
// properties (C6), loads the theme and fonts, runs the core, paints with the painter,
// turns pointer and keyboard input into actions, and keeps the accessibility
// layer. `<md2ui-view>` wraps one of these per connected element.
//
// Work has a lifetime (md2ui `AGENTS.md`, *Give work its lifetime*): per Markdown,
// grouping; per document, theme and measurer, sizing (`prepareDocument`); per effective
// width, layout, placement and paint (`render`); per state change, a new list
// (`withStates`) and painter; per frame, only `paint`. Paint waits for an animation
// frame, and so does a new document, so deltas streamed within one frame make one
// document; what can wait longer (image loads) waits for an idle moment.
//
// The core runs in the view's pipeline session (session.ts), on the main thread or in
// the registration's Worker. Either way its answers arrive asynchronously, so each kind
// of request is sequence-checked: a document is overtaken only by a newer document, a
// width by any newer request, and a state by a newer state or a new scene. While a
// message streams, only its closed blocks are laid out (C6 `streaming`).
//
// A new document keeps what the user was reading in place (scroll anchoring by node id,
// ADR-104) and moves into place from the one it replaces (FLIP: the core's diff, the
// painter's transition, this view's frames), unless the user asked for less motion. A
// new page (the host says so, or what is on screen shares little with what was) does not
// move: what was seen is copied once to a canvas the size of the visible part, over the
// new page, and the compositor fades it out, with no frame of ours (of the ways measured,
// the one with no work per frame and the least memory).
//
// Sizing: the element is a scroll container. With a definite height it scrolls itself;
// with `height: auto` it grows to the document and the page scrolls. Either way the view
// works out the visible part from its own scroll and the window, and an
// IntersectionObserver stops painting while it is off screen. Within a screen of the
// window, a view keeps its canvases and paints the part that will show first, so a
// scroll back into it is not blank; farther away, it gives their memory back (a chat
// holds one view per message) and paints them again when it comes near.
//
// Scrolling: the browser scrolls on its compositor, frames ahead of the main thread, so
// a canvas that covered only the visible part would show what lies behind it at every
// fast scroll. The content canvas rides the scrolled content and holds the visible part
// with room above and below it, and is painted again only when the scroll nears its
// edge. The page background is fixed to the viewport (md2ui `draw_document`), so it has
// a canvas of its own, the view's width and up to the window's height, which stays in
// place (sticky) while the view scrolls. A view the page scrolls is no scroll container,
// so the browser holds that canvas in place for the page's scroll as well.
//
// A code block that scrolls is scrolled by the browser, through a native scroller over
// it in the accessibility layer (block-scroll.ts); each of its offsets repaints only that
// block's part of the content canvas.
//
// Text is selected, copied and found in the accessibility layer too, whose words lie on
// their glyphs (selectable.ts). They take the pointer, so a tap on a word is still a tap
// on the ink, and a press on a target never starts a selection, as a native link's or
// button's never does: a link is followed, a slider dragged, a page panned as before.
import type {
  ActionTarget,
  DisplayList,
  FontSource,
  HostState,
  Md2uiAction,
  Md2uiLoadError,
  Md2uiViewProperties,
  MotionTheme,
  ResolvedTheme,
  ScrollEntry,
  SliderTarget,
  TargetTable,
} from "@md2ui/contracts";
import {
  alignNodeIds,
  type ClosedPrefix,
  closedPrefix,
  type DocumentShape,
  diffDisplayLists,
  holderIds,
  keptShare,
  parseTheme,
  RegexKit,
  shapeShare,
} from "@md2ui/core";
import {
  createPainter,
  createShadowSprites,
  createTransition,
  type Frame,
  type Painter,
  type ScrollOffset,
  type Transition,
  type View,
} from "@md2ui/painter-canvas";
import {
  type FontFaces,
  type FontVariations,
  isGenericFamily,
  loadFonts,
} from "@md2ui/text-pretext";
import { createAccessibilityLayer } from "./a11y.ts";
import { linkOpening, sliderValue, stepped, type Tap, tap, waiting } from "./actions.ts";
import { SCROLLER } from "./block-scroll.ts";
import { carriedStates, type ShownDocument, standingStates } from "./carried.ts";
import { whenIdle } from "./idle.ts";
import { createImageStore, type ImageStore } from "./images.ts";
import { startFade, startTween, type Tween, themeMotion } from "./motion.ts";
import type { Pictures } from "./pictures.ts";
import { WORDS } from "./selectable.ts";
import type { ShownScene } from "./session.ts";
import type { OpenSession } from "./sessions.ts";
import { loadTheme, themeFamilies } from "./theme.ts";
import { themeFonts } from "./theme-fonts.ts";

/** A view's properties, set one at a time with values the element has checked, its release and its teardown. */
export interface ViewController extends Md2uiViewProperties {
  release(ordinals: readonly number[]): void;
  destroy(): void;
}

/**
 * The host's attribute while its document fits it, read by a `:host` rule. Not an edit
 * of the rule: WebKit did not restyle a host without an inline style when the rule went
 * from `clip` back to `auto`, and a long page after a short one could not scroll
 * (iPhone). Not an inline style: it would beat the page's own style for the
 * element.
 */
const FITS = "data-fits";

// A live slider's control takes the touches that start on it and lets none of them pan, so
// a drag is never cancelled by a pan; with no listener that cancels the touch, the browser
// never waits on the page before it scrolls. It lies over the words there.
// A count's control does not: its ➖ and ➕ are the canvas's to tap.
// `.hidden` sits at the top: left where the flow puts it, the live region below the content
// would lengthen the scroll by a pixel. A selection shows half the system's highlight, so
// the painted glyphs under it stay seen; an emoji the browser would draw in colour over
// its painted twin is hidden. The host carries `FITS` while its document fits it
// (`syncScroller`).
const STYLE = `
:host {
  display: block; position: relative; overflow: auto; scrollbar-gutter: stable;
  overflow-anchor: none;
}
:host([hidden]) { display: none; }
:host([${FITS}]) { overflow: clip; }
.content { position: relative; min-width: 100%; isolation: isolate; }
canvas { display: block; }
.ink { position: absolute; left: 0; top: 0; touch-action: pan-x pan-y; }
.back { position: sticky; top: 0; left: 0; z-index: -1; pointer-events: none; }
.fade { position: absolute; left: 0; top: 0; pointer-events: none; }
.layer { position: absolute; inset: 0; pointer-events: none; }
.layer > * {
  position: absolute; box-sizing: border-box; margin: 0; padding: 0; border: 0;
  background: transparent; color: transparent; font-size: 1px; line-height: 1;
  overflow: hidden; white-space: nowrap;
}
.layer > :focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
.layer > [role=slider]:not([aria-disabled]):not([data-count]) {
  pointer-events: auto; touch-action: none; z-index: 1;
}
.layer > .${SCROLLER} {
  overflow: auto; pointer-events: auto; scrollbar-width: none; touch-action: pan-x pan-y;
}
.${SCROLLER}::-webkit-scrollbar { display: none; }
.${SCROLLER} > div { position: relative; overflow: hidden; }
.layer > .${WORDS} { overflow: visible; }
.${WORDS} { white-space: pre; }
.${WORDS} > span {
  position: absolute; white-space: pre; transform-origin: 0 0; pointer-events: auto;
  touch-action: pan-x pan-y;
}
.${WORDS} > span > span { opacity: 0; }
.${WORDS}::selection, .${WORDS} ::selection {
  background-color: color-mix(in srgb, Highlight 50%, transparent); color: transparent;
}
.hidden { position: absolute; top: 0; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
`;

/** The visible part of the document, in its scroll coordinates (CSS px). */
interface Visible {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * How many device pixels the content canvas may hold: the room above and below the
 * visible part is cut to fit, so a large screen at a high pixel ratio stays within what
 * Safari allows a canvas (16,777,216 px).
 */
const CANVAS_PIXELS = 16_000_000;

/**
 * How long after its last width change a view's resize is over, and the room around its
 * visible part (one screen) is painted again.
 */
const RESIZE_QUIET_MS = 100;

/**
 * Below this share of what was on screen, or of what will be, kept across an update
 * (`keptShare`), it is a new page and fades whole. Measured over the corpus's 407
 * documents at 393 and 1,280 px, at the top and half way down: sections
 * removed or added and tasks ticked keep 0.84 or more in 99 % of updates, a changed count
 * 0.53; 9 of 2,961 edits keep under 0.4, all under 0.3 too, and 96.5 % of 2,055 pairs of
 * different documents do (those above share a layout: a theme's samples, a page themed
 * twice).
 */
const NEW_PAGE = 0.4;

/**
 * At or above this share of the same structure where the reader looks (`shapeShare`), an
 * update that kept little content is still the same page with new values (a weather or a
 * dashboard refreshed): it moves node by node. Measured over the same corpus:
 * a document with every digit changed keeps under 0.4 of its content in 23 % of cases,
 * and its shape at 0.99 or more in 95 %; different documents share 0.44 or less of their
 * shape in 95 % of pairs. At 0.7, 1 of 724 refreshes is a new page, and 96.7 % of 1,628
 * pairs of different documents are (96.9 % by content alone).
 */
const SAME_SHAPE = 0.7;

/** Where content space's x origin sits in a view `width` wide (the painter's centring). */
function originX(list: DisplayList, width: number): number {
  const { left, right } = list.padding;
  const slack = Math.max(0, width - left - right - list.width);
  return left + (list.centered ? slack / 2 : 0);
}

/** A node the user can see, by id, and its top in scroll coordinates (padding included). */
interface Anchored {
  readonly nodeId: string;
  readonly y: number;
}

/** Each node's top and bottom in `list`, in scroll coordinates. */
function nodeSpans(list: DisplayList): Map<string, { top: number; bottom: number }> {
  const spans = new Map<string, { top: number; bottom: number }>();
  for (const { nodeId, bounds } of list.entries) {
    if (nodeId === "") continue;
    const top = list.padding.top + bounds.y;
    const bottom = top + bounds.height;
    const seen = spans.get(nodeId);
    spans.set(
      nodeId,
      seen === undefined
        ? { top, bottom }
        : { top: Math.min(seen.top, top), bottom: Math.max(seen.bottom, bottom) },
    );
  }
  return spans;
}

/**
 * The nodes `visible` shows, top first: what a replacement keeps in place. None when
 * the document's top is in view, so what arrives above it is seen. A card's or section's
 * box is not one: what changes inside it above the view moves what is read in it.
 */
function anchorsOf(list: DisplayList, visible: Visible): Anchored[] {
  if (visible.y <= 0) return [];
  const bottom = visible.y + visible.height;
  const boxes = holderIds(list);
  return [...nodeSpans(list)]
    .filter(([id, n]) => n.bottom > visible.y && n.top < bottom && !boxes.has(id))
    .map(([nodeId, n]) => ({ nodeId, y: n.top }))
    .sort((a, b) => a.y - b.y);
}

/** How far the first anchor still in `list` moved down; 0 when none is. */
function anchorDrift(list: DisplayList, anchors: readonly Anchored[]): number {
  const spans = nodeSpans(list);
  for (const { nodeId, y } of anchors) {
    const now = spans.get(nodeId);
    if (now !== undefined) return now.top - y;
  }
  return 0;
}

/**
 * The element whose scroll moves `host`'s document: the view itself, or its nearest
 * scrolling ancestor, or the page.
 */
function scrollerOf(host: HTMLElement): Element {
  if (host.scrollHeight > host.clientHeight) return host;
  for (let el = parentOf(host); el !== null; el = parentOf(el)) {
    const { overflowY } = getComputedStyle(el);
    const scrolls = overflowY === "auto" || overflowY === "scroll";
    if (scrolls && el.scrollHeight > el.clientHeight) return el;
  }
  return document.scrollingElement ?? document.documentElement;
}

/** Whether an overflow value makes no scroll container. */
const notScrolling = (overflow: string): boolean => overflow === "visible" || overflow === "clip";

/**
 * The element a sticky box inside `host` sticks to: its nearest scroll container, which
 * may be one that never scrolls (an ancestor with `overflow: hidden`); the page's for
 * none, or for the root and the body, whose overflow goes to the viewport.
 */
function stickyScroller(host: HTMLElement): Element {
  const page = document.scrollingElement ?? document.documentElement;
  for (let el = parentOf(host); el !== null; el = parentOf(el)) {
    if (el === document.body || el === document.documentElement) return page;
    const { overflowX, overflowY } = getComputedStyle(el);
    if (!notScrolling(overflowX) || !notScrolling(overflowY)) return el;
  }
  return page;
}

/** `el`'s parent in the flat tree: across a shadow root to its host. */
function parentOf(el: Element): Element | null {
  if (el.parentElement !== null) return el.parentElement;
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root.host : null;
}

/**
 * A view on `host`, whose shadow root it owns, starting from `initial`; its pipeline
 * session comes from `open`, and the page faces it loads are kept in `faces` and the
 * pictures it draws in `pictures`, which its registration's views share.
 */
export function createView(
  host: HTMLElement,
  initial: Md2uiViewProperties,
  open: OpenSession,
  faces: FontFaces,
  pictures: Pictures,
): ViewController {
  const root = host.shadowRoot ?? host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = STYLE;
  const content = document.createElement("div");
  content.className = "content";
  const canvas = document.createElement("canvas");
  canvas.className = "ink";
  const back = document.createElement("canvas");
  back.className = "back";
  const layerEl = document.createElement("div");
  layerEl.className = "layer";
  const probe = document.createElement("div");
  probe.className = "hidden";
  const live = document.createElement("div");
  live.className = "hidden";
  live.setAttribute("role", "status");
  content.append(canvas, layerEl, probe, back);
  root.replaceChildren(style, content, live);
  const ctx = canvas.getContext("2d");
  const backCtx = back.getContext("2d");
  if (ctx === null || backCtx === null) throw new Error("<md2ui-view>: Canvas 2D is unavailable");

  const props: Md2uiViewProperties = { ...initial };
  const pageBase = (): string => document.baseURI;
  // --- per document, per width, per state -----------------------------------------
  let theme: ResolvedTheme | null = null;
  /**
   * The theme's motion, as this browser runs it: set with `theme`, on the main thread,
   * which runs the frames whether or not the pipeline is in a Worker.
   */
  let motion: MotionTheme | null = null;
  /** The session measures with the current theme and fonts. */
  let facesReady = false;
  /** The theme's emoji font instances that set axes, which the painter applies itself where a face cannot. */
  let variations: FontVariations = new Map();
  /** The Markdown the latest document was prepared from. */
  let asked: string | null = null;
  let targets: TargetTable = [];
  let docMessageId: string | null = null;
  let rendered: ShownScene | null = null;
  /** The structure of the document shown. */
  let shape: DocumentShape | null = null;
  let list: DisplayList | null = null;
  /** `list`'s right and bottom (CSS px), padding included, in whole pixels: its scroll area. */
  let right = 0;
  let bottom = 0;
  let painter: Painter | null = null;
  /** The last document moving into place, painted in place of `painter` until it ends. */
  let transition: { readonly paint: Transition; readonly tween: Tween } | null = null;
  /** The page replaced by a new one, as it was seen, fading out over it until it ends. */
  let fade: { readonly layer: HTMLCanvasElement; readonly animation: Animation } | null = null;
  /** When the last document that replaced another was asked for (`performance.now()`). */
  let replacedAt = Number.NEGATIVE_INFINITY;
  /** The regexes that find a streamed message's closed blocks. */
  const streamKit = new RegexKit();
  /**
   * The last streamed text scanned, and its closed part: a delta that extends it is
   * scanned from its last cut (`resume`), so a stream costs its length once, not once
   * per delta.
   */
  let stream: { readonly text: string } & ClosedPrefix = { text: "", prefix: "", resume: 0 };
  /** Blurred shadows, kept from one list to the next. */
  const sprites = createShadowSprites();
  /**
   * A new document, theme or width is on its way: once painted, its motion over, the
   * sprites keep only its own (`Painter.settle`). A stream's deltas and a state change
   * keep the last lists' too, and a scroll never drops any.
   */
  let settling = false;
  /** Host state by target ordinal (ADR-003): one target, never a whole text. */
  const states = new Map<number, HostState>();
  /**
   * The states the list on screen paints, which the accessibility layer tells: a state
   * reaches both together, once the session has painted it, never one before the other.
   */
  let shownStates: ReadonlyMap<number, HostState> = new Map();
  /** The last value each slider reported, by ordinal: an unchanged one is not sent again. */
  const sent = new Map<number, number>();
  /** Sliders moved from the keyboard and not yet reported. */
  const moved = new Set<number>();
  /** The last document shown whole: what a replacement is compared with. */
  let whole: ShownDocument | null = null;
  /** The states the user set on `whole`, set aside while a streamed document shows. */
  let held: Map<number, HostState> | null = null;
  /** `states` as the last settle left them: what differs since, the user set. */
  let settled: ReadonlyMap<number, HostState> = new Map();
  /**
   * What the user set on the streamed documents of the message on its way, by ordinal
   * (`undefined`: cleared), kept until it is whole. A streamed document is the start of
   * the next, so its ordinals are theirs.
   */
  const streamedChanges = new Map<number, HostState | undefined>();
  /** How far the user has scrolled each code block, across and down, by node id. */
  const offsets = new Map<string, ScrollOffset>();
  /** The code block under a mouse, whose thumbs show. */
  let hovered: string | null = null;
  /** The list's code blocks that scroll, by node id. */
  let blocks = new Map<string, ScrollEntry>();
  /** Blocks whose paint changed (an offset, the hover) and nothing else: repainted alone. */
  const blocksChanged = new Set<string>();
  let destroyed = false;
  let themeJob = 0;
  let fontJob = 0;
  let themeAbort: AbortController | null = null;
  let prepareJob = 0;
  let renderJob = 0;
  /**
   * A `render` is on its way; `renderAgain` asks for another, at the width then, once it
   * is back. The session answers each width in turn, so while its answers take longer
   * than the width takes to change (a drag, in a busy Worker), asking for every width
   * would queue answers that only ever arrive late; one at a time, each shows.
   */
  let renderBusy = false;
  let renderAgain = false;
  /** A `withStates` is on its way; `statesAgain` asks for another once it is back. */
  let statesBusy = false;
  let statesAgain = false;
  /** A document is on its way: set from a Markdown or face change until it is shown. */
  let docPending = false;
  /** One `prepare` per frame, however many properties were set. */
  let prepareQueued = false;
  /** The Markdown was set: the next document decides which states stand. */
  let replacing = false;

  const emitError = (detail: Md2uiLoadError): void => {
    if (destroyed) return;
    host.dispatchEvent(new CustomEvent("md2ui-error", { detail, bubbles: true, composed: true }));
  };

  /**
   * The view's session. When it cannot open (its chunk fails to load, or it throws) the
   * view reports `pipeline` once and stays empty: this promise then never settles, so no
   * await on it rejects and nothing is asked of a session that is not there.
   */
  const opened = open().catch((error: unknown) => {
    emitError({ resource: "pipeline", url: "", message: String(error) });
    return new Promise<never>(() => undefined);
  });

  const imageStore = (): ImageStore =>
    createImageStore(
      pictures,
      pageBase(),
      () => schedule(),
      (url, message) => emitError({ resource: "image", url, message }),
    );
  /** The decoded images; a new, empty store once the page has been hidden. */
  let images = imageStore();
  /**
   * Holds the images the list on screen names, at the size they are drawn now: per
   * list, when the pixel ratio changes, and once a resize rests. Not while the width is
   * changing: a larger decode holds the thread it runs on (WebKit's decode, Chromium's
   * scaling), which is the page's with no Worker and the Worker's, which lays out the drag,
   * with one, so a drag draws the held decodes scaled and asks for larger ones when it
   * stops.
   */
  const requestImages = (): void => {
    if (destroyed || list === null || resizing) return;
    const screen = { width: layoutWidth(), height: Math.min(host.clientHeight, innerHeight) };
    images.request(list, pixelRatio, screen);
  };

  const layer = createAccessibilityLayer(layerEl, live, {
    activate: (ordinal) => {
      const target = targetByOrdinal(ordinal);
      if (target !== undefined) press(target);
    },
    copy: (nodeId) => {
      const target = list?.targets.find((t) => t.kind === "copy" && t.nodeId === nodeId);
      if (target?.kind === "copy") copyText(target.text);
    },
    moveSlider: (ordinal, value) => {
      const target = targetByOrdinal(ordinal);
      if (target === undefined || !sliderLive(target)) return;
      moved.add(ordinal);
      setStates(() => states.set(ordinal, { kind: "value", value }));
    },
    commitSlider: (ordinal) => {
      if (!moved.delete(ordinal)) return;
      const target = targetByOrdinal(ordinal);
      const state = states.get(ordinal);
      if (target !== undefined && state?.kind === "value") release(target, state.value);
    },
    scrolled: (nodeId, offset) => {
      offsets.set(nodeId, offset);
      blockChanged(nodeId);
    },
  });

  // --- the pipeline ---------------------------------------------------------------

  /** The view is no scroll container now (`syncScroller`): the page's scroll moves it. */
  let clipped = false;
  /** The width a scroll container's gutter took when the view stopped being one (CSS px). */
  let gutter = 0;
  /** `clipped`, and its sticky background sticks to the scroller that moves it. */
  let stuck = false;

  /** The view's width, without the gutter: the same whether or not it scrolls itself. */
  const layoutWidth = (): number => host.clientWidth - (clipped ? gutter : 0);

  /**
   * The scene whose words the layer holds. Laying a scene's words out is the browser's
   * text layout of every line (10–20 ms for 1,200 runs, at load 90), so they
   * follow the scene once the thread is idle, after it is painted, and never during a
   * resize, where each frame is a new width; until then the layer keeps the words it has.
   */
  let worded: ShownScene | null = null;
  let wordsQueued = false;

  const updateLayer = (): void => {
    if (rendered === null || list === null) return;
    layer.update({
      list,
      outline: rendered.outline,
      text: worded === rendered ? rendered.text : null,
      payload: (ordinal) => targets[ordinal],
      states: shownStates,
      disabled: props.disabled,
      originX: originX(list, layoutWidth()),
      offsets,
    });
    if (worded === rendered || wordsQueued) return;
    wordsQueued = true;
    whenIdle(() => {
      wordsQueued = false;
      if (destroyed || resizing) return;
      worded = rendered;
      updateLayer();
    });
  };

  /**
   * Shows `next`, which paints the states `painted`: a new painter, the content's size,
   * its images and the layer.
   */
  const show = (next: DisplayList, painted: ReadonlyMap<number, HostState>): void => {
    list = next;
    shownStates = painted;
    painter = createPainter(next, sprites);
    blocks = new Map(
      next.entries.flatMap((e) => (e.type === "scroll" ? [[e.nodeId, e] as const] : [])),
    );
    const padding = next.padding;
    // Whole pixels, as the canvas is: a fraction shorter, a view with `height: auto` would
    // scroll itself by that fraction.
    const width = padding.left + next.width + padding.right;
    right = Math.ceil(width);
    bottom = Math.ceil(padding.top + next.height + padding.bottom);
    content.style.width = `${width}px`;
    content.style.height = `${bottom}px`;
    whenIdle(requestImages);
    updateLayer();
    schedule();
  };

  /** Shows `rendered` as `states` show it; per state change. */
  const rebuild = (): void => {
    if (rendered === null) return;
    // A new width or state shows at once: a tween of the old list would move stale paint.
    stopMotion();
    if (states.size === 0) {
      show(rendered.list, new Map());
      return;
    }
    if (statesBusy) statesAgain = true;
    else void applyStates();
  };

  /**
   * One `withStates` at a time: a slider dragged faster than the session answers shows
   * each answer, then asks again with the latest states.
   */
  const applyStates = async (): Promise<void> => {
    const scene = rendered;
    const painting = new Map(states);
    statesBusy = true;
    statesAgain = false;
    const next = await (await opened).withStates(painting);
    statesBusy = false;
    if (destroyed) return;
    if (scene === rendered && next !== null) show(next, painting);
    if (statesAgain || scene !== rendered) rebuild();
  };

  /**
   * Per width: the scene at the current width, painted as soon as it is back (on the main
   * thread, in the frame the width changed in). The session keeps the scene while the
   * effective width stands; the layer still follows the centring.
   */
  const layout = async (): Promise<void> => {
    if (rendered === null) return;
    if (renderBusy) {
      renderAgain = true;
      return;
    }
    renderBusy = true;
    renderAgain = false;
    const job = ++renderJob;
    const scene = await (await opened).render(layoutWidth());
    renderBusy = false;
    if (destroyed) return;
    if (job === renderJob) {
      if (scene === null) updateLayer();
      else {
        rendered = scene;
        settling = true;
        rebuild();
      }
      // A frame later would show the old paint at the new size.
      if (frame !== 0) {
        cancelAnimationFrame(frame);
        paint();
      }
    }
    if (renderAgain) void layout();
  };

  /** The Markdown laid out: while the message streams, only its closed blocks. */
  const shownMarkdown = (): string => {
    const text = props.markdown;
    if (!props.streaming) return text;
    if (text !== stream.text) {
      const from = text.startsWith(stream.text) ? stream.resume : 0;
      stream = { text, ...closedPrefix(streamKit, text, from) };
    }
    return stream.prefix;
  };

  /** Per document: the core over the current Markdown, theme and fonts. */
  const prepare = async (): Promise<void> => {
    prepareQueued = false;
    if (destroyed || !facesReady) return;
    const job = ++prepareJob;
    const askedAt = performance.now();
    // A width asked for before this document is answered for the one it replaces.
    renderJob += 1;
    const markdown = shownMarkdown();
    const streamed = props.streaming;
    const width = layoutWidth();
    asked = markdown;
    const session = await opened;
    const prepared = await session.prepare(markdown, width);
    if (job !== prepareJob || destroyed || prepared === null) return;
    if (prepared.upgrade) {
      void session.highlighted().then(() => {
        if (job === prepareJob && !destroyed) schedulePrepare();
      });
    }
    targets = prepared.targets;
    docPending = false;
    docMessageId = props.messageId;
    // A Markdown set while this one was on its way is settled here too, by its text.
    if (replacing || held !== null || whole?.markdown !== markdown) {
      replacing = false;
      settleStates({ markdown, targets }, streamed);
    }
    const before = list;
    const seen = before === null ? null : visible();
    const mode = props.motion;
    const was = shape;
    shape = prepared.shape;
    rendered = prepared.scene;
    if (!streamed) settling = true;
    rebuild();
    // A list was shown, so a document was prepared, and its shape kept.
    if (before !== null && was !== null && list !== null && list !== before) {
      replaced({ list: before, shape: was }, { list, shape: prepared.shape }, seen, askedAt, mode);
    }
    if (layoutWidth() !== width) void layout();
    // Painted now, not a frame later: a stream's document is prepared in a frame.
    if (frame !== 0) {
      cancelAnimationFrame(frame);
      paint();
    }
  };

  /**
   * The states `doc` shows (md2ui `protocol/README.md`, *Lifecycle* 3). Whole, those its
   * replacement of the last whole document left standing. While it is `streamed`, those
   * its closed blocks show on targets left as they were, so a tick does not blink out
   * while a replacement arrives; the last whole document's wait aside until the message
   * is whole and can be compared.
   */
  const settleStates = (doc: ShownDocument, streamed: boolean): void => {
    // A tap on a streamed document, between two deltas or after the message's end has
    // arrived and before it is laid out whole (0s), is the user's on the same target.
    if (held !== null) {
      for (const [ordinal, state] of states) {
        if (settled.get(ordinal) !== state) streamedChanges.set(ordinal, state);
      }
      for (const ordinal of settled.keys()) {
        if (!states.has(ordinal)) streamedChanges.set(ordinal, undefined);
      }
    }
    const set = held ?? new Map(states);
    states.clear();
    sent.clear();
    held = streamed ? set : null;
    if (whole !== null) {
      const kept = streamed ? standingStates(whole, doc, set) : carriedStates(whole, doc, set);
      for (const [ordinal, state] of kept) states.set(ordinal, state);
    }
    for (const [ordinal, state] of streamedChanges) {
      if (doc.targets[ordinal] === undefined) continue;
      if (state === undefined) states.delete(ordinal);
      else states.set(ordinal, state);
    }
    if (!streamed) {
      whole = doc;
      streamedChanges.clear();
    }
    settled = new Map(states);
    for (const ordinal of moved) if (!states.has(ordinal)) moved.delete(ordinal);
  };

  /** Whatever moves stops where it ends, and what it held is given back. */
  const stopMotion = (): void => {
    transition = null;
    if (fade === null) return;
    fade.animation.cancel();
    fade.layer.width = 0;
    fade.layer.height = 0;
    fade.layer.remove();
    fade = null;
  };

  /**
   * `after`, asked for at `askedAt` with the host's `mode` (C6 `motion`), has replaced
   * `before` (each a list and its document's shape), of which `seen` was on screen: the scroll keeps the first anchor still shown
   * where it was, and the new document moves into place from the old, or, a new page,
   * the old fades out over it.
   */
  const replaced = (
    { list: before, shape: was }: { list: DisplayList; shape: DocumentShape },
    { list: after, shape: is }: { list: DisplayList; shape: DocumentShape },
    seen: Visible | null,
    askedAt: number,
    mode: Md2uiViewProperties["motion"],
  ) => {
    // The old list in the new one's ids: an identical node is matched by its place among
    // the nodes around it, not by its occurrence, which an edit above it shifts (ADR-104).
    // A page the host says is new is not matched: nothing on it is the old one's.
    const page = mode === "page";
    const from = page ? before : alignNodeIds(before, after);
    const width = layoutWidth();
    // What was seen, in a list's content space.
    const view = (list: DisplayList, seen: Visible) => ({
      ...seen,
      x: seen.x - originX(list, width),
      y: seen.y - list.padding.top,
    });
    // A new page keeps the scroll as it is: nothing on it is what was being read. One that
    // kept little content but its structure is the same page with new values.
    const fresh =
      page ||
      (mode === "auto" &&
        seen !== null &&
        keptShare(before, from, after, view(before, seen), view(after, seen)) < NEW_PAGE &&
        shapeShare(was, before, view(before, seen), is, after, view(after, seen)) < SAME_SHAPE);
    const drift = fresh || seen === null ? 0 : anchorDrift(after, anchorsOf(from, seen));
    let scrolled = 0;
    if (drift !== 0) {
      const scroller = scrollerOf(host);
      const from = scroller.scrollTop;
      scroller.scrollTop = from + drift;
      scrolled = scroller.scrollTop - from;
    }
    // A list was shown, so a theme was set, and its motion with it. Motion is for what
    // the user sees.
    if (motion === null || seen === null) return;
    // A document asked for within one tween of the last is a burst (a stream's deltas, a
    // frame apart): it shows at once, or every delta would restart the motion. Timed by
    // when each was asked for, not answered, so the time the pipeline takes (in a busy
    // Worker, longer than a tween) never turns a burst into a run of tweens.
    const burst = askedAt - replacedAt < motion.duration;
    replacedAt = askedAt;
    if (burst) return;
    if (fresh) {
      fadeOut(seen, motion);
      return;
    }
    const tween = startTween(motion);
    if (tween === null) return;
    // Where the old content now sits in the new content space, as seen on screen.
    const shift = {
      x: originX(before, width) - originX(after, width),
      y: scrolled + before.padding.top - after.padding.top,
    };
    const diff = diffDisplayLists(from, after);
    transition = { paint: createTransition(from, after, diff, { shift, sprites }), tween };
    schedule();
  };

  /**
   * The page `seen` showed, faded out over the new one: its background and content, as
   * the canvases still hold them, copied to a canvas the size of the visible part, in
   * the place on screen it was seen in, cut where the new scroll area ends. The compositor runs the fade; the copy
   * is given back as it ends.
   */
  const fadeOut = (seen: Visible, theme: MotionTheme): void => {
    const layer = document.createElement("canvas");
    const animation = startFade(layer, theme);
    if (animation === null) return;
    // Where the screen shows the scroll now: a shorter page may have pulled it up.
    const top = (visible() ?? seen).y;
    const height = Math.min(seen.height, scrollEnd() - top);
    const layerCtx = layer.getContext("2d");
    if (height <= 0 || layerCtx === null || shown === null) {
      animation.cancel();
      return;
    }
    layer.className = "fade";
    layer.width = Math.round(seen.width * pixelRatio);
    layer.height = Math.round(height * pixelRatio);
    layer.style.width = `${seen.width}px`;
    layer.style.height = `${height}px`;
    layer.style.transform = `translate(${seen.x}px, ${top}px)`;
    // The background canvas holds the part around the one seen, wherever its scroller has
    // moved it.
    const backY = back.getBoundingClientRect().top - content.getBoundingClientRect().top;
    layerCtx.drawImage(back, 0, (backY - top) * pixelRatio);
    layerCtx.drawImage(canvas, (shown.x - seen.x) * pixelRatio, (shown.y - seen.y) * pixelRatio);
    canvas.after(layer);
    fade = { layer, animation };
    const ended = fade;
    animation.onfinish = () => {
      if (fade === ended) stopMotion();
    };
  };

  const schedulePrepare = (): void => {
    docPending = true;
    if (prepareQueued) return;
    prepareQueued = true;
    // Properties set together (markdown, then messageId), and every delta streamed
    // before the next frame, reach one `prepare`.
    requestAnimationFrame(() => void prepare());
  };

  /**
   * The theme's fonts, loaded into the page, which paints with them, then handed to the
   * session, which measures with them (in a Worker, only `fonts`: it cannot see the
   * page's `@font-face`); then the emoji font instances the session made of them, which
   * the page paints with too.
   */
  const loadFaces = async (): Promise<void> => {
    if (theme === null) return;
    const job = ++fontJob;
    const { fonts } = props;
    const faced = theme;
    reportMissing(faced, fonts);
    // Only the faces the theme draws in:
    // each face the page loads holds its own copy of the font's data.
    const drawn = themeFonts(faced, fonts, pageBase());
    const failed = new Set<FontSource>();
    await loadFonts(drawn, {
      faces,
      pageFamilies: themeFamilies(faced),
      onFontError: (source, error) => {
        failed.add(source);
        emitError({ resource: "font", url: source.url, message: error.message });
      },
    });
    const session = await opened;
    // Only the latest faces reach the session, in the order they were asked for.
    if (job !== fontJob || destroyed) return;
    const loaded = drawn.filter((font) => !failed.has(font));
    const { instances, failed: inSession } = await session.setFaces({
      theme: faced,
      fonts,
      loaded,
      pageBase: pageBase(),
    });
    if (job !== fontJob || destroyed) return;
    // Loaded here but not in the session's Worker, which measures them in a fallback face.
    inSession.forEach(emitError);
    // Made from fonts that loaded, so none fails that has not been reported already.
    await loadFonts(instances, { faces, onFontError: () => undefined });
    if (job !== fontJob || destroyed) return;
    variations = new Map(
      instances.flatMap((i) =>
        i.variationSettings === undefined ? [] : [[i.family, i.variationSettings] as const],
      ),
    );
    facesReady = true;
    schedulePrepare();
  };

  /** The families of `missing.theme` already reported missing from `fonts`. */
  let missing: { readonly theme: ResolvedTheme; readonly families: Set<string> } | null = null;
  /** md2ui's own default families (Arial): the platform's faces, which no host gives. */
  let defaultFamilies: ReadonlySet<string> | null = null;

  /**
   * Reports each family `faced` draws in that none of `fonts` gives, once per theme: in a
   * Worker it is measured in a fallback face, even where the page has it through its
   * own `@font-face`. A CSS generic family, and a family of md2ui's default theme, are
   * the platform's, never a host face.
   */
  const reportMissing = (faced: ResolvedTheme, fonts: readonly FontSource[]): void => {
    if (missing?.theme !== faced) missing = { theme: faced, families: new Set() };
    defaultFamilies ??= new Set(themeFamilies(parseTheme("")).map((f) => f.toLowerCase()));
    const given = new Set(fonts.map((font) => font.family.toLowerCase()));
    for (const family of themeFamilies(faced)) {
      const key = family.toLowerCase();
      const platform = key === "" || isGenericFamily(key) || defaultFamilies.has(key);
      if (platform || given.has(key) || missing.families.has(key)) continue;
      missing.families.add(key);
      emitError({
        resource: "font",
        url: "",
        family,
        message: `The theme draws in "${family}", which none of the view's fonts gives: it is measured in a fallback face`,
      });
    }
  };

  const refreshTheme = async (): Promise<void> => {
    const job = ++themeJob;
    themeAbort?.abort();
    const abort = new AbortController();
    themeAbort = abort;
    let loaded: Awaited<ReturnType<typeof loadTheme>>;
    try {
      loaded = await loadTheme(props, pageBase(), abort.signal);
    } catch {
      return; // aborted by a newer theme
    }
    if (job !== themeJob || destroyed) return;
    if (loaded.error !== null) emitError(loaded.error);
    theme = loaded.theme;
    motion = themeMotion(theme);
    await loadFaces();
  };

  // --- painting -------------------------------------------------------------------

  let frame = 0;
  let onScreen = true;
  let pixelRatio = window.devicePixelRatio || 1;

  /** The part of the document the user can see: the view's own box, cut by the window. */
  const visible = (): Visible | null => {
    const box = host.getBoundingClientRect();
    const top = box.top + host.clientTop;
    const above = Math.max(0, -top);
    const below = Math.min(host.clientHeight, window.innerHeight - top);
    const y = Math.floor(host.scrollTop + above);
    const height = Math.ceil(host.scrollTop + below) - y;
    const width = layoutWidth();
    if (!onScreen || height <= 0 || width <= 0) return null;
    return { x: host.scrollLeft, y, width, height };
  };

  /**
   * For a view out of sight but within a screen of the window, the part that will show
   * first as it comes in: its top screen when it lies below the window, its bottom screen
   * when above. Null farther away. Measured, not observed: an IntersectionObserver's
   * margin stops at an iframe's or a scroller's edge.
   */
  const approaching = (): Visible | null => {
    const width = layoutWidth();
    const screen = window.innerHeight;
    const height = Math.min(host.clientHeight, screen);
    const box = host.getBoundingClientRect();
    if (width <= 0 || height <= 0 || box.bottom < -screen || box.top > 2 * screen) return null;
    const below = box.top > 0;
    const y = below ? host.scrollTop : host.scrollTop + host.clientHeight - height;
    return { x: host.scrollLeft, y: Math.floor(y), width, height };
  };

  const viewOf = (v: Visible): View => ({
    width: v.width,
    height: v.height,
    scrollX: v.x,
    scrollY: v.y,
  });

  /** The part of the document the content canvas holds: the visible part and room around it. */
  let shown: Visible | null = null;
  /** The pixel ratio `shown` was painted at. */
  let shownRatio = 0;
  /** Something besides the scroll changed what the canvases show. */
  let dirty = true;
  /** The visible part's size the background was painted at, and its pixel ratio. */
  let backSize = "";
  /**
   * The view's width is changing: until it rests (`RESIZE_QUIET_MS`), each frame paints
   * only the visible part, at the exact width, and the room around it once it rests or
   * the user scrolls (painting the room at every width change made
   * a drag's frames up to twice as long on long documents).
   */
  let resizing = false;
  let resizeQuiet = 0;
  /** The width the last resize observation saw; -1 before the first. */
  let observedWidth = -1;

  // The canvas stays inside the scroll area the document makes, or the view's own box where
  // that is larger, wherever the scroll is: a rubber band reports a scroll past the end
  // (WebKit), and a canvas placed there made the scroll area longer, so the bounce reached
  // further, for as long as the user kept scrolling.

  /** How far down the scroll area reaches (CSS px). */
  const scrollEnd = (): number => Math.max(bottom, host.clientHeight);

  /** The content canvas's left for `v`: its scroll, cut where the scroll area ends. */
  const leftOf = (v: Visible): number => Math.min(v.x, Math.max(right, layoutWidth()) - v.width);

  /**
   * The room kept above and below `v`: as much as the visible part, cut to the canvas
   * limit. None while a document moves into place, which paints every frame, or while
   * the width changes.
   */
  const overscan = (v: Visible): number => {
    if (transition !== null || resizing) return 0;
    const rows = CANVAS_PIXELS / (v.width * pixelRatio * pixelRatio);
    return Math.max(0, Math.min(v.height, Math.floor((rows - v.height) / 2)));
  };

  /** Whether `held` still shows `v` with half its room to spare on the side scrolled toward. */
  const holds = (held: Visible, v: Visible): boolean => {
    const spare = overscan(v) / 2;
    return (
      held.x === leftOf(v) &&
      held.width === v.width &&
      held.y <= Math.max(0, v.y - spare) &&
      held.y + held.height >= Math.min(scrollEnd(), v.y + v.height + spare)
    );
  };

  /**
   * How far past the window, above it and below it alike, the page may be seen: a phone
   * shows it under the status bar and under a translucent toolbar, beyond `innerHeight`
   * (iPhone Safari 26), and only `viewport-fit=cover`, the host's to set, would
   * tell either inset. The screen's height bounds them both together; half the window
   * bounds the cost where the screen is no measure of it (a short window on a tall
   * screen, a phone on its side, whose screen keeps its upright height).
   */
  const beyond = (): number => {
    const inner = window.innerHeight;
    return Math.max(0, Math.min(screen.height - inner, Math.floor(inner / 2)));
  };

  /**
   * The page background's part of the scrolled content around `v`: the view's width, and
   * its height up to the window's and what may be seen beyond it, from that far above
   * `v`'s top, cut to the view's scrollport and where the scroll area ends. Its size
   * changes only with the view's and the window's, never with the scroll, so a scroll
   * moves it but never paints it.
   */
  const backPart = (v: Visible): Visible => {
    const margin = beyond();
    const height = Math.min(host.clientHeight, window.innerHeight + 2 * margin);
    const port = Math.floor(host.scrollTop);
    const top = Math.max(v.y - margin, port);
    const y = Math.min(top, port + host.clientHeight - height, scrollEnd() - height);
    return { ...v, y: Math.max(0, y), height };
  };

  /** The page background under `v`, placed on it in the scrolled content. */
  const paintBack = (v: Visible, p: Painter, state: Omit<Frame, keyof View>): void => {
    const part = backPart(v);
    // Sticky, the canvas already sits where the scroll puts the viewport: the view's own,
    // or, `stuck`, the page's, which the browser follows on its compositor. A sticky box
    // adds to the scroll area only where the flow put it, so it may follow a bounce past
    // the document's end and fill it. Stuck, it sticks as far above the window as it
    // reaches past it; in the view's own scroll it sticks to the view's top, and the
    // view's box cuts what lies past it.
    back.style.transform = stuck
      ? ""
      : `translate(${part.x - host.scrollLeft}px, ${part.y - host.scrollTop}px)`;
    const top = stuck ? `${-beyond()}px` : "";
    if (back.style.top !== top) back.style.top = top;
    const size = `${part.width}x${part.height}@${pixelRatio}`;
    if (!dirty && size === backSize) return;
    backSize = size;
    const w = Math.round(part.width * pixelRatio);
    const h = Math.round(part.height * pixelRatio);
    if (back.width !== w) back.width = w;
    if (back.height !== h) back.height = h;
    back.style.width = `${part.width}px`;
    back.style.height = `${part.height}px`;
    // Taking no room in the flow, it stays stuck to the last fraction of a pixel of the scroll.
    back.style.marginBottom = `${-part.height}px`;
    p.paintBackground(backCtx, { ...viewOf(part), ...state });
  };

  /**
   * A view whose document fits it is no scroll container, so its sticky background
   * sticks to whichever scroller moves the view, and the browser holds it in place on
   * its compositor (placed from a scroll event, it trailed the page's
   * scroll by a frame). One whose document overflows it scrolls itself again. The gutter
   * stays out of the layout either way (`layoutWidth`), so the change moves nothing.
   * Where the background would stick to a scroller that does not move the view (an
   * ancestor with `overflow: hidden`), the view places it, as it does in its own scroll.
   */
  const syncScroller = (): void => {
    // The document's size, not the scroll area's: the canvases sized for the last one
    // still reach as far as it did until this frame paints.
    const fits = bottom <= host.clientHeight && right <= host.clientWidth;
    if (host.hasAttribute(FITS) !== fits) {
      const before = host.clientWidth;
      host.toggleAttribute(FITS, fits);
      if (fits) gutter = host.clientWidth - before;
    }
    // The page's own style for the element wins over the view's.
    const { overflowX, overflowY } = getComputedStyle(host);
    clipped = overflowX === "clip" && overflowY === "clip";
    stuck = clipped && stickyScroller(host) === scrollerOf(host);
  };

  /** Both canvases emptied: their backing stores are given back at once. */
  const releaseCanvases = (): void => {
    for (const c of [canvas, back]) {
      if (c.width !== 0) c.width = 0;
      if (c.height !== 0) c.height = 0;
    }
    shown = null;
    backSize = "";
  };

  const paint = (): void => {
    frame = 0;
    if (destroyed || painter === null) return;
    syncScroller();
    const seen = visible();
    // Motion is for what the user sees; a view out of sight shows where it ends.
    if (seen === null) stopMotion();
    const v = seen ?? approaching();
    if (v === null) {
      releaseCanvases();
      return;
    }
    const state = {
      pixelRatio,
      images: images.lookup,
      loading: images.loading,
      offsets,
      hovered,
      variations,
    };
    paintBack(v, painter, state);
    const kept = !dirty && shown !== null && shownRatio === pixelRatio && holds(shown, v);
    dirty = false;
    if (kept && shown !== null) {
      const frameState: Frame = { ...viewOf(shown), ...state, background: false };
      for (const nodeId of blocksChanged) {
        const block = blocks.get(nodeId);
        if (block !== undefined) painter.repaint(ctx, frameState, block.bounds);
      }
      blocksChanged.clear();
      return;
    }
    blocksChanged.clear();
    // The same height wherever the scroll is, so the canvas keeps its backing store; it
    // never reaches past the document, even while a bounce shows past it: placed there,
    // it would lengthen the scroll.
    const end = scrollEnd();
    const height = Math.min(end, v.height + 2 * overscan(v));
    const top = Math.min(Math.max(0, v.y - overscan(v)), end - height);
    const held: Visible = { x: leftOf(v), y: top, width: v.width, height };
    shown = held;
    shownRatio = pixelRatio;
    const w = Math.round(held.width * pixelRatio);
    const h = Math.round(held.height * pixelRatio);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    canvas.style.width = `${held.width}px`;
    canvas.style.height = `${held.height}px`;
    canvas.style.transform = `translate(${held.x}px, ${held.y}px)`;
    const frameState: Frame = { ...viewOf(held), ...state, background: false };
    if (transition === null) {
      painter.paint(ctx, frameState);
      if (settling) {
        settling = false;
        // The background is its part's size.
        painter.settle({ ...viewOf(backPart(v)), ...state });
      }
      return;
    }
    transition.paint.paint(ctx, frameState, transition.tween.progress());
    if (transition.tween.done()) transition = null;
    // The next frame paints the last of the motion, or, once it is over, the room around it.
    schedule();
  };

  /** A paint next frame of whatever changed; the scroll alone paints only what it needs. */
  const schedule = (): void => {
    dirty = true;
    scheduleScroll();
  };

  const scheduleScroll = (): void => {
    if (frame === 0 && !destroyed) frame = requestAnimationFrame(paint);
  };

  /** A paint next frame of the block `nodeId` alone, unless more has changed. */
  const blockChanged = (nodeId: string): void => {
    blocksChanged.add(nodeId);
    scheduleScroll();
  };

  /** The width changed: the room around the visible part waits until it rests. */
  const resized = (): void => {
    resizing = true;
    clearTimeout(resizeQuiet);
    resizeQuiet = window.setTimeout(resizeOver, RESIZE_QUIET_MS);
  };

  /** The resize is over, or the user scrolled during it: the next frame paints the room. */
  const resizeOver = (): void => {
    clearTimeout(resizeQuiet);
    if (!resizing) return;
    resizing = false;
    requestImages();
    updateLayer();
    scheduleScroll();
  };

  // --- input ----------------------------------------------------------------------

  const targetByOrdinal = (ordinal: number): ActionTarget | SliderTarget | undefined =>
    list?.targets.find(
      (t): t is ActionTarget | SliderTarget => t.kind !== "copy" && t.ordinal === ordinal,
    );

  const context = () => ({
    messageId: docMessageId,
    states,
    targets: list?.targets ?? [],
    table: targets,
    disabled: props.disabled,
  });

  /** A slider the user may move now: not waiting, not silenced. */
  const sliderLive = (target: ActionTarget | SliderTarget): boolean => {
    const payload = targets[target.ordinal];
    return (
      payload?.slider !== undefined &&
      !props.disabled &&
      !waiting(target, states, list?.targets ?? [])
    );
  };

  const setStates = (change: () => void): void => {
    change();
    rebuild();
  };

  /**
   * The agent answered these targets (md2ui `released`): only a button it held waits, so
   * a tick or a value the user set stays. A streamed replacement's held states lose them
   * too, or its end would carry them back.
   */
  const releasePending = (ordinals: readonly number[]): void => {
    let changed = false;
    for (const set of held === null ? [states] : [states, held]) {
      for (const ordinal of ordinals) {
        if (set.get(ordinal)?.kind === "pending") changed = set.delete(ordinal) || changed;
      }
    }
    if (changed) rebuild();
  };

  const copyText = (text: string): void => {
    navigator.clipboard.writeText(text).then(
      () => layer.announce("Copied"),
      () => layer.announce("Copy failed"),
    );
  };

  const scrollToAnchor = (id: string): void => {
    const anchor = list?.anchors.find((a) => a.id === id);
    if (list === null || anchor === undefined) return;
    probe.style.top = `${list.padding.top + anchor.y}px`;
    probe.scrollIntoView({ block: "start" });
  };

  /** Reports `action`; unless the host cancels it, the view does what it means. */
  const report = (result: Extract<Tap, { kind: "action" }>, before: HostState | undefined) => {
    const action: Md2uiAction = result.action;
    const event = new CustomEvent("md2ui-action", {
      detail: action,
      bubbles: true,
      composed: true,
      cancelable: true,
    });
    const proceed = host.dispatchEvent(event);
    if (!proceed || result.state === null) {
      if (!proceed && result.state?.kind === "value") {
        // A cancelled drag goes back to what was shown before it.
        setStates(() =>
          before === undefined ? states.delete(action.ordinal) : states.set(action.ordinal, before),
        );
      }
      if (proceed && action.kind === "link") openLink(action.href);
      return;
    }
    if (result.state.kind === "value") sent.set(action.ordinal, result.state.value);
    const state = result.state;
    setStates(() => {
      states.set(action.ordinal, state);
      for (const other of result.unchosen ?? [])
        states.set(other, { kind: "checked", checked: false });
    });
  };

  const openLink = (href: string): void => {
    const opening = linkOpening(href, location.href);
    if (opening === null) return;
    if (opening.newTab) window.open(opening.url, "_blank", "noopener");
    else window.open(opening.url, "_self");
  };

  /** A tap on a target that is not a slider. */
  const press = (target: ActionTarget | SliderTarget): void => {
    const payload = targets[target.ordinal];
    if (payload === undefined) return;
    const result = tap(target, payload, context());
    if (result.kind === "anchor") scrollToAnchor(result.id);
    else if (result.kind === "action") report(result, states.get(target.ordinal));
  };

  /** A tap on a count's ➖ or ➕: one step, reported as a slider let go there. */
  const step = (target: ActionTarget | SliderTarget): void => {
    const payload = targets[target.ordinal];
    const value = payload === undefined ? null : stepped(target, payload, states);
    if (value !== null) release(target, value, states.get(target.ordinal));
  };

  /** A slider let go at `value`: reported unless unchanged since it was last sent. */
  const release = (target: ActionTarget | SliderTarget, value: number, before?: HostState) => {
    const payload = targets[target.ordinal];
    if (payload === undefined || sent.get(target.ordinal) === value) return;
    const result = tap(target, payload, context(), value);
    if (result.kind === "action") report(result, before);
  };

  const pointIn = (event: MouseEvent): { x: number; y: number } => {
    const box = canvas.getBoundingClientRect();
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };

  const hitAt = (event: MouseEvent) => {
    if (painter === null || shown === null) return null;
    const { x, y } = pointIn(event);
    return painter.hitTest(viewOf(shown), x, y);
  };

  /** A slider being dragged: its target and axis, and the state it had before the drag. */
  let drag: {
    target: ActionTarget | SliderTarget;
    axis: SliderTarget["axis"];
    before: HostState | undefined;
    pointer: number;
  } | null = null;
  let dragged = false;
  /** The pointer down is on a target: it starts no selection. */
  let pressed = false;

  /**
   * The axis a live slider drags along. md2ui drags any region whose action carries a
   * value (`mouse_button_callback`). A slider linked to an agent reports an agent action,
   * so C4 gives it an action target, which names no axis: it takes the theme's, as every
   * slider target does.
   */
  const dragAxis = (target: ActionTarget | SliderTarget): SliderTarget["axis"] | null => {
    if (target.kind === "slider") return target.axis;
    return theme === null ? null : theme.datapoints.sliders.axis;
  };

  const dragValue = (event: PointerEvent): number | null => {
    if (drag === null) return null;
    const { target, axis } = drag;
    const payload = targets[target.ordinal];
    if (list === null || shown === null || payload?.slider === undefined) return null;
    const { x, y } = pointIn(event);
    const cx = x - originX(list, shown.width) + shown.x;
    const cy = y - list.padding.top + shown.y;
    const { max, decimals } = payload.slider;
    return sliderValue(target.rect, axis, cx, cy, max, decimals);
  };

  const capture = (pointer: number): void => {
    try {
      canvas.setPointerCapture(pointer);
    } catch {
      // A pointer that is no longer active cannot be captured; the drag still works
      // while it stays over the canvas.
    }
  };

  const onPointerDown = (event: PointerEvent): void => {
    dragged = false;
    const target = hitAt(event)?.target;
    pressed = target !== undefined && target !== null;
    if (target === undefined || target === null || target.kind === "copy") return;
    // A count's button is tapped, never dragged.
    if (target.step !== undefined || !sliderLive(target)) return;
    const axis = dragAxis(target);
    if (axis === null) return;
    drag = { target, axis, before: states.get(target.ordinal), pointer: event.pointerId };
    capture(event.pointerId);
    onPointerMove(event);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (drag !== null && event.pointerId === drag.pointer) {
      const value = dragValue(event);
      const { ordinal } = drag.target;
      if (value !== null) setStates(() => states.set(ordinal, { kind: "value", value }));
      return;
    }
    const hit = hitAt(event);
    const over = event.pointerType === "mouse" ? (hit?.scroll?.nodeId ?? null) : null;
    if (over !== hovered) {
      if (hovered !== null) blockChanged(hovered);
      if (over !== null) blockChanged(over);
      hovered = over;
    }
    const target = hit?.target ?? null;
    const payload =
      target === null ? undefined : target.kind === "copy" ? null : targets[target.ordinal];
    const quiet =
      payload === undefined ||
      (target !== null && target.kind !== "copy" && waiting(target, states, list?.targets ?? [])) ||
      (payload !== null && payload.kind !== "link" && payload.kind !== "anchor" && props.disabled);
    content.style.cursor = quiet ? "" : "pointer";
  };

  const onPointerUp = (event: PointerEvent): void => {
    pressed = false;
    if (drag === null || event.pointerId !== drag.pointer) return;
    const { target, before } = drag;
    drag = null;
    dragged = true;
    const state = states.get(target.ordinal);
    if (state?.kind === "value") release(target, state.value, before);
  };

  const onPointerCancel = (event: PointerEvent): void => {
    pressed = false;
    if (drag === null || event.pointerId !== drag.pointer) return;
    const { target, before } = drag;
    drag = null;
    setStates(() =>
      before === undefined ? states.delete(target.ordinal) : states.set(target.ordinal, before),
    );
  };

  /** The mouse left the content: no block is hovered. */
  const onPointerLeave = (): void => {
    if (hovered === null) return;
    blockChanged(hovered);
    hovered = null;
  };

  /** A press on a target selects no text, as a native link or button does not. */
  const onSelectStart = (event: Event): void => {
    if (pressed) event.preventDefault();
  };

  /**
   * Whether `event` reached the ink: the canvas, a code block's scroller over it, or the
   * words laid on it. A control of the layer that the keyboard clicks has done what it
   * does already.
   */
  const onInk = (event: Event): boolean =>
    event.target === canvas ||
    (event.target instanceof Element && event.target.closest(`.${SCROLLER}, .${WORDS}`) !== null);

  const onClick = (event: MouseEvent): void => {
    if (!onInk(event)) return;
    // A press that selected text, by a drag or a double click, taps nothing.
    if (document.getSelection()?.type === "Range") return;
    if (dragged) {
      dragged = false;
      return;
    }
    const target = hitAt(event)?.target;
    if (target === undefined || target === null) return;
    if (target.kind === "copy") copyText(target.text);
    else if (target.step !== undefined) step(target);
    else if (target.kind !== "slider") press(target);
  };

  // --- observers ------------------------------------------------------------------

  // A new effective width relayouts; any other new size (a width the scene already
  // fits, the view's own height, its content's) only repaints.
  const resize = new ResizeObserver(() => {
    const width = layoutWidth();
    if (observedWidth >= 0 && width !== observedWidth) resized();
    observedWidth = width;
    schedule();
    void layout();
  });
  resize.observe(host);

  const intersection = new IntersectionObserver((records) => {
    const last = records.at(-1);
    if (last !== undefined) onScreen = last.isIntersecting;
    schedule();
  });
  intersection.observe(host);

  let ratioQuery: MediaQueryList | null = null;
  const watchRatio = (): void => {
    ratioQuery?.removeEventListener("change", onRatio);
    pixelRatio = window.devicePixelRatio || 1;
    ratioQuery = window.matchMedia(`(resolution: ${pixelRatio}dppx)`);
    ratioQuery.addEventListener("change", onRatio);
  };
  function onRatio(): void {
    watchRatio();
    requestImages();
    schedule();
  }
  watchRatio();

  // A scroll during a resize shows the room around the visible part: it is painted at once.
  const onScroll = (event: Event): void => {
    if (event.type === "scroll") resizeOver();
    scheduleScroll();
  };
  host.addEventListener("scroll", onScroll, { passive: true });
  // Any scroller around the view (the page, a chat thread) moves what is visible.
  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  // On the content: the canvas's, and its code blocks' scrollers', which lie over it.
  content.addEventListener("pointerdown", onPointerDown);
  content.addEventListener("pointermove", onPointerMove);
  content.addEventListener("pointerup", onPointerUp);
  content.addEventListener("pointercancel", onPointerCancel);
  content.addEventListener("pointerleave", onPointerLeave);
  content.addEventListener("click", onClick);
  content.addEventListener("selectstart", onSelectStart);

  // The page's own lifetime. A page left for another may go whole into the back-forward
  // cache, which keeps every view as it was until the user comes back or the browser
  // evicts it, in the same process as the next page. So a hidden page gives back what
  // is cheap to make again: the canvases, the decoded images and the shadow bitmaps. The
  // document, its scene and the user's states stay; a page shown again from the cache
  // asks for its images again and paints.
  const onPageHide = (): void => {
    stopMotion();
    releaseCanvases();
    images.dispose();
    images = imageStore();
    sprites.keepOnly(new Set());
  };
  const onPageShow = (event: PageTransitionEvent): void => {
    if (!event.persisted) return;
    requestImages();
    schedule();
  };
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);

  void refreshTheme();

  // --- the properties (C6), already checked by the element -------------------------

  return {
    get markdown() {
      return props.markdown;
    },
    set markdown(value) {
      props.markdown = value;
      // While streaming, a delta that closes no block changes nothing shown.
      if (props.streaming && shownMarkdown() === asked) return;
      replacing = true;
      schedulePrepare();
    },
    get messageId() {
      return props.messageId;
    },
    set messageId(value) {
      props.messageId = value;
      // With no document on its way, the one shown is relabelled.
      if (!docPending) docMessageId = value;
    },
    get themeSrc() {
      return props.themeSrc;
    },
    set themeSrc(value) {
      props.themeSrc = value;
      void refreshTheme();
    },
    get themeText() {
      return props.themeText;
    },
    set themeText(value) {
      props.themeText = value;
      void refreshTheme();
    },
    get assetBase() {
      return props.assetBase;
    },
    set assetBase(value) {
      props.assetBase = value;
      void refreshTheme();
    },
    get fonts() {
      return props.fonts;
    },
    set fonts(value) {
      props.fonts = value;
      void loadFaces();
    },
    get disabled() {
      return props.disabled;
    },
    set disabled(value) {
      props.disabled = value;
      updateLayer();
    },
    get streaming() {
      return props.streaming;
    },
    set streaming(value) {
      props.streaming = value;
      // Cleared, the whole message is laid out; set, only its closed blocks.
      if (shownMarkdown() !== asked) schedulePrepare();
    },
    get motion() {
      return props.motion;
    },
    set motion(value) {
      // Read by the next document asked for.
      props.motion = value;
    },
    release(ordinals) {
      releasePending(ordinals);
    },
    destroy() {
      destroyed = true;
      themeAbort?.abort();
      images.dispose();
      void opened.then((session) => session.dispose());
      if (frame !== 0) cancelAnimationFrame(frame);
      clearTimeout(resizeQuiet);
      resize.disconnect();
      intersection.disconnect();
      ratioQuery?.removeEventListener("change", onRatio);
      host.removeEventListener("scroll", onScroll);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("pageshow", onPageShow);
      // Given back now, not when the element is collected.
      stopMotion();
      releaseCanvases();
    },
  };
}
