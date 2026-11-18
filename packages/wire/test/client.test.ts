import { createHash } from "node:crypto";
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  createWireClient,
  type OutgoingEvent,
  type WireClientEvent,
  WireFrameError,
} from "../src/index.ts";

const hashOf = (markdown: string): string =>
  createHash("sha256").update(markdown, "utf8").digest("hex").slice(0, 16);

const frame = (value: Record<string, unknown>): string => JSON.stringify(value);

/** A client that has been told the agent's state (`i` unless given), events cleared. */
async function session(state = "i") {
  const sent: string[] = [];
  const events: WireClientEvent[] = [];
  const client = createWireClient({
    transport: { send: (text) => sent.push(text) },
    onEvent: (event) => events.push(event),
  });
  const feed = async (...frames: string[]): Promise<void> => {
    for (const text of frames) await client.receive(text);
  };
  /** A whole message streamed as `m` + `d` frames, ending with the right hash. */
  const stream = (id: string, chunks: readonly string[], replaces?: string): string[] => [
    frame({ t: "m", m: id, md: chunks[0], ...(replaces === undefined ? {} : { r: replaces }) }),
    ...chunks.slice(1).map((md, s) => frame({ t: "d", m: id, s, md })),
    frame({ t: "z", m: id, h: hashOf(chunks.join("")) }),
  ];
  await feed(frame({ t: "s", s: state }));
  events.length = 0;
  return { client, sent, events, feed, stream };
}

const click = (message: string, target = 0): OutgoingEvent => ({
  message,
  target,
  kind: "agent",
  slug: "go",
});

