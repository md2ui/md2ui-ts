// A button label's emphasis picks the face of each of its pieces (md2ui
// `test_label_spans_consume_only_emphasis`); the plain words are `targets.test.ts`'s.
import { expect, test } from "vitest";
import { linkLabelSpans } from "../src/actions/inline-spans.ts";
import { RegexKit } from "../src/group/py/re.ts";

test("a label is cut into its emphasised pieces, the markers gone", () => {
  const kit = new RegexKit();
  expect(linkLabelSpans(kit, "**Got a Tip?** The Times", "primary")).toEqual([
    { text: "Got a Tip?", bold: true, italic: false },
    { text: " The Times", bold: false, italic: false },
  ]);
  expect(linkLabelSpans(kit, "**x**", "text")).toEqual([
    { text: "**x**", bold: false, italic: false },
  ]);
});
