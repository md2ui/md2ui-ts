// The painted words a host lays over the paint (`sceneText`): each run goes to
// the outline item it is painted in, carrying what a copy writes before it, as the
// item's text writes it; words no item holds read before the next item; a control's
// symbol is no word, and a pin's overpaint is not a second copy of its words.
import type { DisplayList, FontSpec, OutlineItem, TextEntry } from "@md2ui/contracts";
import { describe, expect, test } from "vitest";
import { type SceneText, sceneText } from "../src/scene/text-layer.ts";
import { createFakeMeasurer } from "../src/text/fake-measurer.ts";
import { paintMarkdown } from "./scene-kit.ts";

const THEME = `## Code Blocks
Background color: #101010
Padding: 10
### Copy Button
Icon: copy
`;

const DOC = `# The **Title** of [it](/home)

Some \`inline\` text with a [docs link](/docs) and ~~struck~~ words, long enough to wrap onto a second line here.

[Open](/open) [Save](agent:save)

- [ ] todo

Line one\\
Line two

\`\`\`python
def f():
    return 1  # a comment long enough to run past the right edge of the code block
\`\`\`
`;

/** What a copy of a group writes. */
const copied = (group: { runs: readonly { before: string; text: string }[] } | undefined) =>
  group?.runs.map((r) => r.before + r.text).join("");

function painted(markdown: string): { outline: readonly OutlineItem[]; text: SceneText } {
  const { painted } = paintMarkdown(markdown, THEME, 400);
  return {
    outline: painted.outline,
    text: sceneText(painted.list, painted.outline, createFakeMeasurer()),
  };
}

describe("a document's words", () => {
  const { outline, text } = painted(DOC);
  const indexOf = (role: string, start: string): number =>
    outline.findIndex(
      (item) => item.role === role && "text" in item && item.text.startsWith(start),
    );

  test("each heading and text item holds its words, which copy as its text", () => {
    for (const [index, item] of outline.entries()) {
      if (item.role !== "heading" && item.role !== "text") continue;
      expect(copied(text.items.get(index))).toBe(item.text);
      expect(text.items.get(index)?.end).toBe("\n");
    }
    // Wrapped: two lines, the space between them written once.
    const prose = text.items.get(indexOf("text", "Some inline"));
    expect(new Set(prose?.runs.map((r) => r.baseline)).size).toBeGreaterThan(1);
  });

  test("a hard break and a code line's indentation are what a copy writes", () => {
    expect(copied(text.items.get(indexOf("text", "Line one")))).toBe("Line one\nLine two");
    const code = copied(text.items.get(indexOf("text", "def f()")));
    expect(code).toContain("def f():\n    return 1");
  });

  test("a button's label reads before the next item; a tick and a copy icon are no words", () => {
    const loose = [...text.loose.values()].map((group) => copied(group)).join("|");
    expect(loose).toContain("Open");
    expect(loose).toContain("Save");
    expect(loose).toContain("todo");
    const all = [...text.items.values(), ...text.loose.values()].flatMap((g) => g.runs);
    expect(all.some((r) => r.text.includes("📋"))).toBe(false);
  });
});

describe("runs placed by hand", () => {
  const font: FontSpec = { families: ["Inter"], size: 10, weight: 400, italic: false };
  const line = (y: number, ...runs: [string, number][]): TextEntry => ({
    type: "text",
    nodeId: "n",
    bounds: { x: 0, y: y - 10, width: 200, height: 12 },
    y,
    runs: runs.map(([text, x]) => ({ text, x, font, color: "#000000ff" })),
  });
  const list = (entries: TextEntry[]): DisplayList => ({
    version: 1,
    width: 200,
    height: 100,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    centered: false,
    background: { paints: [], shadows: [] },
    entries,
    targets: [],
    anchors: [],
  });
  const item = (text: string, y: number): OutlineItem => ({
    role: "text",
    text,
    bounds: { x: 20, y, width: 180, height: 14 },
  });

  test("a pin's overpaint of a word is not a second copy of it", () => {
    const words = sceneText(
      list([line(10, ["Price ", 20], ["down", 50]), line(10, ["down", 50])]),
      [item("Price down", 0)],
      createFakeMeasurer(),
    );
    expect(copied(words.items.get(0))).toBe("Price down");
  });

  test("a marker on its item's first line leads it with a space; one above, with a line break", () => {
    const words = sceneText(
      list([
        line(10, ["•", 5]),
        line(10, ["First", 20]),
        line(40, ["Label", 0]),
        line(60, ["Second", 20]),
      ]),
      [item("First", 0), item("Second", 50)],
      createFakeMeasurer(),
    );
    expect(words.loose.get(0)).toMatchObject({ runs: [{ text: "•" }], end: " " });
    expect(words.loose.get(1)).toMatchObject({ runs: [{ text: "Label" }], end: "\n" });
    expect(copied(words.items.get(1))).toBe("Second");
  });
});

test("a muted count's digits, painted in its layer, are words", () => {
  const sliders = "## Drawing elements\n\n### Sliders\nEnabled: yes\n";
  const { painted } = paintMarkdown("Count: ~~➖ [7/9] ➕~~", sliders, 400);
  expect(painted.list.entries.some((e) => e.type === "layer")).toBe(true);
  const words = sceneText(painted.list, painted.outline, createFakeMeasurer());
  const all = [...words.items.values(), ...words.loose.values()].flatMap((g) => g.runs);
  expect(all.map((r) => r.text)).toContain("7");
});
