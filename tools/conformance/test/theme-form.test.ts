// The theme check with md2ui-ts's own `## Motion` (TS-first): md2ui
// never exports it, so the fixture form leaves it out, and a THEME file that sets it
// still conforms on every field md2ui has but those the port declines, by class. The
// fixture test runs only when MD2UI_FIXTURES names the fixtures.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { env } from "node:process";
import { parseTheme } from "@md2ui/core";
import { expect, test } from "vitest";
import { compare } from "../src/diff.ts";
import { readJson } from "../src/json.ts";
import { readManifest } from "../src/manifest.ts";
import { assetsBesideTheme, declinedThemeField, themeFixtureForm } from "../src/theme-form.ts";

const fixtures = env["MD2UI_FIXTURES"] ?? "";
const MOTION = "\n## Motion\nDuration: 90\nEasing: steps(3, end)\n";

test("the fixture form has no motion, whatever ## Motion says", () => {
  const theme = "## Root\nPadding: 4\n## Links\n### Primary\nCorner radius: 6\n";
  const form = themeFixtureForm(parseTheme(theme + MOTION));
  expect(form).not.toHaveProperty("motion");
  expect(form).toEqual(themeFixtureForm(parseTheme(theme)));
});

test("an asset md2ui found beside the theme is put back as the port wrote it", () => {
  const dir = "data/markdown/x";
  const recorded = {
    bg_image: `${dir}/a.png`,
    other: `${dir}/a.png`,
    nested: { font_paths: [`${dir}/f.ttf`, "g.ttf"], bg_image: "data/images/b.jpg" },
  };
  const port = {
    bg_image: "a.png",
    other: "a.png",
    nested: { font_paths: ["f.ttf", "g.ttf"], bg_image: "data/images/b.jpg" },
  };
  const { expected, fields } = assetsBesideTheme(recorded, port, dir);
  // Only the asset fields, and only where md2ui's path is the port's beside the theme.
  expect(expected).toEqual({ ...port, other: `${dir}/a.png` });
  expect(fields).toEqual(["bg_image", "nested.font_paths[0]"]);
});

test.skipIf(fixtures === "")("every fixture theme with ## Motion added still matches md2ui", () => {
  const themes = readManifest(fixtures).themes;
  expect(themes.length).toBeGreaterThan(0);
  for (const { theme, file } of themes) {
    const text = file === null ? "" : readFileSync(join(fixtures, file.input), "utf8");
    const resolved = parseTheme(text + MOTION);
    expect(resolved.motion.duration).toBe(90);
    const form = themeFixtureForm(resolved);
    const recorded = readJson(join(fixtures, "theme", `${theme}.json`));
    const { expected } =
      file === null
        ? { expected: recorded }
        : assetsBesideTheme(recorded, form, dirname(file.path));
    const differences = compare(expected, form, { ids: {} });
    expect(
      differences.filter((d) => declinedThemeField(d) === null),
      theme,
    ).toEqual([]);
  }
});
