// The resize cases (resize-cases.ts) in the element's own Worker, the default, where the
// layout of a new width is painted when the Worker's answer arrives.
import { beforeAll, expect, vi } from "vitest";
import { laidOutAtWidth, resizeCases } from "./resize-cases.ts";
import { WARM_TIMEOUT_MS, warmPipelineWorker } from "./warm-worker.ts";

beforeAll(warmPipelineWorker, WARM_TIMEOUT_MS);

resizeCases({}, async (view) => {
  await vi.waitFor(() => expect(laidOutAtWidth(view)).toBe(true), { interval: 1 });
});
