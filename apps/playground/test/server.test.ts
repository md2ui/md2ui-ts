import { encodeClientFrame } from "@md2ui/wire";
import { expect, test, vi } from "vitest";
import { createMemoryServer } from "../src/server.ts";

// A refusal is followed by the current state (md2ui `protocol/README.md`, *Three
// outcomes*). Without it, a client that blocked itself on sending a slider the script has
// no reply for stays blocked, and every view with it.
test("an event the script has no reply for is refused, then the agent listens again", async () => {
  const sent: { t: string; s?: string; code?: string; q?: number }[] = [];
  const server = createMemoryServer(
    { welcome: "# Hi", replies: {}, prompt: (text) => text },
    (text) => sent.push(JSON.parse(text)),
    { delayMs: 0 },
  );
  server.receive(encodeClientFrame({ t: "e", m: "c1", x: 0, q: 7, v: 65 }));
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(sent).toEqual([
    { t: "x", code: "bad_target", q: 7, m: "" },
    { t: "s", s: "l" },
  ]);
});

// md2ui ADR-613: the script's steps ride the working states and its question every
// listening state, so a client can show both.
test("each reply is preceded by the script's steps; each listening state carries its question", async () => {
  const sent: { t: string; s?: string; n?: string; ph?: string }[] = [];
  const server = createMemoryServer(
    { welcome: "# Hi", replies: {}, prompt: (text) => text, steps: ["Read", "Write"], ask: "Why?" },
    (text) => sent.push(JSON.parse(text)),
    { delayMs: 0 },
  );
  server.receive(encodeClientFrame({ t: "h", v: 1 }));
  server.receive(encodeClientFrame({ t: "e", m: "c1", x: 0, q: 7, v: 65 }));
  await vi.waitFor(() => expect(sent.filter((f) => f.t === "s")).toHaveLength(4));
  expect(sent.filter((f) => f.t === "s")).toEqual([
    { t: "s", s: "w", n: "Read" },
    { t: "s", s: "w", n: "Write" },
    { t: "s", s: "l", ph: "Why?" },
    { t: "s", s: "l", ph: "Why?" },
  ]);
});
