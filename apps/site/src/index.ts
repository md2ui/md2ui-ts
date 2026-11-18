// @md2ui/site — the demo page for GitHub Pages (ADR-004). Never published. A bar of three
// selects over one <md2ui-view>: the document, the theme it is shown in, and the
// theme's layout. Choosing a document also chooses the theme written for it; choosing a
// theme replaces it for that document only. The choice lives in the URL, so a view can
// be shared. An Edit button, or an `agent:edit-source` action in the document, opens
// its source beside the view, and the view previews every edit; edits stay in the page.
// Nothing runs on import; index.html calls `startSite`.
import { defineMd2uiView, type Md2uiViewElement, type Md2uiViewEventMap } from "@md2ui/dom";
import type { SourceEditor } from "./editor.ts";
import {
  CONTENTS,
  LAYOUTS,
  type SiteContent,
  type SiteLayout,
  type SiteTheme,
  THEMES,
  themeLayout,
  withLayout,
} from "./samples.ts";

export interface SiteControls {
  readonly content: HTMLSelectElement;
  readonly theme: HTMLSelectElement;
  readonly layout: HTMLSelectElement;
  /** Opens and closes the source panel. */
  readonly edit: HTMLButtonElement;
  /** The source panel; hidden while closed. */
  readonly panel: HTMLElement;
  /** Where the editor goes, inside `panel`. */
  readonly source: HTMLElement;
  /** Shows the file being edited. */
  readonly sourceName: HTMLElement;
  /** Puts the sample's own text back. */
  readonly reset: HTMLButtonElement;
  /** Links to the design the sample reproduces; hidden when it has none. */
  readonly designSource: HTMLAnchorElement;
}

/** The action a document writes to open its own source: `[Edit](agent:edit-source)`. */
const EDIT_SLUG = "edit-source";
/** How long typing pauses before the view lays the text out again. */
const PREVIEW_DELAY_MS = 150;

const fill = (select: HTMLSelectElement, options: readonly { id: string; label: string }[]) => {
  select.replaceChildren(...options.map(({ id, label }) => new Option(label, id)));
};

async function text(src: string, signal: AbortSignal): Promise<string> {
  const response = await fetch(src, { signal });
  if (!response.ok) throw new Error(`${src}: HTTP ${response.status}`);
  return response.text();
}

