import type { TextMeasurer } from "@md2ui/contracts";
import { spec } from "./test-fonts.ts";

/**
 * Emoji answers, asked separately: Pretext corrects canvas emoji widths against a DOM
 * measurement, which a Worker cannot make.
 */
export function emojiAnswers(measurer: TextMeasurer, family: string): unknown {
  return [12, 16, 24].map((size) => ({
    size,
    advance: measurer.advance("Ship it \u{1F680}\u{1F600}", spec(family, 400, size)),
    lineWidth: measurer
      .prepare([{ text: "Ship it \u{1F680} now \u{1F600}", font: spec(family, 400, size) }])
      .lineWidth(),
  }));
}
