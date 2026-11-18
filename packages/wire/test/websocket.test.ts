import { expect, test, vi } from "vitest";
import { connectWebSocket, type WebSocketLike, type WireClientEvent } from "../src/index.ts";

function fakeSocket() {
  const sent: string[] = [];
  let onOpen: () => void = () => {};
  let onMessage: (event: { readonly data: unknown }) => void = () => {};
  const socket: WebSocketLike = {
    send: (data) => sent.push(data),
    addEventListener(type: "open" | "message", listener: never) {
      if (type === "open") onOpen = listener;
      else onMessage = listener;
    },
  };
  return { socket, sent, open: () => onOpen(), message: (data: unknown) => onMessage({ data }) };
}

test("sends hello on open, hands string frames to the client, reports binary frames", async () => {
  const { socket, sent, open, message } = fakeSocket();
  const events: WireClientEvent[] = [];
  const client = connectWebSocket(socket, (event) => events.push(event));
  expect(sent).toEqual([]);
  open();
  expect(sent).toEqual(['{"t":"h","v":1}']);

  message('{"t":"s","s":"l"}');
  await vi.waitFor(() => expect(client.state).toBe("l"));
  expect(events).toEqual([{ type: "state", state: "l" }]);

  message(new ArrayBuffer(4));
  expect(events.at(-1)).toMatchObject({ type: "ignored", reason: "undecodable" });
});

test("a standard WebSocket is a WebSocketLike", () => {
  // Compile-time: Node's global WebSocket has the WHATWG shape a browser's has.
  const fits = (socket: WebSocket): WebSocketLike => socket;
  expect(fits).toBeTypeOf("function");
});
