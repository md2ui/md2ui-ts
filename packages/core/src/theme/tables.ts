// Ports the `## Tables` block of md2ui's `parse_theme` (`pipeline/theme.py`).
import type { ResolvedTheme, TextStyle } from "@md2ui/contracts";
import { partition, strip } from "../group/py/str.ts";
import { parseSectionLine } from "./background.ts";
import { type Draft, newTextStyle } from "./model.ts";
import { setTextStyleField } from "./text-styles.ts";
import { isYes, keyValue, newState, num } from "./values.ts";

type Mode = "" | "table" | "header" | "cells" | "keys";

/** `## Tables`. */
export function tablesSection(theme: Draft<ResolvedTheme>): (line: string, raw: string) => void {
  let mode: Mode = "";
  let state = newState("stroke");
  return (line, raw) => {
    if (line.startsWith("### ")) {
      const sub = strip(line.slice(4)).toLowerCase();
      state = newState("stroke");
      if (sub.startsWith("table")) mode = "table";
      else if (sub.startsWith("header")) mode = "header";
      else if (sub.startsWith("cell")) mode = "cells";
      else if (sub.includes("key")) mode = "keys";
      else mode = "";
      return;
    }
    const tt = theme.tables;
    if (mode === "table") {
      const [key, val] = keyValue(line);
      if (key === "stacking cards") {
        tt.stacking = isYes(val);
      } else if (key === "card layout") {
        const v = val.toLowerCase();
        if (v === "title" || v === "keys") tt.card_layout = v;
      } else {
        parseSectionLine(tt.table, line, raw, state);
      }
    } else if (mode === "header" || mode === "cells") {
      const bullet = line.startsWith("- ") ? strip(line.slice(2)) : "";
      if (bullet.toLowerCase().startsWith("font") && bullet.includes(":")) {
        const [fkey, , fval] = partition(bullet, ":");
        let ts: Draft<TextStyle>;
        if (mode === "header") {
          tt.header_text ??= newTextStyle();
          ts = tt.header_text;
        } else {
          tt.cells_text ??= newTextStyle();
          ts = tt.cells_text;
        }
        setTextStyleField(ts, strip(fkey).toLowerCase(), strip(fval));
      } else {
        parseSectionLine(mode === "header" ? tt.header : tt.cells, line, raw, state);
      }
    } else if (mode === "keys") {
      const bullet = line.startsWith("- ") ? strip(line.slice(2)) : "";
      if (bullet.toLowerCase().startsWith("font") && bullet.includes(":")) {
        const [fkey, , fval] = partition(bullet, ":");
        tt.keys_text ??= newTextStyle();
        setTextStyleField(tt.keys_text, strip(fkey).toLowerCase(), strip(fval));
      } else if (line.includes(":")) {
        const [key, val] = keyValue(line);
        if (key === "key spacing") tt.key_spacing = num(val) ?? tt.key_spacing;
      }
    }
  };
}
