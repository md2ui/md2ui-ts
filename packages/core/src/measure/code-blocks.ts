// A code block's geometry, shared by measurement and painting (md2ui
// `render_code_blocks.code_block_plan`). md2ui measures each line as the sum of its
// syntax-highlighted runs; here a line is measured whole, since colour never changes a
// glyph's advance, so the size needs no highlighter.
import type { ResolvedTheme, TextMeasurer } from "@md2ui/contracts";
import { paddingX, paddingY } from "../theme/query.ts";
import { codeBlockFace, fontOf, inMonospace } from "./font-set.ts";

export interface CodeBlockPlan {
  /** The widest source line, plus the horizontal padding. */
  readonly width: number;
  /** What the block measures: at most `Max lines` of it. */
  readonly height: number;
  readonly line_height: number;
  readonly baseline: number;
  /** Every line, so the paint can tell a block that has more below its cut. */
  readonly full_height: number;
  /** The strip above the code that holds the copy button; 0 without one. */
  readonly header: number;
  readonly line_count: number;
}

/** Python's `str.expandtabs(4)` on text whose only line break is `\n`. */
function expandTabs(source: string): string {
  let out = "";
  let column = 0;
  for (const ch of source) {
    if (ch === "\t") {
      const pad = 4 - (column % 4);
      out += " ".repeat(pad);
      column += pad;
    } else {
      out += ch;
      column = ch === "\n" ? 0 : column + 1;
    }
  }
  return out;
}

/** md2ui `_normalized_source`: one line ending style, tabs expanded, the closing newline dropped. */
export function normalizedSource(content: string): string {
  const source = expandTabs(content.replaceAll("\r\n", "\n").replaceAll("\r", "\n"));
  return source.endsWith("\n") ? source.slice(0, -1) : source;
}

/** md2ui `copy_button_size`: the icon plus the larger of the button's paddings, square. */
function copyButtonSize(theme: ResolvedTheme): number {
  const blocks = theme.code_blocks;
  const pad = blocks.copy_button.padding;
  return blocks.copy_icon_size + (pad ? Math.max(paddingX(pad), paddingY(pad)) : 0);
}

/**
 * md2ui `copy_button_rect`: where the copy button is painted, `[x, y, width, height]`,
 * the block's top-right corner inside its padding.
 */
export function copyButtonRect(
  box: { readonly x: number; readonly y: number; readonly width: number },
  theme: ResolvedTheme,
): readonly [number, number, number, number] {
  const side = copyButtonSize(theme);
  const x = box.x + box.width - theme.code_blocks.padding.right - side;
  return [x, box.y + theme.code_blocks.padding.top, side, side];
}

/** md2ui `copied_text`: what the copy button puts on the clipboard, less the closing newline. */
export function copiedText(content: string): string {
  return content.endsWith("\n") ? content.slice(0, -1) : content;
}

/** md2ui `code_block_plan`, in the theme's code-block face. */
export function codeBlockPlan(
  content: string,
  theme: ResolvedTheme,
  text: TextMeasurer,
): CodeBlockPlan {
  const blocks = theme.code_blocks;
  const font = inMonospace(fontOf(codeBlockFace(theme), blocks.text_style.font_size));
  const metrics = text.fontMetrics(font);
  const glyphHeight = metrics.descent + metrics.ascent;
  const lineHeight = glyphHeight + blocks.line_spacing;
  const lines = normalizedSource(content).split("\n");
  const textWidth = Math.max(
    0,
    ...lines.map((line) => (line === "" ? 0 : text.advance(line, font))),
  );
  const shown = blocks.max_lines === null ? lines.length : Math.min(lines.length, blocks.max_lines);
  const textHeight = glyphHeight + Math.max(0, lines.length - 1) * lineHeight;
  const header = blocks.copy_icon ? copyButtonSize(theme) + blocks.line_spacing : 0;
  return {
    width: textWidth + paddingX(blocks.padding),
    height: header + glyphHeight + Math.max(0, shown - 1) * lineHeight + paddingY(blocks.padding),
    line_height: lineHeight,
    baseline: header + blocks.padding.top + metrics.ascent,
    full_height: header + textHeight + paddingY(blocks.padding),
    header,
    line_count: lines.length,
  };
}
