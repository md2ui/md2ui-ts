import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { SetupError } from "../src/errors.ts";
import { type Phase, readManifest } from "../src/manifest.ts";

const MANIFEST = {
  format_version: 4,
  string_offsets: "code points",
  md2ui_commit: "abc1234",
  md2ui_dirty: true,
  date: "2026-10-04",
  corpus: [
    {
      doc: "tests__a",
      path: "data/markdown/tests/a.md",
      input: "input/tests/a.md",
      theme: "_defaults",
    },
  ],
  phases: [{ phase: "2.1", dir: "02-phase-2.1" }],
  widths: [767, 1280],
  variants: [{ doc: "data/markdown/tests/a.md", name: "overlays", width: 1280, flags: ["--x"] }],
  themes: [
    { theme: "_defaults", theme_path: null, theme_input: null },
    { theme: "THEME", theme_path: "THEME.md", theme_input: "input/THEME.md" },
  ],
  fonts: {
    faces: {
      "Arial|ArialMT|400|5|0": "fonts/Arial.ttf",
      "Apple Symbols|AppleSymbols|400|5|0": null,
    },
    files: {
      "fonts/Arial.ttf": {
        face: "Arial|ArialMT|400|5|0",
        sha256: "a1",
        source: "/System/Library/Fonts/Supplemental/Arial.ttf",
      },
    },
    themes: { _defaults: ["Apple Symbols|AppleSymbols|400|5|0", "Arial|ArialMT|400|5|0"] },
    families: { _defaults: { monospace: "Courier" } },
  },
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "conformance-manifest-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function write(manifest: object): void {
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
}

describe("readManifest", () => {
  test("old fixtures, without font files, fail naming the export that adds them", () => {
    const { fonts: _, ...old } = MANIFEST;
    write({ ...old, format_version: 1 });
    expect(() => readManifest(dir)).toThrow(/export_ts_fixtures/u);
  });

  test("format 2 fixtures, without family names, fail naming the export", () => {
    write({ ...MANIFEST, format_version: 2 });
    expect(() => readManifest(dir)).toThrow(/export_ts_fixtures/u);
  });

  test("format 3 fixtures, which cannot tell a stretched or shaped question from a plain one, fail naming the export", () => {
    write({ ...MANIFEST, format_version: 3 });
    expect(() => readManifest(dir)).toThrow(/export_ts_fixtures/u);
  });

  test("a family name resolved to anything but a family fails", () => {
    write({ ...MANIFEST, fonts: { ...MANIFEST.fonts, families: { _defaults: { monospace: 1 } } } });
    expect(() => readManifest(dir)).toThrow(SetupError);
  });

  test("a theme naming a face the manifest does not list fails", () => {
    write({
      ...MANIFEST,
      fonts: { ...MANIFEST.fonts, themes: { _defaults: ["Nope|Nope|400|5|0"] } },
    });
    expect(() => readManifest(dir)).toThrow(SetupError);
  });

  test("reads phases, widths and variants into layout labels", () => {
    write(MANIFEST);
    const manifest = readManifest(dir);
    const phases: readonly Phase[] = manifest.phases;
    expect(phases).toEqual([{ phase: "2.1", dir: "02-phase-2.1" }]);
    expect(manifest.dirty).toBe(true);
    expect(manifest.layouts.map((l) => l.label)).toEqual(["767", "1280", "1280-overlays"]);
    expect(manifest.layouts[2]?.flags).toEqual(["--x"]);
    expect(manifest.corpus[0]?.input).toBe("input/tests/a.md");
    expect(manifest.themes).toEqual([
      { theme: "_defaults", file: null },
      { theme: "THEME", file: { path: "THEME.md", input: "input/THEME.md" } },
    ]);
    expect(manifest.fonts).toEqual(
      new Map([
        [
          "_defaults",
          [
            {
              face: "Arial|ArialMT|400|5|0",
              path: "fonts/Arial.ttf",
              sha256: "a1",
              source: "/System/Library/Fonts/Supplemental/Arial.ttf",
            },
          ],
        ],
      ]),
    );
    expect(manifest.families).toEqual(new Map([["_defaults", { monospace: "Courier" }]]));
  });

  test("rejects a fixture format it does not know", () => {
    write({ ...MANIFEST, format_version: 5 });
    expect(() => readManifest(dir)).toThrow(SetupError);
    write({ ...MANIFEST, string_offsets: "utf-16" });
    expect(() => readManifest(dir)).toThrow(SetupError);
  });
});
