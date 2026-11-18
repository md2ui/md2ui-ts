// C5 — md2ui's wire protocol, v1: the frames between an md2ui server and a frontend.
// Public: the spec is md2ui's (protocol/README.md), not this repository's.
//
// The JSON Schemas are vendored unchanged in packages/contracts/schema/wire/; these types
// follow them. `c5-wire.protocol.test.ts` fails when md2ui's copy differs, so a change to
// the spec cannot land here unnoticed. Byte limits are the spec's and cannot be typed; the
// wire client enforces them.

/** The protocol's major version, the `v` of a hello frame. */
export type WireProtocolVersion = 1;

/** What the agent is doing: `l` listening, `w` working on the last input (a client blocks input), `i` idle, nobody listening. */
export type AgentState = "l" | "w" | "i";

/** Why a server refused a client frame (the server schema's `code` enum). */
export type WireErrorCode =
  | "bad_frame"
  | "too_large"
  | "bad_version"
  | "unknown_message"
  | "stale"
  | "bad_target"
  | "not_forwarded"
  | "slug_mismatch"
  | "bad_value"
  | "duplicate";

/** One other target an event commits: a bool is that target's `c`, a number its `v`. */
export type SettledValue = readonly [ordinal: number, value: boolean | number];

/** Client → server, first: the protocol version the client speaks. */
export interface HelloFrame {
  /** Type discriminator */
  readonly t: "h";
  /** Protocol version (integer, at least 1) */
  readonly v: number;
}

/** Client → server: the user acted on target `x` of message `m`. Names the target, never restates it. */
export interface EventFrame {
  /** Type discriminator */
  readonly t: "e";
  /** Message id (`^[A-Za-z0-9._:-]{1,64}$`) */
  readonly m: string;
  /** Target ordinal (non-negative integer) */
  readonly x: number;
  /** Client sequence number (non-negative integer) */
  readonly q: number;
  /** Target's action slug */
  readonly a?: string;
  /** Checkbox state asked for */
  readonly c?: boolean;
  /** Slider value asked for */
  readonly v?: number;
  /** Other targets this event commits: [ordinal, value] pairs */
  readonly vs?: readonly SettledValue[];
}

/** Client → server: what the user typed into the client's own field (md2ui ADR-601). */
export interface PromptFrame {
  /** Type discriminator */
  readonly t: "p";
  /** Client sequence number (non-negative integer) */
  readonly q: number;
  /** What the user typed into the client's own field: not blank, at most 4 KB */
  readonly tx: string;
}

/** Client → server: the user is typing in the client's own field (md2ui `protocol/README.md`, *Lifecycle* 7). Carries nothing, not the text: sent on the first key pressed and then at most once a second while keys are pressed. */
export interface TypingFrame {
  /** Type discriminator */
  readonly t: "k";
}

/** Any frame a client sends. */
export type ClientFrame = HelloFrame | EventFrame | PromptFrame | TypingFrame;

/** Server → client: a message, whole or the first chunk of a stream; with `r`, it replaces that message in place. */
export interface MessageFrame {
  /** Type discriminator */
  readonly t: "m";
  /** Message id (`^[A-Za-z0-9._:-]{1,64}$`) */
  readonly m: string;
  /** The Markdown, whole or its first chunk */
  readonly md: string;
  /** Id of the message this one replaces (`^[A-Za-z0-9._:-]{1,64}$`) */
  readonly r?: string;
}

/** Server → client: the next chunk of a streamed message. */
export interface DeltaFrame {
  /** Type discriminator */
  readonly t: "d";
  /** Message id (`^[A-Za-z0-9._:-]{1,64}$`) */
  readonly m: string;
  /** Delta sequence: 0, 1, 2… (non-negative integer) */
  readonly s: number;
  /** Markdown to append */
  readonly md: string;
}

/** Server → client: the message is complete; its actions exist from here on. */
export interface EndFrame {
  /** Type discriminator */
  readonly t: "z";
  /** Message id (`^[A-Za-z0-9._:-]{1,64}$`) */
  readonly m: string;
  /** First 16 hex digits of the SHA-256 of the complete Markdown */
  readonly h: string;
}

/** Server → client: a client frame was refused. */
export interface ErrorFrame {
  /** Type discriminator */
  readonly t: "x";
  /** Error code */
  readonly code: WireErrorCode;
  /** Message id (`^[A-Za-z0-9._:-]{1,64}$`) */
  readonly m?: string;
  /** Client sequence number (non-negative integer) */
  readonly q?: number;
}

/** Server → client: what the agent is doing (md2ui ADR-601). */
export interface StateFrame {
  /** Type discriminator */
  readonly t: "s";
  /** Agent state */
  readonly s: AgentState;
  /** The step the agent is on, sent with `w`, at most 200 characters (md2ui ADR-613) */
  readonly n?: string;
  /** The question the agent asked its prompt to show, sent with `l`, at most 200 characters (md2ui ADR-613) */
  readonly ph?: string;
  /** The `q`s of this client's events answered, 1–64: by the agent with `l`, by the backend with any state (md2ui `protocol/README.md`, ADR-612) */
  readonly u?: readonly number[];
}

/** Any frame a server sends. */
export type ServerFrame = MessageFrame | DeltaFrame | EndFrame | ErrorFrame | StateFrame;
