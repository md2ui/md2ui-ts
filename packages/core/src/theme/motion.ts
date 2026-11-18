// `## Motion`: md2ui-ts vocabulary, with no md2ui counterpart
// (motion keys are TS-first). It holds the two values Web Animations takes for a tween,
// in the form it takes them: `Duration` in milliseconds, `Easing` as CSS writes it. The
// block follows the parser's conventions: keys in any case, an unknown key ignored, a
// value that does not read leaving the field as it was.
import type { ResolvedTheme } from "@md2ui/contracts";
import type { Draft } from "./model.ts";
import { keyValue, num } from "./values.ts";

/** `## Motion`. */
export function motionSection(theme: Draft<ResolvedTheme>): (line: string) => void {
  return (line) => {
    if (!line.includes(":") || line.startsWith("- ")) return;
    const [key, val] = keyValue(line);
    const m = theme.motion;
    if (key === "duration") {
      const ms = num(val);
      if (ms !== undefined && Number.isFinite(ms) && ms >= 0) m.duration = ms;
    } else if (key === "easing") {
      // The core has no CSS parser, and needs none: the view asks the browser (`motion.ts`
      // in `@md2ui/dom`), which runs exactly the syntax it accepts.
      if (val !== "") m.easing = val;
    }
  };
}
