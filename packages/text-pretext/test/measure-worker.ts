// The Worker side of the Worker test: the Pretext measurer built and asked inside
// a dedicated Worker, where there is no `document` and Pretext measures on an
// OffscreenCanvas. It answers the same questions the main thread answers.
import type { FontSource } from "@md2ui/contracts";
import { createPretextMeasurer } from "../src/index.ts";
import { battery } from "./battery.ts";
import { emojiAnswers } from "./emoji-answers.ts";

export interface WorkerRequest {
  readonly family: string;
  readonly sources: readonly FontSource[];
}

export interface WorkerReply {
  readonly hasDocument: boolean;
  readonly hasFontSet: boolean;
  readonly answers: unknown;
  readonly emoji: unknown;
}

addEventListener("message", async (event: MessageEvent<WorkerRequest>) => {
  const { family, sources } = event.data;
  const measurer = await createPretextMeasurer(sources);
  const reply: WorkerReply = {
    hasDocument: typeof document !== "undefined",
    hasFontSet: "fonts" in globalThis,
    answers: battery(measurer, family),
    emoji: emojiAnswers(measurer, family),
  };
  postMessage(reply);
});
