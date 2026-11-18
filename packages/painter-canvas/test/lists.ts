// Synthetic display lists for the painter's tests: entries with correct ink bounds, as
// the scene will compute them, and a long document for frame timing.
import type {
  DisplayEntry,
  DisplayList,
  FontSpec,
  HitTarget,
  PageBackground,
  Rect,
  Shape,
} from "@md2ui/contracts";

export const FONT: FontSpec = { families: ["sans-serif"], size: 16, weight: 400, italic: false };
const BOLD: FontSpec = { ...FONT, weight: 700 };

const NO_BACKGROUND: PageBackground = { paints: [], shadows: [] };

export function list(
  entries: readonly DisplayEntry[],
  targets: readonly HitTarget[] = [],
  size: { width: number; height: number } = { width: 400, height: 400 },
): DisplayList {
  return {
    version: 1,
    ...size,
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    centered: false,
    background: NO_BACKGROUND,
    entries,
    targets,
    anchors: [],
  };
}

function grow(r: Rect, d: number, dx = 0, dy = 0): Rect {
  return { x: r.x - d + dx, y: r.y - d + dy, width: r.width + 2 * d, height: r.height + 2 * d };
}

const box: Rect = { x: 60, y: 60, width: 120, height: 60 };
const rounded: Shape = { kind: "roundRect", radii: [12, 12, 12, 12], ...box };

/** The width of `text` in `font`, for test bounds only: the painter never measures. */
function advance(text: string, font: FontSpec): number {
  const ctx = new OffscreenCanvas(1, 1).getContext("2d");
  if (ctx === null) throw new Error("no 2d context");
  ctx.font = `${font.weight} ${font.size}px ${font.families.join(", ")}`;
  return ctx.measureText(text).width;
}

/** A text line's generous ink bounds: the runs' advance, an ascent and a descent. */
export function textBounds(x: number, y: number, width: number, size = FONT.size): Rect {
  return { x: x - 2, y: y - size * 1.2, width: width + 4, height: size * 1.6 };
}

/** One entry of every type, each with the ink bounds the contract documents. */
export function everyEntry(): readonly DisplayEntry[] {
  const helloWidth = advance("Hello ", FONT);
  const worldWidth = advance("world", BOLD);
  const runs = [
    { text: "Hello ", x: 60, font: FONT, color: "#202020ff" },
    { text: "world", x: 60 + helloWidth, font: BOLD, color: "#c02020ff" },
  ];
  return [
    {
      type: "shadow",
      nodeId: "shadow",
      bounds: grow(box, 8, 0, 4),
      shape: rounded,
      inner: false,
      offsetX: 0,
      offsetY: 4,
      color: "#00000066",
      radius: 16,
    },
    {
      type: "fill",
      nodeId: "fill",
      bounds: box,
      shape: rounded,
      paint: { kind: "color", color: "#3366ccff" },
    },
    {
      type: "stroke",
      nodeId: "stroke",
      bounds: grow(box, 2),
      shape: rounded,
      width: 4,
      color: "#000000ff",
    },
    {
      type: "line",
      nodeId: "line",
      bounds: { x: 60, y: 89, width: 120, height: 2 },
      x0: 60,
      y0: 90,
      x1: 180,
      y1: 90,
      width: 2,
      color: "#000000ff",
    },
    {
      type: "arc",
      nodeId: "arc",
      bounds: { x: 87, y: 57, width: 66, height: 66 },
      cx: 120,
      cy: 90,
      radius: 30,
      startAngle: -90,
      sweepAngle: 250,
      width: 6,
      color: "#5b4fc4ff",
    },
    {
      type: "text",
      nodeId: "text",
      bounds: textBounds(60, 90, helloWidth + worldWidth),
      y: 90,
      runs,
    },
    {
      type: "image",
      nodeId: "image",
      bounds: grow(box, 1),
      src: "missing.png",
      shape: { kind: "rect", ...box },
      fit: "auto",
      placeholder: { color: "#999999ff", label: null },
    },
    {
      type: "scroll",
      nodeId: "scroll",
      bounds: box,
      shape: rounded,
      contentWidth: 400,
      contentHeight: box.height,
      window: { ...box, y: box.y + 12, height: box.height - 24 },
      rest: 1,
      fade: "#f6f8faff",
      entries: [
        {
          type: "text",
          nodeId: "scroll",
          bounds: textBounds(70, 90, 300),
          y: 90,
          runs: [
            {
              text: "const answer = compute(the, many, arguments, here);",
              x: 70,
              font: FONT,
              color: "#202020ff",
            },
          ],
        },
      ],
    },
  ];
}

/**
 * A long document of `count` entries, in the proportions of a card page: per card a
 * shadow, a fill, a stroke, three text lines and a rule.
 */
export function longDocument(count: number, width = 1200): DisplayList {
  const entries: DisplayEntry[] = [];
  const columns = 3;
  const cardW = (width - 40 * (columns + 1)) / columns;
  const cardH = 140;
  let i = 0;
  for (let card = 0; entries.length < count; card++) {
    const x = 40 + (card % columns) * (cardW + 40);
    const y = 40 + Math.floor(card / columns) * (cardH + 40);
    const r: Rect = { x, y, width: cardW, height: cardH };
    const shape: Shape = { kind: "roundRect", radii: [14, 14, 14, 14], ...r };
    const id = `card-${card}`;
    entries.push(
      {
        type: "shadow",
        nodeId: id,
        bounds: grow(r, 12, 0, 6),
        shape,
        inner: false,
        offsetX: 0,
        offsetY: 6,
        color: "#0000002e",
        radius: 24,
      },
      { type: "fill", nodeId: id, bounds: r, shape, paint: { kind: "color", color: "#ffffffff" } },
      { type: "stroke", nodeId: id, bounds: grow(r, 0.5), shape, width: 1, color: "#e0e0e6ff" },
    );
    for (let line = 0; line < 3; line++) {
      const baseline = y + 36 + line * 26;
      entries.push({
        type: "text",
        nodeId: `${id}-t${line}`,
        bounds: textBounds(x + 20, baseline, cardW - 40),
        y: baseline,
        runs: [
          {
            text: `Line ${i++} of the card,`,
            x: x + 20,
            font: line === 0 ? BOLD : FONT,
            color: "#1a1a1aff",
          },
          { text: " with a second run", x: x + 180, font: FONT, color: "#5b4fc4ff" },
        ],
      });
    }
    entries.push({
      type: "line",
      nodeId: id,
      bounds: { x: x + 20, y: y + cardH - 25, width: cardW - 40, height: 2 },
      x0: x + 20,
      y0: y + cardH - 24,
      x1: x + cardW - 20,
      y1: y + cardH - 24,
      width: 1,
      color: "#d0d0d8ff",
    });
  }
  const rows = Math.ceil(entries.length / 7 / columns);
  return list(entries.slice(0, count), [], { width, height: 40 + rows * (cardH + 40) });
}
