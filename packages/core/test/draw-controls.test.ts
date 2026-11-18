import type {
  DisplayEntry,
  FillEntry,
  ShadowEntry,
  SliderTarget,
  StrokeEntry,
} from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { cutOutline } from "../src/scene/draw/fills.ts";
import { paintMarkdown } from "./scene-kit.ts";

const THEME = `## Drawing elements
### Task controls
Type: checkbox
Size: 40
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
### Sliders
Style: line
Length: 200
Thickness: 10
Circle diameter: 20
### Slider Track
Background color: #D8D3FF
### Slider Bar
Background color: #7657F6
### Slider Handle
Background color: #111111
`;

const fills = (list: readonly DisplayEntry[], id?: string): FillEntry[] =>
  list.filter((e): e is FillEntry => e.type === "fill" && (id === undefined || e.nodeId === id));
/** A shape's numbers to 9 places: a track's edges add up off by a float's last bit. */
const rounded = (shape: object | undefined): object | undefined =>
  shape &&
  Object.fromEntries(
    Object.entries(shape).map(([k, v]) => [k, typeof v === "number" ? Number(v.toFixed(9)) : v]),
  );
const colorOf = (e: FillEntry): string => (e.paint.kind === "color" ? e.paint.color : "");

describe("task controls", () => {
  const md = "- [x] done\n- [ ] todo\n";
  const painted = paintMarkdown(md, THEME, 400);
  const list = painted.painted.list.entries;
  const ids = [...new Set(list.map((e) => e.nodeId))];
  const boxes = ids
    .map((id) => fills(list, id))
    .filter((f) => f.length === 2 && f[0]?.shape.width === 40 && f[0].shape.height === 40);

  it("paints an outer and an inner part per control, checked colours first", () => {
    expect(boxes.length).toBe(2);
    const [checked, unchecked] = boxes;
    expect(checked?.map(colorOf)).toEqual(["#dceee2ff", "#4f9c6bff"]);
    expect(unchecked?.map(colorOf)).toEqual(["#cfcfd6ff", "#fdfdfdff"]);
  });

  it("insets the inner part by the padding and rounds it by the outer radius less it", () => {
    const [outer, inner] = boxes[0] ?? [];
    expect(outer?.shape.kind).toBe("roundRect");
    expect(inner?.shape.x).toBe((outer?.shape.x ?? 0) + 5);
    expect(inner?.shape.width).toBe(30);
    expect(inner?.shape.kind).toBe("roundRect");
    if (inner?.shape.kind === "roundRect") expect(inner.shape.radii).toEqual([1, 1, 1, 1]);
  });

  it("slides a switch's knob to the far end when checked", () => {
    const sw = paintMarkdown(md, `${THEME}`.replace("Type: checkbox", "Type: switch"), 400);
    const parts = [...new Set(sw.painted.list.entries.map((e) => e.nodeId))]
      .map((id) => fills(sw.painted.list.entries, id))
      .filter((f) => f.length === 2 && f[0]?.shape.width === 80);
    expect(parts.length).toBe(2);
    const [on, off] = parts;
    const [onOuter, onKnob] = on ?? [];
    const [offOuter, offKnob] = off ?? [];
    expect(onKnob?.shape.x).toBe((onOuter?.shape.x ?? 0) + 80 - 5 - 30);
    expect(offKnob?.shape.x).toBe((offOuter?.shape.x ?? 0) + 5);
    expect(onKnob?.shape.width).toBe(30);
  });
});