describe("a streamed message", () => {
  test("grows by prefix, completes on a good hash, then accepts an event", async () => {
    const { client, sent, events, feed, stream } = await session();
    await feed(...stream("c1", ["Want ", "me to ", "go?"]));
    expect(events).toEqual([
      { type: "message", id: "c1", markdown: "Want ", complete: false },
      { type: "message", id: "c1", markdown: "Want me to ", complete: false },
      { type: "message", id: "c1", markdown: "Want me to go?", complete: false },
      { type: "message", id: "c1", markdown: "Want me to go?", complete: true },
    ]);
    expect(client.sendEvent(click("c1", 2))).toEqual({ sent: true, q: 1 });
    expect(sent).toEqual(['{"t":"e","m":"c1","x":2,"q":1,"a":"go"}']);
  });

  test("a bad hash drops the message, which then has no actions", async () => {
    const { client, sent, events, feed } = await session();
    await feed(
      frame({ t: "m", m: "c1", md: "hello" }),
      frame({ t: "z", m: "c1", h: "0000000000000000" }),
    );
    expect(events.at(-1)).toEqual({ type: "dropped", id: "c1", reason: "hash_mismatch" });
    expect(client.sendEvent(click("c1"))).toEqual({ sent: false, reason: "not_ready" });
    expect(sent).toEqual([]);
  });

  test("a message not yet ended has no actions", async () => {
    const { client, feed } = await session();
    await feed(frame({ t: "m", m: "c1", md: "hello" }));
    expect(client.sendEvent(click("c1"))).toEqual({ sent: false, reason: "not_ready" });
  });

  test("a whole message is a message frame and its end", async () => {
    const { events, feed, stream } = await session();
    await feed(...stream("c1", ["whole é✓😀\n"]));
    expect(events.at(-1)).toEqual({
      type: "message",
      id: "c1",
      markdown: "whole é✓😀\n",
      complete: true,
    });
  });

  test("deltas out of order assemble in sequence order", async () => {
    const { events, feed } = await session();
    const md = "ab cd ef gh";
    await feed(
      frame({ t: "m", m: "c1", md: "ab" }),
      frame({ t: "d", m: "c1", s: 1, md: " ef" }),
      frame({ t: "d", m: "c1", s: 2, md: " gh" }),
      frame({ t: "d", m: "c1", s: 0, md: " cd" }),
      frame({ t: "z", m: "c1", h: hashOf(md) }),
    );
    expect(events.map((e) => e.type === "message" && e.markdown)).toEqual([
      "ab",
      "ab cd ef gh", // delta 0 closes the gap: one event, the whole prefix
      "ab cd ef gh",
    ]);
    expect(events.at(-1)).toMatchObject({ complete: true });
  });

  test("a missing delta at the end drops the message", async () => {
    const { events, feed } = await session();
    await feed(
      frame({ t: "m", m: "c1", md: "a" }),
      frame({ t: "d", m: "c1", s: 1, md: "c" }),
      frame({ t: "z", m: "c1", h: hashOf("ac") }),
    );
    expect(events.at(-1)).toEqual({ type: "dropped", id: "c1", reason: "missing_delta" });
  });

  test("a repeated delta is ignored and not appended twice", async () => {
    const { events, feed } = await session();
    await feed(
      frame({ t: "m", m: "c1", md: "a" }),
      frame({ t: "d", m: "c1", s: 0, md: "b" }),
      frame({ t: "d", m: "c1", s: 0, md: "b" }),
      frame({ t: "z", m: "c1", h: hashOf("ab") }),
    );
    expect(events.filter((e) => e.type === "ignored")).toEqual([
      { type: "ignored", reason: "duplicate_delta", detail: "c1 #0" },
    ]);
    expect(events.at(-1)).toMatchObject({ complete: true, markdown: "ab" });
  });

  test("a message frame arriving after its first delta still heads the message", async () => {
    const { events, feed } = await session();
    await feed(
      frame({ t: "d", m: "c1", s: 0, md: " world" }),
      frame({ t: "m", m: "c1", md: "hello" }),
      frame({ t: "z", m: "c1", h: hashOf("hello world") }),
    );
    // Nothing is shown before the head arrives.
    expect(events).toEqual([
      { type: "message", id: "c1", markdown: "hello world", complete: false },
      { type: "message", id: "c1", markdown: "hello world", complete: true },
    ]);
  });

  test("a delta for an unseen message opens it with an empty first chunk", async () => {
    const { events, feed } = await session();
    await feed(
      frame({ t: "d", m: "c1", s: 0, md: "x" }),
      frame({ t: "z", m: "c1", h: hashOf("x") }),
    );
    expect(events.at(-1)).toMatchObject({ id: "c1", markdown: "x", complete: true });
  });

  test("a message frame for a known id is ignored", async () => {
    const { events, feed } = await session();
    await feed(frame({ t: "m", m: "c1", md: "a" }), frame({ t: "m", m: "c1", md: "b" }));
    expect(events.at(-1)).toMatchObject({ type: "ignored", reason: "duplicate_message" });
  });

  test("an assembled size over the cap drops the message and frees it", async () => {
    const { client, events, feed } = await session();
    const half = "a".repeat(131072);
    await feed(
      frame({ t: "m", m: "c1", md: half }),
      frame({ t: "d", m: "c1", s: 0, md: half }),
      frame({ t: "d", m: "c1", s: 1, md: "b" }),
      frame({ t: "z", m: "c1", h: hashOf(`${half}${half}b`) }),
    );
    expect(events.at(-1)).toMatchObject({ type: "ignored", reason: "after_end" });
    expect(events.at(-2)).toEqual({ type: "dropped", id: "c1", reason: "too_large" });
    expect(client.sendEvent(click("c1"))).toEqual({ sent: false, reason: "not_ready" });
  });

  test("a frame over the cap is never opened, so its end finds no message", async () => {
    const { client, events, feed } = await session();
    await feed(
      frame({ t: "m", m: "c1", md: "a".repeat(262144) }),
      frame({ t: "z", m: "c1", h: hashOf("") }),
    );
    expect(events.at(-2)).toMatchObject({ type: "ignored", reason: "undecodable" });
    expect(events.at(-1)).toEqual({ type: "ignored", reason: "unknown_message", detail: "c1" });
    expect(client.sendEvent(click("c1"))).toEqual({ sent: false, reason: "unknown_message" });
  });

  test("a message of no Markdown completes: an empty message frame, then its end", async () => {
    const { events, feed } = await session();
    await feed(frame({ t: "m", m: "c1", md: "" }), frame({ t: "z", m: "c1", h: hashOf("") }));
    expect(events.at(-1)).toMatchObject({ id: "c1", markdown: "", complete: true });
  });

  test("an assembled size of exactly the cap completes", async () => {
    const { events, feed } = await session();
    const half = "a".repeat(131072);
    await feed(
      frame({ t: "m", m: "c1", md: half }),
      frame({ t: "d", m: "c1", s: 0, md: half }),
      frame({ t: "z", m: "c1", h: hashOf(half + half) }),
    );
    expect(events.at(-1)).toMatchObject({ complete: true });
  });

  test("frames after the end are ignored", async () => {
    const { events, feed, stream } = await session();
    await feed(...stream("c1", ["a"]));
    events.length = 0;
    await feed(
      frame({ t: "d", m: "c1", s: 5, md: "late" }),
      frame({ t: "z", m: "c1", h: hashOf("a") }),
    );
    expect(events.map((e) => e.type === "ignored" && e.reason)).toEqual(["after_end", "after_end"]);
  });

  test("an end for an unknown message is ignored", async () => {
    const { events, feed } = await session();
    await feed(frame({ t: "z", m: "nope", h: "0000000000000000" }));
    expect(events).toEqual([{ type: "ignored", reason: "unknown_message", detail: "nope" }]);
  });

  test("an undecodable frame is ignored with the reason", async () => {
    const { events, feed } = await session();
    await feed("not json", frame({ t: "m", m: "../x", md: "" }));
    expect(events).toEqual([
      { type: "ignored", reason: "undecodable", detail: "bad_frame: not JSON" },
      { type: "ignored", reason: "undecodable", detail: 'bad_frame: bad or missing "m"' },
    ]);
  });
});

