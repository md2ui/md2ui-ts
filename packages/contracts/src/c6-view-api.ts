// C6 — the <md2ui-view> API, its action events and the package names.
// Public (ADR-003, ADR-005, ADR-006): a change to it is a change to the public API, shows
// in an API report and needs a recorded decision. The pipeline runs in `@md2ui/dom`'s
// own Worker unless `defineMd2uiView({ worker: false })`, in `@md2ui/dom` (ADR-006).
//
// What lives here is the DOM-free part, so a host, a binding and the wire client can
// all name it: what a host sets on a view, and what a view reports. The DOM-typed part
// (the element's interface, its event map, `defineMd2uiView()`) is `@md2ui/dom`'s and
// is specified in the report.
//
// Actions are data (ADR-003, md2ui ADR-404): a view never navigates, never edits the
// Markdown, and names a target by the ordinal md2ui gives it (`protocol/README.md`,
// "Targets"). The rest of an action is read from the core's target table for that
// ordinal, never from the paint.

import type { SettledValue } from "./c5-wire.ts";
import type { FontSource } from "./font.ts";

/** What a host sets on a view: the element's properties, and each binding's props. */
export interface Md2uiViewProperties {
  /**
   * The document. Setting it replaces the one shown in place and keeps the scroll
   * (ADR-003: a re-send is how the agent changes state). The view's transient state
   * stays only on targets the new document left as they were, and goes entirely when
   * the Markdown is unchanged (md2ui `protocol/README.md`, *Lifecycle* 3). A host that
   * wants the top sets `scrollTop`, as on any scroller.
   */
  markdown: string;
  /**
   * The host's id for the document shown, opaque to the view: on the wire, the
   * message id. Every action carries the id of the document it was tapped in, so an
   * action that races a replace is never attributed to the new message.
   */
  messageId: string | null;
  /**
   * Where THEME.md is fetched from (ADR-001), relative to the page. Attribute
   * `theme-src`. Ignored while `themeText` is set.
   */
  themeSrc: string | null;
  /** THEME.md's text, given directly instead of fetched. */
  themeText: string | null;
  /**
   * What the theme's relative asset references resolve against. Attribute
   * `asset-base`. Unset, it is `themeSrc` itself, so a reference resolves beside
   * THEME.md, where md2ui looks for it; with `themeText` alone, the page's base URL.
   */
  assetBase: string | null;
  /**
   * The web fonts the theme names, from the host (ADR-001). Those whose family the theme
   * draws in (its text styles' families, its emoji fonts') are loaded before anything is
   * measured (ADR-403); the others are never loaded. So is every face the page itself
   * declares (`@font-face`) for a family the
   * theme names, on the main thread. The theme's own font files never are. A view whose
   * pipeline runs in a Worker (the default) measures only with `fonts`: the page's faces
   * are not seen there, and a theme family missing from them is reported (`md2ui-error`).
   */
  fonts: readonly FontSource[];
  /**
   * Silences the agent-bound actions (`agent`, `checkbox`, `slider`): set it while a
   * message streams (the wire enables actions only after its end) and while the agent
   * works. Attribute `disabled`. Links, an `#anchor`, a code block's copy button and
   * scrolling, which never reach the agent, still work (ADR-003).
   */
  disabled: boolean;
  /**
   * The message is still arriving (a stream between its head and its end). While it is
   * set, the view lays out only the Markdown up to its last blank line outside a code
   * fence: a block still streaming is not shown, nor re-arranged, until it closes.
   * Cleared, the whole message is laid out. Attribute `streaming`. It silences nothing:
   * that is `disabled`'s, which a host also sets while the agent works.
   */
  streaming: boolean;
  /**
   * How the next document moves in from the one shown, as the host knows it; set it
   * before `markdown`. Attribute `motion`.
   * - `"auto"` (the default): the view decides. When what was on screen and what will
   *   be there share little content and not their structure, it is a new page and fades
   *   whole; otherwise each node moves (the same page with new values is not new).
   * - `"page"`: a new message (on the wire, a message frame without `r`): it fades whole,
   *   and nothing is matched.
   * - `"edit"`: a replacement of the message shown (`r`: a patch, a mark, a feed value,
   *   the agent's own re-send): each node moves, however much changed.
   * Motion follows the theme's `## Motion`, and none plays for a reader who asked for
   * less of it.
   */
  motion: "auto" | "page" | "edit";
}

