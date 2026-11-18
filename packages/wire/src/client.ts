// The wire client: assembles streamed messages, verifies them, tracks the agent's state and
// builds the frames a host sends (protocol/README.md "Lifecycle"; reference: md2ui's
// src/md2ui/wire_client.py). It owns no socket, and reads the clock only to throttle the
// typing frame: frames come in through `receive`, go out through the injected transport,
// and everything the host should know leaves through `onEvent`.
import type {
  AgentState,
  ErrorFrame,
  EventFrame,
  PromptFrame,
  SettledValue,
} from "@md2ui/contracts";
import { decodeServerFrame, encodeClientFrame, WireFrameError } from "./codec.ts";
import { MAX_SERVER_FRAME_BYTES, PROTOCOL_VERSION } from "./limits.ts";
import { monotonicMs, requirePlatform, sha256Hex16, utf8Length } from "./platform.ts";

/**
 * How often a client may say its user is typing (the `k` frame, md2ui `protocol/README.md`,
 * *Lifecycle* 7): enough for a server to tell typing under way from typing stopped, not a
 * frame a key.
 */
const TYPING_EVERY_MS = 1000;

/** Where frames go out: a WebSocket, a POST, a test's recorder. */
export interface WireTransport {
  /** Sends one frame, as compact JSON text. */
  send(text: string): void;
}

/** The target kinds that travel; a link or an anchor is the host's own business. */
export type ForwardedKind = "agent" | "checkbox" | "slider";

/** What the user did to a target of a complete message. */
export interface OutgoingEvent {
  /** The message the target belongs to. */
  readonly message: string;
  /** The target's ordinal in document order. */
  readonly target: number;
  readonly kind: ForwardedKind;
  /** The target's action slug, a drift check. */
  readonly slug?: string;
  /** The state a checkbox asks for. */
  readonly checked?: boolean;
  /** The value a slider asks for. */
  readonly value?: number;
  /** Other targets this event commits. */
  readonly settled?: readonly SettledValue[];
}

/**
 * Why the client did not send. `blocked`: no state yet, the agent is working, or the client
 * awaits the state that follows its last input. `too_large`: the frame would pass the
 * protocol's size limit (an event's `settled` list or slug, a prompt's text).
 */
export type Refusal =
  | "blocked"
  | "unknown_message"
  | "not_ready"
  | "stale"
  | "not_forwarded"
  | "too_large";

/** The outcome of an attempt to send: the sequence number used, or the refusal. */
export type SendResult =
  | { readonly sent: true; readonly q: number }
  | { readonly sent: false; readonly reason: Refusal };

/** Why a message was discarded. */
export type DropReason = "hash_mismatch" | "missing_delta" | "too_large";

/** Why a frame changed nothing. */
export type IgnoredReason =
  | "undecodable"
  | "unknown_message"
  | "duplicate_message"
  | "duplicate_delta"
  | "after_end"
  | "stale_message";

/**
 * An event of this client's that was answered: by the agent listening again (md2ui
 * ADR-601), or by the backend handling the click itself, in any state (md2ui ADR-612).
 */
export interface AnsweredEvent {
  /** The latest replacement of the message the event was sent on, or that message itself. */
  readonly message: string;
  /** The event's target ordinal. */
  readonly target: number;
}

/** What the client tells its host. */
export type WireClientEvent =
  | {
      readonly type: "message";
      readonly id: string;
      /** The Markdown assembled so far; all of it when `complete`. */
      readonly markdown: string;
      /** The message this one replaces in place. */
      readonly replaces?: string;
      /** True once the end frame's hash matched: the message's actions may be enabled. */
      readonly complete: boolean;
    }
  | { readonly type: "dropped"; readonly id: string; readonly reason: DropReason }
  | {
      readonly type: "state";
      readonly state: AgentState;
      /**
       * The step the agent is on, while it works (md2ui ADR-613): a short label for the
       * host's working line. Holds until the next state event; absent, the host shows none.
       */
      readonly note?: string;
      /**
       * The question the agent is waiting on, while it listens (md2ui ADR-613): the host's
       * prompt field may show it as its placeholder. Holds until the next state event;
       * absent, the host shows its own.
       */
      readonly placeholder?: string;
      /**
       * The events answered, whose held buttons the host releases, in any state
       * (`Md2uiViewElement.release`). A prompt is never listed. Omitted when nothing is
       * left.
       */
      readonly answered?: readonly AnsweredEvent[];
    }
  | { readonly type: "refused"; readonly frame: ErrorFrame }
  | { readonly type: "ignored"; readonly reason: IgnoredReason; readonly detail: string };

/** What a client is made of. */
export interface WireClientOptions {
  readonly transport: WireTransport;
  /** Called synchronously, in frame order; a throw rejects that frame's `receive`. */
  readonly onEvent: (event: WireClientEvent) => void;
}

