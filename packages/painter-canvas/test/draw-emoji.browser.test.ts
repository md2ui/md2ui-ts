// An emoji with VS16 in a theme's named emoji face paints in its run's colour, as md2ui
// paints it: Chromium and Firefox would draw it in the system's colour emoji font, where
// no tint or `## Fixed colors` pin reaches it (`canvasText`). The face is md2ui's own
// OpenMoji, from the fixtures, so the test runs only with them.
import type { FontSpec, TextEntry } from "@md2ui/contracts";
import { loadFonts } from "@md2ui/text-pretext";
import { expect, inject, test } from "vitest";
import { commands } from "vitest/browser";
import { drawText } from "../src/draw/text.ts";
import { testCanvas, testEnv } from "./pixels.ts";

const fixtures = inject("md2uiFixtures");

/** md2ui's emoji face from the fixtures, loaded into the page under its family. */
async function loadOpenMoji(): Promise<void> {
  const manifest = JSON.parse(await commands.readFile(`${fixtures}/manifest.json`)) as {
    fonts: { faces: Record<string, string | null> };
  };
  const path = Object.entries(manifest.fonts.faces).find(([face]) =>
    face.startsWith("OpenMoji|"),
  )?.[1];
  if (path == null) throw new Error("the fixtures carry no OpenMoji face");
  const data = await commands.readFile(`${fixtures}/${path}`, "base64");
  const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "font/ttf" }));
  await loadFonts([{ family: "OpenMoji", url }], {});
}

const EMOJI: FontSpec = {
  families: ["OpenMoji", "sans-serif"],
  size: 48,
  weight: 400,
  italic: false,
};

test.skipIf(fixtures === "")(
  "an emoji with VS16 in a named face paints in its run's colour",
  async () => {
    await loadOpenMoji();
    const entry: TextEntry = {
      type: "text",
      nodeId: "warn",
      bounds: { x: 0, y: 0, width: 80, height: 80 },
      y: 60,
      runs: [{ text: "\u26A0\uFE0F", x: 10, font: EMOJI, color: "#ff0000ff" }],
    };
    const t = testCanvas(80, 80, 1);
    drawText(t.ctx, entry, testEnv());
    const data = t.ctx.getImageData(0, 0, 80, 80).data;
    const inked: number[][] = [];
    for (let i = 0; i < data.length; i += 4) {
      if ((data[i + 3] ?? 0) > 128) inked.push([...data.subarray(i, i + 3)]);
    }
    expect(inked.length).toBeGreaterThan(50);
    const offColour = inked.filter(([r = 0, g = 0, b = 0]) => r < 200 || g > 40 || b > 40);
    expect(offColour).toEqual([]);
  },
);
