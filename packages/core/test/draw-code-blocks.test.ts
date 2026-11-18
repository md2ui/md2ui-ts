import type { DisplayEntry, ScrollEntry, TextEntry, TextMeasurer } from "@md2ui/contracts";
import { beforeAll, describe, expect, test } from "vitest";
import type { CodeHighlighter } from "../src/scene/draw/context.ts";
import { loadCodeHighlighter } from "../src/scene/highlight.ts";
import { createFakeMeasurer } from "../src/text/fake-measurer.ts";
import { parseTheme } from "../src/theme/parse.ts";
import { paintMarkdown } from "./scene-kit.ts";

/** A `## Code Blocks` theme: `extra` lines in the block, `copy` lines in its Copy Button. */
const codeTheme = (extra = "", copy = "Icon: none"): string =>
  `## Code Blocks
Syntax style: monokai
Background color: #101010
Padding: 10
Line spacing: 4
${extra}
### Copy Button
${copy}
`;
const THEME = codeTheme();

const fence = (language: string, body: string): string => `\`\`\`${language}\n${body}\n\`\`\`\n`;
const PY = "def add(a, b):\n    return a + b  # sum\n";

const texts = (entries: readonly DisplayEntry[]): TextEntry[] =>
  entries.filter((e): e is TextEntry => e.type === "text");
const scrolls = (entries: readonly DisplayEntry[]): ScrollEntry[] =>
  entries.filter((e): e is ScrollEntry => e.type === "scroll");

let highlight: CodeHighlighter;
beforeAll(async () => {
  highlight = await loadCodeHighlighter(parseTheme(THEME), ["python", "py", "nosuchlanguage"]);
});

describe("loadCodeHighlighter", () => {
  test("colours python tokens, and a line's runs concatenate to the line", () => {
    const lines = highlight("def add(a, b):\n\treturn a + b\n", "python");
    expect(lines?.map((l) => l.map((t) => t.text).join(""))).toEqual([
      "def add(a, b):",
      "    return a + b",
    ]);
    expect(new Set(lines?.flat().map((t) => t.color)).size).toBeGreaterThan(2);
  });

  test("answers an alias, and null for an unset or unknown language", () => {
    expect(highlight("x = 1", "py")).not.toBeNull();
    expect(highlight("x = 1", "PYTHON")).not.toBeNull();
    expect(highlight("x = 1", null)).toBeNull();
    expect(highlight("x = 1", "nosuchlanguage")).toBeNull();
    expect(highlight("x = 1", "rust")).toBeNull();
  });

  test("keeps blank lines and drops the closing newline", () => {
    expect(highlight("a = 1\n\nb = 2\n", "python")).toHaveLength(3);
  });

  // md2ui: an unset or unknown syntax style is Pygments' grayscale `bw`, which
  // colours no token, so the block draws in its own text colour; `default` still colours.
  test("an unset or unknown syntax style colours nothing", async () => {
    const odd = await loadCodeHighlighter(parseTheme("## Code Blocks\nSyntax style: nope\n"), [
      "python",
    ]);
    const plain = await loadCodeHighlighter(parseTheme(""), ["python"]);
    const named = await loadCodeHighlighter(parseTheme("## Code Blocks\nSyntax style: default\n"), [
      "python",
    ]);
    expect(odd("def f(): pass", "python")).toBeNull();
    expect(plain("def f(): pass", "python")).toBeNull();
    expect(named("def f(): pass", "python")).not.toBeNull();
    for (const h of [odd, plain, named]) h.dispose();
  });

  test("a disposed highlighter has released its instance and refuses to answer", async () => {
    const once = await loadCodeHighlighter(parseTheme(THEME), ["python"]);
    once.dispose();
    expect(() => once("x = 1", "python")).toThrow();
  });
});

