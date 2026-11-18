// Where a theme's asset references point: font files and background images, resolved
// to URLs and never fetched (the host loads them, ADR-001).
//
// md2ui (`pipeline/theme_assets.py`) rewrites a relative path to the file beside the
// THEME.md when that file exists, and otherwise leaves it as written; URLs and
// absolute paths are never touched. A client cannot ask whether a file exists without
// fetching it, so here a relative reference always resolves against `base`, the URL
// the host gives (the theme's own URL resolves it beside the theme, md2ui's first
// choice). The paths are found by field name anywhere in the theme, as md2ui finds them.
import type { ResolvedTheme } from "@md2ui/contracts";

// The platform's WHATWG URL (ADR-007). The core's ES-only lib does not declare it; every
// supported runtime has it.
declare const URL: new (url: string, base?: string) => { readonly href: string };

const PATH_FIELDS: readonly string[] = Object.freeze(["font_paths", "font_path", "bg_image"]);
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** `theme` with every relative asset reference resolved against `base`. */
export function resolveThemeAssets(theme: ResolvedTheme, base: string): ResolvedTheme {
  return walk(theme, base) as ResolvedTheme;
}

function walk(node: unknown, base: string): unknown {
  if (Array.isArray(node)) return node.map((v) => walk(v, base));
  if (node === null || typeof node !== "object") return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    out[key] = PATH_FIELDS.includes(key) ? resolveField(value, base) : walk(value, base);
  }
  return out;
}

function resolveField(value: unknown, base: string): unknown {
  if (typeof value === "string") return resolveAsset(value, base);
  if (Array.isArray(value))
    return value.map((v) => (typeof v === "string" ? resolveAsset(v, base) : v));
  return value;
}

/** One reference: unchanged when empty, absolute or a URL, or when `base` is not a URL. */
function resolveAsset(ref: string, base: string): string {
  if (ref === "" || ref.startsWith("/") || SCHEME.test(ref)) return ref;
  try {
    return new URL(ref, base).href;
  } catch {
    return ref;
  }
}
