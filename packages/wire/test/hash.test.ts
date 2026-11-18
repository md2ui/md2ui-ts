import { expect, test } from "vitest";
import { sha256Hex16, utf8Length } from "../src/platform.ts";

test("sha256Hex16 is the first 16 hex digits of the SHA-256 of the UTF-8 bytes", async () => {
  expect(await sha256Hex16("")).toBe("e3b0c44298fc1c14");
  expect(await sha256Hex16("héllo ✓ 😀\n")).toBe("f3c2d1e944068af9");
});

test("utf8Length counts bytes, not characters", () => {
  expect(utf8Length("é✓😀")).toBe(2 + 3 + 4);
});