describe("a replace while a click is pending", () => {
  test("stales the old message at once and gates the new one until its end", async () => {
    const { client, sent, events, feed, stream } = await session();
    await feed(frame({ t: "s", s: "l" }), ...stream("A", ["Pick one"]));
    expect(client.sendEvent(click("A"))).toEqual({ sent: true, q: 1 });
    expect(client.blocked).toBe(true); // listening: blocked itself, the server's `w` follows

    const [open, ...rest] = stream("B", ["Picked"], "A");
    await feed(open ?? "");
    expect(events.at(-1)).toEqual({
      type: "message",
      id: "B",
      markdown: "Picked",
      replaces: "A",
      complete: false,
    });
    await feed(frame({ t: "x", code: "stale", m: "A", q: 1 }));
    expect(events.at(-1)).toEqual({
      type: "refused",
      frame: { t: "x", code: "stale", m: "A", q: 1 },
    });
    await feed(frame({ t: "s", s: "l" })); // releases the self-block
    expect(client.blocked).toBe(false);

    expect(client.sendEvent(click("A"))).toEqual({ sent: false, reason: "stale" });
    expect(client.sendEvent(click("B"))).toEqual({ sent: false, reason: "not_ready" });
    await feed(...rest);
    expect(events.at(-1)).toEqual({
      type: "message",
      id: "B",
      markdown: "Picked",
      replaces: "A",
      complete: true,
    });
    expect(client.sendEvent(click("B"))).toEqual({ sent: true, q: 2 });
    expect(sent.at(-1)).toBe('{"t":"e","m":"B","x":0,"q":2,"a":"go"}');
  });

  test("replacing a message still streaming discards it", async () => {
    const { client, events, feed, stream } = await session();
    await feed(frame({ t: "m", m: "A", md: "half" }), ...stream("B", ["new"], "A"));
    events.length = 0;
    await feed(
      frame({ t: "d", m: "A", s: 0, md: "more" }),
      frame({ t: "z", m: "A", h: hashOf("halfmore") }),
    );
    expect(events).toEqual([
      { type: "ignored", reason: "stale_message", detail: "A" },
      { type: "ignored", reason: "stale_message", detail: "A" },
    ]);
    expect(client.sendEvent(click("A"))).toEqual({ sent: false, reason: "stale" });
  });

  test("a replace is processed after the completion it follows, though fed without awaiting", async () => {
    const { events, client, stream } = await session();
    const [m, z] = stream("A", ["one"]);
    const [m2, z2] = stream("B", ["two"], "A");
    const pending = [m, z, m2, z2].map((text) => client.receive(text ?? ""));
    await Promise.all(pending);
    expect(events.map((e) => e.type === "message" && `${e.id}:${e.complete}`)).toEqual([
      "A:false",
      "A:true",
      "B:false",
      "B:true",
    ]);
  });

  test("a throwing host does not break the chain", async () => {
    const sent: string[] = [];
    let seen = 0;
    const client = createWireClient({
      transport: { send: (text) => sent.push(text) },
      onEvent: () => {
        seen += 1;
        if (seen === 1) throw new Error("host failed");
      },
    });
    const first = client.receive(frame({ t: "s", s: "l" }));
    const second = client.receive(frame({ t: "s", s: "w" }));
    await expect(first).rejects.toThrow("host failed");
    await second;
    expect(client.state).toBe("w");
  });
});

