// The theme a view paints with (ADR-001): THEME.md given as text or fetched by URL,
// parsed by the core, its asset references resolved against the asset base.
import type { FontSource, Md2uiLoadError, ResolvedTheme } from "@md2ui/contracts";
import { parseTheme, resolveThemeAssets } from "@md2ui/core";

/** The view properties that decide the theme. */
export interface ThemeInput {
  readonly themeSrc: string | null;
  readonly themeText: string | null;
  readonly assetBase: string | null;
}

export interface LoadedTheme {
  readonly theme: ResolvedTheme;
  /** Set when THEME.md could not be fetched; `theme` is then md2ui's default. */
  readonly error: Md2uiLoadError | null;
}

/**
 * Loads the theme for `input`. `pageBase` is the page's base URL, which a relative
 * `themeSrc` and, with no `themeSrc`, the asset references resolve against. Unset,
 * the asset base is the THEME.md URL itself, so a reference resolves beside it, where
 * md2ui looks. Never rejects: a theme that cannot be fetched is md2ui's default, and
 * malformed text renders what it can (ADR-006).
 */
export async function loadTheme(
  input: ThemeInput,
  pageBase: string,
  signal: AbortSignal,
): Promise<LoadedTheme> {
  const src = input.themeSrc === null ? null : new URL(input.themeSrc, pageBase).href;
  const base = new URL(input.assetBase ?? src ?? pageBase, pageBase).href;
  if (input.themeText !== null || src === null) {
    return { theme: resolveThemeAssets(parseTheme(input.themeText ?? ""), base), error: null };
  }
  try {
    const response = await fetch(src, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return { theme: resolveThemeAssets(parseTheme(await response.text()), base), error: null };
  } catch (cause) {
    if (signal.aborted) throw cause;
    const message = cause instanceof Error ? cause.message : String(cause);
    return {
      theme: parseTheme(""),
      error: { resource: "theme", url: src, message },
    };
  }
}

/**
 * The family each emoji font path of the theme is drawn in, for sizing and paint alike.
 * The view never loads the theme's font files (ADR-006), so the host gives that file
 * among its `fonts`: the source whose URL is the path, both resolved against
 * `pageBase`, names the family. With no such source, and for a theme that names no
 * emoji font, the platform's own emoji face draws (the CSS generic `emoji`).
 */
export function emojiFamilies(
  fonts: readonly FontSource[],
  pageBase: string,
): (fontPath: string | null) => string {
  const byUrl = new Map<string, string>();
  for (const font of fonts) byUrl.set(href(font.url, pageBase), font.family);
  return (fontPath) => (fontPath ? byUrl.get(href(fontPath, pageBase)) : undefined) ?? "emoji";
}

/** `url` resolved against `base`; as written when it is not a URL. */
export function href(url: string, base: string): string {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

/** Every string the theme holds under `key`, wherever it sits. */
export function themeValues(theme: ResolvedTheme, key: string): string[] {
  const values = new Set<string>();
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const value of node) walk(value);
    } else if (node !== null && typeof node === "object") {
      for (const [name, value] of Object.entries(node)) {
        if (name === key && typeof value === "string") values.add(value);
        else walk(value);
      }
    }
  };
  walk(theme);
  return [...values];
}

/** Every family the theme's text styles name, for the page's own faces to load. */
export function themeFamilies(theme: ResolvedTheme): string[] {
  return themeValues(theme, "font_name");
}