describe("drawCodeBlock", () => {
  test("a highlighted python block paints runs at their offsets in the whole line", () => {
    const { painted, theme } = paintMarkdown(fence("python", PY), THEME, 800, { highlight });
    const lines = texts(painted.list.entries);
    expect(lines).toHaveLength(2);
    const second = lines[1];
    expect(new Set(second?.runs.map((r) => r.color)).size).toBeGreaterThan(1);
    expect(second?.runs.map((r) => r.text).join("")).toBe("    return a + b  # sum");
    // The fake measurer: 0.25 em per space, so "return" starts 4 spaces in (0.25 em each).
    const size = theme.code_blocks.text_style.font_size;
    const ret = second?.runs.find((r) => r.text.startsWith("return"));
    expect((ret?.x ?? 0) - (second?.runs[0]?.x ?? 0)).toBeCloseTo(
      second?.runs[0]?.text === "    " ? 4 * size * 0.25 : Number.NaN,
    );
    expect(lines[0]?.y).toBeLessThan(second?.y ?? 0);
    expect(scrolls(painted.list.entries)).toHaveLength(0);
    for (const line of lines) expect(line.clip?.kind).toBe("roundRect");
  });

  test("an unknown language is one run in the block's text colour", () => {
    const { painted, theme } = paintMarkdown(fence("nosuchlanguage", PY), THEME, 800, {
      highlight,
    });
    const lines = texts(painted.list.entries);
    expect(lines).toHaveLength(2);
    const ink = `#${theme.code_blocks.text_style.color.toString(16).padStart(8, "0").slice(2)}ff`;
    for (const line of lines) {
      expect(line.runs).toHaveLength(1);
      expect(line.runs[0]?.color).toBe(ink);
    }
  });

  test("without a highlighter the block paints in one colour too", () => {
    const { painted } = paintMarkdown(fence("python", PY), THEME);
    expect(texts(painted.list.entries).every((l) => l.runs.length === 1)).toBe(true);
  });

  test("a line wider than the block makes a scroll entry holding the lines as text", () => {
    const wide = `x = "${"w".repeat(300)}"`;
    const { painted, scene } = paintMarkdown(fence("python", wide), THEME, 800, { highlight });
    const [scroll] = scrolls(painted.list.entries);
    expect(scroll).toBeDefined();
    expect(scroll?.entries).toHaveLength(1);
    expect(scroll?.contentWidth).toBeGreaterThan(scroll?.shape.width ?? Number.POSITIVE_INFINITY);
    expect(scroll?.fade).toBe("#101010ff");
    expect(texts(painted.list.entries)).toHaveLength(0);
    expect(scene.scrollables).toHaveLength(1);
    const background = painted.list.entries.find((e) => e.type === "fill");
    expect(background?.nodeId).toBe(scroll?.nodeId);
  });

  // md2ui: a block cut at Max lines is a scroll entry holding ALL its lines, so
  // the host can scroll down to them; at rest the two that fit show, and the host fades
  // the bottom (the fade is the entry's, not a fill of the list).
  test("Max lines cuts between lines: every line in the block's scroll entry, two at rest", () => {
    const body = ["a = 1", "b = 2", "c = 3", "d = 4", "e = 5"].join("\n");
    const cut = codeTheme("Max lines: 2");
    const { painted, scene } = paintMarkdown(fence("python", body), cut, 800, { highlight });
    expect(texts(painted.list.entries)).toEqual([]);
    const [block] = scrolls(painted.list.entries);
    if (block === undefined) throw new Error("no scroll entry");
    expect(block.entries.map((e) => e.runs.map((r) => r.text).join(""))).toEqual(body.split("\n"));
    expect(block.rest).toBe(2);
    expect(block.fade).toBe("#101010ff");
    const [s] = scene.scrollables;
    expect(block.contentHeight).toBe(s?.content_height);
    expect(block.contentHeight).toBeGreaterThan(block.shape.height);
    // The window runs from below the top padding to above the bottom one (Padding: 10).
    expect(block.window).toEqual({
      x: block.shape.x,
      y: block.shape.y + 10,
      width: block.shape.width,
      height: block.shape.height - 20,
    });
    expect(
      painted.list.entries.some((e) => e.type === "fill" && e.paint.kind === "linearGradient"),
    ).toBe(false);

    const all = paintMarkdown(fence("python", body), codeTheme("Max lines: none"), 800, {
      highlight,
    });
    expect(texts(all.painted.list.entries)).toHaveLength(5);
    expect(scrolls(all.painted.list.entries)).toEqual([]);
  });

  // md2ui code_block_scroll_tests: a block cut at Max lines can scroll down,
  // so the scene names it with how tall its content really is; one whose lines all fit
  // and none runs past its edge is not named.
  test("a block cut at Max lines is a scrollable with its content height", () => {
    const body = ["a = 1", "b = 2", "c = 3", "d = 4", "e = 5"].join("\n");
    const cut = paintMarkdown(fence("python", body), codeTheme("Max lines: 2"), 800, {
      highlight,
    }).scene.scrollables;
    expect(cut).toHaveLength(1);
    const [block] = cut;
    expect(block?.content_height).toBeGreaterThan(block?.height ?? Number.POSITIVE_INFINITY);
    expect(block?.content_width).toBeLessThanOrEqual(block?.width ?? 0);
    const all = paintMarkdown(fence("python", body), codeTheme("Max lines: none"), 800, {
      highlight,
    }).scene.scrollables;
    expect(all).toEqual([]);
  });

  test("the copy button appears when Copy icon is set", () => {
    const on = THEME.replace(
      "Icon: none",
      "Icon: C\nIcon size: 14\nFill color: #FF0000\nPadding: 4",
    );
    const { painted } = paintMarkdown(fence("python", PY), on, 800, { highlight });
    const entries = painted.list.entries;
    const icon = texts(entries).find((t) => t.runs.some((r) => r.text === "C"));
    expect(icon).toBeDefined();
    expect(icon?.runs[0]?.font.size).toBe(14);
    const button = entries.find(
      (e) => e.type === "fill" && e.paint.kind === "color" && e.paint.color === "#ff0000ff",
    );
    expect(button).toBeDefined();
    // After the lines: the button paints over the code.
    expect(entries.indexOf(button as DisplayEntry)).toBeLessThan(
      entries.indexOf(icon as TextEntry),
    );

    const off = paintMarkdown(fence("python", PY), THEME, 800, { highlight });
    expect(texts(off.painted.list.entries).some((t) => t.runs.some((r) => r.text === "C"))).toBe(
      false,
    );
  });

  test("every text entry's bounds contain its runs", () => {
    const { painted } = paintMarkdown(fence("python", PY), THEME, 800, { highlight });
    for (const t of texts(painted.list.entries)) {
      for (const r of t.runs) {
        expect(t.bounds.x).toBeLessThanOrEqual(r.x);
        expect(t.bounds.y).toBeLessThanOrEqual(t.y);
      }
    }
  });
});

