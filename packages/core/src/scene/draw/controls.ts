// The two non-text drawing elements: a slider and a task control (md2ui
// `render_drawing_elements.draw_slider`, `draw_task_control`). Their geometry is
// `measure/drawing.ts`, the very rectangle sizing and the click regions use; what is
// decided here is the paint: which style fills which part, and where the value falls.
import type { Argb, ResolvedTheme, SectionStyle } from "@md2ui/contracts";
import {
  sliderGeometry,
  sliderRect,
  taskControlRect,
  taskControlSize,
} from "../../measure/drawing.ts";
import { GREY_INK, GREY_LIGHT, GREY_MID, GREY_TRACK, GREY_WHITE } from "../../theme/model.ts";
import { sectionIsActive } from "../../theme/query.ts";
import { opaque, pushBg, replaceColor } from "../backgrounds.ts";
import type { BgStack } from "../boxes.ts";
import { rotationSlot } from "./colors.ts";
import { type BoxDrawer, type Draw, nodesOf } from "./context.ts";
import { type PartStyle, paintPart, type Subject } from "./element-paint.ts";
import { cutOutline, shadows, strokeOutline } from "./fills.ts";
import { type Box, type Pen, roundShape } from "./pen.ts";
import { glyphRun } from "./text.ts";

/** md2ui `SectionStyle(bg_colors=[color])`: a part's fallback, nothing else set. */
const plainStyle = (color: Argb): PartStyle => ({
  bg_colors: [color],
  bg_image: null,
  gradient: null,
  shadows: [],
  stroke_width: 0,
  stroke_color: null,
  stroke_align: "center",
  corner_radius: 0,
  corner_radius_authored: false,
});

/**
 * md2ui `_slider_radius`: a part's corner radius, an authored one first, then the
 * slider's, then a full cap; never more than half of `thickness`.
 */
function sliderRadius(theme: ResolvedTheme, style: PartStyle, thickness: number): number {
  const half = thickness / 2;
  if (style.corner_radius_authored) return Math.max(0, Math.min(style.corner_radius, half));
  return Math.max(0, Math.min(theme.datapoints.sliders.corner_radius ?? half, half));
}

/**
 * md2ui `_slider_track_rect`: the track, centred across the slider's outer rectangle
 * (`sliderRect`) and as long as it.
 */
function sliderTrack(box: Parameters<typeof sliderRect>[0], theme: ResolvedTheme): Box {
  const { thickness } = sliderGeometry(theme);
  const [x, y, width, height] = sliderRect(box, theme);
  return theme.datapoints.sliders.axis === "vertical"
    ? { x: x + (width - thickness) / 2, y, width: thickness, height }
    : { x, y: y + (height - thickness) / 2, width, height: thickness };
}

/**
 * md2ui `_paint_slider_bar`: the bar as one shape, the rounded track cut at the value.
 * The fixed end keeps the track's cap and the moving edge is square, even while the value
 * is narrower than the radius. Its colour, image and gradient fill the value-sized rect
 * clipped to the track, and its shadows and stroke trace the cut shape, so the outline
 * closes at the value edge. A full bar is the track's own shape.
 */
function paintSliderBar(
  p: Pen,
  inner: Box,
  fill: Box,
  radius: number,
  style: PartStyle,
  who: Subject,
  stack: BgStack,
): void {
  if (fill.width <= 0 || fill.height <= 0) return;
  const bar = cutOutline(inner, radius, fill);
  shadows(p, bar, style.shadows, false);
  paintPart(p, fill, 0, { ...style, shadows: [], stroke_width: 0 }, who, stack, {
    clip: roundShape(inner, radius),
  });
  shadows(p, bar, style.shadows, true);
  if (style.stroke_width > 0 && style.stroke_color !== null) {
    const stroke = replaceColor(style.stroke_color, stack, who.theme, "stroke");
    strokeOutline(p, inner, radius, style.stroke_width, stroke, style.stroke_align, {
      within: fill,
    });
  }
}

