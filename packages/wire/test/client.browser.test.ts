import { expect, test } from "vitest";
import { createWireClient, type WireClientEvent } from "../src/index.ts";

test("a whole message completes with the browser's own WebCrypto", async () => {
  const events: WireClientEvent[] = [];
  const client = createWireClient({
    transport: { send: () => {} },
    onEvent: (e) => events.push(e),
  });
  const md =
    "Want me to generate the quarterly report?\n\n[Yes](agent:generate-report?format=pdf) *[No](agent:cancel)*\n";
  await client.receive(JSON.stringify({ t: "m", m: "c7.12", md }));
  await client.receive('{"t":"z","m":"c7.12","h":"814bf85aa136f9e8"}');
  expect(events.at(-1)).toEqual({ type: "message", id: "c7.12", markdown: md, complete: true });
});
