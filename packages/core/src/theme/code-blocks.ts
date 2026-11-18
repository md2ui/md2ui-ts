// `## Code Blocks` and its `### Copy Button`. Ported from md2ui's
// `_parse_code_block_line`, `_parse_copy_button_line` and the `code blocks` branch of
// `parse_theme`.
import type { ResolvedTheme } from "@md2ui/contracts";
import { pyMax } from "../group/py/math.ts";
import { strip } from "../group/py/str.ts";
import { parseLayeredLine } from "./background.ts";
import { parseLinkStyleLine } from "./links.ts";
import type { Draft } from "./model.ts";
import { applyPadding, type BlockState, hex, keyValue, newState, num, yesNo } from "./values.ts";

type CodeBlocks = Draft<ResolvedTheme>["code_blocks"];

function parseCodeBlockLine(block: CodeBlocks, line: string): void {
  if (!line.includes(":") || line.startsWith("- ")) return;
  const [key, val] = keyValue(line);
  if (key === "syntax style" && val !== "") {
    block.syntax_style = val;
  } else if (key === "background color" || key === "fill color") {
    block.background_color = hex(val) ?? block.background_color;
  } else if (key === "corner radius") {
    block.corner_radius = pyMax(0, num(val) ?? block.corner_radius);
  } else if (key === "line spacing") {
    block.line_spacing = pyMax(0, num(val) ?? block.line_spacing);
  } else if (key === "min width") {
    block.min_width = pyMax(0, num(val) ?? block.min_width);
  } else if (key === "max lines") {
    if (val.toLowerCase() === "none") {
      block.max_lines = null;
    } else {
      const n = num(val) ?? 0;
      // Python's int(inf) raises; the field is left as it was.
      if (n >= 1 && Number.isFinite(n)) block.max_lines = Math.trunc(n);
    }
  } else if (key === "fade") {
    block.fade = yesNo(val, block.fade);
  } else {
    applyPadding(block.padding, key, val);
  }
}

function parseCopyButtonLine(
  block: CodeBlocks,
  line: string,
  raw: string,
  state: BlockState,
): void {
  if (parseLayeredLine(block.copy_button, line, raw, state)) return;
  if (!line.includes(":") || line.startsWith("- ")) return;
  const [key, val] = keyValue(line);
  if (key === "icon") {
    block.copy_icon = ["", "none"].includes(val.toLowerCase()) ? null : val;
  } else if (key === "icon size") {
    block.copy_icon_size = pyMax(1, num(val) ?? block.copy_icon_size);
  } else {
    parseLinkStyleLine(block.copy_button, key, val, state);
  }
}

/** `## Code Blocks`. */
export function codeBlocksSection(
  theme: Draft<ResolvedTheme>,
): (line: string, raw: string) => void {
  const state = newState();
  let copyButton = false;
  return (line, raw) => {
    if (line.startsWith("### ")) {
      copyButton = strip(line.slice(4)).toLowerCase() === "copy button";
      return;
    }
    if (copyButton) parseCopyButtonLine(theme.code_blocks, line, raw, state);
    else parseCodeBlockLine(theme.code_blocks, line);
  };
}
