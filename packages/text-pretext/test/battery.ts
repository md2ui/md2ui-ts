import type { FontSpec, TextMeasurer } from "@md2ui/contracts";
import { spec, themeSpec, twoParagraphs, UNHELD } from "./test-fonts.ts";

/** Every question the measurer answers, at several widths; the answers are plain data. */
export function battery(measurer: TextMeasurer, family: string): unknown {
  const fonts: FontSpec[] = [spec(family), spec(family, 700, 20)];
  const prepared = measurer.prepare(twoParagraphs(family));
  const widths = [prepared.minWidth(), 120, 200, 333.5, prepared.lineWidth()];
  const unheld = measurer.prepare([{ text: UNHELD, font: themeSpec(family, 700, 15) }]);
  return {
    fonts: fonts.map((font) => ({
      advance: measurer.advance("Hello, world", font),
      indented: measurer.advance("    x", font),
      metrics: measurer.fontMetrics(font),
      ink: measurer.inkBounds("Hx", font),
      blank: measurer.inkBounds(" ", font),
    })),
    lineWidth: prepared.lineWidth(),
    minWidth: prepared.minWidth(),
    counts: widths.map((w) => prepared.lineCount(w)),
    lines: widths.map((w) => prepared.lines(w)),
    // A theme's font names no generic family, so what its faces lack is measured in the
    // browser's fallback, which a Worker must resolve as the page does.
    unheld: {
      advance: measurer.advance(UNHELD, themeSpec(family)),
      lineWidth: unheld.lineWidth(),
      lines: [100, 150, 200].map((w) => unheld.lines(w)),
    },
  };
}
