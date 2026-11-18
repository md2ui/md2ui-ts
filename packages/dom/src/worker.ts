// @md2ui/dom/worker — the Worker side of a view (C6, ADR-006). A host that registers the
// element with `defineMd2uiView({ worker })` gives it a module Worker whose whole file
// is:
//
//   import { exposePipeline } from "@md2ui/dom/worker";
//   exposePipeline();
//
// The view then groups, lays out and paints its documents there, and decodes its raster
// pictures there, and the main thread only paints display lists. The bridge is Comlink (ADR-007): no message protocol of our
// own. Nothing runs on import.
import type { Md2uiLoadError } from "@md2ui/contracts";
import { RegexKit } from "@md2ui/core";
import { createFontFaces, type FontFaceSource, loadFonts } from "@md2ui/text-pretext";
import { expose, transfer } from "comlink";
import { whenIdle } from "./idle.ts";
import {
  createSession,
  type LoadFonts,
  type PipelineHost,
  type PipelineSession,
  prewarm,
  prewarmWide,
} from "./session.ts";

/**
 * How long a Worker goes without a new document, after preparing one, before it runs the
 * second warm: a stream that sends its blocks back to back never waits behind it.
 */
const WIDE_WARM_PAUSE_MS = 50;

/**
 * Serves `<md2ui-view>`'s pipeline from this Worker: each view opens its own session,
 * closed when the view is, and the views' raster pictures are decoded here. Fonts come
 * only from the view's `fonts`: a Worker cannot see the page's `@font-face`.
 */
export function exposePipeline(): void {
  // Each font once for the Worker, whichever view asks: every view gives its fonts, and
  // a font set that gains a face per view and per theme change slows down and, in
  // Firefox, at length stops settling loads.
  const faces = createFontFaces();
  // A WebKit Worker cannot load a font from another origin by URL (`NetworkError`, even
  // with `Access-Control-Allow-Origin: *`), but loads the same file fetched:
  // each file is fetched once for the Worker, however many faces are made of it (a
  // variable font's instances), and its faces are made from a `blob:` URL of its bytes.
  const files = new Map<string, Promise<string>>();
  const fileUrl = (url: string): Promise<string> => {
    const known = files.get(url);
    if (known !== undefined) return known;
    const made = fetch(url, { mode: "cors" }).then(async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return URL.createObjectURL(await response.blob());
    });
    files.set(url, made);
    // One that fails is fetched again when next asked for, as a face is made again.
    made.catch(() => files.delete(url));
    return made;
  };
  // A font that fails here is measured in a fallback face the page does not paint with:
  // the view reports it (`md2ui-error`).
  const loadOnce: LoadFonts = async (fonts) => {
    const failed: Md2uiLoadError[] = [];
    const fail = (font: FontFaceSource, error: unknown): void => {
      const why = error instanceof Error ? (error.cause ?? error) : error;
      const detail = (why instanceof Error ? why.message : String(why)).trim();
      failed.push({
        resource: "font",
        url: font.url,
        family: font.family,
        message: `Font "${font.family}" failed to load from ${font.url} in the pipeline's Worker (${detail}): it is measured there in a fallback face`,
      });
    };
    /** Each source as loaded, from its file's bytes, to the source the host gave. */
    const given = new Map<FontFaceSource, FontFaceSource>();
    await Promise.all(
      fonts.map(async (font) => {
        try {
          given.set({ ...font, url: await fileUrl(font.url) }, font);
        } catch (error) {
          fail(font, error);
        }
      }),
    );
    await loadFonts([...given.keys()], {
      faces,
      onFontError: (source, error) => fail(given.get(source) ?? source, error),
    });
    return failed;
  };
  // One regex kit for every session: each compiles the detector's patterns only once.
  // The Worker starts when the first view opens a session; it warms the kit meanwhile.
  const kit = new RegexKit();
  whenIdle(() => prewarm(kit));
  // The second warm (`prewarmWide`) waits for a pause in the documents after the first
  // has been shown: run before it, it put off the first paint by about its own cost
  // and a Worker has no idle callback to say when nothing waits.
  let wideWarm: ReturnType<typeof setTimeout> | undefined;
  let wideWarmed = false;
  const sessions = new Map<number, PipelineSession>();
  let opened = 0;
  const session = (id: number): PipelineSession => {
    const found = sessions.get(id);
    if (found === undefined) throw new Error(`md2ui: no pipeline session ${id}`);
    return found;
  };
  const host: PipelineHost = {
    open() {
      opened += 1;
      sessions.set(opened, createSession({ loadFonts: loadOnce, kit, faces }));
      return opened;
    },
    setFaces: (id, input) => session(id).setFaces(input),
    async prepare(id, markdown, width) {
      clearTimeout(wideWarm);
      const prepared = await session(id).prepare(markdown, width);
      if (!wideWarmed) {
        clearTimeout(wideWarm);
        wideWarm = setTimeout(() => {
          wideWarmed = true;
          prewarmWide(kit);
        }, WIDE_WARM_PAUSE_MS);
      }
      return prepared;
    },
    highlighted: (id) => session(id).highlighted(),
    render: (id, width) => session(id).render(width),
    withStates: (id, states) => session(id).withStates(states),
    close(id) {
      sessions.get(id)?.dispose();
      sessions.delete(id);
    },
    async decode(blob, options) {
      const bitmap = await createImageBitmap(blob, options);
      return transfer(bitmap, [bitmap]);
    },
  };
  expose(host);
}
