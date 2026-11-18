# @md2ui/wire

A client for md2ui's [wire protocol](https://github.com/md2ui/md2ui/blob/main/protocol/README.md)
v1, over a transport you give: it assembles and verifies streamed messages, tracks what
the agent is doing and builds the frames you send.

**Experimental alpha**; the API may change between any two releases. Part of
[md2ui-ts](https://github.com/md2ui/md2ui-ts), the client for
[md2ui](https://github.com/md2ui/md2ui). Home: [md2ui.org](https://md2ui.org).

## Install

```sh
npm i @md2ui/wire@alpha     # or: pnpm add, yarn add, bun add
```

No dependencies and no peers. It works without `@md2ui/dom`; with it, it feeds
`<md2ui-view>`.

## Example

```ts
import { connectWebSocket } from "@md2ui/wire";

// A socket that is still connecting: the hello goes out when it opens.
const client = connectWebSocket(new WebSocket("wss://agent.example/ws"), (event) => {
  if (event.type === "message") console.log(event.id, event.complete, event.markdown);
  if (event.type === "state") console.log(event.state, event.answered);
});

// Later, a click on target 0 of a complete message:
const result = client.sendEvent({ message: "m1", target: 0, kind: "agent", slug: "ship" });
if (!result.sent) console.warn(result.reason);
```

`createWireClient` takes any carrier and does not send the hello: call `client.hello()`
once it is open. Wiring it to `<md2ui-view>`, the events, refusals and re-sending a stale
click are in the [md2ui-ts README](https://github.com/md2ui/md2ui-ts#talking-to-a-backend).

## API

| Export | What it is |
|---|---|
| `connectWebSocket(socket, onEvent)` | A `WireClient` over a `WebSocketLike`; sends the hello on `open` |
| `createWireClient({ transport, onEvent })` | A `WireClient` over a `WireTransport` (`send(text)`) |
| `WireClient` | `hello()`, `receive(text)`, `sendEvent(event)`, `sendPrompt(text)`, `sendTyping()`, `state`, `blocked` |
| `WireClientEvent` | `message`, `dropped`, `state` (with `note`, `placeholder`, `answered`), `refused`, `ignored` |
| `OutgoingEvent` | `{ message, target, kind, slug?, checked?, value?, settled? }` |
| `SendResult`, `Refusal` | `{ sent: true, q }` or `{ sent: false, reason }`: `blocked`, `unknown_message`, `not_ready`, `stale`, `not_forwarded`, `too_large` |
| `AnsweredEvent`, `DropReason`, `IgnoredReason`, `ForwardedKind`, `AgentState`, `SettledValue` | The values those carry |
| `WireClientOptions`, `WireTransport`, `WebSocketLike` | What the client is made of |
| `decodeServerFrame`, `decodeClientFrame`, `encodeClientFrame`, `WireFrameError`, `Decoded`, `FrameProblem` | The codec, for a server or a test |
| `ClientFrame`, `ServerFrame`, `HelloFrame`, `EventFrame`, `PromptFrame`, `TypingFrame`, `MessageFrame`, `DeltaFrame`, `EndFrame`, `ErrorFrame`, `StateFrame`, `WireErrorCode`, `WireProtocolVersion` | The frame types |

## Requirements

A secure context (https or localhost), or a runtime with WebCrypto: the client verifies
each message's hash and `createWireClient` throws without it.

## Licence

MIT, in [`LICENSE`](LICENSE).