// md2ui `font_loader.resolve_code_typeface`: a code font neither loaded nor
// installed falls back to a monospace, never the proportional face every other stack ends
// in. Every font a code block is measured and painted in ends in `monospace`, so the
// browser falls back to one on the page and in the Worker alike (text-pretext's
// `cssFont` adds `serif` only after it, for a glyph no monospace has).
test("a code block is measured and painted in its font, then monospace", () => {
  const asked: string[][] = [];
  const fake = createFakeMeasurer();
  const text: TextMeasurer = {
    ...fake,
    advance: (t, font) => {
      asked.push([...font.families]);
      return fake.advance(t, font);
    },
    fontMetrics: (font) => {
      asked.push([...font.families]);
      return fake.fontMetrics(font);
    },
  };
  const theme = codeTheme("", "Icon: 📋");
  const code = `${theme}\n## Text Styles\nCode Block\n- Font Name: Not An Installed Mono\n`;
  const { painted } = paintMarkdown(fence("", "x = 1"), code, 800, { text });
  const line = ["Not An Installed Mono", "monospace"];
  expect(asked).toContainEqual(line);
  const runs = texts(painted.list.entries).flatMap((e) => e.runs);
  expect(runs.find((r) => r.text === "x = 1")?.font.families).toEqual(line);
  expect(runs.find((r) => r.text === "📋")?.font.families).toEqual(["emoji", ...line]);
});
