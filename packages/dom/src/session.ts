// A view's pipeline session (C6): the core, with what a view keeps across the documents
// it shows (its code highlighter, its faces). It runs on the main thread or, when the
// host registered the element with a `worker`, in that Worker, where `exposePipeline()`
// opens one session per view: views share no session state. Only what the thread it
// runs in holds for every view is shared: Pretext's measurements, the font set
// (ADR-003), and the regex kit its opener gives every session it opens.
//
// Everything that crosses the session's boundary is plain data (the theme, the font
// sources, the display list, the outline and its painted words, the target table), so
// the same methods serve a direct call and a Comlink message. Every method is
// asynchronous for that reason.
import type {
  DisplayList,
  FontSource,
  HostState,
  Md2uiLoadError,
  OutlineItem,
  ResolvedTheme,
  TargetTable,
  TextMeasurer,
} from "@md2ui/contracts";
import {
  type DocumentShape,
  type PaintedScene,
  type RegexKit,
  type SceneText,
  sceneText,
} from "@md2ui/core";
import { createPretextMeasurer, type FontFaceSource, type FontFaces } from "@md2ui/text-pretext";
import { emojiInstances } from "./emoji-instances.ts";
import { createViewHighlighter } from "./highlight.ts";
import { whenIdle } from "./idle.ts";
import {
  type GroupedDocument,
  groupDocument,
  type PreparedDocument,
  prepareDocument,
} from "./pipeline.ts";
import { emojiFamilies, href } from "./theme.ts";
import { themeFonts } from "./theme-fonts.ts";

/** What sizing depends on beside the document. */
export interface SessionFaces {
  readonly theme: ResolvedTheme;
  /** The host's fonts: they also name the theme's emoji family. */
  readonly fonts: readonly FontSource[];
  /**
   * Those of `fonts` the page loaded. A session in a Worker loads those of these the
   * theme draws in (`themeFonts`), and the emoji font instances made from them, into its
   * own font set, and never one the page could not load: WebKit never settles a failed font load in a Worker, which
   * would hold the view back for good.
   */
  readonly loaded: readonly FontSource[];
  /** The page's base URL, which font and emoji paths resolve against. */
  readonly pageBase: string;
}

/** What a session's faces came to (`setFaces`). */
export interface SetFaces {
  /** The emoji font instances the theme asks for (`emojiInstances`), which the page loads too, to paint with. */
  readonly instances: readonly FontFaceSource[];
  /**
   * The fonts the page loaded that the session's own thread could not (a Worker's): it
   * measures them in a fallback face, which the page does not paint with.
   */
  readonly failed: readonly Md2uiLoadError[];
}

/** What a view shows of a scene. */
export interface ShownScene {
  readonly list: DisplayList;
  readonly outline: readonly OutlineItem[];
  /** The words `list` paints, by outline item: what the view lays on the paint to select and find. */
  readonly text: SceneText;
}

/** A new document, laid out at the width it was asked for. */
export interface PreparedScene {
  /** What each target reports, by ordinal. */
  readonly targets: TargetTable;
  readonly scene: ShownScene;
  /** The document's structure (`documentShape`). */
  readonly shape: DocumentShape;
  /**
   * Some of its code paints plain while a grammar loads: `highlighted()` resolves when
   * it has, and the document is worth preparing again.
   */
  readonly upgrade: boolean;
}

export interface PipelineSession {
  /**
   * Measures with `faces` from the next document on; resolves once their fonts are
   * loaded, or once newer faces have replaced them.
   */
  setFaces(faces: SessionFaces): Promise<SetFaces>;
  /**
   * `markdown`, grouped, sized and laid out at `width` (CSS px, root padding included).
   * Null when no faces are set yet, or when a newer document overtook this one while it
   * waited for its grammars (only the first document a session shows waits).
   */
  prepare(markdown: string, width: number): Promise<PreparedScene | null>;
  /** Resolves when the grammars the last prepared document lacked have loaded. */
  highlighted(): Promise<void>;
  /** The document at `width`; null while its effective width stands, or with none. */
  render(width: number): Promise<ShownScene | null>;
  /** The last scene as `states` show it (ADR-003); null with no scene. */
  withStates(states: ReadonlyMap<number, HostState>): Promise<DisplayList | null>;
  /** Releases the session's highlighters; it is not used again. */
  dispose(): void;
}

/** A session's methods called on the Worker that holds it, named by the session's number. */
type OnHost<Session> = {
  readonly [Method in keyof Session]: Session[Method] extends (...args: infer Args) => infer Result
    ? (session: number, ...args: Args) => Result
    : never;
};

/**
 * What a Worker exposes (`exposePipeline`): a session per view, each named by a number,
 * every call on the Worker's own endpoint. Not a Comlink proxy per session: a proxy is a
 * MessagePort, and WebKit holds back a message to a port in a Worker by a second when the
 * Worker's thread has slept past one of its run loop's timers (a third of replacements,
 * desktop WebKit and iPhones), while a message to the Worker is never late.
 */
export interface PipelineHost extends OnHost<Omit<PipelineSession, "dispose">> {
  /** A new session's number. */
  open(): number;
  /** Releases the session numbered `session`; it is not used again. */
  close(session: number): void;
  /**
   * A raster `blob` decoded as `createImageBitmap` decodes it with `options`, for the
   * page's pictures; the bitmap is transferred to the page, not copied.
   */
  decode(blob: Blob, options: ImageBitmapOptions): Promise<ImageBitmap>;
}

/**
 * A small document that holds what the grouper and the detector read (a heading, data
 * points, a list of key-values, styled text).
 */