/** What every action carries. */
interface ActionBase {
  /** The target's place among the document's actionable targets, from 0 (the wire's `x`). */
  readonly ordinal: number;
  /** The `messageId` the view had when the tapped document was shown. */
  readonly messageId: string | null;
  /** The text the author gave the target: the link's text, the task's item. */
  readonly label: string;
}

/**
 * An `http(s)`, `mailto:` or `/route` link. Unless the host calls `preventDefault()`,
 * the view opens it as a plain `<a>` would, http(s) and `mailto:` only, an external
 * one in a new tab; a routing host cancels it and routes it (ADR-003). Never sent over
 * the wire.
 */
export interface LinkAction extends ActionBase {
  readonly kind: "link";
  /** As the author wrote it. */
  readonly href: string;
}

/** An `agent:` link or card, a linked task box or a linked slider. */
export interface AgentAction extends ActionBase {
  readonly kind: "agent";
  /** The action's slug, for the wire's drift check (`a`). */
  readonly slug: string;
  /**
   * A linked task box: the state the tap asks for. A choice option (an `agent:` button
   * with `md2ui.choice=<name>`, md2ui ADR-405): always `true`, the option chosen; a tap
   * chooses an option and never clears it.
   */
  readonly checked?: boolean;
  /**
   * A linked slider: the value asked for, in its authored domain. A linked count
   * (`➖ [[2/9]](agent:…) ➕`): a whole number, one step from the value shown.
   */
  readonly value?: number;
  /**
   * A button its author marked `md2ui.commit`: the values the user set on the
   * document's other controls since it was shown (the wire's `vs`). A choice travels as
   * its chosen option, `[ordinal, true]`, once per group, never `false`.
   */
  readonly settled?: readonly SettledValue[];
}

/** A plain task box. */
export interface CheckboxAction extends ActionBase {
  readonly kind: "checkbox";
  /** The state the tap asks for. */
  readonly checked: boolean;
}

/**
 * A plain slider: reported once, on release, and only when its value changed. A count
 * (`Quantity: ➖ [2/9] ➕`) is a slider whose ➖ and ➕ each report one step, a whole number
 * inside 0 to its maximum; it is never dragged.
 */
export interface SliderAction extends ActionBase {
  readonly kind: "slider";
  /** The value asked for, inside the domain the document authored (`[3/10]`: 0–10). */
  readonly value: number;
}

/**
 * What a tap reports, as the detail of a cancelable `md2ui-action` event. A disabled
 * (`~~…~~`) target reports nothing; neither does an `#anchor`, which the view scrolls
 * to, nor a copy button, whose text the view puts on the clipboard and announces.
 * Cancelling an agent-bound action keeps the view from showing it pending (or ticked,
 * or at its new value).
 */
export type Md2uiAction = LinkAction | AgentAction | CheckboxAction | SliderAction;

/** The actions a host may send over the wire (`@md2ui/wire`'s `sendEvent`). */
export type ForwardedAction = AgentAction | CheckboxAction | SliderAction;

/**
 * A resource the view could not load. The view still renders what it can: md2ui's
 * default theme for a theme, the fallback face for a font, the placeholder for an image.
 *
 * A font is also reported when the theme draws in a family none of `fonts` gives: a view
 * whose pipeline runs in a Worker measures it in a fallback face,
 * even where the page has it through its own `@font-face`. Such an error names the
 * `family`, has no `url` (empty), and is reported once per theme and family. A CSS
 * generic family (`sans-serif`, `system-ui`) never is, nor one of md2ui's default theme
 * (Arial), which every theme draws in where it names no family of its own.
 */
export interface Md2uiLoadError {
  /**
   * `"pipeline"`: the view's session could not open (its code failed to load, or it
   * threw), with an empty `url`. It is reported once, and the view stays empty.
   */
  readonly resource: "theme" | "font" | "image" | "pipeline";
  readonly url: string;
  /**
   * A font's family: of a face the view's Worker could not load, though the page did, or
   * of the theme's family that none of `fonts` gives.
   */
  readonly family?: string;
  readonly message: string;
}