describe("a stale event", () => {
  test("surfaces the server's refusal and refuses locally afterwards", async () => {
    const { client, events, feed, stream } = await session();
    await feed(...stream("c7.12", ["old"]), ...stream("c7.13", ["new"], "c7.12"));
    await feed(frame({ t: "x", code: "stale", m: "c7.12", q: 4 }));
    expect(events.at(-1)).toEqual({
      type: "refused",
      frame: { t: "x", code: "stale", m: "c7.12", q: 4 },
    });
    expect(client.sendEvent(click("c7.12"))).toEqual({ sent: false, reason: "stale" });
  });
});

describe("the agent's state", () => {
  test("nothing is sent before the first state", async () => {
    const sent: string[] = [];
    const client = createWireClient({
      transport: { send: (t) => sent.push(t) },
      onEvent: () => {},
    });
    expect(client.state).toBeUndefined();
    expect(client.blocked).toBe(true);
    expect(client.sendPrompt("hi")).toEqual({ sent: false, reason: "blocked" });
    await client.receive(frame({ t: "s", s: "i" }));
    expect(client.sendPrompt("hi")).toEqual({ sent: true, q: 1 });
    expect(sent).toEqual(['{"t":"p","q":1,"tx":"hi"}']);
  });

  // md2ui ADR-613: a state's words for the host's chrome hold until the next state.
  test("a state hands the host its step and its question; a bare state clears both", async () => {
    const { events, feed } = await session();
    await feed(frame({ t: "s", s: "w", n: "Edit app.py" }));
    expect(events.at(-1)).toEqual({ type: "state", state: "w", note: "Edit app.py" });
    await feed(frame({ t: "s", s: "l", ph: "Any note for the rider?" }));
    expect(events.at(-1)).toEqual({
      type: "state",
      state: "l",
      placeholder: "Any note for the rider?",
    });
    await feed(frame({ t: "s", s: "l" }));
    expect(events.at(-1)).toEqual({ type: "state", state: "l" });
  });

  test("working blocks events and prompts; nothing is sent", async () => {
    const { client, sent, events, feed, stream } = await session();
    await feed(...stream("c1", ["a"]), frame({ t: "s", s: "w", n: "thinking" }));
    expect(events.at(-1)).toEqual({ type: "state", state: "w", note: "thinking" });
    expect(client.blocked).toBe(true);
    expect(client.sendEvent(click("c1"))).toEqual({ sent: false, reason: "blocked" });
    expect(client.sendPrompt("hi")).toEqual({ sent: false, reason: "blocked" });
    expect(sent).toEqual([]);
    await feed(frame({ t: "s", s: "l" }));
    expect(client.blocked).toBe(false);
  });

  test("sending while listening blocks until the next state frame, even the same state", async () => {
    const { client, events, feed, stream } = await session();
    await feed(...stream("c1", ["a"]), frame({ t: "s", s: "l" }));
    expect(client.sendPrompt("one")).toEqual({ sent: true, q: 1 });
    expect(client.blocked).toBe(true);
    expect(client.sendPrompt("two")).toEqual({ sent: false, reason: "blocked" });
    await feed(frame({ t: "s", s: "l" }));
    expect(events.at(-1)).toEqual({ type: "state", state: "l" });
    expect(client.blocked).toBe(false);
    expect(client.sendEvent(click("c1"))).toEqual({ sent: true, q: 2 });
  });

  test("a refusal releases the self-block: a frame-level one is not followed by a state", async () => {
    const { client, feed } = await session("l");
    client.sendPrompt("one");
    expect(client.blocked).toBe(true);
    await feed(frame({ t: "x", code: "bad_frame" }));
    expect(client.blocked).toBe(false);
  });

  test("a completed message releases the self-block: the agent has answered", async () => {
    const { client, feed, stream } = await session("l");
    await feed(...stream("c1", ["a"]));
    client.sendEvent(click("c1"));
    expect(client.blocked).toBe(true);
    await feed(...stream("c2", ["b"], "c1"));
    expect(client.blocked).toBe(false);
  });

  test("idle never self-blocks", async () => {
    const { client, feed, stream } = await session();
    await feed(...stream("c1", ["a"]), frame({ t: "s", s: "i" }));
    expect(client.sendPrompt("one").sent).toBe(true);
    expect(client.sendEvent(click("c1"))).toEqual({ sent: true, q: 2 });
    expect(client.blocked).toBe(false);
  });
});