/** One protocol session. */
export interface WireClient {
  /** Sends the hello. */
  hello(): void;
  /** Handles one server frame; frames are processed strictly in arrival order. */
  receive(text: string): Promise<void>;
  /** Sends the user's click, if the protocol allows it now. */
  sendEvent(event: OutgoingEvent): SendResult;
  /** Sends what the user typed into the host's own field. */
  sendPrompt(text: string): SendResult;
  /**
   * Says the user pressed a key in the host's own field (protocol rule 7): the first call
   * sends a typing frame, then at most one a second goes out. Nothing is sent before the
   * hello, while the agent works, or while this client awaits what follows its last input,
   * as the host's field takes no keys then.
   */
  sendTyping(): void;
  /** What the agent is doing, from the last state frame. */
  readonly state: AgentState | undefined;
  /**
   * Whether input is blocked now: no state has arrived yet, the agent is
   * working, or this client sent input while the agent listened and awaits what follows.
   */
  readonly blocked: boolean;
}

type Status = "streaming" | "complete" | "stale" | "dropped";

/** The pieces of a message still arriving; gone once it completes or drops. */
interface Assembly {
  replaces: string | undefined;
  /** The message frame's Markdown; undefined while only deltas have arrived. */
  head: string | undefined;
  readonly deltas: Map<number, string>;
  /** Markdown of the deltas that follow the head without a gap. */
  prefix: string;
  /** How many deltas the prefix holds. */
  contiguous: number;
  bytes: number;
}

const FORWARDED: readonly string[] = Object.freeze(["agent", "checkbox", "slider"]);

