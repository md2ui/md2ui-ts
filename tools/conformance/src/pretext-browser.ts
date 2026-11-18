// The browser layout and placement conformance run in (stage C). Pretext needs a
// canvas and `Intl.Segmenter` (ADR-403), so the layout and boxes stages answer from a
// headless Chromium: the page side (`pretext-page.ts`) is bundled once with rolldown and
// loaded into a blank page, and each document is sent to it as text. md2ui's font files
// are sent once each, checked against the manifest's hash.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { rolldown } from "rolldown";
import { SetupError } from "./errors.ts";
import type { FontFile } from "./manifest.ts";
import type {
  PageFont,
  PagePayload,
  PageResult,
  PlacePayload,
  PlaceResult,
  PretextSession,
} from "./pretext-page.ts";

export interface PretextBrowser {
  /** Loads the faces the page does not have yet; `path` is absolute. */
  loadFonts(fonts: readonly FontFile[]): Promise<void>;
  layout(payload: PagePayload): Promise<PageResult>;
  place(payload: PlacePayload): Promise<PlaceResult>;
  close(): Promise<void>;
}

/** The bundle's global, and the session the page keeps on `globalThis`. */
interface PageGlobals {
  md2uiPretext: { pretextSession(fitEpsilon: number): Promise<PretextSession> };
  md2uiSession: PretextSession;
}

/** Pretext's line-fit epsilon in Chromium (its engine profile). */
const CHROMIUM_FIT_EPSILON = 0.005;

async function pageBundle(): Promise<string> {
  const bundle = await rolldown({
    input: fileURLToPath(new URL("./pretext-page.ts", import.meta.url)),
    platform: "browser",
    // The fixture readers' `node:fs` stays external, and nothing in the workspace runs
    // on import, so an import whose bindings go unused is dropped with it.
    external: /^node:/u,
    treeshake: { moduleSideEffects: false },
  });
  try {
    const { output } = await bundle.generate({ format: "iife", name: "md2uiPretext" });
    return output[0].code;
  } finally {
    await bundle.close();
  }
}

function pageFont({ face, path, sha256, instance }: FontFile): PageFont {
  const data = readFileSync(path);
  if (createHash("sha256").update(data).digest("hex") !== sha256) {
    throw new SetupError(`${path} is not the font file the manifest names (sha256)`);
  }
  return {
    face,
    data: data.toString("base64"),
    ...(instance === undefined ? {} : { axes: instance.coordinates }),
  };
}

export async function openPretextBrowser(): Promise<PretextBrowser> {
  const code = await pageBundle();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><html><body></body></html>");
    await page.addScriptTag({ content: code });
    await page.evaluate(async (fitEpsilon) => {
      const g = globalThis as unknown as PageGlobals;
      g.md2uiSession = await g.md2uiPretext.pretextSession(fitEpsilon);
    }, CHROMIUM_FIT_EPSILON);
    const loaded = new Set<string>();
    return {
      loadFonts: async (fonts) => {
        const added = fonts.filter(({ face }) => !loaded.has(face)).map(pageFont);
        await page.evaluate(
          (sent) => (globalThis as unknown as PageGlobals).md2uiSession.loadFonts(sent),
          added,
        );
        for (const { face } of added) loaded.add(face);
      },
      layout: (payload) =>
        page.evaluate(
          (p) => (globalThis as unknown as PageGlobals).md2uiSession.layout(p),
          payload,
        ),
      place: (payload) =>
        page.evaluate((p) => (globalThis as unknown as PageGlobals).md2uiSession.place(p), payload),
      close: () => browser.close(),
    };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
