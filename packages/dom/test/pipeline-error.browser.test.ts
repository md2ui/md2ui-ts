// A view whose session cannot open (its chunk fails to load, or `createSession` throws)
// reports it once, as `md2ui-error {resource: "pipeline"}`, and stays empty.
import { createFontFaces } from "@md2ui/text-pretext";
import { expect, test, vi } from "vitest";
import { createPictures } from "../src/pictures.ts";
import { createView } from "../src/view.ts";
import { MARKDOWN, THEME } from "./document.ts";

test("a session that cannot open is one pipeline error, and nothing unhandled", async () => {
  const unhandled: unknown[] = [];
  const onRejection = (event: PromiseRejectionEvent): void => {
    unhandled.push(event.reason);
  };
  window.addEventListener("unhandledrejection", onRejection);
  const host = document.createElement("div");
  host.style.cssText = "width: 500px; height: 300px";
  document.body.append(host);
  const errors: unknown[] = [];
  host.addEventListener("md2ui-error", (event) => errors.push((event as CustomEvent).detail));
  const view = createView(
    host,
    {
      markdown: "",
      messageId: null,
      themeSrc: null,
      themeText: THEME,
      assetBase: null,
      fonts: [],
      disabled: false,
      streaming: false,
      motion: "auto",
    },
    () => Promise.reject(new Error("chunk failed")),
    createFontFaces(),
    createPictures(() => Promise.reject(new Error("no decode"))),
  );
  view.markdown = MARKDOWN;
  await vi.waitFor(() => expect(errors).toHaveLength(1));
  view.themeText = `${THEME}\n`;
  view.markdown = `${MARKDOWN}\n\nMore.`;
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(errors).toEqual([{ resource: "pipeline", url: "", message: "Error: chunk failed" }]);
  expect(unhandled).toEqual([]);
  view.destroy();
  host.remove();
  window.removeEventListener("unhandledrejection", onRejection);
});
