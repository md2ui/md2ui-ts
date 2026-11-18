// The wire protocol's limits and id formats, from protocol/README.md ("Frames", "Limits")
// and md2ui's reference codec (src/md2ui/wire_frames.py). Sizes are UTF-8 bytes unless a
// name says otherwise.
import type { WireProtocolVersion } from "@md2ui/contracts";

/** The only protocol version this client speaks. */
export const PROTOCOL_VERSION: WireProtocolVersion = 1;

/** A hello, event or typing frame. */
export const MAX_EVENT_BYTES = 512;

/** A prompt frame. */
export const MAX_PROMPT_FRAME_BYTES = 8192;

/** The text of one prompt. */
export const MAX_PROMPT_TEXT_BYTES = 4096;

/**
 * A server frame as it travels: the UTF-8 bytes of the encoded JSON, so a message's
 * Markdown is bounded by what it costs once escaped, not by its own length. A server
 * never sends a frame over it, and a streamed message is held to the same bound.
 */
export const MAX_SERVER_FRAME_BYTES = 262144;

/** Other targets one event may commit. */
export const MAX_SETTLED = 32;

/** An action slug, in code points. */
export const MAX_SLUG = 128;

/** The answered events one state frame may name (`u`). */
export const MAX_ANSWERED = 64;

/** A state's `n`, the step the agent is on, in code points (md2ui ADR-613). */
export const MAX_NOTE = 200;

/** A state's `ph`, the question the agent asked its prompt to show, in code points. */
export const MAX_PLACEHOLDER = 200;

/** A message id. */
export const ID_PATTERN = /^[A-Za-z0-9._:-]{1,64}$/;

/** The first 16 hex digits of a SHA-256. */
export const HASH_PATTERN = /^[0-9a-f]{16}$/;
