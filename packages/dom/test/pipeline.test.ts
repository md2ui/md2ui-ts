// The core as a view runs it: grouping per document, the scene per effective width, and
// relayout only when the effective width moves (md2ui `session.effective_width`).
import type { DisplayList } from "@md2ui/contracts";
import { createFakeMeasurer, loadCodeHighlighter, parseTheme, RegexKit } from "@md2ui/core";
import { expect, test } from "vitest";
import { groupDocument, prepareDocument } from "../src/pipeline.ts";
import { MARKDOWN, ORDINAL, PADDING, THEME } from "./document.ts";

const theme = parseTheme(THEME);
const faces = { theme, text: createFakeMeasurer(), emojiFamily: () => "emoji", highlight: null };

test("grouping gives the target table and the code languages", () => {
  const grouped = groupDocument(MARKDOWN, new RegexKit());
  expect(grouped.targets.map((t) => t?.kind)).toEqual([
    "link",
    "anchor",
    "agent",
    "checkbox",
    "slider",
    "agent",
  ]);
  expect(grouped.targets[ORDINAL.save]).toMatchObject({ slug: "save", commit: true });
  expect([...grouped.languages]).toEqual(["sh"]);
});

test("the scene is laid out at the view width less the root padding", () => {
  const scene = prepareDocument(groupDocument(MARKDOWN, new RegexKit()), faces).render(500);
  expect(scene.list.width).toBe(500 - 2 * PADDING);
  expect(scene.list.padding.left).toBe(PADDING);
});

test("a width under the floor or over Max width keeps the scene; one between relayouts", () => {
  const capped = parseTheme(
    THEME.replace("Stack sections: yes", "Stack sections: yes\nMax width: 400"),
  );
  const doc = prepareDocument(groupDocument(MARKDOWN, new RegexKit()), { ...faces, theme: capped });
  const wide = doc.render(1000);
  expect(wide.list.width).toBe(400);
  expect(doc.render(2000)).toBe(wide);
  expect(doc.render(400 + 2 * PADDING)).toBe(wide);
  const narrow = doc.render(300 + 2 * PADDING);
  expect(narrow).not.toBe(wide);
  expect(narrow.list.width).toBe(320);
  expect(doc.render(10)).toBe(narrow);
});

test("a document rendered at one width and then another matches one rendered fresh", () => {
  const grouped = groupDocument(MARKDOWN, new RegexKit());
  const doc = prepareDocument(grouped, faces);
  doc.render(900);
  const again: DisplayList = doc.render(500).list;
  const fresh: DisplayList = prepareDocument(groupDocument(MARKDOWN, new RegexKit()), faces).render(
    500,
  ).list;
  expect(JSON.parse(JSON.stringify(again))).toEqual(JSON.parse(JSON.stringify(fresh)));
});

test("a loaded highlighter colours the code block", async () => {
  const grouped = groupDocument(MARKDOWN, new RegexKit());
  // A named style: with none, md2ui's grayscale `bw` colours nothing.
  const styled = parseTheme(`${THEME}\n## Code Blocks\nSyntax style: default\n`);
  const highlight = await loadCodeHighlighter(styled, grouped.languages);
  try {
    const colours = (list: DisplayList): Set<string> => {
      const found = new Set<string>();
      for (const entry of list.entries) {
        if (entry.type !== "scroll") continue;
        for (const inner of entry.entries) {
          if (inner.type === "text") for (const run of inner.runs) found.add(run.color);
        }
      }
      return found;
    };
    const plain = prepareDocument(grouped, faces).render(500).list;
    const coloured = prepareDocument(grouped, { ...faces, highlight }).render(500).list;
    expect(colours(plain).size).toBe(1);
    expect(colours(coloured).size).toBeGreaterThan(1);
  } finally {
    highlight.dispose();
  }
});
