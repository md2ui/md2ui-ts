import { expect, test } from "vitest";
import { server } from "vitest/browser";

/** What each engine's user agent must say, so a test cannot pass in the wrong one. */
function userAgentMatches(browser: string, userAgent: string): boolean {
  switch (browser) {
    case "chromium":
      return userAgent.includes("Chrome");
    case "firefox":
      return userAgent.includes("Firefox");
    case "webkit":
      return userAgent.includes("AppleWebKit") && !userAgent.includes("Chrome");
    default:
      return false;
  }
}

test("the browser project runs in the real engine it names", () => {
  expect(["chromium", "firefox", "webkit"]).toContain(server.browser);
  expect(userAgentMatches(server.browser, navigator.userAgent)).toBe(true);
});

test("OffscreenCanvas measures text", () => {
  const ctx = new OffscreenCanvas(64, 16).getContext("2d");
  if (ctx === null) {
    throw new Error("OffscreenCanvas 2d context is unavailable");
  }
  ctx.font = "16px sans-serif";
  expect(ctx.measureText("x").width).toBeGreaterThan(0);
});
