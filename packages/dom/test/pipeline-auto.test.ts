// `Layout: Auto` as a view runs it (md2ui `session.build_scene`, 1ae8b45a): the choice is
// made on a width band's first layout and kept for the document's life, so a resize
// inside a decided band generates one layout, and a narrow band never measures.
import * as core from "@md2ui/core";
import { expect, test, vi } from "vitest";
import { groupDocument, prepareDocument } from "../src/pipeline.ts";

vi.mock("@md2ui/core", async (original) => {
  const actual = await original<typeof core>();
  return { ...actual, generate: vi.fn(actual.generate) };
});

const PADDING = 20;
const THEME = `# t\n## Styling & Spacing\n### Root\nLayout: Auto\nPadding: ${PADDING}\nMax width: 2000\n`;
const MARKDOWN = ["A", "B", "C", "D"].map((h) => `## ${h}\n\nBody of ${h}.`).join("\n\n");

test("a band's first layout builds both arrangements; a resize inside it builds one", () => {
  const faces = {
    theme: core.parseTheme(THEME),
    text: core.createFakeMeasurer(),
    emojiFamily: () => "emoji",
    highlight: null,
  };
  const doc = prepareDocument(groupDocument(MARKDOWN, new core.RegexKit()), faces);
  const generate = vi.mocked(core.generate);
  const builds = (width: number): number => {
    generate.mockClear();
    doc.render(width + 2 * PADDING);
    return generate.mock.calls.length;
  };
  // Effective widths: band 2, band 2, band 0, band 0, band 1, band 1, band 2 again.
  expect([1280, 1500, 500, 700, 900, 1100, 1700].map(builds)).toEqual([2, 1, 1, 1, 2, 1, 1]);
});