const PREWARM = [
  "# Today",
  "",
  "A short note on 24 Oct 2026 at 9:30: 3 items, $12.50, 40% done.",
  "",
  "- **Status:** open",
  "- Owner: Ana",
  "",
  "`code` and _muted_ text.",
].join("\n");

/**
 * Groups a small document with `kit`, so the first document a thread shows does not
 * also pay for compiling the grouper's regexes and code. Run while the thread is idle,
 * as a theme and fonts load: it costs about what it saves, so it pays only in time the
 * thread would otherwise spend waiting.
 */
export function prewarm(kit: RegexKit): void {
  groupDocument(PREWARM, kit);
}

/**
 * `prewarm`'s document with a line outside Latin-1, grouped with `kit` after it. Engines
 * compile a regex again for a string outside Latin-1, and the detector's patterns are
 * many: without this, the first block holding such text pays for compiling them all
 * again (daylight-theme in a Worker: 100–200 ms in each engine, ~15 ms after).
 * Only `prewarm`'s new line is detected again: the kit remembers the rest.
 */
export function prewarmWide(kit: RegexKit): void {
  groupDocument(`${PREWARM}\n\n• ★ 4.6 — 12 €`, kit);
}

/** Loads fonts into the font set of the thread a session runs in; resolves with those that failed. */
export type LoadFonts = (fonts: readonly FontFaceSource[]) => Promise<readonly Md2uiLoadError[]>;

/**
 * A session. `loadFonts`: in a Worker, how the host's fonts reach the Worker's own font
 * set (`exposePipeline` loads each once for all its sessions); null on the main thread,
 * where the view has loaded them already, for paint, and reported those that failed.
 * `faces`: the faces of the thread the session runs in, through which its fonts are
 * loaded.
 *
 * `kit`: the regexes it groups with, one for every session of a registration (or of a
 * Worker). A kit compiles the detector's patterns on first use, which costs a new
 * view's first document hundreds of milliseconds, and a kit kept across documents
 * groups each the same as a new one would (ADR-104); its memo of detected text holds
 * two groupings, whichever views they were for.
 */
export function createSession({
  loadFonts,
  kit,
  faces: threadFaces,
}: {
  readonly loadFonts: LoadFonts | null;
  readonly kit: RegexKit;
  readonly faces: FontFaces;
}): PipelineSession {
  const highlighter = createViewHighlighter(whenIdle);
  let faces: { readonly input: SessionFaces; readonly text: TextMeasurer } | null = null;
  let facesJob = 0;
  let grouped: { readonly markdown: string; readonly document: GroupedDocument } | null = null;
  let doc: PreparedDocument | null = null;
  /** The measurer `doc` was sized with, which tells where its words leave gaps at every width. */
  let docText: TextMeasurer | null = null;
  let scene: PaintedScene | null = null;
  let job = 0;
  let grammars: Promise<unknown> = Promise.resolve();

  /** Per width: `painted`, and its words, with the measurer it was laid out with. */
  const shown = (painted: PaintedScene, text: TextMeasurer): ShownScene => ({
    list: painted.list,
    outline: painted.outline,
    text: sceneText(painted.list, painted.outline, text),
  });

  return {
    async setFaces(input) {
      const mine = ++facesJob;
      const instances = emojiInstances(input.theme, input.loaded, input.pageBase);
      // Only the faces the theme draws in: a Worker holds its own copy of each face's
      // data (about 2 MB a face in Chromium), and the host may give many more.
      // A host's font URL is written against the page; in a Worker a relative one would
      // resolve against the Worker's own file instead.
      const drawn = [...themeFonts(input.theme, input.loaded, input.pageBase), ...instances];
      const failed =
        (await loadFonts?.(
          drawn.map((font) => ({ ...font, url: href(font.url, input.pageBase) })),
        )) ?? [];
      const text = await createPretextMeasurer([], { faces: threadFaces });
      if (mine === facesJob) faces = { input, text };
      return { instances, failed };
    },

    async prepare(markdown, width) {
      if (faces === null) return null;
      const mine = ++job;
      const { input, text } = faces;
      if (grouped?.markdown !== markdown) {
        grouped = { markdown, document: groupDocument(markdown, kit) };
      }
      const next = grouped.document;
      // The core paints synchronously, so it is handed the grammars it can use now. The
      // first document waits for its own; after that, a document naming a language not
      // loaded yet is shown at once, that language plain, and again once its grammar
      // arrives: a stream never stalls on a grammar.
      const loading = highlighter.load(input.theme, next.languages);
      const now = highlighter.now(input.theme, next.languages);
      let highlight = now.highlighter;
      const first = doc === null;
      if (!now.complete && first) {
        highlight = await loading;
        if (mine !== job) return null;
      }
      grammars = loading;
      docText = text;
      doc = prepareDocument(next, {
        theme: input.theme,
        text,
        emojiFamily: emojiFamilies(input.fonts, input.pageBase),
        highlight,
      });
      highlighter.show(highlight);
      scene = doc.render(width);
      return {
        targets: next.targets,
        scene: shown(scene, text),
        shape: next.shape,
        upgrade: !now.complete && !first,
      };
    },

    async highlighted() {
      await grammars;
    },

    async render(width) {
      const painted = doc?.render(width) ?? null;
      if (painted === null || painted === scene || docText === null) return null;
      scene = painted;
      return shown(painted, docText);
    },

    async withStates(states) {
      return scene?.withStates(states) ?? null;
    },

    dispose() {
      highlighter.dispose();
    },
  };
}