describe("sliders", () => {
  const md = "Volume: [50%]\n";
  const sliderParts = (theme: string) => {
    const p = paintMarkdown(md, theme, 400);
    const list = p.painted.list.entries;
    const id = list.find((e) => e.type === "fill" && colorOf(e as FillEntry) === "#d8d3ffff")
      ?.nodeId as string;
    return { p, id, parts: fills(list, id) };
  };

  it("paints track, bar to the value, then the handle on the boundary", () => {
    const { parts } = sliderParts(THEME);
    expect(parts.map(colorOf)).toEqual(["#d8d3ffff", "#7657f6ff", "#111111ff"]);
    const [track, bar, handle] = parts;
    expect(track?.shape.width).toBe(200);
    expect(track?.shape.height).toBe(10);
    expect(bar?.shape.width).toBe(100);
    expect(bar?.shape.x).toBe(track?.shape.x);
    expect(handle?.shape.width).toBe(20);
    expect((handle?.shape.x ?? 0) + 10).toBe((track?.shape.x ?? 0) + 100);
    expect(bar?.clip?.kind).toBe("roundRect");
  });

  it("paints a vertical slider's fill from the bottom", () => {
    const { parts } = sliderParts(THEME.replace("Style: line", "Style: line\nAxis: vertical"));
    const [track, bar] = parts;
    expect(track?.shape.height).toBe(200);
    expect(bar?.shape.height).toBe(100);
    expect((bar?.shape.y ?? 0) + (bar?.shape.height ?? 0)).toBe(
      (track?.shape.y ?? 0) + (track?.shape.height ?? 0),
    );
  });

  describe("the drag bar sits inside the fill, its gap short of the value edge (md2ui 5dc29c60)", () => {
    // md2ui tests/slider_tests.py `_HANDLE_THEME`: a 100 x 40 track, a 20 x 4 drag bar.
    const thick = (axis: string, gap = "") =>
      "## Drawing elements\n### Sliders\nStyle: thick\n" +
      `Axis: ${axis}\nLength: 100\nThickness: 40\nDrag bar length: 20\nBar thickness: 4\n${gap}` +
      "### Slider Track\nBackground color: #D8D3FF\n### Slider Bar\nBackground color: #7657F6\n" +
      "### Slider Handle\nBackground color: #111111\n";
    /** The handle's span along the axis, relative to the track's start (its top when vertical). */
    const span = (value: number, axis: string, gap = ""): [number, number] => {
      const p = paintMarkdown(`Volume: [${value}%]\n`, thick(axis, gap), 400);
      const list = p.painted.list.entries;
      const id = list.find((e) => e.type === "fill" && colorOf(e as FillEntry) === "#d8d3ffff")
        ?.nodeId as string;
      const [track, , handle] = fills(list, id);
      if (track === undefined || handle === undefined) throw new Error("no slider painted");
      const [start, size] =
        axis === "vertical"
          ? [handle.shape.y - track.shape.y, handle.shape.height]
          : [handle.shape.x - track.shape.x, handle.shape.width];
      return [Number(start.toFixed(9)), Number((start + size).toFixed(9))];
    };

    it("ends the gap before the value edge horizontally, starts it after vertically", () => {
      // At 50 % the value edge is 50 along the track on both axes.
      expect(span(50, "horizontal")).toEqual([41, 45]);
      expect(span(50, "horizontal", "Drag bar gap: 8\n")).toEqual([38, 42]);
      expect(span(50, "vertical")).toEqual([55, 59]);
      expect(span(50, "vertical", "Drag bar gap: -3\n")).toEqual([50, 54]);
    });

    it("a fill too short for the gap and the bar keeps the bar at the track's start", () => {
      expect(span(1, "horizontal")).toEqual([0, 4]);
      expect(span(1, "vertical")).toEqual([96, 100]);
    });
  });

  describe("a bar's stroke and shadows trace the track cut at the value (md2ui 14937ec9)", () => {
    // md2ui data/markdown/tests/slider-bar-filled-shape, on a 200 x 10 track: the bar's
    // radius is 5, and an outside stroke 2 wide grows its outline by 1.
    const theme = THEME.replace(
      "### Slider Bar\nBackground color: #7657F6\n",
      "### Slider Bar\nBackground color: #7657F6\nStroke width: 2\nStroke color: #FF0000\n" +
        "Stroke align: outside\nOuter shadow:\n- Color: #333333\n- Radius: 6\n",
    );
    const bar = (md: string, axis = "") => {
      const p = paintMarkdown(md, theme.replace("Style: line", `Style: line${axis}`), 400);
      const list = p.painted.list.entries;
      const [track] = fills(list).filter((e) => colorOf(e) === "#d8d3ffff");
      const ofSlider = list.filter((e) => e.nodeId === track?.nodeId);
      return {
        track: track?.shape ?? { x: 0, y: 0, width: 0, height: 0 },
        shadow: ofSlider.find((e): e is ShadowEntry => e.type === "shadow"),
        stroke: ofSlider.find((e): e is StrokeEntry => e.type === "stroke"),
      };
    };

    it("rounds the fixed end and squares the value edge", () => {
      const { track, shadow, stroke } = bar("Volume: [50%]\n");
      const { x, y } = track;
      expect(rounded(shadow?.shape)).toEqual(
        rounded({
          kind: "roundRect",
          x,
          y,
          width: 100,
          height: 10,
          radii: [5, 0, 0, 5],
        }),
      );
      expect(shadow?.clip).toBeUndefined();
      expect(rounded(stroke?.shape)).toEqual(
        rounded({
          kind: "roundRect",
          x: x - 1,
          y: y - 1,
          width: 102,
          height: 12,
          radii: [6, 0, 0, 6],
        }),
      );
      expect(stroke?.clip).toBeUndefined();
    });

    it("cuts a vertical bar at its top", () => {
      const { track, stroke } = bar("Volume: [50%]\n", "\nAxis: vertical");
      expect(stroke?.shape).toMatchObject({
        kind: "roundRect",
        x: track.x - 1,
        width: 12,
        radii: [0, 0, 6, 6],
      });
      expect(stroke?.shape.y).toBeCloseTo(track.y + 100 - 1, 9);
      expect(stroke?.shape.height).toBeCloseTo(102, 9);
    });

    /** Each point a path's data names, in content space. */
    const pathPoints = (shape: object | undefined): [number, number][] => {
      if (shape === undefined || !("d" in shape)) throw new Error("not a path");
      const { x, y, d } = shape as { x: number; y: number; d: string };
      const numbers = [
        ...d.matchAll(/[ML]([-+.\de]+) ([-+.\de]+)|A(?:[-+.\de]+ ){5}([-+.\de]+) ([-+.\de]+)/gu),
      ];
      return numbers.map((m) => [x + Number(m[1] ?? m[3]), y + Number(m[2] ?? m[4])]);
    };
    /** How far `p` lies from the outline of `box` rounded by `r` (0 on it). */
    const offOutline = (
      box: { x: number; y: number; width: number; height: number },
      r: number,
      [px, py]: [number, number],
    ) => {
      const qx = Math.abs(px - (box.x + box.width / 2)) - (box.width / 2 - r);
      const qy = Math.abs(py - (box.y + box.height / 2)) - (box.height / 2 - r);
      return Math.abs(
        Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r,
      );
    };

    it("a value inside the fixed end's corners keeps the exact slice of its cap", () => {
      // 1% of 200 is 2 px, inside the 5 px radius: once a smaller radius, now the arc itself.
      const { track, shadow, stroke } = bar("Volume: [1%]\n");
      expect(shadow?.shape).toMatchObject({ kind: "path", x: track.x, y: track.y });
      expect(rounded(shadow?.shape)).toMatchObject({ width: 2, height: 10 });
      const h = Math.sqrt(25 - 9);
      const expected = [
        [2, 5 - h],
        [2, 5 + h],
        [0, 5],
        [0, 5],
        [2, 5 - h],
      ];
      const points = pathPoints(shadow?.shape);
      expect(points).toHaveLength(expected.length);
      points.forEach(([px, py], k) => {
        expect(px - track.x).toBeCloseTo(expected[k]?.[0] ?? Number.NaN, 9);
        expect(py - track.y).toBeCloseTo(expected[k]?.[1] ?? Number.NaN, 9);
      });
      // The outside stroke traces the same cut grown by 1 px: radius 6, 3 px kept.
      expect(stroke?.shape.kind).toBe("path");
      const grown = { x: track.x - 1, y: track.y - 1, width: 202, height: 12 };
      for (const point of pathPoints(stroke?.shape)) {
        const onCut = Math.abs(point[0] - (track.x + 2)) < 1e-9;
        expect(onCut || offOutline(grown, 6, point) < 1e-9).toBe(true);
      }
    });

    it("a value inside the far end's corners follows its arcs to the value edge, either axis", () => {
      for (const axis of ["", "\nAxis: vertical"]) {
        const { track, shadow } = bar("Volume: [99%]\n", axis);
        expect(shadow?.shape.kind).toBe("path");
        const points = pathPoints(shadow?.shape);
        // Corners of the fixed end, the arcs' ends, and two points on the value edge.
        expect(points).toHaveLength(9);
        const edge = axis === "" ? track.x + 198 : track.y + 2;
        const onEdge = points.filter(([px, py]) => Math.abs((axis === "" ? px : py) - edge) < 1e-9);
        expect(onEdge).toHaveLength(2);
        for (const point of points) expect(offOutline(track, 5, point)).toBeLessThan(1e-9);
      }
    });

    it("a full bar whose radius rounds a float past half its thickness is still its track", () => {
      // An outside stroke grows the box and the radius apart: 2 × (20.1 + 1.5) and 40.2 + 3
      // may differ in their last bit.
      const box = { x: 0, y: 0, width: 300, height: 40.2 + 3 };
      const radius = (box.height / 2) * (1 + 1e-15);
      expect(cutOutline(box, radius, box)).toMatchObject({ kind: "roundRect", ...box });
    });

    it("is the whole track's shape when full", () => {
      const { track, shadow, stroke } = bar("Volume: [100%]\n");
      expect(rounded(shadow?.shape)).toEqual(
        rounded({ ...track, kind: "roundRect", radii: [5, 5, 5, 5] }),
      );
      expect(rounded(stroke?.shape)).toEqual(
        rounded({
          kind: "roundRect",
          x: track.x - 1,
          y: track.y - 1,
          width: 202,
          height: 12,
          radii: [6, 6, 6, 6],
        }),
      );
    });
  });

  it("moves only the slider's entries when the host drags it", () => {
    const { p, id } = sliderParts(THEME);
    const before = p.painted.list;
    const slider = p.painted.list.targets.find(
      (t): t is SliderTarget => t.kind === "slider" && t.nodeId === id,
    );
    const after = p.painted.withStates(
      new Map([[slider?.ordinal ?? -1, { kind: "value", value: 25 }]]),
    );
    expect(after.entries.length).toBe(before.entries.length);
    after.entries.forEach((e, i) => {
      const old = before.entries[i] as DisplayEntry;
      if (e.nodeId === id && e.type === "fill") return;
      expect(e).toEqual(old);
    });
    const bar = fills(after.entries, id)[1];
    expect(bar?.shape.width).toBe(50);
    expect(after.targets).toEqual(before.targets);
    for (const e of fills(after.entries, id)) {
      expect(e.bounds.width).toBeGreaterThanOrEqual(e.shape.width - 1e-9);
    }
  });
});
