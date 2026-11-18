// One highlighter per view: reused while it covers a document's languages, grown when a
// document names a new one, started afresh for a new syntax style, and every instance
// but the shown one and the latest released.
import { parseTheme } from "@md2ui/core";
import { expect, test } from "vitest";
import { createViewHighlighter } from "../src/highlight.ts";

const monokai = parseTheme("## Code Blocks\nSyntax style: monokai\n");
const dracula = parseTheme("## Code Blocks\nSyntax style: dracula\n");

/** Deferred work, run when the test says so. */
function deferred() {
  const queue: (() => void)[] = [];
  return {
    defer: (work: () => void) => queue.push(work),
    flush: async () => {
      for (const work of queue.splice(0)) work();
      // A release waits for its load.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

/** Whether `h` still answers: a released highlighter throws. */
const alive = (h: ((s: string, l: string) => unknown) | null): boolean => {
  try {
    h?.("x = 1", "python");
    return true;
  } catch {
    return false;
  }
};

test("no code, no highlighter", async () => {
  const { defer } = deferred();
  expect(await createViewHighlighter(defer).load(monokai, new Set())).toBeNull();
});

test("a highlighter is reused while it covers the languages, and grown when it does not", async () => {
  const { defer, flush } = deferred();
  const view = createViewHighlighter(defer);
  const first = await view.load(monokai, new Set(["python"]));
  view.show(first);
  expect(await view.load(monokai, new Set(["python"]))).toBe(first);
  expect(await view.load(monokai, new Set())).toBe(first);
  const grown = await view.load(monokai, new Set(["sh"]));
  expect(grown).not.toBe(first);
  expect(grown?.("x = 1", "python")).not.toBeNull();
  // The shown document still paints with the first until the grown one is shown.
  await flush();
  expect(alive(first)).toBe(true);
  view.show(grown);
  await flush();
  expect(alive(first)).toBe(false);
  expect(alive(grown)).toBe(true);
});

test("a new syntax style starts afresh; a load nobody showed is released when replaced", async () => {
  const { defer, flush } = deferred();
  const view = createViewHighlighter(defer);
  const shown = await view.load(monokai, new Set(["python"]));
  view.show(shown);
  const skipped = await view.load(dracula, new Set(["python"]));
  const latest = await view.load(monokai, new Set(["python", "sh"]));
  await flush();
  expect([alive(shown), alive(skipped), alive(latest)]).toEqual([true, false, true]);
  view.dispose();
  await flush();
  expect([alive(shown), alive(latest)]).toEqual([false, false]);
});

test("a half-written fence name loads nothing", async () => {
  const { defer } = deferred();
  const view = createViewHighlighter(defer);
  expect(await view.load(monokai, new Set(["pyt"]))).toBeNull();
  expect(view.now(monokai, new Set(["pyt"]))).toEqual({ highlighter: null, complete: true });
});

test("what colours code now: the shown highlighter while a grown one loads", async () => {
  const { defer } = deferred();
  const view = createViewHighlighter(defer);
  const first = await view.load(monokai, new Set(["python"]));
  view.show(first);
  const now = (languages: string[], theme = monokai) => view.now(theme, new Set(languages));
  expect(now(["python"]).highlighter).toBe(first);
  expect(now(["python"]).complete).toBe(true);
  const growing = view.load(monokai, new Set(["python", "sh"]));
  expect(now(["python", "sh"]).highlighter).toBe(first);
  expect(now(["python", "sh"]).complete).toBe(false);
  const grown = await growing;
  expect(now(["python", "sh"]).highlighter).toBe(grown);
  expect(now(["python", "sh"]).complete).toBe(true);
  // Another syntax style has nothing loaded yet.
  expect(now(["python"], dracula)).toEqual({ highlighter: null, complete: false });
});
