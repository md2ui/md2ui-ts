// The small marks between and before content: a horizontal rule, a row separator, and a
// list or quote gutter marker (md2ui `draw_horizontal_rule`, `_draw_row_separator`,
// `_draw_list_marker`).
import type { Argb } from "@md2ui/contracts";
import { fontOf } from "../../measure/font-set.ts";
import { hint, LINE_SCALE, type Props, truthy } from "../../measure/leaf-kit.ts";
import { markerFace } from "../../measure/text-fonts.ts";
import { scopedHorizontalRuleStyle } from "../../theme/query.ts";
import { replaceColor } from "../backgrounds.ts";
import type { LayoutBox } from "../boxes.ts";
import type { BoxDrawer } from "./context.ts";
import { nodesOf } from "./context.ts";
import { css, ovalShape, rectShape, roundShape } from "./pen.ts";
import { labelRuns } from "./text.ts";

/** md2ui `draw_horizontal_rule`: a line across the middle of the box, its colour replaced. */
export const drawRule: BoxDrawer = (d, box, p) => {
  const { theme } = d.sizer;
  const scopes = nodesOf(d, box)?.sized.text_style_chain ?? [];
  const rule = scopedHorizontalRuleStyle(theme, scopes);
  const y = box.y + box.height / 2;
  const color = replaceColor(rule.stroke_color, box.bg_stack, theme, "stroke");
  p.line(box.x, y, box.x + box.width, y, rule.stroke_width, color);
};

/**
 * md2ui `_draw_row_separator`: the vertical rule the theme draws for ` | `, or the
 * separator character in the body text style (so it takes the body colour's replacement).
 */
export const drawSeparator: BoxDrawer = (d, box, p) => {
  const { theme, leaves } = d.sizer;
  const sep = hint(box.render_properties, "separator") as Props;
  if (sep["kind"] === "rule") {
    const rule = theme.vertical_rule;
    const x = box.x + box.width / 2;
    const color = replaceColor(rule.stroke_color, box.bg_stack, theme, "stroke");
    p.line(x, box.y, x, box.y + box.height, rule.stroke_width, color);
    return;
  }
  const ch = String(sep["char"] ?? "");
  if (ch === "") return;
  const size = theme.text.font_size;
  const font = fontOf(leaves.fonts.typeface, size);
  const color = replaceColor(theme.text.color, box.bg_stack, theme);
  p.text(box.y + size, [
    { text: ch, x: box.x, font, color: css(color), width: leaves.text.advance(ch, font) },
  ]);
};

/**
 * md2ui `_draw_list_marker`: a bullet shape or glyph, a quote bar, or a text marker (an
 * ordinal, a quote character) set ink-top flush with the box. The shape centres on the
 * first line, an aside bar spans the item, and a bar above its item is horizontal.
 */
export const drawListMarker: BoxDrawer = (d, box: LayoutBox, p) => {
  const { theme, leaves } = d.sizer;
  const { fonts } = leaves;
  const lm = hint(box.render_properties, "list_marker") as Props;
  const kind = lm["kind"];
  const lineHeight = Math.min(box.height, theme.text.font_size * LINE_SCALE);
  const color = (role: "text" | "fill"): Argb => {
    const configured = lm["color"];
    const base =
      configured === null || configured === undefined ? theme.text.color : (configured as Argb);
    return replaceColor(base, box.bg_stack, theme, role);
  };
  const emoji = lm["emoji"];

  if (kind === "bullet" && !truthy(emoji)) {
    const size = Number(lm["size"] ?? 0);
    const rect = {
      x: box.x,
      y: box.y + Math.max(0, (lineHeight - size) / 2),
      width: size,
      height: size,
    };
    p.fill(lm["shape"] === "square" ? roundShape(rect, 2) : ovalShape(rect), {
      kind: "color",
      color: css(color("fill")),
    });
    return;
  }
  if (kind === "bullet") {
    const size = Number(lm["size"] ?? theme.text.font_size);
    const { runs } = labelRuns(
      d,
      String(emoji),
      box.x,
      fonts.typeface,
      fonts.emoji,
      size,
      color("text"),
    );
    p.text(box.y + size, runs);
    return;
  }
  if (kind === "quote" && lm["mode"] === "bar") {
    const barWidth = Number(lm["bar_width"] ?? 0);
    const rect =
      (lm["aside"] ?? true)
        ? { x: box.x, y: box.y, width: barWidth, height: box.height }
        : {
            x: box.x,
            y: box.y,
            width: Math.min(Number(lm["bar_length"] ?? 50), box.width),
            height: barWidth,
          };
    p.fill(rectShape(rect), { kind: "color", color: css(color("fill")) });
    return;
  }
  const text = String(lm["text"] || "");
  const [face, size] = markerFace(lm, fonts, theme);
  const ink = leaves.text.inkBounds(text, fontOf(face, size));
  const { runs } = labelRuns(d, text, box.x, face, fonts.emoji, size, color("text"));
  p.text(box.y + ink.top, runs);
};
