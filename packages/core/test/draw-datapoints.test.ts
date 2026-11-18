// Datapoint displays painted: a ratio bar and a Key Value bar (track, then fill), a chart's
// rows and its vertical bars with their legend, a ring's arc, and a split date chip. The
// section painters are called directly, with a hand-made section box, as the lead's
// section pass will call them.
import type { DisplayEntry } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { sectionBox } from "../src/scene/backgrounds.ts";
import type { SectionBox } from "../src/scene/boxes.ts";
import type { Draw } from "../src/scene/draw/context.ts";
import { drawDateChip, drawRingArc } from "../src/scene/draw/datapoints.ts";
import { pen } from "../src/scene/draw/pen.ts";
import { type Painted, paintMarkdown } from "./scene-kit.ts";

const ZERO = { top: 0, left: 0, right: 0, bottom: 0 };

/** The entries of `p` that are not text, with their geometry reduced to what is asserted. */
const inks = (p: Painted) => p.painted.list.entries.filter((e) => e.type !== "text");

/** A fill's rect and colour. */
function rects(entries: readonly DisplayEntry[]) {
  return entries.flatMap((e) =>
    e.type === "fill" && e.paint.kind === "color"
      ? [{ x: e.shape.x, y: e.shape.y, w: e.shape.width, h: e.shape.height, color: e.paint.color }]
      : [],
  );
}

/** Every entry's bounds contain the geometry it draws. */
function expectBoundsHold(entries: readonly DisplayEntry[]): void {
  for (const e of entries) {
    if (e.type === "fill" || e.type === "stroke") {
      const s = e.shape;
      expect(e.bounds.x).toBeLessThanOrEqual(s.x + 1e-9);
      expect(e.bounds.y).toBeLessThanOrEqual(s.y + 1e-9);
      expect(e.bounds.x + e.bounds.width).toBeGreaterThanOrEqual(s.x + s.width - 1e-9);
      expect(e.bounds.y + e.bounds.height).toBeGreaterThanOrEqual(s.y + s.height - 1e-9);
    }
    if (e.type === "arc") {
      expect(e.bounds.x).toBeLessThanOrEqual(e.cx - e.radius);
      expect(e.bounds.x + e.bounds.width).toBeGreaterThanOrEqual(e.cx + e.radius);
    }
  }
}

/** A `Draw` over a painted document's sizer, and a pen recording into `out`. */
function drawOf(painted: Painted, out: DisplayEntry[]) {
  const { sizer } = painted;
  const d: Draw = {
    sizer,
    sized: sizer.index,
    nodes: new Map(),
    pins: new Map(),
    highlight: null,
    choices: new Map(),
    segments: new Map(),
  };
  return { d, p: pen(out, "", sizer.leaves.text) };
}

test("a ratio bar is its track and a fill of the fraction, centred in its row", () => {
  const painted = paintMarkdown(
    "# T\n\n4/8\n",
    "## Drawing elements\n### Ratio Bars\nThickness: 10\n",
  );
  const box = painted.scene.boxes.find((b) => b.render_properties?.["datapoint_bar"]);
  expect(box).toBeDefined();
  if (box === undefined) return;
  const [track, fill] = rects(inks(painted));
  const y = box.y + (box.height - 10) / 2;
  expect(track).toEqual({ x: box.x, y, w: box.width, h: 10, color: "#e5e5e5ff" });
  expect(fill).toEqual({ x: box.x, y, w: box.width / 2, h: 10, color: "#222222ff" });
  expectBoundsHold(inks(painted));
});

test("a Key Value percent bar fills its percent of the box", () => {
  const painted = paintMarkdown("# T\n\nQuality: 50%\n");
  const bar = painted.scene.boxes.find((b) => b.render_properties?.["datapoint_bar"]);
  const [track, fill] = rects(inks(painted));
  expect(track?.w).toBe(bar?.width);
  expect(fill?.w).toBeCloseTo((bar?.width ?? 0) / 2, 9);
  expect(fill?.h).toBe(track?.h);
});

test("a chart draws a track and a bar per row, scaled against 100", () => {
  const painted = paintMarkdown(
    "# T\n\n- Jan: 90%\n- Feb: 40%\n- Mar: 70%\n",
    "## Charts\nBar thickness: 18\n",
    600,
  );
  const chart = painted.scene.boxes.find((b) => b.render_properties?.["chart"]);
  const all = rects(inks(painted));
  const tracks = all.filter((r) => r.color === "#e5e5e5ff");
  const bars = all.filter((r) => r.color === "#222222ff");
  expect(tracks.map((r) => r.w)).toEqual([600, 600, 600]);
  expect(bars.map((r) => r.w)).toEqual([540, 240, 420]);
  // A row is its label line, 4, and a track; rows sit 12 apart.
  const line = painted.theme.labels.font_size * 1.4;
  const rowH = line + 4 + 18;
  tracks.forEach((r, i) => {
    expect(r.y).toBeCloseTo((chart?.y ?? 0) + line + 4 + i * (rowH + 12), 9);
  });
  const texts = painted.painted.list.entries.filter((e) => e.type === "text");
  const values = texts.flatMap((e) => e.runs.map((r) => r.text)).filter((t) => t.endsWith("%"));
  expect(values).toEqual(["90%", "40%", "70%"]);
  expectBoundsHold(inks(painted));
});

