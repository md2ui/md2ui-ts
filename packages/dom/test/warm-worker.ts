// The dev server serves a Worker's module graph file by file, which on a first load can
// take longer than a test waits for a view (a host's bundled Worker is one file): a suite
// whose views run in the element's own Worker starts one, and has it answer, first.
import { wrap } from "comlink";
import type { PipelineHost } from "../src/session.ts";
import { pipelineWorker } from "../src/sessions.ts";

/** Resolves once a Worker made as the element makes its own has answered. */
export async function warmPipelineWorker(): Promise<void> {
  const worker = pipelineWorker();
  try {
    await wrap<PipelineHost>(worker).open();
  } finally {
    worker.terminate();
  }
}

/** How long the first load may take under a loaded gate. */
export const WARM_TIMEOUT_MS = 120_000;
