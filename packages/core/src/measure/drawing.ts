// The size of a drawing element, a slider or a task control (md2ui
// `render_drawing_elements`: `slider_geometry`, `drawing_element_min_width`,
// `task_control_geometry`). A control has no text; its box comes from the theme alone.
import type { ResolvedTheme, TextMeasurer } from "@md2ui/contracts";
import { pyRound } from "../group/py/math.ts";
import { formatG } from "../group/py/str.ts";
import { type Face, fontOf } from "./font-set.ts";
import { type Props, resolveHAlign } from "./leaf-kit.ts";

/** A box a control is placed in: its slot, and the hints that align it. */
interface ControlBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly render_properties: Props | null;
}

/** The x of a `width`-wide control in `box`, per its alignment: md2ui's slack arithmetic. */
function alignedX(box: ControlBox, width: number, theme: ResolvedTheme): number {
  const align = resolveHAlign(box.render_properties, theme);
  const slack = Math.max(0, box.width - width);
  return box.x + (align === "right" ? slack : align === "center" ? slack / 2 : 0);
}

/** md2ui `SliderGeometry`, the fields sizing reads. */
interface SliderGeometry {
  readonly width: number;
  readonly height: number;
  readonly thickness: number;
  readonly handleSize: number;
}

/** md2ui `slider_geometry`. */
export function sliderGeometry(theme: ResolvedTheme): SliderGeometry {
  const sliders = theme.datapoints.sliders;
  const thickness = Math.max(1, sliders.thickness ?? (sliders.style === "thick" ? 85 : 10));
  const length = Math.max(thickness, sliders.length);
  const handleSize = sliders.style === "thick" ? sliders.drag_bar_length : sliders.circle_diameter;
  const cross = Math.max(thickness, handleSize);
  return sliders.axis === "vertical"
    ? { width: cross, height: length, thickness, handleSize }
    : { width: length, height: cross, thickness, handleSize };
}

/** md2ui `slider_size`: `[width, height]`. */
function sliderSize(theme: ResolvedTheme): readonly [number, number] {
  const g = sliderGeometry(theme);
  return [g.width, g.height];
}

/** A drawing element's payload, as the measurers read it. */
type Payload = Readonly<Record<string, unknown>> | null;

// A count's button diameter and its digits' size, as multiples of the body text size; one
// digit's slot at the digits' size, and the room either side of them (md2ui
// `render_counts`: `_BUTTON`, `_DIGITS`, `_DIGIT_WIDTH`, `_SIDE`).
const COUNT_BUTTON = 1.875;
export const COUNT_DIGITS = 1.2;
const COUNT_DIGIT_WIDTH = 0.62;
const COUNT_SIDE = 0.75;

/** md2ui `render_counts.is_count`: a slider the grouper stamped `count` (md2ui ADR-405). */
export function isCount(payload: Payload): boolean {
  return payload?.["kind"] === "slider" && Boolean(payload["count"]);
}

/**
 * md2ui `count_size`: the box a count is drawn in, `[width, height]`: two buttons and the
 * slot of its widest value. The theme's alone, so a value the user steps to moves no box.
 */
function countSize(payload: Payload, theme: ResolvedTheme): readonly [number, number] {
  const size = theme.text.font_size;
  const button = pyRound(size * COUNT_BUTTON);
  const digits = formatG(Number(payload?.["max"] ?? 0) || 0).length;
  const slot = digits * size * COUNT_DIGITS * COUNT_DIGIT_WIDTH + 2 * size * COUNT_SIDE;
  return [2 * button + slot, button];
}

/**
 * md2ui `count_rects`: the ➖ and ➕ buttons' rectangles in `box`, `[x, y, width, height]`
 * each, where the paint draws them and where a tap lands.
 */
export function countRects(
  box: ControlBox,
  payload: Payload,
  theme: ResolvedTheme,
): readonly [readonly [number, number, number, number], readonly [number, number, number, number]] {
  const [width, button] = countSize(payload, theme);
  const x = alignedX(box, width, theme);
  const y = box.y + Math.max(0, (box.height - button) / 2);
  return [
    [x, y, button, button],
    [x + width - button, y, button, button],
  ];
}

/** md2ui `leaf_slider_size`: the box a slider leaf is measured at, a count's or the theme's. */
export function leafSliderSize(payload: Payload, theme: ResolvedTheme): readonly [number, number] {
  return isCount(payload) ? countSize(payload, theme) : sliderSize(theme);
}

/** md2ui `task_control_size`: `[width, height]` (`task_control_geometry`). */
export function taskControlSize(theme: ResolvedTheme): readonly [number, number] {
  const controls = theme.datapoints.task_controls;
  const isSwitch = controls.type === "switch";
  const minimum = isSwitch ? 40 : 32;
  const size = Math.max(minimum, controls.size ?? minimum);
  return [isSwitch ? size * 2 : size, size];
}

/**
 * md2ui `task_control_rect`: where a task control is painted and clicked, `[x, y, width,
 * height]`.
 */
export function taskControlRect(
  box: ControlBox,
  theme: ResolvedTheme,
): readonly [number, number, number, number] {
  const [width, height] = taskControlSize(theme);
  return [
    alignedX(box, width, theme),
    box.y + Math.max(0, (box.height - height) / 2),
    width,
    height,
  ];
}

/**
 * md2ui `slider_rect`: the slider's outer rectangle in `box`, `[x, y, width, height]`,
 * its length along the axis capped at the box.
 */
export function sliderRect(
  box: ControlBox,
  theme: ResolvedTheme,
): readonly [number, number, number, number] {
  const g = sliderGeometry(theme);
  let { width, height } = g;
  if (theme.datapoints.sliders.axis === "vertical") {
    height = Math.max(g.thickness, Math.min(height, box.height));
  } else {
    width = Math.max(g.thickness, Math.min(width, box.width));
  }
  const ySlack = Math.max(0, box.height - height);
  return [alignedX(box, width, theme), box.y + ySlack / 2, width, height];
}

// md2ui `_SLIDER_MIN_LENGTH`: the shortest a horizontal slider is squeezed to.
const SLIDER_MIN_LENGTH = 96;

/**
 * md2ui `drawing_element_min_width`: a task control and a vertical slider are fixed
 * across; a horizontal slider may shrink to a floor.
 */
export function drawingElementMinWidth(payload: Payload, theme: ResolvedTheme): number {
  if (payload?.["kind"] !== "slider") return taskControlSize(theme)[0];
  if (isCount(payload)) return countSize(payload, theme)[0];
  const g = sliderGeometry(theme);
  if (theme.datapoints.sliders.axis === "vertical") return g.width;
  const cross = Math.max(g.thickness, g.handleSize);
  return Math.min(g.width, Math.max(cross, SLIDER_MIN_LENGTH));
}

/**
 * md2ui `drawing_element_baseline`: a control sits in a line of text, so it offers the
 * baseline a body line centred in its box would have; `null` when it is not drawn.
 */
export function drawingElementBaseline(
  payload: Payload,
  theme: ResolvedTheme,
  text: TextMeasurer,
  typeface: Face,
): number | null {
  let height: number;
  if (payload?.["kind"] === "slider" && theme.datapoints.sliders.enabled) {
    height = leafSliderSize(payload, theme)[1];
  } else if (theme.datapoints.task_controls.enabled) {
    height = taskControlSize(theme)[1];
  } else {
    return null;
  }
  const m = text.fontMetrics(fontOf(typeface, theme.text.font_size));
  return (height - (m.descent + m.ascent)) / 2 + m.ascent;
}
