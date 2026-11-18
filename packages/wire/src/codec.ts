// Frame validation for protocol v1: whether a frame is well formed, never what it means
// (protocol/README.md "Frames"; reference: md2ui's src/md2ui/wire_frames.py, whose check
// order this follows). Known keys are strict, unknown keys are dropped from the result.
import type {
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
} from "@md2ui/contracts";
import {
  HASH_PATTERN,
  ID_PATTERN,
  MAX_ANSWERED,
  MAX_EVENT_BYTES,
  MAX_NOTE,
  MAX_PLACEHOLDER,
  MAX_PROMPT_FRAME_BYTES,
  MAX_PROMPT_TEXT_BYTES,
  MAX_SERVER_FRAME_BYTES,
  MAX_SETTLED,
  MAX_SLUG,
  PROTOCOL_VERSION,
} from "./limits.ts";
import { utf8Length } from "./platform.ts";

/** Why a frame was refused, in the vocabulary of the protocol's error codes. */
export type FrameProblem = "bad_frame" | "too_large" | "bad_version";

/** A frame this protocol refuses. */
export class WireFrameError extends Error {
  /** The protocol error code the frame earns. */
  readonly code: FrameProblem;
  /** The frame key that failed (`t` for an unknown type); undefined for the frame as a whole. */
  readonly key: string | undefined;

  constructor(code: FrameProblem, key: string | undefined, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "WireFrameError";
    this.code = code;
    this.key = key;
  }
}

/** The result of decoding: the checked frame, or why not. */
export type Decoded<F> =
  | { readonly ok: true; readonly frame: F }
  | { readonly ok: false; readonly error: WireFrameError };

type Raw = Readonly<Record<string, unknown>>;
type Check<F> = (raw: Raw) => F;

const ERROR_CODES: readonly WireErrorCode[] = Object.freeze([
  "bad_frame",
  "too_large",
  "bad_version",
  "unknown_message",
  "stale",
  "bad_target",
  "not_forwarded",
  "slug_mismatch",
  "bad_value",
  "duplicate",
] satisfies WireErrorCode[]);

const AGENT_STATES = ["l", "w", "i"] as const;

function bad(key: string): never {
  throw new WireFrameError("bad_frame", key, `bad or missing "${key}"`);
}

function has(raw: Raw, key: string): boolean {
  return Object.hasOwn(raw, key);
}

