// Binds a client to a WebSocket (protocol/README.md "Transports"): hello on open, one text
// frame per `receive`. The browser's `WebSocket` satisfies the shape structurally, so no
// DOM types are involved.
import { createWireClient, type WireClient, type WireClientEvent } from "./client.ts";

/** The part of a WebSocket the wire uses. */
export interface WebSocketLike {
  send(data: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
}

/** A client talking over *socket*; the hello goes out when the socket opens. */
export function connectWebSocket(
  socket: WebSocketLike,
  onEvent: (event: WireClientEvent) => void,
): WireClient {
  const client = createWireClient({ transport: { send: (text) => socket.send(text) }, onEvent });
  socket.addEventListener("open", () => client.hello());
  socket.addEventListener("message", (event) => {
    if (typeof event.data === "string") {
      void client.receive(event.data);
    } else {
      onEvent({ type: "ignored", reason: "undecodable", detail: "a binary frame" });
    }
  });
  return client;
}