// md2ui `protocol/README.md`, *Lifecycle* 7 (cb81468e): the typing frame, throttled in the
// client as md2ui's wire_client.py `typing` throttles it.
describe("typing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test("the first key sends k, then at most one a second while keys are pressed", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const { client, sent } = await session("l");
    client.hello();
    sent.length = 0;
    client.sendTyping();
    expect(sent).toEqual(['{"t":"k"}']);
    for (let ms = 0; ms < 999; ms += 111) {
      vi.advanceTimersByTime(111);
      client.sendTyping();
    }
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1000 - 999);
    client.sendTyping();
    expect(sent).toEqual(['{"t":"k"}', '{"t":"k"}']);
    client.sendTyping();
    expect(sent).toHaveLength(2);
  });

  test("nothing before the hello, while the agent works, or after this client's own send", async () => {
    vi.useFakeTimers({ toFake: ["performance"] });
    const { client, sent, feed } = await session("l");
    client.sendTyping();
    expect(sent).toEqual([]);
    client.hello();
    sent.length = 0;
    client.sendPrompt("one");
    client.sendTyping();
    expect(sent).toEqual(['{"t":"p","q":1,"tx":"one"}']);
    await feed(frame({ t: "s", s: "w" }));
    client.sendTyping();
    expect(sent).toHaveLength(1);
    await feed(frame({ t: "s", s: "i" }));
    client.sendTyping();
    expect(sent.at(-1)).toBe('{"t":"k"}');
  });

  test("before the first state, typing still goes once the hello has", () => {
    const sent: string[] = [];
    const client = createWireClient({
      transport: { send: (t) => sent.push(t) },
      onEvent: () => {},
    });
    client.hello();
    client.sendTyping();
    expect(sent).toEqual(['{"t":"h","v":1}', '{"t":"k"}']);
  });
});

