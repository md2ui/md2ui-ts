// A choice run drawn as one segmented control, and a count as its digits between two
// round buttons (md2ui ADR-405: `render_segmented`, `render_counts.draw_count`), painted
// through the whole pipeline with the fake measurer.
import type {
  DisplayEntry,
  FillEntry,
  GroupingNode,
  HostState,
  LineEntry,
  Rect,
  StrokeEntry,
  TextEntry,
} from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { paintMarkdown } from "./scene-kit.ts";

const THEME = `## Text Styles
Links
- Font color: #FFFFFF

Links Secondary
- Font color: #333333

## Links
Segmented: yes
Fill color: #26262B
Corner radius: 20
Disabled fill color: #EEEEF0
Disabled text color: #96969D

### Secondary
Fill color: #F2F2F3
Stroke width: 1
Stroke color: #E8E8EC

## Drawing elements
### Sliders
Style: line
`;
const NO_SLIDERS = `${THEME}Enabled: no\n`;

const PRIMARY = "#26262bff";
const SECONDARY = "#f2f2f3ff";
const DISABLED = "#eeeef0ff";

const option = (label: string, name: string | null) =>
  `[${label}](agent:size?v=${label.toLowerCase()}${name === null ? "" : `&md2ui.choice=${name}`})`;
const run = (name: string | null) =>
  `${option("S", name)} | *${option("M", name)}* | *${option("L", name)}*`;
const DOC = `_Size_\n\n${run("size")}\n\nQuantity: ➖ [0/9] ➕\n`;

const fills = (list: readonly DisplayEntry[], id?: string) =>
  list.filter((e): e is FillEntry => e.type === "fill" && (id === undefined || e.nodeId === id));
const lines = (list: readonly DisplayEntry[]) =>
  list.filter((e): e is LineEntry => e.type === "line");
const colorOf = (e: FillEntry | undefined) => (e?.paint.kind === "color" ? e.paint.color : null);

/** The node the grouper stamped `segmented_run`, if any. */
function segmentedRun(node: GroupingNode): GroupingNode | null {
  if (node.segmented_run) return node;
  for (const child of node.children) {
    const found = segmentedRun(child);
    if (found !== null) return found;
  }
  return null;
}

/** Each target's rect by ordinal: an option's is its pill, a count's its two buttons. */
function rects(list: { readonly targets: readonly unknown[] }, ordinal: number): Rect[] {
  return (list.targets as { ordinal?: number; rect: Rect }[])
    .filter((t) => t.ordinal === ordinal)
    .map((t) => t.rect);
}

/** md2ui `paint_segmented`'s divider x between pills `a` and `b`. */
const between = (a: Rect, b: Rect) => (a.x + a.width + b.x) / 2;

/** md2ui's radio: the chosen ordinal checked, every other option of the group not. */
const choose = (chosen: number): Map<number, HostState> =>
  new Map([0, 1, 2].map((o) => [o, { kind: "checked", checked: o === chosen }]));

