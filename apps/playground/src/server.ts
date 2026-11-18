// An in-memory md2ui server for the playground: it speaks the wire protocol (md2ui
// `protocol/README.md`) to one client, streaming each message as a head, deltas and an
// end frame, a few characters at a time, as an agent's reply arrives. Listening again
// after a reply to an event, it names that event's `q` (`u`, md2ui ADR-601). Its states
// carry the script's words for the client's chrome (md2ui ADR-613).
import type { ServerFrame } from "@md2ui/wire";
import { decodeClientFrame } from "@md2ui/wire";

/** What the server does for each action slug, and the reply to a typed prompt. */
export interface Script {
  /** The first message, sent after the hello. */
  readonly welcome: string;
  /** A reply that replaces the message the action came from, by slug. */
  readonly replies: Readonly<Record<string, (detail: string) => string>>;
  /** A new message answering what the user typed. */
  readonly prompt: (text: string) => string;
  /** The steps the agent says it is on before each reply, one working state (`n`) each. */
  readonly steps?: readonly string[];
  /** The question the agent waits on, which every listening state carries (`ph`). */
  readonly ask?: string;
}

export interface MemoryServer {
  /** A frame from the client, as JSON text. */
  receive(text: string): void;
}

/** The end frame's hash: the first 16 hex digits of the SHA-256 of the text's UTF-8. */
async function hash16(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest).subarray(0, 8), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** How many stream pauses each of the script's steps is shown for, so a person can read it. */
const STEP_PAUSES = 20;

/**
 * A server playing `script` to the client whose frames it receives, sending its own
 * through `send`. A chunk of `chunk` characters goes out every `delayMs`.
 */
export function createMemoryServer(
  script: Script,
  send: (text: string) => void,
  { chunk = 24, delayMs = 30 }: { readonly chunk?: number; readonly delayMs?: number } = {},
): MemoryServer {
  let count = 0;
  let queue: Promise<void> = Promise.resolve();
  const frame = (f: ServerFrame): void => send(JSON.stringify(f));
  const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, delayMs));
  /** The agent listens again, naming the event it answered, if any. */
  const listening = (answers?: number): void =>
    frame({
      t: "s",
      s: "l",
      ...(answers !== undefined && { u: [answers] }),
      ...(script.ask !== undefined && { ph: script.ask }),
    });

  /**
   * Streams `markdown` as a new message, or as the replacement of `replaces`, in answer to
   * the event numbered `answers`.
   */
  const stream = (markdown: string, replaces?: string, answers?: number): void => {
    queue = queue.then(async () => {
      count += 1;
      const id = `c${count}`;
      const steps = script.steps ?? [];
      if (steps.length === 0) frame({ t: "s", s: "w" });
      for (const n of steps) {
        frame({ t: "s", s: "w", n });
        for (let k = 0; k < STEP_PAUSES; k += 1) await pause();
      }
      const head = markdown.slice(0, chunk);
      frame(
        replaces === undefined
          ? { t: "m", m: id, md: head }
          : { t: "m", m: id, md: head, r: replaces },
      );
      for (let at = chunk, s = 0; at < markdown.length; at += chunk, s += 1) {
        await pause();
        frame({ t: "d", m: id, s, md: markdown.slice(at, at + chunk) });
      }
      frame({ t: "z", m: id, h: await hash16(markdown) });
      listening(answers);
    });
  };

  /**
   * Refuses the event numbered `q`, then says the agent is listening, as a refusal is
   * followed by the current state (md2ui `protocol/README.md`, *Three outcomes*): a client
   * that blocked itself on send is released. After any reply still streaming.
   */
  const refuse = (q: number, slug: string): void => {
    queue = queue.then(() => {
      frame({ t: "x", code: "bad_target", q, m: slug });
      listening();
    });
  };

  return {
    receive(text) {
      const decoded = decodeClientFrame(text);
      if (!decoded.ok) return;
      const f = decoded.frame;
      if (f.t === "h") stream(script.welcome);
      else if (f.t === "p") stream(script.prompt(f.tx));
      else if (f.t === "k")
        return; // typing: a server may ignore it
      else {
        const reply = script.replies[f.a ?? ""];
        const detail = f.c !== undefined ? String(f.c) : f.v !== undefined ? String(f.v) : "";
        if (reply === undefined) refuse(f.q, f.a ?? "");
        else stream(reply(detail), f.m, f.q);
      }
    },
  };
}