/** md2ui `draw_slider`'s fallback colours when the theme styles no part of a kind. */
function sliderDefaults(thick: boolean): readonly [PartStyle, PartStyle, PartStyle] {
  return thick
    ? [plainStyle(GREY_INK), plainStyle(GREY_WHITE), plainStyle(GREY_MID)]
    : [plainStyle(GREY_TRACK), plainStyle(GREY_INK), plainStyle(GREY_INK)];
}

/** md2ui `draw_slider.resolved`: the style, or its colour fallback when it paints nothing. */
const withFallback = (style: SectionStyle, fallback: PartStyle): PartStyle =>
  style.bg_colors.length > 0 || style.bg_image !== null || style.gradient !== null
    ? style
    : { ...style, bg_colors: fallback.bg_colors };

/**
 * md2ui `draw_slider`: a themed slider from its numeric payload — the track, the progress
 * bar to the value (of the document's own maximum), and the handle on the boundary.
 */
export const drawSlider: BoxDrawer = (d, box, p) => {
  const found = nodesOf(d, box);
  if (found === null) return;
  const { theme } = d.sizer;
  const sliders = theme.datapoints.sliders;
  const geometry = sliderGeometry(theme);
  const payload = found.sized.drawing_element;
  const maximum = Number(payload?.["max"] || 100);
  const value = Math.min(maximum, Math.max(0, Number(payload?.["value"] ?? 0)));
  const { index, chain } = rotationSlot(found.node, theme);
  const who: Subject = { slot: index, chain, theme };
  const [defaultTrack, defaultBar, defaultHandle] = sliderDefaults(sliders.style === "thick");
  const trackStyle = withFallback(sliders.track, defaultTrack);
  const barStyle = withFallback(sliders.bar, defaultBar);
  const handleStyle = withFallback(sliders.handle, defaultHandle);

  const inner = sliderTrack(box, theme);
  const trackFill = paintPart(
    p,
    inner,
    sliderRadius(theme, trackStyle, geometry.thickness),
    trackStyle,
    who,
    box.bg_stack,
  );
  const innerStack = pushBg(box.bg_stack, opaque(trackFill));
  const ratio = value / maximum;
  const vertical = sliders.axis === "vertical";
  const innerBottom = inner.y + inner.height;
  const boundary = vertical ? innerBottom - inner.height * ratio : inner.x + inner.width * ratio;
  const fill: Box = vertical
    ? { x: inner.x, y: boundary, width: inner.width, height: innerBottom - boundary }
    : { x: inner.x, y: inner.y, width: boundary - inner.x, height: inner.height };
  paintSliderBar(
    p,
    inner,
    fill,
    sliderRadius(theme, barStyle, Math.min(inner.width, inner.height)),
    barStyle,
    who,
    innerStack,
  );

  const centerX = inner.x + inner.width / 2;
  const centerY = inner.y + inner.height / 2;
  let handle: Box;
  let radius: number;
  if (sliders.style === "line") {
    const diameter = sliders.circle_diameter;
    handle = vertical
      ? { x: centerX - diameter / 2, y: boundary - diameter / 2, width: diameter, height: diameter }
      : {
          x: boundary - diameter / 2,
          y: centerY - diameter / 2,
          width: diameter,
          height: diameter,
        };
    radius = diameter / 2;
  } else {
    // md2ui `_drag_bar_rect`: inside the fill, the gap short of the value edge, and never
    // past the track's start when the fill cannot hold the gap and the bar.
    const { drag_bar_length: length, drag_bar_thickness: thickness, drag_bar_gap: gap } = sliders;
    handle = vertical
      ? {
          x: centerX - length / 2,
          y: Math.min(innerBottom, boundary + gap + thickness) - thickness,
          width: length,
          height: thickness,
        }
      : {
          x: Math.max(inner.x, boundary - gap - thickness),
          y: centerY - length / 2,
          width: thickness,
          height: length,
        };
    radius = Math.min(handle.width, handle.height) / 2;
  }
  paintPart(p, handle, radius, handleStyle, who, innerStack);
};

/**
 * md2ui `draw_task_control`: a checkbox or switch in its checked or unchecked state, an
 * outer part and an inner part (the tick's box, or the switch's knob, which slides to the
 * far end when checked).
 */
