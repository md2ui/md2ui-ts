import type {
  DisplayEntry,
  DisplayList,
  HitTarget,
  HostState,
  OutlineItem,
} from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { paintMarkdown } from "./scene-kit.ts";

const THEME = `## Links
Fill color: #26262B
Corner radius: 24
Padding: 10
Disabled fill color: #EEEEF0
Disabled text color: #96969D

## Code Blocks
Background color: #101010
Padding: 10
### Copy Button
Icon: copy

## Drawing elements
### Task controls
Type: checkbox
Size: 20
Padding: 5
Corner radius: 6
### Checked outer
Background color: #DCEEE2
### Checked inner
Background color: #4F9C6B
### Unchecked outer
Background color: #CFCFD6
### Unchecked inner
Background color: #FDFDFD
`;

const DOC = `# The **Title** of [it](/home)

Some \`inline\` text with a [docs link](/docs) and ~~struck~~ words.

## Section two {#two}

[Open](/open) [Save](agent:save)

![A photo](https://example.com/photo.png)

- [x] done
- [ ] todo

\`\`\`python
print("hi")  # a comment long enough to run past the right edge of the code block
\`\`\`
`;

const CARD = `Intro line.

[![](https://example.com/card.png) Caption words
on two lines](/card)

After the card, [inline](/inline) link.
`;

type Target = Exclude<HitTarget, { kind: "copy" }>;
const targetsOf = (list: DisplayList, kind: Target["kind"]): Target[] =>
  list.targets.filter((t): t is Target => t.kind === kind);
const only = (list: DisplayList, id: string): DisplayEntry[] =>
  list.entries.filter((e) => e.nodeId === id);

/** The indices at which two lists of one geometry differ, and the nodes they belong to. */
function changes(a: DisplayList, b: DisplayList): { indices: number[]; nodes: Set<string> } {
  expect(b.entries).toHaveLength(a.entries.length);
  const indices: number[] = [];
  a.entries.forEach((e, i) => {
    if (JSON.stringify(e) !== JSON.stringify(b.entries[i])) indices.push(i);
  });
  return { indices, nodes: new Set(indices.map((i) => a.entries[i]?.nodeId ?? "")) };
}

const strip = (items: readonly OutlineItem[]) =>
  items.map((i) =>
    i.role === "heading" || i.role === "text" || i.role === "image"
      ? { ...i, bounds: undefined }
      : i,
  );

