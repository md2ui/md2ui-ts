// A page whose Content Security Policy allows no Worker (`worker-src 'none'`): the
// element's own Worker cannot start, and the views run their pipeline on the main thread.
import { expect, test, vi } from "vitest";
import { defineMd2uiView } from "../src/index.ts";
import { MARKDOWN, THEME } from "./document.ts";

test("with no Worker allowed, a view still shows its document, from the main thread", async () => {
  const policy = document.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = "worker-src 'none'";
  document.head.prepend(policy);
  const blocked = new Promise((resolve) => {
    document.addEventListener("securitypolicyviolation", resolve, { once: true });
  });
  defineMd2uiView();
  const view = document.createElement("md2ui-view");
  view.style.cssText = "width: 500px; height: 300px";
  view.themeText = THEME;
  view.markdown = MARKDOWN;
  document.body.append(view);
  await blocked;
  const layer = () => [...(view.shadowRoot?.querySelector(".layer")?.children ?? [])];
  await vi.waitFor(
    () => expect(layer().some((e) => e.getAttribute("aria-label") === "Yes")).toBe(true),
    {
      timeout: 10_000,
    },
  );
  view.remove();
});