describe("a segmented run", () => {
  const painted = paintMarkdown(DOC, THEME, 800);
  const { list } = painted.painted;
  const group = segmentedRun(painted.grouping);
  const [s, m, l] = [0, 1, 2].map((o) => rects(list, o)[0] as Rect);

  it("paints the quieter button's surface around the run, under every box", () => {
    expect(group).not.toBeNull();
    const surface = fills(list.entries, group?.node_id);
    expect(surface).toHaveLength(1);
    const shape = surface[0]?.shape;
    expect(colorOf(surface[0])).toBe(SECONDARY);
    expect(shape).toMatchObject({
      kind: "roundRect",
      x: (s as Rect).x - 3,
      width: (l as Rect).x + (l as Rect).width + 3 - ((s as Rect).x - 3),
      radii: [23, 23, 23, 23],
    });
    const stroke = list.entries.filter(
      (e): e is StrokeEntry => e.type === "stroke" && e.nodeId === group?.node_id,
    );
    expect(stroke.map((e) => [e.width, e.color])).toEqual([[1, "#e8e8ecff"]]);
    // Above nothing a button paints: the first entry of any option comes after it.
    const at = list.entries.indexOf(surface[0] as DisplayEntry);
    const firstOption = list.entries.findIndex((e) => e.nodeId === group?.children[0]?.node_id);
    expect(at).toBeLessThan(firstOption);
  });

  it("draws the chosen option's own pill and the others as labels, a divider between two unchosen", () => {
    const [sId, mId, lId] = (group?.children ?? []).map((k) => k.node_id);
    expect(fills(list.entries, sId).map(colorOf)).toContain(PRIMARY);
    expect(fills(list.entries, mId)).toEqual([]);
    expect(fills(list.entries, lId)).toEqual([]);
    const label = list.entries.find((e): e is TextEntry => e.type === "text" && e.nodeId === mId);
    expect(label?.runs[0]?.color).toBe("#333333ff");
    const dividers = lines(list.entries);
    expect(dividers.map((d) => d.x0)).toEqual([between(m as Rect, l as Rect)]);
    expect(dividers[0]?.color).toBe("#33333355");
    expect(dividers[0]?.width).toBe(1);
  });

  it("moves the divider and the main pill to the option the host shows chosen", () => {
    const [sId, , lId] = (group?.children ?? []).map((k) => k.node_id);
    const shown = painted.painted.withStates(choose(2)).entries;
    expect(lines(shown).map((d) => d.x0)).toEqual([between(s as Rect, m as Rect)]);
    expect(fills(shown, lId).map(colorOf)).toContain(PRIMARY);
    expect(fills(shown, sId)).toEqual([]);
    const label = shown.find((e): e is TextEntry => e.type === "text" && e.nodeId === sId);
    expect(label?.runs[0]?.color).toBe("#333333ff");
    // The surface stays where it was: a tap moves colours, never a box.
    expect(fills(shown, group?.node_id)).toEqual(fills(list.entries, group?.node_id));
  });

  it("is not drawn for a ` | ` run of buttons that share no choice name", () => {
    const plain = paintMarkdown(`${run(null)}\n`, THEME, 800);
    expect(segmentedRun(plain.grouping)).toBeNull();
    const entries = plain.painted.list.entries;
    expect(lines(entries)).toEqual([]);
    // Its secondary buttons keep their own pills; nothing paints the surface's 3px-wider corner.
    const radii = fills(entries).map((e) => (e.shape.kind === "roundRect" ? e.shape.radii[0] : 0));
    expect(radii).toContain(20);
    expect(radii).not.toContain(23);
  });
});

describe("a count", () => {
  const painted = paintMarkdown(DOC, THEME, 800);
  const { list } = painted.painted;
  const [minus, plus] = rects(list, 3) as [Rect, Rect];
  const countId = (
    list.targets.find((t) => "ordinal" in t && t.ordinal === 3) as { nodeId: string }
  ).nodeId;

  it("paints two round buttons, ➖ disabled at 0, its signs and its digits between them", () => {
    const own = fills(list.entries, countId);
    const ovals = own.filter((e) => e.shape.kind === "oval");
    expect(ovals.map((e) => [e.shape.x, e.shape.y, e.shape.width])).toEqual([
      [minus.x, minus.y, minus.width],
      [plus.x, plus.y, plus.width],
    ]);
    expect(ovals.map(colorOf)).toEqual([DISABLED, SECONDARY]);
    // A round-capped stroke per arm: one for ➖, two for ➕, in each button's ink.
    const signs = own.filter((e) => e.shape.kind === "roundRect");
    expect(signs.map(colorOf)).toEqual(["#96969dff", "#333333ff", "#333333ff"]);
    const w = Math.max(1.5, minus.width / 15);
    expect(signs[0]?.shape).toMatchObject({
      x: minus.x + minus.width / 2 - minus.width * 0.22 - w / 2,
      height: w,
      radii: [w / 2, w / 2, w / 2, w / 2],
    });
    const digits = list.entries.filter(
      (e): e is TextEntry => e.type === "text" && e.nodeId === countId,
    );
    expect(digits.map((e) => e.runs.map((r) => r.text).join(""))).toEqual(["0"]);
    const run = digits[0]?.runs[0];
    expect(run?.font.weight).toBe(700);
    expect(run?.x).toBeGreaterThan(minus.x + minus.width);
    expect((run?.x ?? 0) + (digits[0]?.bounds.width ?? 0)).toBeLessThan(plus.x);
  });

  it("shows the host's value: ➖ live once it can step down", () => {
    const shown = painted.painted.withStates(new Map([[3, { kind: "value", value: 4 }]])).entries;
    const ovals = fills(shown, countId).filter((e) => e.shape.kind === "oval");
    expect(ovals.map(colorOf)).toEqual([SECONDARY, SECONDARY]);
    const digits = shown.find((e): e is TextEntry => e.type === "text" && e.nodeId === countId);
    expect(digits?.runs[0]?.text).toBe("4");
  });

  it("paints nothing, neither a control nor its text, when sliders are disabled", () => {
    const off = paintMarkdown(DOC, NO_SLIDERS, 800);
    expect(off.theme.datapoints.sliders.enabled).toBe(false);
    const ids = new Set(off.painted.list.entries.map((e) => e.nodeId));
    expect(ids.has(countId)).toBe(false);
  });
});
