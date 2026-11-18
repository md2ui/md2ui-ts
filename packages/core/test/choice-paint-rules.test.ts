// A segmented run and a count paint as a button pill does (md2ui ADR-400, ADR-405;
// md2ui `tests/choice_paint_tests.py` on its sample
// `tests/choice-paint-theme-rules`): a pale secondary button with a 3px inside stroke,
// whose fill turns blue and stroke amber on a navy section. And a control written `~~`
// is drawn whole at the default mute (md2ui `render_counts.muted_paint`).
import type { DisplayEntry, FillEntry, GroupingNode, StrokeEntry } from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { paintMarkdown } from "./scene-kit.ts";

const THEME = `## Styling & Spacing

### Root
Background color: #FFFFFF
Padding: 24
Spacing: 20

### Heading 2
Background color: #1E3A8A
Corner radius: 16
Padding: 20
Spacing: 14

## Text Styles

Text
- Font size: 15
- Font color: #111827

Links
- Font size: 14
- Font weight: 600
- Font color: #FFFFFF

Links Secondary
- Font color: #111827

## Links
Segmented: yes
Fill color: #111827
Corner radius: 18
Padding top: 8
Padding bottom: 8
Padding left: 14
Padding right: 14

### Secondary
Fill color: #F3F4F6
Stroke width: 3
Stroke align: inside
Stroke color: #9CA3AF

## Drawing elements

### Sliders
Enabled: yes

## Color Replacements
On background color: #1E3A8A
- Replacement: #FFFFFF
- Fill color: #F3F4F6, Replacement: #3B82F6
- Stroke color: #9CA3AF, Replacement: #FBBF24
- Fill color: #111827, Replacement: #FFFFFF

On background color: #3B82F6
- Text color: #111827, Replacement: #FFFFFF

On background color: #FFFFFF
- Text color: #FFFFFF, Replacement: #111827
`;

const run = (name: string) =>
  `[S](agent:${name}?v=s&md2ui.choice=${name}) | ` +
  `~~*[M](agent:${name}?v=m&md2ui.choice=${name})*~~ | ` +
  `*[L](agent:${name}?v=l&md2ui.choice=${name})*`;
const DOC = `${run("size")}

Quantity: ➖ [2/9] ➕

*[Pill](agent:pill)*

## On navy

${run("size2")}

Quantity: ➖ [2/9] ➕

*[Pill](agent:pill2)*
`;

const BLUE = "#3b82f6ff";
const AMBER = "#fbbf24ff";

/** Every node `pick` accepts, in document order. */
function find(node: GroupingNode, pick: (n: GroupingNode) => boolean): GroupingNode[] {
  return [...(pick(node) ? [node] : []), ...node.children.flatMap((k) => find(k, pick))];
}

const own = (list: readonly DisplayEntry[], id: string | undefined) =>
  list.filter((e) => e.nodeId === id);
const fillsOf = (list: readonly DisplayEntry[]) =>
  list.filter((e): e is FillEntry => e.type === "fill");
const strokesOf = (list: readonly DisplayEntry[]) =>
  list.filter((e): e is StrokeEntry => e.type === "stroke");
const colorOf = (e: FillEntry | undefined) => (e?.paint.kind === "color" ? e.paint.color : null);

