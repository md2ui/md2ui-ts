// Real corpus documents for the live tests: a document's Markdown and THEME.md
// read from the fixtures, md2ui's font files loaded as the host would give them, and
// the edits the brief times: a stream of deltas, a task ticked, a section removed.
import type { FontSource, ResolvedTheme, TextMeasurer } from "@md2ui/contracts";
import { parseTheme, resolveThemeAssets } from "@md2ui/core";
import { createPretextMeasurer } from "@md2ui/text-pretext";
import { commands } from "vitest/browser";
import type { Faces } from "../src/pipeline.ts";

interface Manifest {
  readonly corpus: readonly { doc: string; input: string; theme_input: string | null }[];
  readonly fonts: { readonly faces: Readonly<Record<string, string | null>> };
}

/** A corpus document under its own theme. */
export interface CorpusDocument {
  readonly markdown: string;
  readonly theme: ResolvedTheme;
}

/** The fixtures' manifest. */
async function manifestOf(fixtures: string): Promise<Manifest> {
  return JSON.parse(await commands.readFile(`${fixtures}/manifest.json`)) as Manifest;
}

/** Every corpus document name. */
export async function corpusDocs(fixtures: string): Promise<string[]> {
  return (await manifestOf(fixtures)).corpus.map(({ doc }) => doc);
}

/** `doc` (a manifest name such as `tests-render__home-dashboards__kawsar-ahmed-macos-custom-widget__content`) and its theme. */
export async function corpusDocument(fixtures: string, doc: string): Promise<CorpusDocument> {
  const entry = (await manifestOf(fixtures)).corpus.find((e) => e.doc === doc);
  if (entry === undefined) throw new Error(`no corpus document ${doc}`);
  const markdown = await commands.readFile(`${fixtures}/${entry.input}`);
  const themeText =
    entry.theme_input === null ? "" : await commands.readFile(`${fixtures}/${entry.theme_input}`);
  return { markdown, theme: resolveThemeAssets(parseTheme(themeText), document.baseURI) };
}

/**
 * Every font file the fixtures carry, each given as a host gives it (a `FontSource`,
 * here a blob URL, which a Worker of the page can load too).
 */
export async function corpusFonts(fixtures: string): Promise<FontSource[]> {
  const { faces } = (await manifestOf(fixtures)).fonts;
  const sources: FontSource[] = [];
  for (const [face, path] of Object.entries(faces)) {
    if (path === null) continue;
    const [family = "", , weight = "400", , italic = "0"] = face.split("|");
    const data = await commands.readFile(`${fixtures}/${path}`, "base64");
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "font/ttf" }));
    sources.push({ family, url, weight: Number(weight), italic: italic === "1" });
  }
  return sources;
}

/**
 * A Pretext measurer with every font the fixtures carry that the browser loads (format 3's
 * Courier, extracted from Apple's `.ttc`, does not). The emoji face is the platform's.
 */
export async function corpusMeasurer(fixtures: string): Promise<TextMeasurer> {
  return createPretextMeasurer(await corpusFonts(fixtures), { onFontError: () => undefined });
}

/** What `prepareDocument` needs for `doc` under `text`, with no code highlighter. */
export function facesOf(doc: CorpusDocument, text: TextMeasurer): Faces {
  return { theme: doc.theme, text, emojiFamily: () => "emoji", highlight: null };
}

/**
 * `markdown` as a model streams it: pieces of about four characters (a token), each
 * the document so far.
 */
export function streamed(markdown: string, size = 4): string[] {
  const out: string[] = [];
  for (let end = size; end < markdown.length + size; end += size) {
    out.push(markdown.slice(0, Math.min(end, markdown.length)));
  }
  return out;
}

/** `markdown` with its first open task ticked, as an agent re-sends it. */
export function tickFirstTask(markdown: string): string {
  const ticked = markdown.replace(/^(\s*[-*+] )\[ \]/mu, "$1[x]");
  if (ticked === markdown) throw new Error("no open task to tick");
  return ticked;
}

/**
 * `markdown` without its `index`-th section at heading `level`: from that heading line
 * to the next heading of the same or a higher level.
 */
export function removeSection(markdown: string, level: number, index: number): string {
  const lines = markdown.split("\n");
  const heading = (line: string): number => /^(#{1,6})(\s|$)/u.exec(line)?.[1]?.length ?? 0;
  const starts = lines.flatMap((line, i) => (heading(line) === level ? [i] : []));
  const start = starts[index];
  if (start === undefined) throw new Error(`no section ${index} at level ${level}`);
  let end = start + 1;
  while (end < lines.length) {
    const h = heading(lines[end] ?? "");
    if (h > 0 && h <= level) break;
    end++;
  }
  return [...lines.slice(0, start), ...lines.slice(end)].join("\n");
}