test("a five-row two-series chart draws a legend and vertical bars in series colours", () => {
  const painted = paintMarkdown(
    "# T\n\nSales, Costs:\n- Jan: 90%, 10%\n- Feb: 40%, 20%\n- Mar: 70%, 30%\n- Apr: 70%, 30%\n- May: 70%, 30%\n",
    "## Charts\nBar thickness: 18\nBar width: fill\n",
    600,
  );
  const entries = painted.painted.list.entries;
  const dots = entries.filter((e) => e.type === "fill" && e.shape.kind === "oval");
  expect(dots).toHaveLength(2);
  const legend = entries.flatMap((e) => (e.type === "text" ? e.runs.map((r) => r.text) : []));
  expect(legend).toContain("Sales");
  expect(legend).toContain("Costs");
  const bars = rects(entries).filter((r) => r.w > 20);
  expect(bars).toHaveLength(10);
  // A 90% bar is 140 * 0.9 tall; a 10% one is floored at the bar thickness.
  expect(bars[0]).toMatchObject({ h: 126, color: "#222222ff" });
  expect(bars[1]).toMatchObject({ h: 18, color: "#8c8c8cff" });
  // Bars rest on the base line, 140 below the legend.
  const base = (bars[0]?.y ?? 0) + (bars[0]?.h ?? 0);
  expect(bars.every((b) => Math.abs(b.y + b.h - base) < 1e-9)).toBe(true);
  expectBoundsHold(inks(painted));
});

test("a bar's thickness stub never leaves its track (md2ui d07d6999)", () => {
  // The bar's box is 769.5 wide; a 375 padding leaves an inner track 19.5 wide, narrower
  // than the bar is thick, so the 1/8 fill's 30px floor is capped at 19.5.
  const bar = paintMarkdown(
    "# T\n\n1/8\n",
    "## Drawing elements\n### Ratio Bars\nThickness: 30\n### Ratio Bar Track\nPadding: 375\n",
  );
  const [, fill] = rects(inks(bar));
  expect(fill).toMatchObject({ x: 375, w: 19.5 });
  // A chart row's twin: 600 less 2 x 290 is 20.
  const chart = paintMarkdown(
    "# T\n\n- Jan: 1%\n- Feb: 2%\n- Mar: 3%\n",
    "## Charts\nBar thickness: 30\n### Chart Track\nPadding: 290\n",
    600,
  );
  const fills = rects(inks(chart)).filter((r) => r.color === "#222222ff");
  expect(fills.map((r) => [r.x, r.w])).toEqual([
    [290, 20],
    [290, 20],
    [290, 20],
  ]);
});

test("a ring is a stroked track and a round arc sweeping its fraction from 12 o'clock", () => {
  const painted = paintMarkdown(
    "# T\n",
    "## Drawing elements\n### Ring\nThickness: 12\nBackground color: #00CC58\n### Ring Track\nBackground color: #E5F9EE\n",
  );
  const out: DisplayEntry[] = [];
  const { d, p } = drawOf(painted, out);
  const sbox = sectionBox(10, 20, 132, 132, 0, ZERO, "ring", { ring: { value: 25, max: 100 } });
  drawRingArc(d, sbox, p);
  const [track, arc] = out;
  expect(track).toMatchObject({
    type: "stroke",
    width: 12,
    color: "#e5f9eeff",
    shape: { kind: "oval", x: 16, y: 26, width: 120, height: 120 },
  });
  expect(arc).toMatchObject({
    type: "arc",
    cx: 76,
    cy: 86,
    radius: 60,
    startAngle: -90,
    sweepAngle: 90,
    width: 12,
    color: "#00cc58ff",
  });
  expectBoundsHold(out);
  // An empty ring is its track alone.
  const none: DisplayEntry[] = [];
  drawRingArc(
    d,
    sectionBox(0, 0, 50, 80, 0, ZERO, "ring", { ring: { value: 0, max: 10 } }),
    drawOf(painted, none).p,
  );
  expect(none.map((e) => e.type)).toEqual(["stroke"]);
  expect(none[0]).toMatchObject({ shape: { width: 2 * ((50 - 12) / 2) } });
});

test("a split date chip paints its base, then a key region over a day region", () => {
  const theme =
    "## Drawing elements\n### Dates\nBackground color: #F0EDF7\nFill: split\nCorner radius: 10\n" +
    "### Date Key\nBackground color: #112233\n- Font size: 11\n" +
    "### Date Day\nBackground color: #445566\n- Font size: 28\n";
  const painted = paintMarkdown("# T\n", theme);
  const out: DisplayEntry[] = [];
  const { d, p } = drawOf(painted, out);
  const sbox: SectionBox = sectionBox(5, 50, 28, 78, 0, ZERO, "date_chip");
  const strokes: ((q: typeof p) => void)[] = [];
  drawDateChip(d, sbox, p, strokes);
  expect(out).toHaveLength(3);
  const [base, key, day] = out;
  expect(base).toMatchObject({ type: "fill", paint: { color: "#f0edf7ff" } });
  // The regions meet where the two text cells' heights divide the chip: 11 : 28.
  const split = 50 + 78 * (11 / 39);
  expect(key).toMatchObject({
    type: "fill",
    shape: { kind: "roundRect", y: 50, height: split - 50, radii: [10, 10, 0, 0] },
    paint: { color: "#112233ff" },
  });
  expect(day).toMatchObject({
    type: "fill",
    shape: { kind: "roundRect", y: split, height: 128 - split, radii: [0, 0, 10, 10] },
    paint: { color: "#445566ff" },
  });
  expect(strokes).toHaveLength(0);
  expectBoundsHold(out);
});
