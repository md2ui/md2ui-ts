// Where a view's pipeline session runs (C6), and where its registration's pictures are
// decoded. By default in a Worker: one per registration, made when the first view opens
// a session, each view's session called on it by number through Comlink (ADR-007; not a
// proxy each: see `PipelineHost`). The Worker is `@md2ui/dom`'s own (pipeline-worker.ts),
// or the host's. When no Worker can be had, or a registration asks for none, on the main
// thread: the session module is then loaded on demand, so a page whose views run in a
// Worker does not load the pipeline twice.
//
// A raster picture is decoded where the pipeline runs: WebKit decodes a blob,
// and Chromium scales a reduced decode, on the thread that asks, which on the page cost a
// frame of 100 ms or more when a picture landed. The Worker hands the bitmap back
// transferred, not copied.
import { RegexKit } from "@md2ui/core";
import type { FontFaces } from "@md2ui/text-pretext";
import { type Remote, wrap } from "comlink";
import { whenIdle } from "./idle.ts";
import type { PipelineHost, PipelineSession } from "./session.ts";

/** Opens a session for one view. */
export type OpenSession = () => Promise<PipelineSession>;

/** Decodes a raster `blob` as `createImageBitmap` does with `options`. */
export type Decode = (blob: Blob, options: ImageBitmapOptions) => Promise<ImageBitmap>;

/** Where a registration's views run their pipeline, and where its pictures are decoded. */
export interface PipelineThread {
  readonly open: OpenSession;
  readonly decode: Decode;
}

/** Where a registration's views run their pipeline (`Md2uiViewOptions.worker`). */
export type WorkerChoice = false | (() => Worker);

/**
 * `@md2ui/dom`'s own Worker. Written as bundlers that ship a module Worker with the page
 * (Vite, webpack, Parcel) look for one, so they find and bundle its file.
 */
export const pipelineWorker = (): Worker =>
  new Worker(new URL("./pipeline-worker.js", import.meta.url), { type: "module" });

/** Sessions on this thread, whose fonts the views load through `faces`. */
function pageSessions(faces: FontFaces): OpenSession {
  // One kit for the registration's sessions, as `exposePipeline` keeps one for a Worker's,
  // warmed while idle once the first opens.
  const kit = new RegexKit();
  let warmed = false;
  return async () => {
    const { createSession, prewarm } = await import("./session.ts");
    if (!warmed) whenIdle(() => prewarm(kit));
    warmed = true;
    return createSession({ loadFonts: null, kit, faces });
  };
}

/** The session numbered `id` in the Worker `host` serves, called as one on this thread is. */
function remoteSession(host: Remote<PipelineHost>, id: number): PipelineSession {
  return {
    setFaces: (faces) => host.setFaces(id, faces),
    prepare: (markdown, width) => host.prepare(id, markdown, width),
    highlighted: () => host.highlighted(id),
    render: (width) => host.render(id, width),
    withStates: (states) => host.withStates(id, states),
    dispose: () => void host.close(id),
  };
}

/**
 * How the views of one registration open their sessions and decode their pictures: in
 * the Worker `worker` makes, or on this thread when it is false. A Worker that cannot be
 * made, or that fails before it first answers (a CSP `worker-src`, a page opened from
 * `file://`, a Worker file the bundler did not ship), is given up for the registration's
 * life: every view, those already waiting for it included, runs on this thread instead,
 * and its pictures are decoded here.
 */
export function pipelineThread(worker: WorkerChoice, faces: FontFaces): PipelineThread {
  const onPage = pageSessions(faces);
  const decodeHere: Decode = (blob, options) => createImageBitmap(blob, options);
  if (worker === false) return { open: onPage, decode: decodeHere };
  let host: {
    readonly remote: Remote<PipelineHost>;
    /** Resolves, to null, when the Worker fails before it has first answered. */
    readonly failed: Promise<null>;
  } | null = null;
  let answered = false;
  let givenUp = false;
  /** `call`'s answer from the Worker; null when there is no Worker to answer it. */
  const onWorker = async <T>(
    call: (remote: Remote<PipelineHost>) => Promise<T>,
  ): Promise<{ readonly answer: T } | null> => {
    if (givenUp) return null;
    if (host === null) {
      let made: Worker;
      try {
        made = worker();
      } catch {
        givenUp = true;
        return null;
      }
      const failed = new Promise<null>((resolve) => {
        made.addEventListener(
          "error",
          () => {
            if (answered) return;
            givenUp = true;
            made.terminate();
            resolve(null);
          },
          { once: true },
        );
      });
      host = { remote: wrap<PipelineHost>(made), failed };
    }
    const asking = call(host.remote).then((answer) => ({ answer }));
    // Once the Worker has answered, an error it reports is a document's, not its start's.
    const reply = answered ? await asking : await Promise.race([asking, host.failed]);
    if (reply !== null) answered = true;
    return reply;
  };
  return {
    async open() {
      const opened = await onWorker(async (remote) => remoteSession(remote, await remote.open()));
      return opened?.answer ?? onPage();
    },
    async decode(blob, options) {
      const decoded = await onWorker((remote) => remote.decode(blob, options));
      return decoded?.answer ?? decodeHere(blob, options);
    },
  };
}
