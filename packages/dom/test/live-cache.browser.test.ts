// The view's detection memo (ADR-104: a cache only where the timings miss): a kit
// kept across documents must group every document exactly as a fresh kit does. Checked
// for every corpus document through the edits a view sees: a stream (prefixes), a task
// ticked, a section removed, and the document re-sent. Runs only with fixtures.
import { groupMarkdown, RegexKit } from "@md2ui/core";
import { expect, inject, test } from "vitest";
import {
  corpusDocs,
  corpusDocument,
  removeSection,
  streamed,
  tickFirstTask,
} from "./live-corpus.ts";

const fixtures = inject("md2uiFixtures");

/** A grouping tree as text; its hashes are 64-bit integers. */
const text = (tree: unknown): string =>
  JSON.stringify(tree, (_, v: unknown) => (typeof v === "bigint" ? v.toString(16) : v));

/** The documents a view shows in turn while `markdown` streams in and is then edited. */
function sequence(markdown: string): string[] {
  const prefixes = streamed(markdown, Math.max(4, Math.ceil(markdown.length / 12)));
  const edits: string[] = [];
  if (/^\s*[-*+] \[ \]/mu.test(markdown)) edits.push(tickFirstTask(markdown));
  for (const level of [1, 2, 3]) {
    const headings = markdown.match(new RegExp(`^#{${level}}(\\s|$)`, "gmu"))?.length ?? 0;
    if (headings >= 2) {
      edits.push(removeSection(markdown, level, 1));
      break;
    }
  }
  return [...prefixes, ...edits, markdown];
}

test.skipIf(fixtures === "")(
  "a kit kept across documents groups each one as a fresh kit does",
  async () => {
    let checked = 0;
    for (const doc of await corpusDocs(fixtures)) {
      const { markdown } = await corpusDocument(fixtures, doc);
      const kept = new RegexKit();
      for (const [i, md] of sequence(markdown).entries()) {
        const fresh = text(groupMarkdown(md, new RegexKit()));
        expect(text(groupMarkdown(md, kept)), `${doc} #${i}`).toBe(fresh);
        checked++;
      }
    }
    console.log(`live cache: ${checked} documents grouped alike with a kept kit`);
  },
  600_000,
);