function isNat(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Python's `str.isspace()` code points. Generated with
// `python3 -c "import sys; print([hex(c) for c in range(sys.maxunicode+1) if chr(c).isspace()])"`
// (Python 3.14). `core` holds the same set as `PY_SPACE_RANGES`; `wire` cannot import it.
// biome-ignore lint/suspicious/noControlCharactersInRegex: Python's white space includes \x1c-\x1f.
const PY_BLANK = /^[\t-\r\x1c- \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/;

/**
 * Blank as the reference server judges a prompt (`bool(text.strip())` in md2ui's
 * `wire_frames.py`): only Python's white space. JavaScript's `trim` would also strip
 * U+FEFF, so a prompt the server accepts would never be sent.
 */
function isBlank(text: string): boolean {
  return PY_BLANK.test(text);
}

function codePoints(text: string): number {
  return [...text].length;
}

function id(raw: Raw, key: string): string {
  const value = raw[key];
  return typeof value === "string" && ID_PATTERN.test(value) ? value : bad(key);
}

function optionalId(raw: Raw, key: string): string | undefined {
  return has(raw, key) ? id(raw, key) : undefined;
}

function nat(raw: Raw, key: string): number {
  const value = raw[key];
  return isNat(value) ? value : bad(key);
}

function markdown(raw: Raw): string {
  const value = raw["md"];
  return typeof value === "string" ? value : bad("md");
}

const checkMessage: Check<MessageFrame> = (raw) => {
  const m = id(raw, "m");
  const r = optionalId(raw, "r");
  const md = markdown(raw);
  return r === undefined ? { t: "m", m, md } : { t: "m", m, md, r };
};

const checkDelta: Check<DeltaFrame> = (raw) => {
  const m = id(raw, "m");
  const s = nat(raw, "s");
  return { t: "d", m, s, md: markdown(raw) };
};

const checkEnd: Check<EndFrame> = (raw) => {
  const m = id(raw, "m");
  const h = raw["h"];
  return typeof h === "string" && HASH_PATTERN.test(h) ? { t: "z", m, h } : bad("h");
};

const checkError: Check<ErrorFrame> = (raw) => {
  const code = ERROR_CODES.find((known) => known === raw["code"]) ?? bad("code");
  const m = optionalId(raw, "m");
  const q = has(raw, "q") ? nat(raw, "q") : undefined;
  return {
    t: "x",
    code,
    ...(m === undefined ? {} : { m }),
    ...(q === undefined ? {} : { q }),
  };
};

/**
 * A state's `u`: 1 to `MAX_ANSWERED` sequence numbers of this client's events that were
 * answered, by the agent with `l` (md2ui ADR-601) or by the backend with any state (a
 * handled click, md2ui ADR-612).
 */
function answered(raw: Raw): readonly number[] | undefined {
  if (!has(raw, "u")) return undefined;
  const u = raw["u"];
  const ok = Array.isArray(u) && u.length > 0 && u.length <= MAX_ANSWERED && u.every(isNat);
  // Parsed from this frame's own text, so nothing else holds the array.
  return ok ? (u as readonly number[]) : bad("u");
}

/**
 * A state's words for the client's chrome (md2ui ADR-613): at most `cap` code points. Any
 * state may carry either; a server sends `n` only with `w` and `ph` only with `l`.
 */
function words(raw: Raw, key: "n" | "ph", cap: number): string | undefined {
  if (!has(raw, key)) return undefined;
  const text = raw[key];
  return typeof text === "string" && codePoints(text) <= cap ? text : bad(key);
}

const checkState: Check<StateFrame> = (raw) => {
  const s = AGENT_STATES.find((known) => known === raw["s"]) ?? bad("s");
  const n = words(raw, "n", MAX_NOTE);
  const ph = words(raw, "ph", MAX_PLACEHOLDER);
  const u = answered(raw);
  return {
    t: "s",
    s,
    ...(n === undefined ? {} : { n }),
    ...(ph === undefined ? {} : { ph }),
    ...(u === undefined ? {} : { u }),
  };
};

const checkHello: Check<HelloFrame> = (raw) => {
  const v = raw["v"];
  if (!isNat(v) || v < 1) return bad("v");
  if (v !== PROTOCOL_VERSION) {
    throw new WireFrameError("bad_version", "v", `version ${v}`);
  }
  return { t: "h", v };
};

function settled(raw: Raw, fired: number): readonly SettledValue[] | undefined {
  if (!has(raw, "vs")) return undefined;
  const rows = raw["vs"];
  if (!Array.isArray(rows) || rows.length > MAX_SETTLED) return bad("vs");
  const seen = new Set<number>([fired]);
  return rows.map((row: unknown): SettledValue => {
    if (!Array.isArray(row) || row.length !== 2) return bad("vs");
    const [ordinal, value] = row as readonly unknown[];
    if (!isNat(ordinal) || seen.has(ordinal)) return bad("vs");
    if (typeof value !== "boolean" && !isFiniteNumber(value)) return bad("vs");
    seen.add(ordinal);
    return [ordinal, value];
  });
}

const checkEvent: Check<EventFrame> = (raw) => {
  const m = id(raw, "m");
  const x = nat(raw, "x");
  const q = nat(raw, "q");
  const a = raw["a"];
  if (
    has(raw, "a") &&
    !(typeof a === "string" && codePoints(a) >= 1 && codePoints(a) <= MAX_SLUG)
  ) {
    bad("a");
  }
  const c = raw["c"];
  if (has(raw, "c") && typeof c !== "boolean") bad("c");
  const v = raw["v"];
  if (has(raw, "v") && !isFiniteNumber(v)) bad("v");
  const vs = settled(raw, x);
  return {
    t: "e",
    m,
    x,
    q,
    ...(typeof a === "string" ? { a } : {}),
    ...(typeof c === "boolean" ? { c } : {}),
    ...(typeof v === "number" ? { v } : {}),
    ...(vs === undefined ? {} : { vs }),
  };
};

const checkPrompt: Check<PromptFrame> = (raw) => {
  const q = nat(raw, "q");
  const tx = raw["tx"];
  if (typeof tx !== "string" || isBlank(tx)) return bad("tx");
  if (utf8Length(tx) > MAX_PROMPT_TEXT_BYTES) {
    throw new WireFrameError("too_large", "tx", "tx over the prompt limit");
  }
  return { t: "p", q, tx };
};

/** `k` carries nothing, not even the text: what is typed reaches the server only when it is sent. */
const checkTyping: Check<TypingFrame> = () => ({ t: "k" });

const SERVER_CHECKS: Readonly<Record<string, Check<ServerFrame>>> = Object.freeze({
  m: checkMessage,
  d: checkDelta,
  z: checkEnd,
  x: checkError,
  s: checkState,
});

const CLIENT_CHECKS: Readonly<Record<string, Check<ClientFrame>>> = Object.freeze({
  h: checkHello,
  e: checkEvent,
  p: checkPrompt,
  k: checkTyping,
});

function decodeWith<F>(
  text: string,
  checks: Readonly<Record<string, Check<F>>>,
  maxBytes: number,
  capFor: (type: string) => number,
): F {
  const size = utf8Length(text);
  if (size > maxBytes) {
    throw new WireFrameError("too_large", undefined, `${size} bytes`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new WireFrameError("bad_frame", undefined, "not JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new WireFrameError("bad_frame", undefined, "not an object");
  }
  const raw = parsed as Raw;
  const type = raw["t"];
  if (typeof type !== "string" || !Object.hasOwn(checks, type)) return bad("t");
  const check = checks[type];
  if (check === undefined) return bad("t");
  if (size > capFor(type)) {
    throw new WireFrameError("too_large", undefined, `${size} bytes`);
  }
  return check(raw);
}

function attempt<F>(run: () => F): Decoded<F> {
  try {
    return { ok: true, frame: run() };
  } catch (error) {
    if (error instanceof WireFrameError) return { ok: false, error };
    throw error;
  }
}

function decodeServer(text: string): ServerFrame {
  return decodeWith(text, SERVER_CHECKS, MAX_SERVER_FRAME_BYTES, () => MAX_SERVER_FRAME_BYTES);
}

function decodeClient(text: string): ClientFrame {
  return decodeWith(text, CLIENT_CHECKS, MAX_PROMPT_FRAME_BYTES, (type) =>
    type === "p" ? MAX_PROMPT_FRAME_BYTES : MAX_EVENT_BYTES,
  );
}

/** Checks one frame from a server; unknown keys are dropped, never an error. */
export function decodeServerFrame(text: string): Decoded<ServerFrame> {
  return attempt(() => decodeServer(text));
}

/** Checks one frame from a client, as a server would on receipt. */
export function decodeClientFrame(text: string): Decoded<ClientFrame> {
  return attempt(() => decodeClient(text));
}

/** One client frame as compact JSON; throws {@link WireFrameError} for a frame a server would refuse. */
export function encodeClientFrame(frame: ClientFrame): string {
  const text = JSON.stringify(frame);
  decodeClient(text);
  return text;
}