describe("a segmented run and a count paint as a button pill", () => {
  const painted = paintMarkdown(DOC, THEME, 600);
  const entries = painted.painted.list.entries;
  const runs = find(painted.grouping, (n) => n.segmented_run === true);
  const counts = find(painted.grouping, (n) => n.drawing_element?.count === true);
  const label = (text: string, which: number) =>
    find(painted.grouping, (n) => n.type === "link" && n.link_label === text)[which];

  it("on a coloured section, take the pill's replaced colours, as the pill beside them does", () => {
    expect(runs).toHaveLength(2);
    expect(counts).toHaveLength(2);
    const pill = fillsOf(own(entries, label("Pill", 1)?.node_id));
    expect(pill.map(colorOf)).toEqual([BLUE]);
    const surface = own(entries, runs[1]?.node_id);
    expect(fillsOf(surface).map(colorOf)).toEqual([BLUE]);
    expect(strokesOf(surface).map((e) => e.color)).toEqual([AMBER]);
    const count = own(entries, counts[1]?.node_id);
    const buttons = fillsOf(count).filter((e) => e.shape.kind === "oval");
    expect(buttons.map(colorOf)).toEqual([BLUE, BLUE]);
    expect(strokesOf(count).map((e) => e.color)).toEqual([AMBER, AMBER]);
    // Each sign takes the ink resolved on its button: the dark text, white on blue.
    const signs = fillsOf(count).filter((e) => e.shape.kind === "roundRect");
    expect(signs.map(colorOf)).toEqual(["#ffffffff", "#ffffffff", "#ffffffff"]);
    // The chosen S sits on the surface, so it is replaced against the blue surface, not
    // the navy section (which would have turned it white), and its label against itself.
    const s = own(entries, label("S", 1)?.node_id);
    expect(fillsOf(s).map(colorOf)).toEqual(["#111827ff"]);
    expect(s.flatMap((e) => (e.type === "text" ? e.runs.map((r) => r.color) : []))).toEqual([
      "#ffffffff",
    ]);
  });

  it("lay their strokes where Stroke align puts a pill's: inside the shape", () => {
    const [fill] = fillsOf(own(entries, runs[0]?.node_id));
    const [stroke] = strokesOf(own(entries, runs[0]?.node_id));
    expect(fill?.shape).toMatchObject({ kind: "roundRect", radii: [21, 21, 21, 21] });
    expect(stroke?.shape).toEqual({
      kind: "roundRect",
      x: (fill?.shape.x ?? 0) + 1.5,
      y: (fill?.shape.y ?? 0) + 1.5,
      width: (fill?.shape.width ?? 0) - 3,
      height: (fill?.shape.height ?? 0) - 3,
      radii: [19.5, 19.5, 19.5, 19.5],
    });
    const count = own(entries, counts[0]?.node_id);
    const [minus] = fillsOf(count).filter((e) => e.shape.kind === "oval");
    const [ring] = strokesOf(count);
    expect(ring?.shape).toEqual({
      kind: "oval",
      x: (minus?.shape.x ?? 0) + 1.5,
      y: (minus?.shape.y ?? 0) + 1.5,
      width: (minus?.shape.width ?? 0) - 3,
      height: (minus?.shape.height ?? 0) - 3,
    });
  });

  it("draws a disabled option inside its segment, in the disabled ink, never as a pill", () => {
    for (const which of [0, 1]) {
      const m = own(entries, label("M", which)?.node_id);
      expect(m.map((e) => e.type)).toEqual(["text"]);
      // The quieter ink at the default mute: the theme states no `Disabled …` colour, and
      // no replacement names the muted ink.
      expect(m.flatMap((e) => (e.type === "text" ? e.runs.map((r) => r.color) : []))).toEqual([
        "#11182766",
      ]);
    }
  });
});

describe("a control written ~~", () => {
  const CONTROLS = (t: string) =>
    `Volume: ${t}[65%]${t}\n\nSize: ➖ ${t}[2/9]${t} ➕\n\n- ${t}[ ]${t} Send the report\n`;
  const SLIDERS = `## Drawing elements\n\n### Sliders\nEnabled: yes\n\n### Task controls\nEnabled: yes\n`;
  const paintOf = (t: string) => {
    const painted = paintMarkdown(CONTROLS(t), SLIDERS, 600);
    const ids = new Set(
      find(painted.grouping, (n) => n.drawing_element !== undefined).map((n) => n.node_id),
    );
    return {
      painted,
      entries: painted.painted.list.entries
        .filter((e) => ids.has(e.nodeId))
        .map(({ nodeId: _, ...e }) => e),
    };
  };

  it("is drawn whole at the default mute, in its own unchanged box", () => {
    const live = paintOf("");
    const muted = paintOf("~~");
    expect(
      find(muted.painted.grouping, (n) => n.drawing_element?.["disabled"] === true),
    ).toHaveLength(3);
    expect(live.entries.length).toBeGreaterThan(5);
    // Each control is one layer at md2ui's `MUTED_OPACITY`, holding the live control's own
    // paint, unfaded: the layer fades it whole (md2ui `muted_paint`'s `saveLayer`).
    expect(muted.entries.map((e) => (e.type === "layer" ? e.opacity : e.type))).toEqual([
      0.4, 0.4, 0.4,
    ]);
    const held = muted.entries.flatMap((e) =>
      e.type === "layer" ? e.entries.map(({ nodeId: _, ...inner }) => inner) : [],
    );
    expect(held).toEqual(live.entries);
  });
});

