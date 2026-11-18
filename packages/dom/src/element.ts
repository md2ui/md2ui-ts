// `<md2ui-view>` (C6, ADR-006): the custom element every host integrates through. It
// holds the properties, checks what a host sets, mirrors the five attributes, passes on
// `release`, and runs one view (view.ts) while it is connected. The class is made inside
// `defineMd2uiView()`, so importing this module touches no `HTMLElement` and registers
// nothing: a server-side render imports it safely.
import type {
  FontSource,
  Md2uiAction,
  Md2uiLoadError,
  Md2uiViewProperties,
} from "@md2ui/contracts";
import { createFontFaces } from "@md2ui/text-pretext";
import { createPictures } from "./pictures.ts";
import { pipelineThread, pipelineWorker } from "./sessions.ts";
import { createView, type ViewController } from "./view.ts";

/** How the views a registration makes run the pipeline (C6). */
export interface Md2uiViewOptions {
  /**
   * Where the views run grouping, layout and paint. Unset, in a module Worker of
   * `@md2ui/dom`'s own, one for the registration, made when the first view connects.
   * `false`: on the main thread. A function: in the module Worker it makes, whose file
   * calls `exposePipeline()` from `@md2ui/dom/worker`, for a host that bundles its own.
   *
   * A Worker that cannot be made or fails to start (a CSP `worker-src`, a page opened
   * from `file://`, a bundler that did not ship the Worker's file) leaves the views on
   * the main thread. In a Worker, a view measures only with its `fonts`: the page's
   * `@font-face` faces are not seen there, so every family the theme names must be
   * among them.
   */
  readonly worker?: false | (() => Worker);
}

/** The events a view dispatches (C6). Both bubble and cross the shadow boundary. */
export interface Md2uiViewEventMap extends HTMLElementEventMap {
  /** A tap on a target, by ordinal. Cancelable: see each action kind. */
  "md2ui-action": CustomEvent<Md2uiAction>;
  /** A theme, font or image that could not load; the view still renders. */
  "md2ui-error": CustomEvent<Md2uiLoadError>;
}