/** Creates a client; throws where WebCrypto is unavailable, since no message could be verified. */
export function createWireClient(options: WireClientOptions): WireClient {
  requirePlatform();
  const { transport, onEvent } = options;
  const statuses = new Map<string, Status>();
  const assemblies = new Map<string, Assembly>();
  /**
   * The events this client sent, by `q`, each on the latest replacement of its message:
   * what a listening state's `u` names.
   */
  const sentEvents = new Map<number, AnsweredEvent>();
  let state: AgentState | undefined;
  let selfBlocked = false;
  let nextQ = 1;
  let helloSent = false;
  /** When the last typing frame went out, in {@link monotonicMs}. */
  let typedAt: number | undefined;
  let chain: Promise<void> = Promise.resolve();

  const ignore = (reason: IgnoredReason, detail: string): void =>
    onEvent({ type: "ignored", reason, detail });

  const finish = (id: string, status: "complete" | "dropped" | "stale"): void => {
    statuses.set(id, status);
    assemblies.delete(id);
  };

  const drop = (id: string, reason: DropReason): void => {
    finish(id, "dropped");
    onEvent({ type: "dropped", id, reason });
  };

  const emitProgress = (id: string, assembly: Assembly): void => {
    if (assembly.head === undefined) return;
    onEvent({
      type: "message",
      id,
      markdown: assembly.head + assembly.prefix,
      ...(assembly.replaces === undefined ? {} : { replaces: assembly.replaces }),
      complete: false,
    });
  };

  const open = (id: string, replaces: string | undefined): Assembly => {
    const assembly: Assembly = {
      replaces,
      head: undefined,
      deltas: new Map(),
      prefix: "",
      contiguous: 0,
      bytes: 0,
    };
    statuses.set(id, "streaming");
    assemblies.set(id, assembly);
    return assembly;
  };

  /**
   * Adds a chunk's size; false once the message is over the frame cap and has been dropped.
   * Escaping only adds to a message's bytes, so a stream whose Markdown alone passes the cap
   * could never have fit one frame, and a server never sends one.
   */
  const admit = (id: string, assembly: Assembly, md: string): boolean => {
    assembly.bytes += utf8Length(md);
    if (assembly.bytes <= MAX_SERVER_FRAME_BYTES) return true;
    drop(id, "too_large");
    return false;
  };

  const onMessage = (id: string, md: string, replaces: string | undefined): void => {
    // Deltas that arrived first opened the message without its head; the head fills it.
    const assembly = assemblies.get(id) ?? (statuses.has(id) ? undefined : open(id, replaces));
    if (assembly === undefined || assembly.head !== undefined) {
      ignore("duplicate_message", id);
      return;
    }
    if (replaces !== undefined) {
      finish(replaces, "stale");
      for (const [q, { message, target }] of sentEvents) {
        if (message === replaces) sentEvents.set(q, { message: id, target });
      }
    }
    assembly.replaces = replaces;
    if (!admit(id, assembly, md)) return;
    assembly.head = md;
    emitProgress(id, assembly);
  };

  const onDelta = (id: string, sequence: number, md: string): void => {
    const assembly = assemblies.get(id) ?? open(id, undefined);
    if (assembly.deltas.has(sequence)) {
      ignore("duplicate_delta", `${id} #${sequence}`);
      return;
    }
    if (!admit(id, assembly, md)) return;
    assembly.deltas.set(sequence, md);
    const before = assembly.contiguous;
    for (let next = assembly.deltas.get(assembly.contiguous); next !== undefined; ) {
      assembly.prefix += next;
      assembly.contiguous += 1;
      next = assembly.deltas.get(assembly.contiguous);
    }
    if (assembly.contiguous > before) emitProgress(id, assembly);
  };

  const onEnd = async (id: string, hash: string): Promise<void> => {
    const assembly = assemblies.get(id);
    if (assembly === undefined) {
      ignore("unknown_message", id);
      return;
    }
    if (assembly.deltas.size > assembly.contiguous) {
      drop(id, "missing_delta");
      return;
    }
    const markdown = (assembly.head ?? "") + assembly.prefix;
    if ((await sha256Hex16(markdown)) !== hash) {
      drop(id, "hash_mismatch");
      return;
    }
    finish(id, "complete");
    // The agent answered: whatever this client's last input was, it has been handled.
    selfBlocked = false;
    onEvent({
      type: "message",
      id,
      markdown,
      ...(assembly.replaces === undefined ? {} : { replaces: assembly.replaces }),
      complete: true,
    });
  };

  /**
   * The events `u` names; a `q` this client never sent as an event (a prompt) is left out.
   * An event whose replacement dropped stays on it, as md2ui releases it on the page still
   * shown (`wire_client.py` `answered`): a view keeps that page's states aside while the
   * replacement streams, and the agent's next replacement names the dropped one.
   */
  const resolve = (u: readonly number[]): AnsweredEvent[] =>
    u.flatMap((q) => {
      const event = sentEvents.get(q);
      return event === undefined ? [] : [event];
    });

  const handle = async (text: string): Promise<void> => {
    const decoded = decodeServerFrame(text);
    if (!decoded.ok) {
      ignore("undecodable", decoded.error.message);
      return;
    }
    const frame = decoded.frame;
    switch (frame.t) {
      case "s": {
        state = frame.s;
        selfBlocked = false;
        const answered = frame.u === undefined ? [] : resolve(frame.u);
        onEvent({
          type: "state",
          state: frame.s,
          ...(frame.n === undefined ? {} : { note: frame.n }),
          ...(frame.ph === undefined ? {} : { placeholder: frame.ph }),
          ...(answered.length === 0 ? {} : { answered }),
        });
        return;
      }
      case "x":
        // A refused input is not being worked on, so release the self-block here rather
        // than wait for the state md2ui's server re-sends after every refusal (protocol
        // README, "a refused frame"): a server that sends none still leaves no host stuck.
        selfBlocked = false;
        onEvent({ type: "refused", frame });
        return;
      default:
    }
    const status = statuses.get(frame.m);
    if (status === "stale") {
      ignore("stale_message", frame.m);
    } else if (frame.t === "m") {
      onMessage(frame.m, frame.md, frame.r);
    } else if (status === "complete" || status === "dropped") {
      ignore("after_end", frame.m);
    } else if (frame.t === "d") {
      onDelta(frame.m, frame.s, frame.md);
    } else {
      await onEnd(frame.m, frame.h);
    }
  };

  const dispatch = (frame: EventFrame | PromptFrame): SendResult => {
    let text: string;
    try {
      text = encodeClientFrame(frame);
    } catch (error) {
      // Over a size limit is the data's doing, not the caller's; anything else is misuse.
      if (error instanceof WireFrameError && error.code === "too_large") {
        return { sent: false, reason: "too_large" };
      }
      throw error;
    }
    transport.send(text);
    nextQ += 1;
    if (state === "l") selfBlocked = true;
    return { sent: true, q: frame.q };
  };

  const isBlocked = (): boolean => state === undefined || state === "w" || selfBlocked;

  return {
    hello() {
      transport.send(encodeClientFrame({ t: "h", v: PROTOCOL_VERSION }));
      helloSent = true;
    },
    receive(text) {
      const run = chain.then(() => handle(text));
      chain = run.catch(() => undefined);
      return run;
    },
    sendEvent(event) {
      if (!FORWARDED.includes(event.kind)) return { sent: false, reason: "not_forwarded" };
      const status = statuses.get(event.message);
      if (status === undefined) return { sent: false, reason: "unknown_message" };
      if (status === "stale") return { sent: false, reason: "stale" };
      if (status !== "complete") return { sent: false, reason: "not_ready" };
      if (isBlocked()) return { sent: false, reason: "blocked" };
      const result = dispatch({
        t: "e",
        m: event.message,
        x: event.target,
        q: nextQ,
        ...(event.slug === undefined ? {} : { a: event.slug }),
        ...(event.checked === undefined ? {} : { c: event.checked }),
        ...(event.value === undefined ? {} : { v: event.value }),
        ...(event.settled === undefined ? {} : { vs: event.settled }),
      });
      if (result.sent) sentEvents.set(result.q, { message: event.message, target: event.target });
      return result;
    },
    sendPrompt(text) {
      if (isBlocked()) return { sent: false, reason: "blocked" };
      return dispatch({ t: "p", q: nextQ, tx: text });
    },
    sendTyping() {
      // md2ui's field is locked while the agent works, its own send included; typing before
      // the first state still goes, as md2ui's field takes keys then (wire_client.py `typing`).
      if (!helloSent || state === "w" || selfBlocked) return;
      const now = monotonicMs();
      if (typedAt !== undefined && now - typedAt < TYPING_EVERY_MS) return;
      typedAt = now;
      transport.send(encodeClientFrame({ t: "k" }));
    },
    get state() {
      return state;
    },
    get blocked() {
      return isBlocked();
    },
  };
}
