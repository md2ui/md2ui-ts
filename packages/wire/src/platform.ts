// The platform services the wire needs, UTF-8, SHA-256 and a monotonic clock, reached through the global
// scope at call time so importing this module touches nothing and no DOM types are needed.
// The end frame's hash is the SHA-256 of protocol/README.md "Lifecycle" 2.

interface Platform {
  readonly TextEncoder?: new () => { encode(text: string): Uint8Array };
  readonly performance?: { now(): number };
  readonly crypto?: {
    readonly subtle?: {
      digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer>;
    };
  };
}

function platform(): Platform {
  return globalThis as unknown as Platform;
}

/** The UTF-8 size of a string, which is what every wire limit counts. */
export function utf8Length(text: string): number {
  const Encoder = platform().TextEncoder;
  if (Encoder === undefined) throw new Error("@md2ui/wire needs TextEncoder");
  return new Encoder().encode(text).length;
}

/** Milliseconds on a monotonic clock (`performance.now()`, in browsers and Node alike). */
export function monotonicMs(): number {
  const clock = platform().performance;
  if (clock === undefined) throw new Error("@md2ui/wire needs performance.now()");
  return clock.now();
}

/** The end frame's `h`: the first 16 hex digits of the SHA-256 of the text's UTF-8. */
export async function sha256Hex16(text: string): Promise<string> {
  const { TextEncoder: Encoder, crypto } = platform();
  if (Encoder === undefined || crypto?.subtle === undefined) throw missing();
  const digest = await crypto.subtle.digest("SHA-256", new Encoder().encode(text));
  const bytes = new Uint8Array(digest).subarray(0, 8);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Fails early, with a reason, where WebCrypto is unavailable (an insecure http: page). */
export function requirePlatform(): void {
  const { TextEncoder: Encoder, crypto } = platform();
  if (Encoder === undefined || crypto?.subtle === undefined) throw missing();
}

function missing(): Error {
  return new Error(
    "@md2ui/wire needs TextEncoder and WebCrypto (crypto.subtle), which browsers expose only " +
      "on secure pages: serve the page over https: or from localhost",
  );
}