/** Runs the site in `view` with `controls`. Returns what stops it. */
export function startSite(view: Md2uiViewElement, controls: SiteControls): () => void {
  defineMd2uiView();
  fill(controls.content, CONTENTS);
  fill(controls.theme, THEMES);
  fill(
    controls.layout,
    LAYOUTS.map((layout) => ({ id: layout, label: layout })),
  );

  const params = new URLSearchParams(location.search);
  let content: SiteContent =
    CONTENTS.find((c) => c.id === params.get("content")) ?? (CONTENTS[0] as SiteContent);
  let theme: SiteTheme = THEMES.find((t) => t.id === params.get("theme")) ?? themeOf(content);
  let layout: SiteLayout | null = LAYOUTS.find((l) => l === params.get("layout")) ?? null;
  let themeSource = "";
  let abort = new AbortController();
  /** Each sample's own text, fetched once. */
  const originals = new Map<string, string>();
  /** The visitor's text for a sample they edited. */
  const edits = new Map<string, string>();
  let editor: SourceEditor | null = null;
  let opening: Promise<void> | null = null;
  let previewTimer: ReturnType<typeof setTimeout> | undefined;

  function themeOf(c: SiteContent): SiteTheme {
    return THEMES.find((t) => t.id === c.theme) ?? (THEMES[0] as SiteTheme);
  }

  const markdownOf = (c: SiteContent): string => edits.get(c.id) ?? originals.get(c.id) ?? "";

  const syncControls = (): void => {
    controls.content.value = content.id;
    controls.theme.value = theme.id;
    controls.layout.value = layout ?? themeLayout(themeSource);
    controls.sourceName.textContent = content.src.split("/").slice(-2).join("/");
    controls.reset.disabled = !edits.has(content.id);
    controls.designSource.hidden = content.designUrl === undefined;
    controls.designSource.href = content.designUrl ?? "";
    const url = new URL(location.href);
    url.search = new URLSearchParams({
      content: content.id,
      theme: theme.id,
      ...(layout !== null && { layout }),
    }).toString();
    history.replaceState(null, "", url);
  };

  const applyTheme = (): void => {
    view.themeText = layout === null ? themeSource : withLayout(themeSource, layout);
  };

  const show = (markdown: string): void => {
    view.messageId = content.id;
    view.markdown = markdown;
  };

  const load = async (loadContent: boolean): Promise<void> => {
    abort.abort();
    abort = new AbortController();
    const { signal } = abort;
    const wanted = content;
    try {
      const [markdown, source] = await Promise.all([
        loadContent && !originals.has(wanted.id) ? text(wanted.src, signal) : null,
        text(theme.src, signal),
      ]);
      if (markdown !== null) originals.set(wanted.id, markdown);
      themeSource = source;
      view.fonts = [...theme.fonts];
      applyTheme();
      if (loadContent) {
        show(markdownOf(wanted));
        view.scrollTop = 0;
        editor?.setText(markdownOf(wanted));
      }
      syncControls();
    } catch (error) {
      if (!signal.aborted) console.error(error);
    }
  };

  const setOpen = (open: boolean): void => {
    controls.panel.hidden = !open;
    controls.edit.setAttribute("aria-pressed", String(open));
    if (open && editor === null && opening === null) {
      opening = import("./editor.ts").then(({ createSourceEditor }) => {
        editor = createSourceEditor(controls.source, markdownOf(content), (next) => {
          edits.set(content.id, next);
          controls.reset.disabled = false;
          clearTimeout(previewTimer);
          previewTimer = setTimeout(() => show(next), PREVIEW_DELAY_MS);
        });
      });
    }
  };

  const onContent = (): void => {
    content = CONTENTS.find((c) => c.id === controls.content.value) ?? content;
    theme = themeOf(content);
    layout = null;
    void load(true);
  };
  const onTheme = (): void => {
    theme = THEMES.find((t) => t.id === controls.theme.value) ?? theme;
    layout = null;
    void load(false);
  };
  const onLayout = (): void => {
    layout = LAYOUTS.find((l) => l === controls.layout.value) ?? null;
    applyTheme();
    syncControls();
  };
  const onEdit = (): void => setOpen(controls.panel.hidden !== false);
  const onReset = (): void => {
    edits.delete(content.id);
    clearTimeout(previewTimer);
    show(markdownOf(content));
    editor?.setText(markdownOf(content));
    syncControls();
  };
  const onAction = (event: Md2uiViewEventMap["md2ui-action"]): void => {
    const action = event.detail;
    if (action.kind !== "agent" || action.slug !== EDIT_SLUG) return;
    event.preventDefault(); // handled here: the view shows nothing pending
    setOpen(true);
  };
  // What the view could not load (a theme, a font, a picture, a family no font gives)
  // still shows, in a fallback; the console says what fell back.
  const onError = (event: Md2uiViewEventMap["md2ui-error"]): void => {
    console.warn("md2ui-error", event.detail);
  };

  controls.content.addEventListener("change", onContent);
  controls.theme.addEventListener("change", onTheme);
  controls.layout.addEventListener("change", onLayout);
  controls.edit.addEventListener("click", onEdit);
  controls.reset.addEventListener("click", onReset);
  view.addEventListener("md2ui-action", onAction);
  view.addEventListener("md2ui-error", onError);
  void load(true);

  return () => {
    abort.abort();
    clearTimeout(previewTimer);
    editor?.destroy();
    controls.content.removeEventListener("change", onContent);
    controls.theme.removeEventListener("change", onTheme);
    controls.layout.removeEventListener("change", onLayout);
    controls.edit.removeEventListener("click", onEdit);
    controls.reset.removeEventListener("click", onReset);
    view.removeEventListener("md2ui-action", onAction);
    view.removeEventListener("md2ui-error", onError);
  };
}
