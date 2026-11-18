// A fixed-colour pin in paint, as md2ui judges it: a pin that vanishes into what is painted
// behind it is dropped (`render_colors._pin_or_replace`), judged against the composited
// backdrop; a clear pin is an authored "no fill" and is kept. md2ui's own cases
// (`fixed_color_tests`), and its sample `tests/translucent-fill-pin-on-its-colour` painted end
// to end; no fixtures needed.
import type { FillEntry } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { BG_IMAGE } from "../src/scene/backgrounds.ts";
import { pinOrReplace } from "../src/scene/draw/colors.ts";
import { parseTheme } from "../src/theme/parse.ts";
import { paintMarkdown } from "./scene-kit.ts";

// md2ui: test_a_translucent_pin_is_judged_on_what_shows_behind_it
test("a translucent pin is judged on what shows behind it", () => {
  const t = parseTheme("");
  const green = 0xff00e700;
  const tint = 0x1900e700;
  const white = 0xffffffff;
  // A 10% green fill over a green section paints green: it would vanish, and so would a
  // label pinned green on that fill, which is see-through to the green below.
  expect(pinOrReplace(0xff1a1a1a, tint, [green], t, "fill")).toBe(0xff1a1a1a);
  expect(pinOrReplace(0xff26262b, green, [tint, green], t)).toBe(0xff26262b);
  // The same tint over white shows, and a green label on it shows too.
  expect(pinOrReplace(0xff1a1a1a, tint, [white], t, "fill")).toBe(tint);
  expect(pinOrReplace(0xff26262b, green, [tint, white], t)).toBe(green);
  // A clear pin is kept, and so is any pin over a picture, whose colour is unknown.
  expect(pinOrReplace(0xff1a1a1a, 0x0000e700, [green], t, "fill")).toBe(0x0000e700);
  expect(pinOrReplace(0xff1a1a1a, tint, [BG_IMAGE, green], t, "fill")).toBe(tint);
});

// md2ui data/markdown/tests/translucent-fill-pin-on-its-colour (fonts dropped).
const THEME = `## Styling & Spacing

### Root
Background color: #00E700
Padding: 30

## Inline Code
Fill color: #1A1A1A
Padding: 8

## Fixed colors

### Badges
#### Contains
- ▲ : Text color: #00E700, Fill color: #00E70019
`;

// md2ui: test_a_translucent_fill_pin_on_its_own_colour_leaves_a_legible_button, on the
// chip path its sample takes: the fill pin is dropped, so the chip paints its own fill,
// and the green label pinned on it shows.
test("a translucent fill pin on its own colour leaves a legible chip", () => {
  const { list } = paintMarkdown("`▲ 6%`\n", THEME).painted;
  const fills = list.entries.filter(
    (e): e is FillEntry => e.type === "fill" && e.paint.kind === "color",
  );
  expect(fills.map((f) => (f.paint.kind === "color" ? f.paint.color : ""))).toContain("#1a1a1aff");
  const label = list.entries.find((e) => e.type === "text" && e.runs.some((r) => r.text !== ""));
  expect(label?.type === "text" && label.runs.map((r) => r.color)).toContain("#00e700ff");
});