export const drawTaskControl: BoxDrawer = (d, box, p) => {
  const found = nodesOf(d, box);
  if (found === null) return;
  const { theme } = d.sizer;
  const controls = theme.datapoints.task_controls;
  const checked = Boolean(found.sized.drawing_element?.["checked"]);
  const isSwitch = controls.type === "switch";
  const [width, height] = taskControlSize(theme);
  const padding = Math.max(0, Math.min(controls.padding, height / 2));
  const defaultRadius = isSwitch ? height / 2 : 6;
  const outerDefault = Math.max(0, Math.min(controls.corner_radius ?? defaultRadius, height / 2));
  const outerAuthored = checked ? controls.checked_outer : controls.unchecked_outer;
  const innerAuthored = checked ? controls.checked_inner : controls.unchecked_inner;
  // A box the theme does not style draws in the built-in greys, and a ticked one shows
  // its tick: a ring alone tells ticked from open by colour only.
  const unstyled = !sectionIsActive(outerAuthored);
  const outerStyle = unstyled ? plainStyle(checked ? GREY_INK : GREY_LIGHT) : outerAuthored;
  const innerStyle = sectionIsActive(innerAuthored) ? innerAuthored : plainStyle(GREY_WHITE);
  // md2ui `task_control_radii`: an authored state radius replaces the control's.
  const outerRadius = outerStyle.corner_radius_authored
    ? Math.max(0, Math.min(outerStyle.corner_radius, height / 2))
    : outerDefault;
  const innerRadius = Math.max(0, outerRadius - padding);
  const { index, chain } = rotationSlot(found.node, theme);
  const who: Subject = { slot: index, chain, theme };

  const [x, y] = taskControlRect(box, theme);
  const fill = paintPart(p, { x, y, width, height }, outerRadius, outerStyle, who, box.bg_stack);
  const innerSize = Math.max(0, height - 2 * padding);
  if (innerSize <= 0) return;
  const innerX = isSwitch && checked ? x + width - padding - innerSize : x + padding;
  const inner: Box = {
    x: innerX,
    y: y + padding,
    width: isSwitch ? innerSize : width - 2 * padding,
    height: innerSize,
  };
  const innerStack = pushBg(box.bg_stack, opaque(fill));
  const innerFill = paintPart(p, inner, innerRadius, innerStyle, who, innerStack);
  const authored = checked ? controls.checked_symbol : controls.unchecked_symbol;
  const tick = unstyled && checked && !authored;
  const symbol = tick ? "✓" : authored;
  if (!symbol) return;
  const color =
    (tick ? GREY_INK : checked ? controls.checked_symbol_color : controls.unchecked_symbol_color) ??
    fill ??
    theme.text.color;
  const ink = replaceColor(color, pushBg(innerStack, opaque(innerFill)), theme);
  drawSymbol(d, p, inner, symbol, ink);
};

// md2ui `_SYMBOL_SHARE`: the symbol's size as a share of the inner shape's height, room
// around a glyph whose line box (ascent to descent) is taller than its size.
const SYMBOL_SHARE = 0.7;

/**
 * md2ui `_draw_symbol`: `symbol` centred in `inner`, in the emoji face a badge glyph draws
 * in, shrunk to the shape's width when it is wider.
 */
function drawSymbol(d: Draw, p: Pen, inner: Box, symbol: string, color: Argb): void {
  const { fonts, text } = d.sizer.leaves;
  let size = inner.height * SYMBOL_SHARE;
  let run = glyphRun(d, symbol, 0, fonts.emoji, fonts.typeface, size, color);
  if (run.width > inner.width) {
    size *= inner.width / run.width;
    run = glyphRun(d, symbol, 0, fonts.emoji, fonts.typeface, size, color);
  }
  const m = text.fontMetrics(run.font);
  const x = inner.x + inner.width / 2 - run.width / 2;
  const baseline = inner.y + inner.height / 2 + (m.ascent - m.descent) / 2;
  p.text(baseline, [{ ...run, x }]);
}
