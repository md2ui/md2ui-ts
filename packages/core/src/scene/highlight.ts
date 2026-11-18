// Syntax colours for code blocks (md2ui `render_code_blocks.highlighted_lines`), by Shiki's
// JavaScript regex engine: grammars and the theme load on demand, so nothing here runs on
// import and a document pays only for the languages it uses (ADR-007). A token's colour
// may differ from Pygments'; its text, and so every glyph's place, does not.
import type { Argb, ResolvedTheme } from "@md2ui/contracts";
import { codeToTokensBase, createShikiPrimitiveAsync, type ThemedToken } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { bundledLanguages } from "shiki/langs";
import { bundledThemes } from "shiki/themes";
import { normalizedSource } from "../measure/code-blocks.ts";
import { argb } from "../theme/model.ts";
import type { CodeHighlighter, CodeToken } from "./draw/context.ts";

/** The Shiki theme closest to each Pygments style md2ui's `Syntax style` names. */
const SHIKI_THEMES: Readonly<Record<string, string>> = Object.freeze({
  default: "github-light",
  vs: "light-plus",
  monokai: "monokai",
  "github-dark": "github-dark",
  dracula: "dracula",
  "one-dark": "one-dark-pro",
  "solarized-dark": "solarized-dark",
  "solarized-light": "solarized-light",
  nord: "nord",
  "nord-darker": "nord",
  "gruvbox-dark": "gruvbox-dark-medium",
  "gruvbox-light": "gruvbox-light-medium",
  material: "material-theme",
});

/**
 * md2ui's `get_style_by_name(style or "bw")`, with an unknown name as `bw`: Pygments'
 * grayscale style colours no token, so every token takes the block's own text colour and
 * no Shiki theme stands for it (`undefined`).
 */
function shikiTheme(style: string): string | undefined {
  return Object.hasOwn(SHIKI_THEMES, style) ? SHIKI_THEMES[style] : undefined;
}

/** A `#rgb`, `#rrggbb` or `#rrggbbaa` colour as ARGB; `null` when it is none of them. */
function argbOf(color: string): Argb | null {
  const hex = color.replace(/^#/, "");
  const full = hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex;
  if (!/^(?:[0-9a-f]{6}|[0-9a-f]{8})$/i.test(full)) return null;
  const n = (i: number): number => Number.parseInt(full.slice(i, i + 2), 16);
  return argb(full.length === 8 ? n(6) : 255, n(0), n(2), n(4));
}

/**
 * One line's tokens as md2ui's adjacent same-colour runs. A token the style left
 * uncoloured (Shiki gives it the theme's foreground) takes the block's own text colour.
 */
function runsOf(line: readonly ThemedToken[], foreground: string, fallback: Argb): CodeToken[] {
  const runs: CodeToken[] = [];
  for (const token of line) {
    if (token.content === "") continue;
    const own = token.color === undefined || token.color.toLowerCase() === foreground;
    const color = (own ? null : argbOf(token.color ?? "")) ?? fallback;
    const last = runs.at(-1);
    if (last !== undefined && last.color === color) {
      runs[runs.length - 1] = { text: last.text + token.content, color };
    } else {
      runs.push({ text: token.content, color });
    }
  }
  return runs;
}

/**
 * A highlighter that holds a Shiki instance. Shiki warns once ten are alive, so a host
 * keeps one per view and releases the one it replaces.
 */
export type LoadedHighlighter = CodeHighlighter & {
  /** Frees the Shiki instance; the highlighter must not be called afterwards. */
  readonly dispose: () => void;
};

/**
 * The names among `languages` a highlighter can colour, lower-cased: Shiki's grammar
 * names and aliases. A fence a stream has only half written (` ```pyt `) names none.
 */
export function codeLanguages(languages: Iterable<string>): Set<string> {
  const grammars = new Set(Object.keys(bundledLanguages));
  return new Set([...languages].map((l) => l.toLowerCase()).filter((l) => grammars.has(l)));
}

/**
 * Loads the grammars `languages` name (unknown names are skipped) and the theme md2ui's
 * `syntax_style` maps to; with the grayscale style, loads nothing and colours nothing.
 */
export async function loadCodeHighlighter(
  theme: ResolvedTheme,
  languages: Iterable<string>,
): Promise<LoadedHighlighter> {
  const themeName = shikiTheme(theme.code_blocks.syntax_style);
  // Plain: the drawer paints a block the highlighter answers `null` for in its text colour.
  if (themeName === undefined) return Object.assign(() => null, { dispose: () => {} });
  const grammars = new Map(Object.entries(bundledLanguages));
  const themes = new Map(Object.entries(bundledThemes));
  const known = [...codeLanguages(languages)];
  const primitive = await createShikiPrimitiveAsync({
    themes: [themes.get(themeName)].filter((t) => t !== undefined),
    langs: known.map((l) => grammars.get(l)).filter((g) => g !== undefined),
    engine: createJavaScriptRegexEngine(),
  });
  const loaded = new Set(known);
  const foreground = primitive.getTheme(themeName).fg?.toLowerCase() ?? "";
  const fallback = theme.code_blocks.text_style.color;
  const highlight: CodeHighlighter = (source, language) => {
    const lang = language?.toLowerCase();
    if (lang === undefined || !loaded.has(lang)) return null;
    const text = normalizedSource(source);
    const tokens = codeToTokensBase(primitive, text, { lang, theme: themeName });
    return text.split("\n").map((_, i) => runsOf(tokens[i] ?? [], foreground, fallback));
  };
  return Object.assign(highlight, { dispose: () => primitive.dispose() });
}