// md2ui ADR-601 (5c7bf1d9): a listening state's `u`, resolved as md2ui's
// wire_client.py `answered()` resolves it, on the message now standing for the event's.
describe("the events a listening state answered", () => {
  test("follow each event's message through its replacements", async () => {
    const { client, events, feed, stream } = await session();
    await feed(...stream("c1", ["a"]), ...stream("c9", ["z"]));
    expect(client.sendEvent(click("c1", 2))).toEqual({ sent: true, q: 1 });
    expect(client.sendEvent(click("c9", 0))).toEqual({ sent: true, q: 2 });
    await feed(...stream("c2", ["b"], "c1"), ...stream("c3", ["c"], "c2"));
    expect(client.sendEvent(click("c3", 1))).toEqual({ sent: true, q: 3 });
    events.length = 0;
    await feed(frame({ t: "s", s: "l", u: [1, 2, 3] }));
    expect(events).toEqual([
      {
        type: "state",
        state: "l",
        answered: [
          { message: "c3", target: 2 },
          { message: "c9", target: 0 },
          { message: "c3", target: 1 },
        ],
      },
    ]);
  });

  // md2ui ADR-612 (8806456fc): a click the backend answers is released in any state.
  test("a working or idle state releases the events it names too", async () => {
    const { client, events, feed, stream } = await session();
    await feed(...stream("c1", ["a"]));
    expect(client.sendEvent(click("c1", 2))).toEqual({ sent: true, q: 1 });
    events.length = 0;
    await feed(...stream("c2", ["b"], "c1"), frame({ t: "s", s: "w", u: [1] }));
    expect(events.at(-1)).toEqual({
      type: "state",
      state: "w",
      answered: [{ message: "c2", target: 2 }],
    });
  });

  test("a replacement still streaming is the message that stands", async () => {
    const { client, events, feed, stream } = await session();
    await feed(...stream("c1", ["a"]));
    client.sendEvent(click("c1", 4));
    await feed(frame({ t: "m", m: "c2", r: "c1", md: "b" }), frame({ t: "s", s: "l", u: [1] }));
    expect(events.at(-1)).toEqual({
      type: "state",
      state: "l",
      answered: [{ message: "c2", target: 4 }],
    });
  });

  // md2ui ADR-614 (639b39ab8): a handler may answer a tap with a new page of its includes, a
  // new message, and then name the tap in `u`. The event stays on the page it was sent on,
  // so a host releases nothing on the page now shown.
  test("after a backend's new page, the event stays on the page left", async () => {
    const { client, events, feed, stream } = await session();
    await feed(...stream("c1", ["a"]));
    expect(client.sendEvent(click("c1", 0))).toEqual({ sent: true, q: 1 });
    await feed(...stream("c2", ["b"]));
    expect(client.sendEvent(click("c2", 0))).toEqual({ sent: true, q: 2 });
    events.length = 0;
    await feed(frame({ t: "s", s: "l", u: [1] }));
    expect(events).toEqual([
      { type: "state", state: "l", answered: [{ message: "c1", target: 0 }] },
    ]);
  });

  test("leave out prompts and other connections' q", async () => {
    const { client, events, feed, stream } = await session();
    await feed(...stream("c1", ["a"]));
    expect(client.sendPrompt("hi")).toEqual({ sent: true, q: 1 });
    expect(client.sendEvent(click("c1", 0))).toEqual({ sent: true, q: 2 });
    events.length = 0;
    await feed(frame({ t: "s", s: "l", u: [1, 2, 99] }));
    expect(events).toEqual([
      { type: "state", state: "l", answered: [{ message: "c1", target: 0 }] },
    ]);
    await feed(frame({ t: "s", s: "l", u: [1, 99] }));
    expect(events.at(-1)).toEqual({ type: "state", state: "l" });
  });

  // md2ui keeps the old page on screen when a replacement fails its hash, and releases the
  // button there (wire_client.py: the dropped message never joins `_chain`, the old one
  // stays in it). A view holds the old page's states aside under the replacement's id
  // while it streams, so the event stays on the replacement.
  const dropped = (id: string, replaces: string): string[] => [
    frame({ t: "m", m: id, r: replaces, md: "e" }),
    frame({ t: "z", m: id, h: "0000000000000000" }),
  ];

  test("an event whose replacement dropped is still answered, on that replacement", async () => {
    const { client, events, feed, stream } = await session();
    await feed(...stream("c4", ["d"]));
    expect(client.sendEvent(click("c4", 3))).toEqual({ sent: true, q: 1 });
    await feed(...dropped("c5", "c4"));
    expect(events.at(-1)).toEqual({ type: "dropped", id: "c5", reason: "hash_mismatch" });
    await feed(frame({ t: "s", s: "l", u: [1] }));
    expect(events.at(-1)).toEqual({
      type: "state",
      state: "l",
      answered: [{ message: "c5", target: 3 }],
    });
  });

  test("the agent's next replacement, naming the dropped one, takes its events", async () => {
    const { client, events, feed, stream } = await session();
    await feed(...stream("c1", ["a"]));
    client.sendEvent(click("c1", 2));
    await feed(...dropped("c2", "c1"), frame({ t: "s", s: "l", u: [1] }));
    expect(events.at(-1)).toEqual({
      type: "state",
      state: "l",
      answered: [{ message: "c2", target: 2 }],
    });
    await feed(...stream("c3", ["c"], "c2"), frame({ t: "s", s: "l", u: [1] }));
    expect(events.at(-1)).toEqual({
      type: "state",
      state: "l",
      answered: [{ message: "c3", target: 2 }],
    });
  });

  test("a new message after a drop leaves the events where they stand", async () => {
    const { client, events, feed, stream } = await session();
    await feed(...stream("c1", ["a"]));
    client.sendEvent(click("c1", 1));
    await feed(...dropped("c2", "c1"), ...stream("c6", ["f"]));
    await feed(frame({ t: "s", s: "l", u: [1] }));
    expect(events.at(-1)).toEqual({
      type: "state",
      state: "l",
      answered: [{ message: "c2", target: 1 }],
    });
  });
});

