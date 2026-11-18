// A count's own theme parameters, `### Count Button` under `## Drawing elements` (md2ui
// ADR-405; `tests/count_theme_tests.py`, on the sample
// `data/markdown/tests/count-theme-parameters`, inlined here). A count is a slider, so its
// round ➖/➕ buttons are one drawing-element layer each, painted as a slider handle is:
// keyed, they take the block's fill, stroke at its `Stroke align`, shadow and `Symbol
// color`, replaced on a coloured section as a handle's are, and a keyed button that
// cannot step is the same button at the default mute. Unkeyed, the count keeps the
// quieter button's paint (`choices-paint.test.ts` pins that).
import type {
  DisplayEntry,
  DisplayList,
  FillEntry,
  LayerEntry,
  ShadowEntry,
  StrokeEntry,
} from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { newTheme } from "../src/theme/model.ts";
import { parseTheme } from "../src/theme/parse.ts";
import { paintMarkdown } from "./scene-kit.ts";

const DOC = `Quantity: ➖ [2/9] ➕

Guests: ➖ [0/9] ➕

*[Pill](agent:pill)*

## On navy

Quantity: ➖ [2/9] ➕

*[Pill](agent:pill2)*
`;

const BASE = `## Styling & Spacing

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
Fill color: #111827
Corner radius: 18
Disabled fill color: #E5E7EB
Disabled text color: #6B7280

### Secondary
Fill color: #F3F4F6
Stroke width: 1
Stroke color: #9CA3AF
`;

const REPLACEMENTS = `
## Color Replacements
On background color: #1E3A8A
- Replacement: #FFFFFF
- Fill color: #FDE68A, Replacement: #34D399
- Stroke color: #B45309, Replacement: #FFFFFF
- Fill color: #F3F4F6, Replacement: #3B82F6

On background color: #34D399
- Text color: #78350F, Replacement: #064E3B

On background color: #3B82F6
- Text color: #111827, Replacement: #FFFFFF

On background color: #FFFFFF
- Text color: #FFFFFF, Replacement: #111827
`;

const KEYED = `${BASE}
## Drawing elements

### Sliders
Enabled: yes

### Count Button
Background color: #FDE68A
Stroke width: 3
Stroke color: #B45309
Stroke align: inside
Padding: 12
Outer shadow:
- Offset y: 3
- Color: #92400E
- Radius: 0
Symbol color: #78350F
${REPLACEMENTS}`;

const SYMBOL_ONLY = `${BASE}
## Drawing elements

### Count Button
Symbol color: #78350F
`;

const AMBER = "#fde68aff";
const BROWN = "#b45309ff";
const SIGN = "#78350fff";
const SECONDARY = "#f3f4f6ff";
/** A colour at md2ui's `MUTED_OPACITY` (0.4) of its alpha: 0.4 × 255 = 102 = 0x66. */
const muted = (c: string) => `${c.slice(0, 7)}66`;

const fillsOf = (list: readonly DisplayEntry[], id: string) =>
  list.filter((e): e is FillEntry => e.type === "fill" && e.nodeId === id);
const colorOf = (e: FillEntry) => (e.paint.kind === "color" ? e.paint.color : null);

/**
 * `entries` as they show: a layer's own, each colour at the layer's opacity of its alpha,
 * so a muted button reads `muted(c)` whether it is faded entry by entry or as one layer.
 */
function shown(entries: readonly DisplayEntry[]): DisplayEntry[] {
  return entries.flatMap((e) => {
    if (e.type !== "layer") return [e];
    const fade = (c: string) =>
      `${c.slice(0, 7)}${Math.round(Number.parseInt(c.slice(7), 16) * e.opacity)
        .toString(16)
        .padStart(2, "0")}`;
    return JSON.parse(
      JSON.stringify(shown(e.entries), (key, value) =>
        key === "color" && typeof value === "string" ? fade(value) : value,
      ),
    ) as DisplayEntry[];
  });
}

/** Each count's node id, top to bottom, and its buttons' fills, signs, strokes and shadows. */
function counts(list: DisplayList) {
  const entries = shown(list.entries);
  const ids = [...new Set(list.targets.map((t) => t.nodeId))].filter((id) =>
    entries.some((e) => e.type === "fill" && e.nodeId === id && e.shape.kind === "oval"),
  );
  return ids.map((id) => {
    const fills = fillsOf(entries, id);
    return {
      buttons: fills.filter((e) => e.shape.kind === "oval"),
      signs: fills.filter((e) => e.shape.kind === "roundRect").map(colorOf),
      strokes: entries.filter((e): e is StrokeEntry => e.type === "stroke" && e.nodeId === id),
      shadows: entries.filter((e): e is ShadowEntry => e.type === "shadow" && e.nodeId === id),
      layers: list.entries.filter((e): e is LayerEntry => e.type === "layer" && e.nodeId === id),
    };
  });
}

