// md2ui shapes an emoji run that holds a sequence (a joiner, a keycap, a flag, a skin
// tone) as the one glyph its font makes of it (`render_shaping`). The port
// shapes nothing itself: Pretext measures the run in one `measureText` call, and the
// engine applies the font's ligatures (ADR-007). This checks every shaped run md2ui
// recorded, in md2ui's own face files, against the real canvas, not the replay:
//   1. in every engine, Pretext's advance is the canvas's for the whole run;
//   2. in Chromium and WebKit, that is md2ui's shaped advance, except where the engine
//      cannot reach the font's ligature (`known` below); Firefox rounds advances to
//      1/60 px and is checked within that.
// Runs only when MD2UI_FIXTURES names the fixtures.
import { canvasText, createPretextMeasurer, setCanvasFont } from "@md2ui/text-pretext";
import { expect, inject, test } from "vitest";
import { commands, server } from "vitest/browser";
import { loadFaces } from "../src/index.ts";

const fixtures = inject("md2uiFixtures");

interface Manifest {
  readonly widths: readonly number[];
  readonly corpus: readonly { doc: string }[];
  readonly fonts: { readonly faces: Readonly<Record<string, string | null>> };
}

interface Shaped {
  readonly face: string;
  readonly size: number;
  readonly text: string;
  readonly a: number;
}

/**
 * Runs an engine does not shape as md2ui does:
 * - a keycap in OpenMoji, every engine. OpenMoji joins a keycap only with its U+FE0F; the
 *   measurer hands a named face VS15 instead (`canvasText`), which every engine draws as
 *   OpenMoji's empty digit and keycap mark (0 wide), and VS16 would send the cluster to
 *   the system's colour font in Chromium and Firefox;
 * - a skin tone in Firefox, which sends it to the system's colour font.
 */
function known(text: string): boolean {
  if (text.endsWith("\u20E3")) return text.includes("\uFE0F");
  return server.browser === "firefox" && /[\u{1F3FB}-\u{1F3FF}]/u.test(text);
}

/** Firefox's canvas advances are multiples of 1/60 px. */
const FIREFOX_SLACK = 0.6;

test.skipIf(fixtures === "")(
  "an emoji sequence is measured whole, as its font joins it",
  async () => {
    const manifest = JSON.parse(await commands.readFile(`${fixtures}/manifest.json`)) as Manifest;
    const shaped = new Map<string, Shaped>();
    for (const width of manifest.widths) {
      for (const { doc } of manifest.corpus) {
        const text = await commands
          .readFile(`${fixtures}/measure/${width}/${doc}.jsonl`)
          .catch(() => "");
        for (const line of text.split("\n")) {
          if (!line.includes('"shaped"')) continue;
          const r = JSON.parse(line) as Shaped & { q: string; shaped?: boolean };
          if (r.q === "advance" && r.shaped === true)
            shaped.set(`${r.face}|${r.size}|${r.text}`, r);
        }
      }
    }
    expect(shaped.size).toBeGreaterThan(0);
    const faces = [...new Set([...shaped.values()].map((r) => r.face))];
    await loadFaces(
      await Promise.all(
        faces.map(async (face) => {
          const file = manifest.fonts.faces[face];
          if (!file) throw new Error(`no font file for ${face}`);
          return { face, data: await commands.readFile(`${fixtures}/${file}`, "base64") };
        }),
      ),
    );
    const pretext = await createPretextMeasurer([]);
    const ctx = new OffscreenCanvas(1, 1).getContext("2d");
    if (ctx === null) throw new Error("no 2D context");
    for (const { face, size, text, a } of shaped.values()) {
      // The face loaded under its key with default descriptors: asked upright at 400, as
      // the replay asks it, never synthesized. Every shaped face is an upright emoji face.
      const font = { families: [face], size, weight: 400, italic: false };
      const what = `${server.browser} ${face} ${size} ${JSON.stringify(text)}`;
      const advance = pretext.advance(text, font);
      setCanvasFont(ctx, font);
      expect(advance, what).toBe(ctx.measureText(canvasText(text, font)).width);
      if (known(text)) continue;
      if (server.browser === "firefox")
        expect(Math.abs(advance - a), what).toBeLessThan(FIREFOX_SLACK);
      else expect(advance, what).toBe(a);
    }
  },
  120_000,
);