/** `<md2ui-view>`: an `HTMLElement` with the view's properties, its method and events (C6). */
export interface Md2uiViewElement extends HTMLElement, Md2uiViewProperties {
  /**
   * Releases the buttons this view shows pending for these ordinals, which the agent has
   * answered (`@md2ui/wire`'s `answered`, md2ui ADR-601). A tick or a value the user set
   * stays; an ordinal the document does not hold pending is ignored.
   */
  release(ordinals: readonly number[]): void;
  addEventListener<K extends keyof Md2uiViewEventMap>(
    type: K,
    listener: (this: Md2uiViewElement, event: Md2uiViewEventMap[K]) => unknown,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof Md2uiViewEventMap>(
    type: K,
    listener: (this: Md2uiViewElement, event: Md2uiViewEventMap[K]) => unknown,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

declare global {
  interface HTMLElementTagNameMap {
    "md2ui-view": Md2uiViewElement;
  }
}

const TAG = "md2ui-view";

/** The attributes, and the property each one sets. */
const ATTRIBUTES: Readonly<Record<string, keyof Md2uiViewProperties>> = Object.freeze({
  "theme-src": "themeSrc",
  "asset-base": "assetBase",
  "message-id": "messageId",
  disabled: "disabled",
  streaming: "streaming",
  motion: "motion",
});

const text = (value: unknown): string => String(value);
const nullableText = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

function fontList(value: unknown): readonly FontSource[] {
  if (!Array.isArray(value)) throw new TypeError(`<${TAG}>: fonts must be an array`);
  for (const font of value as unknown[]) {
    const ok =
      typeof font === "object" &&
      font !== null &&
      typeof (font as FontSource).family === "string" &&
      typeof (font as FontSource).url === "string";
    if (!ok) throw new TypeError(`<${TAG}>: each font needs a family and a url`);
  }
  return Object.freeze([...(value as FontSource[])]);
}

const MOTIONS: readonly string[] = Object.freeze(["auto", "page", "edit"]);

/** A motion; an attribute removed is the default. */
function motionOf(value: unknown): Md2uiViewProperties["motion"] {
  if (value === null || value === undefined) return "auto";
  if (typeof value === "string" && MOTIONS.includes(value))
    return value as Md2uiViewProperties["motion"];
  throw new TypeError(`<${TAG}>: motion must be "auto", "page" or "edit"`);
}

/**
 * Every property, and how a value a host sets becomes its value; a misuse throws
 * (ADR-006).
 */
const CHECK: { readonly [K in keyof Md2uiViewProperties]: (v: unknown) => Md2uiViewProperties[K] } =
  Object.freeze({
    markdown: text,
    messageId: nullableText,
    themeSrc: nullableText,
    themeText: nullableText,
    assetBase: nullableText,
    fonts: fontList,
    disabled: Boolean,
    streaming: Boolean,
    motion: motionOf,
  });

/**
 * Registers `<md2ui-view>` in this window's custom element registry. Call it once
 * before the element is used; calling it again does nothing, options included. Nothing
 * registers on import.
 */
export function defineMd2uiView(options: Md2uiViewOptions = {}): void {
  if (customElements.get(TAG) !== undefined) return;
  // The page's faces, each made once for every view this registration makes, as the
  // Worker does for its own (`exposePipeline`). None is deleted when no view names it
  // any more: another view, or the host, may paint with it, and what is kept is one face
  // per font ever named, as md2ui's window loads each once per process.
  const faces = createFontFaces();
  const { open, decode } = pipelineThread(options.worker ?? pipelineWorker, faces);
  // The pictures its views draw: one decode per URL, freed with the last view showing it,
  // decoded where the views' pipeline runs.
  const pictures = createPictures(decode);

  class Md2uiView extends HTMLElement {
    static readonly observedAttributes = Object.keys(ATTRIBUTES);

    readonly #props: Md2uiViewProperties = {
      markdown: "",
      messageId: null,
      themeSrc: null,
      themeText: null,
      assetBase: null,
      fonts: [],
      disabled: false,
      streaming: false,
      motion: "auto",
    };
    #view: ViewController | null = null;

    constructor() {
      super();
      // A property set before the element was defined (a framework sets them as soon
      // as it creates the node) shadows the accessor: take it over.
      for (const name of Object.keys(CHECK)) {
        if (Object.hasOwn(this, name)) {
          const value: unknown = Reflect.get(this, name);
          Reflect.deleteProperty(this, name);
          Reflect.set(this, name, value);
        }
      }
    }

    connectedCallback(): void {
      this.#view ??= createView(this, this.#props, open, faces, pictures);
    }

    disconnectedCallback(): void {
      this.#view?.destroy();
      this.#view = null;
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
      const property = ATTRIBUTES[name];
      if (property !== undefined) {
        // A boolean property's attribute is a flag: its presence is the value.
        const flag = typeof this.#props[property] === "boolean";
        Reflect.set(this, property, flag ? value !== null : value);
      }
    }

    #set<K extends keyof Md2uiViewProperties>(name: K, value: unknown): void {
      const checked = CHECK[name](value);
      this.#props[name] = checked;
      const view: Md2uiViewProperties | null = this.#view;
      if (view !== null) view[name] = checked;
    }

    get markdown(): string {
      return this.#props.markdown;
    }
    set markdown(value: string) {
      this.#set("markdown", value);
    }
    get messageId(): string | null {
      return this.#props.messageId;
    }
    set messageId(value: string | null) {
      this.#set("messageId", value);
    }
    get themeSrc(): string | null {
      return this.#props.themeSrc;
    }
    set themeSrc(value: string | null) {
      this.#set("themeSrc", value);
    }
    get themeText(): string | null {
      return this.#props.themeText;
    }
    set themeText(value: string | null) {
      this.#set("themeText", value);
    }
    get assetBase(): string | null {
      return this.#props.assetBase;
    }
    set assetBase(value: string | null) {
      this.#set("assetBase", value);
    }
    get fonts(): readonly FontSource[] {
      return this.#props.fonts;
    }
    set fonts(value: readonly FontSource[]) {
      this.#set("fonts", value);
    }
    get disabled(): boolean {
      return this.#props.disabled;
    }
    set disabled(value: boolean) {
      this.#set("disabled", value);
    }
    get streaming(): boolean {
      return this.#props.streaming;
    }
    set streaming(value: boolean) {
      this.#set("streaming", value);
    }
    get motion(): Md2uiViewProperties["motion"] {
      return this.#props.motion;
    }
    set motion(value: Md2uiViewProperties["motion"]) {
      this.#set("motion", value);
    }

    release(ordinals: readonly number[]): void {
      if (!Array.isArray(ordinals))
        throw new TypeError(`<${TAG}>: release takes an array of ordinals`);
      this.#view?.release(ordinals);
    }
  }

  customElements.define(TAG, Md2uiView);
}
