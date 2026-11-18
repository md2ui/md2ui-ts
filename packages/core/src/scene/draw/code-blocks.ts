// A code block's paint (md2ui `render_code_blocks.draw_code_block`): its background, its
// highlighted lines (a scrollable block's all of them, in one `scroll` entry), and the
// copy button. Geometry
// is `codeBlockPlan` and `copyButtonRect`, the very functions sizing used (md2ui ADR-400).
import type { DisplayEntry, ResolvedTheme, TextEntry } from "@md2ui/contracts";
import {
  type CodeBlockPlan,
  codeBlockPlan,
  copyButtonRect,
  normalizedSource,
} from "../../measure/code-blocks.ts";
import { codeBlockFace, emojiFontOf, fontOf, inMonospace } from "../../measure/font-set.ts";
import { paddingY } from "../../theme/query.ts";
import { pushBg, replaceColor } from "../backgrounds.ts";
import type { BgStack } from "../boxes.ts";
import { replacedGradient } from "./colors.ts";
import type { BoxDrawer, Draw } from "./context.ts";
import { layeredFill } from "./fills.ts";
import { css, type MeasuredRun, type Pen, pen, roundShape } from "./pen.ts";

/**
 * md2ui `lines_that_fit`: how many whole lines a block of this height shows above its
 * bottom padding, at least one, so a cut always falls between two lines.
 */
function linesThatFit(plan: CodeBlockPlan, height: number, theme: ResolvedTheme): number {
  const blocks = theme.code_blocks;
  const glyph = plan.line_height - blocks.line_spacing;
  const room = height - plan.header - paddingY(blocks.padding) - glyph + 0.5;
  return Math.max(1, Math.min(plan.line_count, Math.floor(room / plan.line_height) + 1));
}

/**
 * md2ui `_paint_copy_button`: the button in its `### Copy Button` style, its icon centred
 * on it. Its stroke is a plain round-rect stroke, not an aligned outline. It is replaced
 * as a link button is, against the block's fill (`stack`).
 */
function copyButton(
  d: Draw,
  p: Pen,
  box: { readonly x: number; readonly y: number; readonly width: number },
  stack: BgStack,
): void {
  const { theme, leaves } = d.sizer;
  const blocks = theme.code_blocks;
  const style = blocks.copy_button;
  const [x, y, w, h] = copyButtonRect(box, theme);
  const rect = { x, y, width: w, height: h };
  const radius = style.corner_radius ?? 0;
  const fill =
    style.fill_color === null ? null : replaceColor(style.fill_color, stack, theme, "fill");
  layeredFill(p, rect, {
    color: fill,
    image: style.bg_image ? { src: style.bg_image, fallbackSrc: null } : null,
    gradient: replacedGradient(style.gradient, stack, theme),
    radius,
    shadows: style.shadows,
  });
  if (style.stroke_width && style.stroke_color !== null) {
    p.stroke(
      roundShape(rect, radius),
      style.stroke_width,
      replaceColor(style.stroke_color, stack, theme, "stroke"),
    );
  }
  const font = inMonospace(
    emojiFontOf(leaves.fonts.emoji, codeBlockFace(theme), blocks.copy_icon_size),
  );
  const metrics = leaves.text.fontMetrics(font);
  const icon = blocks.copy_icon ?? "";
  const width = leaves.text.advance(icon, font);
  const ink = replaceColor(
    (style.text_style ?? blocks.text_style).color,
    pushBg(stack, fill),
    theme,
  );
  p.text(y + (h - (metrics.descent + metrics.ascent)) / 2 + metrics.ascent, [
    { text: icon, x: x + (w - width) / 2, font, color: css(ink), width },
  ]);
}

/**
 * md2ui `draw_code_block`: the block's rounded background; its lines, one run per
 * highlighted token at its offset in the whole line, so colour never moves a glyph; a
 * block wider than its box, or cut by `Max lines`, is a `scroll` entry holding every line,
 * whose host paints the fades (md2ui `render_scroll_overlay`); and the copy button. Colour replacements apply as to a
 * pill: the fill against what the block sits on, then the runs, fade and button against
 * that replaced fill.
 */
export const drawCodeBlock: BoxDrawer = (d, box, p) => {
  if (box.content_id === null) return;
  const node = d.nodes.get(box.content_id);
  if (node === undefined) return;
  const { theme, leaves } = d.sizer;
  const blocks = theme.code_blocks;
  const content = node.content ?? "";
  const plan = codeBlockPlan(content, theme, leaves.text);
  const radius = Math.min(blocks.corner_radius, box.width / 2, box.height / 2);
  const shape = roundShape(box, radius);
  const fill = replaceColor(blocks.background_color, box.bg_stack, theme, "fill");
  const inner = pushBg(box.bg_stack, fill);
  p.fill(shape, { kind: "color", color: css(fill) });

  const font = inMonospace(fontOf(codeBlockFace(theme), blocks.text_style.font_size));
  const advance = (text: string): number => (text === "" ? 0 : leaves.text.advance(text, font));
  const highlighted = d.highlight?.(content, node.code_language ?? null) ?? null;
  const shown = linesThatFit(plan, box.height, theme);
  // md2ui `code_block_scrollables`: wider than its box, or cut below its last shown line.
  const scrolls = plan.width > box.width + 0.5 || plan.full_height > box.height + 0.5;
  const entries: DisplayEntry[] = [];
  const lines = scrolls ? pen(entries, p.nodeId, leaves.text) : p;
  let rest = 0;
  normalizedSource(content)
    .split("\n")
    .slice(0, scrolls ? undefined : shown)
    .forEach((line, i) => {
      const tokens = highlighted?.[i] ?? [{ text: line, color: blocks.text_style.color }];
      let offset = 0;
      const runs: MeasuredRun[] = tokens.map((token) => {
        const run = {
          text: token.text,
          x: box.x + blocks.padding.left + advance(line.slice(0, offset)),
          font,
          color: css(replaceColor(token.color, inner, theme)),
          width: advance(token.text),
        };
        offset += token.text.length;
        return run;
      });
      lines.text(box.y + plan.baseline + i * plan.line_height, runs, scrolls ? undefined : shape);
      if (i < shown) rest = entries.length;
    });
  if (scrolls) {
    // The lines' window: below the space above the code, above the bottom padding.
    const top = box.y + plan.header + blocks.padding.top;
    const bottom = box.y + box.height - blocks.padding.bottom;
    p.scroll(
      shape,
      { width: plan.width, height: plan.full_height },
      { x: box.x, y: top, width: box.width, height: bottom - top },
      blocks.fade ? fill : null,
      entries.filter((e): e is TextEntry => e.type === "text"),
      rest,
    );
  }

  if (blocks.copy_icon) {
    copyButton(d, p, box, inner);
  }
};