// md2ui `tests/choice_paint_tests.py` on its sample `tests/segmented-disabled-first`:
// the two runs differ only in which option is disabled.
describe("a run's surface is the control's, not its first option's", () => {
  const DISABLED_FIRST =
    "~~*[S](agent:size?v=s&md2ui.choice=size)*~~ | [M](agent:size?v=m&md2ui.choice=size) | " +
    "*[L](agent:size?v=l&md2ui.choice=size)*\n\n" +
    "[S](agent:fit?v=s&md2ui.choice=fit) | ~~*[M](agent:fit?v=m&md2ui.choice=fit)*~~ | " +
    "*[L](agent:fit?v=l&md2ui.choice=fit)*\n";

  it("paints alike whichever option is disabled", () => {
    const painted = paintMarkdown(DISABLED_FIRST, THEME, 600);
    const entries = painted.painted.list.entries;
    const runs = find(painted.grouping, (n) => n.segmented_run === true);
    expect(runs).toHaveLength(2);
    const surface = (id: string | undefined) => {
      const mine = own(entries, id);
      return [fillsOf(mine).map(colorOf), strokesOf(mine).map((e) => e.color)];
    };
    expect(surface(runs[0]?.node_id)).toEqual(surface(runs[1]?.node_id));
    expect(surface(runs[1]?.node_id)).toEqual([["#f3f4f6ff"], ["#9ca3afff"]]);
  });
});

// md2ui `tests/choices_tests.py` on its sample `tests/choice-run-pills` (ADR-405):
// the look is the theme's. Without `## Links` → `Segmented: yes` the same run
// is separate pills; the grouper's stamp is the same either way.
describe("a choice run is segmented only when the theme says so", () => {
  const PILLS = THEME.replace("Segmented: yes\n", "");
  const CHOICE_RUN_PILLS =
    "*[S](agent:size?v=s&md2ui.choice=size)* | [M](agent:size?v=m&md2ui.choice=size) | " +
    "*[L](agent:size?v=l&md2ui.choice=size)*\n\n[Add to cart](agent:add?md2ui.commit=1)\n";
  /** The run's own fills, and each option's, under `theme`. */
  const look = (theme: string) => {
    const painted = paintMarkdown(CHOICE_RUN_PILLS, theme, 600);
    const entries = painted.painted.list.entries;
    const runs = find(painted.grouping, (n) => n.segmented_run === true);
    const options = ["S", "M", "L"].map((text) =>
      fillsOf(
        own(
          entries,
          find(painted.grouping, (n) => n.type === "link" && n.link_label === text)[0]?.node_id,
        ),
      ).map(colorOf),
    );
    return {
      segmented: painted.theme.links.segmented,
      runs: runs.length,
      surface: fillsOf(own(entries, runs[0]?.node_id)).map(colorOf),
      options,
    };
  };

  it("draws pills under a theme that does not ask", () => {
    expect(look(PILLS)).toEqual({
      segmented: false,
      runs: 1,
      surface: [],
      options: [["#f3f4f6ff"], ["#111827ff"], ["#f3f4f6ff"]],
    });
  });

  it("draws one control under a theme that does", () => {
    expect(look(THEME)).toEqual({
      segmented: true,
      runs: 1,
      surface: ["#f3f4f6ff"],
      options: [[], ["#111827ff"], []],
    });
  });

  it("takes the key from any block of the section", () => {
    const keyed = PILLS.replace("### Secondary\n", "### Secondary\nSegmented: yes\n");
    expect(look(keyed).segmented).toBe(true);
  });
});