describe("the display list", () => {
  const painted = paintMarkdown(DOC, THEME, 400);
  const { list } = painted.painted;

  it("is produced with no DOM present", () => {
    const host: Record<string, unknown> = globalThis;
    expect(host["document"]).toBeUndefined();
    expect(host["window"]).toBeUndefined();
    expect(host["OffscreenCanvas"]).toBeUndefined();
    expect(list.entries.length).toBeGreaterThan(0);
  });

  it("survives a JSON round trip unchanged", () => {
    const kinds = new Set(list.entries.map((e) => e.type));
    for (const type of ["fill", "text", "image", "scroll"]) expect(kinds).toContain(type);
    expect(JSON.parse(JSON.stringify(list))).toEqual(list);
    expect(JSON.parse(JSON.stringify(painted.painted.outline))).toEqual(painted.painted.outline);
  });

  it("is version 1, and every colour is #rrggbbaa in lower case", () => {
    expect(list.version).toBe(1);
    const colours = [...JSON.stringify(list).matchAll(/"(?:color|fade)":("[^"]*"|null)/g)].map(
      (m) => m[1] as string,
    );
    expect(colours.length).toBeGreaterThan(10);
    for (const c of colours) if (c !== "null") expect(c).toMatch(/^"#[0-9a-f]{8}"$/);
  });

  it("anchors a {#id} heading", () => {
    expect(list.anchors.map((a) => a.id)).toEqual(["two"]);
  });
});

describe("outline", () => {
  it("lists headings with level and plain text, text, an image's alt, targets after their text", () => {
    const { painted: p } = paintMarkdown(DOC, THEME, 400);
    expect(strip(p.outline).slice(0, 8)).toEqual([
      { role: "heading", level: 1, text: "The Title of it", bounds: undefined },
      { role: "target", ordinal: 0, name: "it" },
      {
        role: "text",
        text: "Some inline text with a docs link and struck words.",
        bounds: undefined,
      },
      { role: "target", ordinal: 1, name: "docs link" },
      { role: "heading", level: 2, text: "Section two", bounds: undefined },
      { role: "target", ordinal: 2, name: "Open" },
      { role: "target", ordinal: 3, name: "Save" },
      { role: "image", text: "A photo", bounds: undefined },
    ]);
  });

  it("gives a heading, a text and an image the bounds of their box", () => {
    const { painted: p } = paintMarkdown(DOC, THEME, 400);
    for (const item of p.outline) {
      if (item.role === "target" || item.role === "copy") continue;
      expect(item.bounds.width).toBeGreaterThan(0);
      expect(item.bounds.height).toBeGreaterThan(0);
    }
  });

  it("lists a task as its checkbox named by its text, and a code block's text then its copy item", () => {
    const { painted: p, theme } = paintMarkdown(DOC, THEME, 400);
    expect(theme.code_blocks.copy_icon).toBe("copy");
    const roles = strip(p.outline).slice(8);
    const copyTarget = p.list.targets.find((t) => t.kind === "copy");
    expect(roles).toEqual([
      { role: "target", ordinal: 4, name: "done" },
      { role: "target", ordinal: 5, name: "todo" },
      {
        role: "text",
        text: 'print("hi")  # a comment long enough to run past the right edge of the code block',
        bounds: undefined,
      },
      { role: "copy", nodeId: copyTarget?.nodeId },
    ]);
  });

  it("puts a link card's target before the items inside it, an inline link's after its text", () => {
    const { painted: p } = paintMarkdown(CARD, THEME, 400);
    expect(strip(p.outline)).toEqual([
      { role: "text", text: "Intro line.", bounds: undefined },
      { role: "target", ordinal: 0, name: "Caption words on two lines" },
      { role: "image", text: "", bounds: undefined },
      { role: "text", text: "Caption words", bounds: undefined },
      { role: "text", text: "on two lines", bounds: undefined },
      { role: "text", text: "After the card, inline link.", bounds: undefined },
      { role: "target", ordinal: 1, name: "inline" },
    ]);
    expect(p.list.targets[0]).toMatchObject({ kind: "link", ordinal: 0, card: true });
  });

  it("reads a control's label once, as the control's name, before or after it", () => {
    const { painted: p } = paintMarkdown(
      "- [ ] Milk\n\nVolume: [50/100]\n\n- [ ] Eggs and **bread**\n\nMilk\n",
      THEME,
      400,
    );
    expect(strip(p.outline)).toEqual([
      { role: "target", ordinal: 0, name: "Milk" },
      { role: "target", ordinal: 1, name: "Volume" },
      { role: "target", ordinal: 2, name: "Eggs and bread" },
      // The same words elsewhere are not a label.
      { role: "text", text: "Milk", bounds: undefined },
    ]);
  });

  it("has no copy item without a copy icon", () => {
    const { painted: p } = paintMarkdown(DOC, THEME.replace("Icon: copy", "Icon: none"), 400);
    expect(p.outline.some((i) => i.role === "copy")).toBe(false);
  });
});

describe("withStates", () => {
  const { painted: p } = paintMarkdown(DOC, THEME, 400);
  const [button] = targetsOf(p.list, "agent");
  const [done, todo] = targetsOf(p.list, "checkbox");
  const state = (t: Target | undefined, s: HostState) =>
    p.withStates(new Map([[t?.ordinal ?? -1, s]]));

  it("answers the list itself for an empty map", () => {
    expect(p.withStates(new Map())).toEqual(p.list);
  });

  it("shows a pending button in its disabled colours and changes nothing else", () => {
    const id = button?.nodeId ?? "";
    const shown = state(button, { kind: "pending" });
    const diff = changes(p.list, shown);
    expect(diff.indices.length).toBeGreaterThan(0);
    expect([...diff.nodes]).toEqual([id]);
    expect(shown.targets).toEqual(p.list.targets);
    expect(shown.anchors).toEqual(p.list.anchors);
    const fill = only(shown, id).find((e) => e.type === "fill");
    expect(fill?.type === "fill" && fill.paint).toEqual({ kind: "color", color: "#eeeef0ff" });
    const text = only(shown, id).find((e) => e.type === "text");
    expect(text?.type === "text" && text.runs.map((r) => r.color)).toEqual(["#96969dff"]);
    // The geometry stands: the same entries, in the same places.
    expect(shown.entries.map((e) => [e.type, e.nodeId, e.bounds])).toEqual(
      p.list.entries.map((e) => [e.type, e.nodeId, e.bounds]),
    );
  });

  it("shows a task ticked ahead of the agent and changes only that task's entries", () => {
    const shown = state(todo, { kind: "checked", checked: true });
    const diff = changes(p.list, shown);
    expect(diff.indices.length).toBeGreaterThan(0);
    expect([...diff.nodes]).toEqual([todo?.nodeId]);
    expect(shown.targets).toEqual(p.list.targets);
    // Ticked, the unchecked task paints as the checked one does.
    const colours = (l: DisplayList, t: Target | undefined) =>
      only(l, t?.nodeId ?? "").flatMap((e) =>
        e.type === "fill" && e.paint.kind === "color" ? [e.paint.color] : [],
      );
    expect(colours(shown, todo)).toEqual(colours(p.list, done));
    expect(colours(p.list, todo)).toEqual(["#cfcfd6ff", "#fdfdfdff"]);
  });

  it("changes nothing when the state is the one the node already shows", () => {
    expect(state(done, { kind: "checked", checked: true })).toEqual(p.list);
  });

  it("ignores an ordinal the document does not hold", () => {
    expect(p.withStates(new Map([[99, { kind: "pending" }]]))).toEqual(p.list);
  });

  it("leaves a sentence as it is when one of its links is pending, as md2ui does", () => {
    // md2ui keys an inline link as its text's id plus `#k`, which names no node: the
    // link mutes only itself, and drawn inside prose it shows no disabled paint.
    const { painted: q } = paintMarkdown(
      "Pick [one](agent:one) or [two](agent:two) today.\n",
      THEME,
      400,
    );
    const [one, two] = targetsOf(q.list, "agent");
    expect(one?.nodeId).toBe(two?.nodeId);
    expect(q.withStates(new Map([[one?.ordinal ?? -1, { kind: "pending" }]]))).toEqual(q.list);
  });
});