describe("sending", () => {
  test("a kind that does not travel is not forwarded", async () => {
    const { client, sent, feed, stream } = await session();
    await feed(...stream("c1", ["a"]));
    const link = { message: "c1", target: 0, kind: "link" } as unknown as OutgoingEvent;
    expect(client.sendEvent(link)).toEqual({ sent: false, reason: "not_forwarded" });
    expect(sent).toEqual([]);
  });

  test("an unknown message is refused", async () => {
    expect((await session()).client.sendEvent(click("nope"))).toEqual({
      sent: false,
      reason: "unknown_message",
    });
  });

  test("q is shared by events and prompts, and carries the optional keys", async () => {
    const { client, sent, feed, stream } = await session();
    await feed(...stream("c1", ["a"]));
    client.sendPrompt("first");
    client.sendEvent({
      message: "c1",
      target: 3,
      kind: "slider",
      value: 72.5,
      settled: [
        [1, 3],
        [2, true],
      ],
    });
    client.sendEvent({ message: "c1", target: 1, kind: "checkbox", checked: false });
    expect(sent).toEqual([
      '{"t":"p","q":1,"tx":"first"}',
      '{"t":"e","m":"c1","x":3,"q":2,"v":72.5,"vs":[[1,3],[2,true]]}',
      '{"t":"e","m":"c1","x":1,"q":3,"c":false}',
    ]);
  });

  test("a malformed frame is misuse and throws without spending a sequence number", async () => {
    const { client, sent, feed, stream } = await session();
    await feed(...stream("c1", ["a"]));
    expect(() => client.sendPrompt("  ")).toThrow(WireFrameError);
    expect(() => client.sendEvent(click("c1", -1))).toThrow(WireFrameError);
    expect(() => client.sendPrompt("\u001c\u0085 ")).toThrow(WireFrameError); // blank to Python
    expect(client.sendPrompt("ok")).toEqual({ sent: true, q: 1 });
    expect(sent).toEqual(['{"t":"p","q":1,"tx":"ok"}']);
  });

  test("a frame over its size limit is refused, not thrown, and spends nothing", async () => {
    const { client, sent, feed, stream } = await session();
    await feed(...stream("c1", ["a"]));
    expect(client.sendPrompt("a".repeat(4097))).toEqual({ sent: false, reason: "too_large" });
    const settled = Array.from({ length: 32 }, (_, i): [number, number] => [i + 1, 1234.5]);
    expect(client.sendEvent({ ...click("c1"), slug: "s".repeat(128), settled })).toEqual({
      sent: false,
      reason: "too_large",
    });
    expect(sent).toEqual([]);
    expect(client.sendPrompt("ok")).toEqual({ sent: true, q: 1 });
  });

  test("hello is the version frame", async () => {
    const { client, sent } = await session();
    client.hello();
    expect(sent).toEqual(['{"t":"h","v":1}']);
  });
});

describe("the platform", () => {
  test("a client cannot be made without WebCrypto", () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
    Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true });
    try {
      expect(() => createWireClient({ transport: { send: () => {} }, onEvent: () => {} })).toThrow(
        /WebCrypto/,
      );
    } finally {
      if (descriptor !== undefined) Object.defineProperty(globalThis, "crypto", descriptor);
    }
  });
});