describe("### Count Button", () => {
  it("parses into the count theme, as a slider handle's block does", () => {
    const { button, symbol_color } = parseTheme(KEYED).datapoints.counts;
    expect(button.bg_colors).toEqual([0xfffde68a]);
    expect(button.stroke_align).toBe("inside");
    expect(button.stroke_width).toBe(3);
    expect(button.shadows).toHaveLength(1);
    expect(symbol_color).toBe(0xff78350f);
    // md2ui skips `Padding` in a drawing element's block.
    expect(button.padding).toEqual(newTheme().datapoints.counts.button.padding);
    const bare = parseTheme(BASE).datapoints.counts;
    expect(bare.button.bg_colors).toEqual([]);
    expect(bare.symbol_color).toBeNull();
  });

  const [quantity, guests, navy] = counts(paintMarkdown(DOC, KEYED, 600).painted.list);

  it("paints a keyed count's own button, stroke inside, shadow and sign", () => {
    expect(quantity?.buttons.map(colorOf)).toEqual([AMBER, AMBER]);
    const plus = quantity?.buttons[1]?.shape;
    const stroke = quantity?.strokes[1];
    expect(stroke).toMatchObject({ width: 3, color: BROWN });
    // `Stroke align: inside`: the outline is the button shrunk by half the width.
    expect(stroke?.shape).toMatchObject({
      kind: "oval",
      x: (plus?.x ?? 0) + 1.5,
      width: (plus?.width ?? 0) - 3,
    });
    expect(quantity?.shadows.map((s) => [s.color, s.offsetY, s.inner])).toEqual([
      ["#92400eff", 3, false],
      ["#92400eff", 3, false],
    ]);
    expect(quantity?.signs).toEqual([SIGN, SIGN, SIGN]);
  });

  it("replaces a keyed button on a coloured section as a handle's", () => {
    expect(navy?.buttons.map(colorOf)).toEqual(["#34d399ff", "#34d399ff"]);
    expect(navy?.strokes.map((s) => s.color)).toEqual(["#ffffffff", "#ffffffff"]);
    // The sign is replaced against the button's own, replaced, fill.
    expect(navy?.signs).toEqual(["#064e3bff", "#064e3bff", "#064e3bff"]);
  });

  it("mutes a keyed button that cannot step whole, its own paint at the default mute", () => {
    // Guests 0/9: ➖ cannot step; ➕ can.
    expect(guests?.buttons.map(colorOf)).toEqual([muted(AMBER), AMBER]);
    expect(guests?.strokes.map((s) => s.color)).toEqual([muted(BROWN), BROWN]);
    expect(guests?.shadows.map((s) => s.color)).toEqual([muted("#92400eff"), "#92400eff"]);
    expect(guests?.signs).toEqual([muted(SIGN), SIGN, SIGN]);
    // ➖ alone, as one layer: its sign over its fill hides it, as md2ui's `saveLayer` does.
    const [layer, ...more] = guests?.layers ?? [];
    expect(more).toEqual([]);
    expect(layer?.opacity).toBe(0.4);
    expect(layer?.entries.map((e) => e.type)).toEqual(["shadow", "fill", "stroke", "fill"]);
  });

  it("with Symbol color alone keeps the inherited paint, muted whole, and recolours the signs", () => {
    const [, zero] = counts(paintMarkdown(DOC, SYMBOL_ONLY, 600).painted.list);
    // Not the disabled fill (#E5E7EB): the quieter button's own paint, faded.
    expect(zero?.buttons.map(colorOf)).toEqual([muted(SECONDARY), SECONDARY]);
    expect(zero?.strokes.map((s) => s.color)).toEqual([muted("#9ca3afff"), "#9ca3afff"]);
    expect(zero?.signs).toEqual([muted(SIGN), SIGN, SIGN]);
  });

  it("without the keys keeps the quieter button's paint and its disabled paint", () => {
    const [, zero] = counts(paintMarkdown(DOC, BASE, 600).painted.list);
    expect(zero?.buttons.map(colorOf)).toEqual(["#e5e7ebff", SECONDARY]);
    expect(zero?.signs).toEqual(["#6b7280ff", "#111827ff", "#111827ff"]);
  });
});
