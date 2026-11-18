// @md2ui/wire — the optional wire client: md2ui's protocol v1 (protocol/README.md) over an
// injected transport (ADR-003). It assembles and verifies streamed messages, tracks the
// agent's state and builds the event, prompt and typing frames; the host owns the socket and what
// it shows. No DOM, no module-level mutable state; nothing runs on import.
export type {
  AgentState,
  ClientFrame,
  DeltaFrame,
  EndFrame,
  ErrorFrame,
  EventFrame,
  HelloFrame,
  MessageFrame,
  PromptFrame,
  ServerFrame,
  SettledValue,
  StateFrame,
  TypingFrame,
  WireErrorCode,
  WireProtocolVersion,
} from "@md2ui/contracts";
export type {
  AnsweredEvent,
  DropReason,
  ForwardedKind,
  IgnoredReason,
  OutgoingEvent,
  Refusal,
  SendResult,
  WireClient,
  WireClientEvent,
  WireClientOptions,
  WireTransport,
} from "./client.ts";
export { createWireClient } from "./client.ts";
export type { Decoded, FrameProblem } from "./codec.ts";
export {
  decodeClientFrame,
  decodeServerFrame,
  encodeClientFrame,
  WireFrameError,
} from "./codec.ts";
export type { WebSocketLike } from "./websocket.ts";
export { connectWebSocket } from "./websocket.ts";
