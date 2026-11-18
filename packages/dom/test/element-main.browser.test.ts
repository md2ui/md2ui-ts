// `<md2ui-view>` with its pipeline on the main thread (C6 `defineMd2uiView({ worker:
// false })`): the element's whole suite, and the live and memory suites, run
// again here, as a host that opts out of the Worker runs them.
import { vi } from "vitest";

vi.mock(import("../src/element.ts"), async (original) => {
  const actual = await original();
  return { ...actual, defineMd2uiView: () => actual.defineMd2uiView({ worker: false }) };
});

import "./element.browser.test.ts";
import "./live.browser.test.ts";
import "./memory.browser.test.ts";
