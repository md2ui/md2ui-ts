// The unit a chart's author declares for bare values, and how a value shows it (md2ui:
// pipeline/value_format.py; ADR-204). A value written in no chart unit is written bare
// and its unit declared once: `Temperature (°C):` above a run, `High (°C)` as a line's
// key. The grouper reads the declaration; the generator (a line's last value) and the
// scene (tick labels, legends, value labels) show it through the theme's `Value format`.
// Both halves live here so one module owns that vocabulary.

import { compile, type RegexKit } from "./py/re.ts";
import { strip } from "./py/str.ts";

// A declared unit: words or symbols in the last parentheses, with no digit, so
// `Results (2025)` declares nothing. Units in words run long (`millions of shares`,
// `kilowatt-hours per day`); what keeps a sentence's last aside from reading as one is
// the short line that must carry it (`charts.ts`, six words).
// py: MAX_UNIT = 32
const MAX_UNIT = 32;
// py: re.compile(rf"\(([^()\d]{{1,{MAX_UNIT}}})\)\s*:?\s*$")
const DECLARED = compile(String.raw`\(([^()\d]{1,${MAX_UNIT}})\)\s*:?\s*$`);
// py: re.compile(r"^[-+−]?[\d.,]+$")
const BARE = compile(String.raw`^[-+−]?[\d.,]+$`);

/** md2ui: `declared_unit`. The unit `text` ends by declaring (`High (°C)` → `°C`), or null. */
export function declaredUnit(kit: RegexKit, text: string): string | null {
  const m = kit.re(DECLARED).search(strip(text));
  return m === null ? null : strip(m.text(1)) || null;
}

/** md2ui: `without_unit`. `text` without the unit it declares (`High, Low (°C)` → `High, Low`). */
export function withoutUnit(kit: RegexKit, text: string): string {
  return strip(kit.re(DECLARED).sub("", strip(text)));
}

/** md2ui: `is_bare`. Whether a value is written as a bare number, the form a declared unit labels. */
export function isBare(kit: RegexKit, text: string): boolean {
  return kit.re(BARE).match(strip(text)) !== null;
}

/**
 * md2ui: `with_unit`. `text`, a bare value, shown with `unit` where the theme's `Value
 * format` puts it (`1 unit` → `24 °C`); `1`, the default, leaves it bare.
 */
export function withUnit(text: string, unit: string | null | undefined, fmt: string): string {
  if (!unit || fmt === "1") return text;
  return fmt.replaceAll("unit", "\0").replaceAll("1", text).replaceAll("\0", unit);
}
