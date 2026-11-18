// md2ui slants italic text in a family loaded without an italic file (`styled_font`,
// a skew that changes no advance). The replay asks the browser for italic in that
// upright face, and every engine leaves the advance where the upright face has it. In
// Chromium, where the replay runs, that is md2ui's recorded advance, and the ink leans:
// the oblique is synthesized. (Firefox's upright advances already differ from Skia's in
// the third decimal, and WebKit's canvas reports the upright ink box.) Runs only when
// MD2UI_FIXTURES names the fixtures.
import { expect, inject, test } from "vitest";
import { commands, server } from "vitest/browser";
import { loadFaces } from "../src/index.ts";

const fixtures = inject("md2uiFixtures");
/** md2ui's sample of a family with no italic file (Inter Regular and Bold). */
const DOC = "tests__italic-without-italic-file__content";

interface Manifest {
  readonly widths: readonly number[];
  readonly fonts: { readonly faces: Readonly<Record<string, string | null>> };
}

interface Advance {
  readonly face: string;
  readonly size: number;
  readonly text: string;
  readonly a: number;
}

test.skipIf(fixtures === "")(
  "a synthesized oblique keeps md2ui's upright advances and leans the ink",
  async () => {
    const manifest = JSON.parse(await commands.readFile(`${fixtures}/manifest.json`)) as Manifest;
    const records = (
      await commands.readFile(`${fixtures}/measure/${manifest.widths[0]}/${DOC}.jsonl`)
    )
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as Advance & { q: string })
      .filter((r) => r.q === "advance" && r.face.endsWith("|0") && r.text.trim() !== "");
    const faces = [...new Set(records.map((r) => r.face))];
    expect(faces.length).toBeGreaterThan(0);
    await loadFaces(
      await Promise.all(
        faces.map(async (face) => {
          const file = manifest.fonts.faces[face];
          if (!file) throw new Error(`no font file for ${face}`);
          return { face, data: await commands.readFile(`${fixtures}/${file}`, "base64") };
        }),
      ),
    );
    const ctx = new OffscreenCanvas(1, 1).getContext("2d");
    if (ctx === null) throw new Error("no 2D context");
    // As the replay measures a gap: Skia's `measureText` neither kerns nor shapes.
    ctx.fontKerning = "none";
    ctx.textRendering = "optimizeSpeed";
    const measure = (font: string, text: string): TextMetrics => {
      ctx.font = font;
      return ctx.measureText(text);
    };
    for (const { face, size, text, a } of records) {
      const upright = measure(`${size}px ${JSON.stringify(face)}`, text);
      const oblique = measure(`italic ${size}px ${JSON.stringify(face)}`, text);
      expect(oblique.width, `${face} ${size} "${text}"`).toBe(upright.width);
      if (server.browser !== "chromium") continue;
      expect(oblique.width, `${face} ${size} "${text}"`).toBeCloseTo(a, 3);
      expect(oblique.actualBoundingBoxRight, `${face} "${text}"`).toBeGreaterThan(
        upright.actualBoundingBoxRight,
      );
    }
  },
);
