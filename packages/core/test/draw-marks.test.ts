import type { DisplayEntry } from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { paintMarkdown } from "./scene-kit.ts";

const entries = (md: string, theme = "", width = 600): DisplayEntry[] =>
  paintMarkdown(md, theme, width).painted.list.entries as DisplayEntry[];
const ofType = <T extends DisplayEntry["type"]>(list: DisplayEntry[], type: T) =>
  list.filter((e): e is Extract<DisplayEntry, { type: T }> => e.type === type);

const within = (e: DisplayEntry, x: number, y: number): boolean =>
  x >= e.bounds.x &&
  x <= e.bounds.x + e.bounds.width &&
  y >= e.bounds.y &&
  y <= e.bounds.y + e.bounds.height;

describe("images", () => {
  it("draws a placeholder entry whose src has the md2ui params stripped", () => {
    const [img] = ofType(entries("![Logo](https://x.test/a.png?md2ui.fit=contain)"), "image");
    expect(img?.src).toBe("https://x.test/a.png");
    expect(img?.fit).toBe("contain");
    expect(img?.shape.kind).toBe("rect");
    expect(img?.placeholder.color).toBe("#969696ff");
  });

  // md2ui ADR-406: a source of params alone, `![](?md2ui.…)`, is an image
  // with no picture: no image entry to fetch, only a quiet box sized by its params.
  it("draws a params-only source as a quiet box sized by its params", () => {
    const list = entries("![](?md2ui.aspect_ratio=1:1)");
    expect(ofType(list, "image")).toEqual([]);
    const [fill] = ofType(list, "fill").filter(
      (f) => f.paint.kind === "color" && f.paint.color === "#d0d0d0ff",
    );
    expect(fill?.shape.height).toBeCloseTo(fill?.shape.width ?? 0);
    expect(fill?.shape.width).toBeGreaterThan(0);
  });

  it("falls back to auto fit, and a circle is a square oval", () => {
    const [img] = ofType(
      entries("![Me](https://x.test/a.jpg?md2ui.shape=circle&md2ui.max_width=100)"),
      "image",
    );
    expect(img?.fit).toBe("auto");
    expect(img?.shape.kind).toBe("oval");
    expect(img?.shape.width).toBe(img?.shape.height);
    expect(img?.shape.width).toBeLessThanOrEqual(100);
  });

  it("labels a roomy placeholder with its alt text, centred", () => {
    const [img] = ofType(entries("![Hello](https://x.test/a.jpg)"), "image");
    const label = img?.placeholder.label;
    expect(label?.runs.map((r) => r.text).join("")).toBe("Hello");
    const shape = img?.shape;
    if (shape === undefined || label === undefined || label === null) throw new Error("no label");
    const first = label.runs[0];
    const last = label.runs[label.runs.length - 1];
    const width = (last?.x ?? 0) - (first?.x ?? 0);
    expect((first?.x ?? 0) - shape.x).toBeGreaterThan(0);
    expect(width).toBeGreaterThanOrEqual(0);
    expect(label.y).toBeCloseTo(shape.y + shape.height / 2 + 14 / 2, -1);
    expect(img && within(img, first?.x ?? 0, label.y)).toBe(true);
  });
});

describe("horizontal rule", () => {
  it("is a centred line in the theme's stroke", () => {
    const list = entries(
      "Above\n\n---\n\nBelow",
      "## Horizontal Rule\nStroke color: #112233\nStroke width: 3",
    );
    const [rule] = ofType(list, "line");
    expect(rule?.y0).toBe(rule?.y1);
    expect(rule?.width).toBe(3);
    expect(rule?.color).toBe("#112233ff");
    expect((rule?.x1 ?? 0) - (rule?.x0 ?? 0)).toBeGreaterThan(100);
    expect(rule && within(rule, rule.x0, rule.y0)).toBe(true);
  });
});

describe("list markers", () => {
  const theme =
    "## Styling & Spacing\n### Unordered Lists\n#### Marker\nShape: square\nSize: 8\nColor: #4B3F91\nSpace: 10";

  it("draws a square bullet in the marker colour", () => {
    const fills = ofType(entries("- one\n- two", theme), "fill");
    expect(fills).toHaveLength(2);
    const [a] = fills;
    expect(a?.shape.kind).toBe("roundRect");
    expect(a?.shape.width).toBe(8);
    expect(a?.paint).toEqual({ kind: "color", color: "#4b3f91ff" });
  });

  it("draws a circle bullet as an oval", () => {
    const [a] = ofType(entries("- one", theme.replace("square", "circle")), "fill");
    expect(a?.shape.kind).toBe("oval");
  });

  it("draws numbered ordinals as text", () => {
    const md = "1. first\n2. second";
    const t =
      "## Styling & Spacing\n### Numbered Lists\n#### Marker\nNumber format: 1.\nFont size: 16\nSpace: 10";
    const texts = ofType(entries(md, t), "text").map((e) => e.runs.map((r) => r.text).join(""));
    expect(texts).toContain("1.");
    expect(texts).toContain("2.");
  });

  it("draws an aside quote bar spanning the quote", () => {
    const t =
      "## Styling & Spacing\n### Quotes\n#### Marker\nBar width: 4\nBar color: #C0C0C0\nSpace: 12";
    const [bar] = ofType(entries("> quoted words", t), "fill");
    expect(bar?.shape.width).toBe(4);
    expect(bar?.shape.height).toBeGreaterThan(10);
    expect(bar?.paint).toEqual({ kind: "color", color: "#c0c0c0ff" });
  });
});

describe("separators", () => {
  // md2ui separator_display_tests: test_a_dot_is_text_not_a_cell (ADR-205). A
  // `Bullet:` line from before ADR-205 is read as nothing.
  it("draws a dot inside its text, never as a separator", () => {
    const theme = "## Separators\nBullet: show\nDash: show\nBar: show";
    const list = entries("Alpha • Beta", theme);
    const texts = ofType(list, "text").map((e) => e.runs.map((r) => r.text).join(""));
    expect(texts.join("|")).toContain("Alpha • Beta");
    expect(texts).not.toContain("•");
  });

  it("draws a vertical rule for a bar when Draw is on", () => {
    const list = entries(
      "Alpha | Beta",
      "## Vertical Rule\nDraw: yes\nStroke color: #C0C0C0\nStroke width: 2",
    );
    const [line] = ofType(list, "line");
    expect(line?.x0).toBe(line?.x1);
    expect(line?.width).toBe(2);
    expect(line?.color).toBe("#c0c0c0ff");
    expect(line && within(line, line.x0, line.y0)).toBe(true);
  });
});
