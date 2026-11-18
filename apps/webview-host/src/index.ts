// @md2ui/webview-host — the page a native app's web view loads (never published). One
// <md2ui-view> fills the screen and scrolls itself, as on the site; showing another
// document sets its markdown (and, with a new theme, its theme and fonts) on that same
// view, which rebuilds the scene. It talks to the app through flutter_inappwebview's
// JavaScript bridge. The app calls `md2uiHost`:
//   - `theme({ src, fonts, assetBase? })` and `show({ markdown, messageId, disabled? })`
//     show its own documents (an agent's replies) in its own theme;
//   - `disable(disabled)` silences agent-bound actions while the agent works;
//   - `configure({ sample, hud })` shows one of the site's samples instead (the app's
//     scroll lab).
// The page reports actions, links, load errors and scroll smoothness through
// `callHandler`. With `?embed=1` it starts empty and waits for the app; otherwise it
// shows a sample. No wire yet. Nothing runs on import; index.html calls
// `startWebviewHost`.
import { defineMd2uiView, type FontSource, type Md2uiViewElement } from "@md2ui/dom";

interface Sample {
  readonly id: string;
  readonly content: string;
  readonly theme: string;
  readonly fonts: readonly FontSource[];
}

interface HostOptions {
  /** The sample shown, by id. */
  readonly sample: string;
  readonly hud: boolean;
}

/** The app's theme: its THEME.md and the faces its `Font Name`s use. */
interface AppTheme {
  readonly src: string;
  readonly fonts: readonly FontSource[];
  /** What the theme's asset paths resolve against; beside `src` when absent. */
  readonly assetBase?: string;
}

/** One of the app's documents. */
interface AppDocument {
  readonly markdown: string;
  readonly messageId: string;
  readonly disabled?: boolean;
}

/** What one scroll gesture, from first scroll event to rest, looked like. */
interface ScrollStats {
  readonly frames: number;
  readonly seconds: number;
  readonly fps: number;
  /** Frames that took longer than 1.5 refresh intervals (~25 ms at 60 Hz). */
  readonly slowFrames: number;
  readonly worstFrameMs: number;
}

interface FlutterBridge {
  callHandler(name: string, ...args: unknown[]): Promise<unknown>;
}

const ICONS: FontSource = {
  family: "md2ui icons",
  url: "assets/icons/material-design-icons-md2ui.ttf",
};

const face = (family: string, pkg: string, weight: number, version = "5.3.0"): FontSource => ({
  family,
  url: `https://cdn.jsdelivr.net/npm/@fontsource/${pkg}@${version}/files/${pkg}-latin-${weight}-normal.woff2`,
  weight,
});

const MONO: readonly FontSource[] = [400, 500, 700].map((w) =>
  face("JetBrains Mono", "jetbrains-mono", w),
);

// The site's samples (apps/site/src/samples.ts), each with the faces its theme names.
const SAMPLES: readonly Sample[] = [
  {
    id: "home",
    content: "samples/home/content.md",
    theme: "samples/home/THEME.md",
    fonts: [
      ...[400, 500, 600, 700].map((w) => face("Inter 24pt", "inter", w)),
      ...[400, 500, 600, 700].map((w) => face("IBM Plex Mono", "ibm-plex-mono", w)),
      ICONS,
    ],
  },
  {
    id: "whipsaw",
    content: "samples/whipsaw/content.md",
    theme: "samples/whipsaw/THEME.md",
    fonts: [...[400, 500, 600, 700].map((w) => face("Inter 18pt", "inter", w)), ICONS],
  },
  {
    id: "brutalism",
    content: "samples/brutalism/content.md",
    theme: "samples/brutalism/THEME.md",
    fonts: [
      ...[400, 500, 600, 700, 800, 900].map((w) => face("Archivo", "archivo", w)),
      ...MONO,
      ICONS,
    ],
  },
];

function optionsFrom(search: string): HostOptions {
  const params = new URLSearchParams(search);
  return { sample: params.get("sample") ?? "home", hud: params.get("hud") === "1" };
}

function bridge(): FlutterBridge | undefined {
  return (window as { flutter_inappwebview?: FlutterBridge }).flutter_inappwebview;
}

/** Sends `payload` to the app's handler `name`; logged instead in a plain browser. */
function post(name: string, payload: unknown): void {
  const flutter = bridge();
  if (flutter === undefined) console.info(name, payload);
  else void flutter.callHandler(name, payload);
}

/**
 * Measures each scroll gesture with requestAnimationFrame: started by the first scroll
 * event, ended 250 ms after the last. Returns what stops it.
 */
