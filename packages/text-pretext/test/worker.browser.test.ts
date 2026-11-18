// The Worker test: does Pretext measure in a dedicated Worker on an
// OffscreenCanvas, with web fonts loaded there, and answer exactly what the main thread
// answers? The core runs without a DOM (ADR-003), so a Worker can host the whole
// pipeline; measurement has to live in the same thread as layout, because C3 is
// synchronous.
import { expect, test } from "vitest";
import { createPretextMeasurer } from "../src/index.ts";
import { battery } from "./battery.ts";
import { emojiAnswers } from "./emoji-answers.ts";
import type { WorkerReply, WorkerRequest } from "./measure-worker.ts";
import { TEST_FONTS } from "./test-fonts.ts";

function askWorker(request: WorkerRequest): Promise<WorkerReply> {
  const worker = new Worker(new URL("./measure-worker.ts", import.meta.url), { type: "module" });
  return new Promise<WorkerReply>((resolve, reject) => {
    worker.addEventListener("message", (event: MessageEvent<WorkerReply>) => {
      worker.terminate();
      resolve(event.data);
    });
    worker.addEventListener("error", (event) => {
      worker.terminate();
      reject(new Error(event.message));
    });
    worker.postMessage(request);
  });
}

test.each(TEST_FONTS)("a Worker answers what the main thread answers in $family", async (font) => {
  const reply = await askWorker({ family: font.family, sources: font.sources });
  const main = await createPretextMeasurer(font.sources);
  expect(reply.hasDocument).toBe(false);
  expect(reply.hasFontSet).toBe(true);
  expect(reply.answers).toEqual(battery(main, font.family));
  expect(reply.emoji).toEqual(emojiAnswers(main, font.family));
});
