import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  createWireClient,
  decodeClientFrame,
  decodeServerFrame,
  type WireClientEvent,
} from "../src/index.ts";

const root = process.env["MD2UI_PROTOCOL"];
if (root === undefined || root === "") {
  throw new Error("MD2UI_PROTOCOL must name md2ui's protocol/ folder");
}
const examples = join(root, "examples");
const invalid = join(examples, "invalid");

const read = (dir: string, name: string): string => readFileSync(join(dir, name), "utf8");
const jsonFiles = (dir: string): string[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .sort();
const decoder = (name: string) =>
  name.startsWith("client-") ? decodeClientFrame : decodeServerFrame;

const EXPECTED_INVALID: Readonly<Record<string, { code: string; key: string }>> = {
  "client-event-bad-id.json": { code: "bad_frame", key: "m" },
  "client-event-c-not-bool.json": { code: "bad_frame", key: "c" },
  "client-event-negative-x.json": { code: "bad_frame", key: "x" },
  "client-event-v-not-a-number.json": { code: "bad_frame", key: "v" },
  "client-prompt-no-text.json": { code: "bad_frame", key: "tx" },
  "client-unknown-type.json": { code: "bad_frame", key: "t" },
  "server-end-bad-hash.json": { code: "bad_frame", key: "h" },
  "server-state-answered-none.json": { code: "bad_frame", key: "u" },
  "server-state-placeholder-too-long.json": { code: "bad_frame", key: "ph" },
  "server-state-unknown.json": { code: "bad_frame", key: "s" },
};

describe("the conformance examples", () => {
  for (const name of jsonFiles(examples)) {
    test(`${name} is accepted`, () => {
      expect(decoder(name)(read(examples, name)).ok).toBe(true);
    });
  }

  for (const name of jsonFiles(invalid)) {
    test(`${name} is rejected as the table says`, () => {
      const result = decoder(name)(read(invalid, name));
      const wanted = EXPECTED_INVALID[name];
      expect(wanted).toBeDefined();
      if (result.ok) throw new Error("accepted");
      expect({ code: result.error.code, key: result.error.key }).toEqual(wanted);
    });
  }

  test("the table names exactly the invalid examples present", () => {
    expect(Object.keys(EXPECTED_INVALID).sort()).toEqual(jsonFiles(invalid));
  });
});

describe("the example session", () => {
  test("the message and its end complete; the replacement makes it stale", async () => {
    const events: WireClientEvent[] = [];
    const client = createWireClient({
      transport: { send: () => {} },
      onEvent: (e) => events.push(e),
    });
    await client.receive(read(examples, "server-message.json"));
    await client.receive(read(examples, "server-end.json"));
    expect(events.at(-1)).toMatchObject({ type: "message", id: "c7.12", complete: true });
    await client.receive(read(examples, "server-message-replace.json"));
    expect(client.sendEvent({ message: "c7.12", target: 0, kind: "agent" })).toEqual({
      sent: false,
      reason: "stale",
    });
  });
});

describe("the refusals", () => {
  test("a bad_value refusal reaches the host as refused", async () => {
    const events: WireClientEvent[] = [];
    const client = createWireClient({
      transport: { send: () => {} },
      onEvent: (e) => events.push(e),
    });
    await client.receive(read(examples, "server-error-bad-value.json"));
    expect(events).toEqual([
      { type: "refused", frame: { t: "x", code: "bad_value", m: "c7.12", q: 5 } },
    ]);
  });
});