function watchScrolling(onGesture: (stats: ScrollStats) => void): () => void {
  let start = 0;
  let last = 0;
  let frames = 0;
  let slow = 0;
  let worst = 0;
  let lastScroll = 0;
  let raf = 0;

  const tick = (now: number): void => {
    if (last !== 0) {
      const gap = now - last;
      frames += 1;
      worst = Math.max(worst, gap);
      if (gap > 25) slow += 1;
    }
    last = now;
    if (now - lastScroll > 250) {
      const seconds = (now - start) / 1000;
      if (frames > 0) {
        onGesture({
          frames,
          seconds: Math.round(seconds * 100) / 100,
          fps: Math.round(frames / seconds),
          slowFrames: slow,
          worstFrameMs: Math.round(worst),
        });
      }
      raf = 0;
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  const onScroll = (): void => {
    lastScroll = performance.now();
    if (raf !== 0) return;
    start = lastScroll;
    last = 0;
    frames = 0;
    slow = 0;
    worst = 0;
    raf = requestAnimationFrame(tick);
  };

  window.addEventListener("scroll", onScroll, { capture: true, passive: true });
  return () => {
    window.removeEventListener("scroll", onScroll, { capture: true });
    if (raf !== 0) cancelAnimationFrame(raf);
  };
}

/** Shows the latest gesture's numbers in a corner of the page. */
function showHud(hud: HTMLElement, stats: ScrollStats): void {
  hud.textContent =
    `${stats.fps} fps · ${stats.slowFrames}/${stats.frames} slow · ` +
    `worst ${stats.worstFrameMs} ms · ${stats.seconds}s`;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return response.text();
}

/**
 * Runs the page in `view`, with `hud` for scroll numbers. Exposes `window.md2uiHost`
 * for the app and reports to it through the bridge. Returns what stops it.
 */
export function startWebviewHost(view: Md2uiViewElement, hud: HTMLElement): () => void {
  defineMd2uiView();
  let generation = 0;
  let shownTheme: string | null = null;

  const onAction = (event: Event): void => {
    const detail = (event as CustomEvent).detail as { kind: string; href?: string };
    if (detail.kind === "link") {
      // The app opens links: a web view must not navigate away from this page.
      event.preventDefault();
      post("md2uiLink", detail.href);
      return;
    }
    // No agent answers yet, so an agent-bound press is reported and not left pending.
    if (detail.kind === "agent") event.preventDefault();
    post("md2uiAction", detail);
  };
  const onError = (event: Event): void => post("md2uiError", (event as CustomEvent).detail);

  const stopWatching = watchScrolling((stats) => {
    if (!hud.hidden) showHud(hud, stats);
    post("md2uiScroll", stats);
  });

  const show = async (options: HostOptions): Promise<void> => {
    const job = ++generation;
    hud.hidden = !options.hud;
    const sample = SAMPLES.find((s) => s.id === options.sample) ?? SAMPLES[0];
    if (sample === undefined) return;
    const markdown = await fetchText(sample.content);
    if (job !== generation) return;
    if (shownTheme !== sample.theme) {
      shownTheme = sample.theme;
      view.themeSrc = sample.theme;
      // The samples' theme asset paths (the icon font's `Font:`) are written against
      // the page, as the site serves them, not against THEME.md's folder. The icon
      // font is matched by URL, so they must resolve to the `fonts` entry's address.
      view.assetBase = "./";
      // A new array reloads the fonts, so only a new theme sets them.
      view.fonts = [...sample.fonts];
    }
    view.messageId = sample.id;
    view.markdown = markdown;
    view.scrollTop = 0;
    hud.textContent = "scroll to measure";
    post("md2uiReady", { sample: sample.id });
  };

  const configure = (options: Partial<HostOptions>): void => {
    void show({ ...optionsFrom(location.search), ...options }).catch((error: unknown) =>
      post("md2uiError", { resource: "page", message: String(error) }),
    );
  };

  const theme = (next: AppTheme): void => {
    if (shownTheme === next.src) return;
    shownTheme = next.src;
    view.themeSrc = next.src;
    view.assetBase = next.assetBase ?? null;
    view.fonts = [...next.fonts];
  };

  const showDocument = (doc: AppDocument): void => {
    // A sample still loading never replaces the app's document.
    ++generation;
    view.disabled = doc.disabled === true;
    view.messageId = doc.messageId;
    view.markdown = doc.markdown;
    view.scrollTop = 0;
    post("md2uiReady", { messageId: doc.messageId });
  };

  const disable = (disabled: boolean): void => {
    view.disabled = disabled;
  };

  document.addEventListener("md2ui-action", onAction);
  document.addEventListener("md2ui-error", onError);
  (window as { md2uiHost?: unknown }).md2uiHost = {
    configure,
    theme,
    show: showDocument,
    disable,
  };
  if (new URLSearchParams(location.search).get("embed") === "1") post("md2uiHostReady", {});
  else configure({});

  return () => {
    stopWatching();
    document.removeEventListener("md2ui-action", onAction);
    document.removeEventListener("md2ui-error", onError);
    delete (window as { md2uiHost?: unknown }).md2uiHost;
  };
}
