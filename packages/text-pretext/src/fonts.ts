import { clearCache, prepareWithSegments } from "@chenglou/pretext";
import type { FontSource } from "@md2ui/contracts";
import { placeholderFont } from "./canvas-font.ts";

function fontSet(): FontFaceSet {
  const set =
    typeof document !== "undefined"
      ? document.fonts
      : (globalThis as { fonts?: FontFaceSet }).fonts;
  if (set === undefined) {
    throw new Error("No FontFaceSet: web fonts can be loaded only in a window or a Worker");
  }
  return set;
}

/**
 * A font source, or an instance of a variable one: its axes set where CSS
 * `font-variation-settings` states them (`"FILL" 1, "GRAD" -25`). The instance is a
 * family of its own, since a canvas font cannot state variations.
 */
export interface FontFaceSource extends FontSource {
  readonly variationSettings?: string;
}

/**
 * The faces one thread has made, each kept by what makes two sources the same face, so
 * a source named again (another view, a theme or `fonts` set again) reuses its face, or
 * the load already on its way, instead of adding a face to the font set each time. The
 * font set keeps every face it is given, and each holds its own font data (b41 report:
 * about 0.5 MB a face in Chromium).
 */
export interface FontFaces {
  readonly made: Map<string, Promise<FontFace>>;
  /**
   * How many times a face arriving has cleared Pretext's caches, which are the thread's:
   * a measurer that keeps answers of its own drops them when this moves.
   */
  cleared: number;
}

/** No faces made yet: one for each thread, shared by everything that loads fonts in it. */
export function createFontFaces(): FontFaces {
  return { made: new Map(), cleared: 0 };
}

/** What makes two font sources the same face. */
function faceKey(source: FontFaceSource): string {
  return JSON.stringify([
    source.family,
    source.url,
    source.weight ?? 400,
    source.italic === true,
    source.variationSettings ?? "",
  ]);
}

async function makeFace(source: FontFaceSource): Promise<FontFace> {
  const face = new FontFace(source.family, `url(${JSON.stringify(source.url)})`, {
    weight: String(source.weight ?? 400),
    style: source.italic === true ? "italic" : "normal",
    ...(source.variationSettings === undefined
      ? {}
      : { variationSettings: source.variationSettings }),
  });
  try {
    return await face.load();
  } catch (cause) {
    throw new Error(`Font "${source.family}" failed to load from ${source.url}`, { cause });
  }
}

/** The face for `source`, from `faces` when it holds one; one that fails is made again next time. */
function faceFor(source: FontFaceSource, faces: FontFaces | undefined): Promise<FontFace> {
  if (faces === undefined) return makeFace(source);
  const key = faceKey(source);
  const known = faces.made.get(key);
  if (known !== undefined) return known;
  const made = makeFace(source);
  faces.made.set(key, made);
  made.catch(() => {
    if (faces.made.get(key) === made) faces.made.delete(key);
  });
  return made;
}

/** Every measurement taken before a face arrived used the fallback font (ADR-403). */
function clearMeasurements(faces: FontFaces | undefined): void {
  clearCache();
  forgetFontString();
  if (faces !== undefined) faces.cleared += 1;
}

async function loadFont(
  source: FontFaceSource,
  set: FontFaceSet,
  faces: FontFaces | undefined,
): Promise<void> {
  const face = await faceFor(source, faces);
  if (set.has(face)) return;
  set.add(face);
  clearMeasurements(faces);
}

/**
 * Pretext keeps one canvas context for the page and sets its font itself, so the
 * WebKit rule of `setCanvasFont` is applied by making it measure once in the
 * placeholder font: its next font string then differs from its current one.
 */
function forgetFontString(): void {
  prepareWithSegments("x", placeholderFont());
}

/** How the fonts are found and what happens when one fails. */
export interface FontLoading {
  /**
   * Families the theme names. Each face the font set already declares for one of them
   * (a page's `@font-face`) is loaded too, so it is never measured as its fallback.
   */
  readonly pageFamilies?: readonly string[];
  /** Called for a source that fails, which is then skipped. Without it, a failure rejects. */
  readonly onFontError?: (source: FontFaceSource, error: Error) => void;
  /**
   * The faces this thread has made already; without them, every source makes a face,
   * and a measurer sees only the fonts its own load brought (`createPretextMeasurer`).
   */
  readonly faces?: FontFaces;
}

/** A face's family as CSS names it, without the quotes `@font-face` may keep. */
function familyOf(face: FontFace): string {
  return face.family.replace(/^(["'])(.*)\1$/, "$2");
}

/** Loads the faces `set` declares for `families`; Pretext's caches are cleared if any arrives. */
async function loadPageFaces(
  set: FontFaceSet,
  families: readonly string[],
  faces: FontFaces | undefined,
): Promise<void> {
  const pending: FontFace[] = [];
  set.forEach((face) => {
    if (face.status !== "loaded" && families.includes(familyOf(face))) pending.push(face);
  });
  if (pending.length === 0) return;
  // A page face that fails is the page's own: the fallback stays, as it would in CSS,
  // and is measured as before.
  const settled = await Promise.allSettled(pending.map((face) => face.load()));
  if (!settled.some((result) => result.status === "fulfilled")) return;
  clearMeasurements(faces);
}

/**
 * Loads every source into the font set; Pretext's caches are cleared as each face new to
 * the set arrives, and only then.
 */
export async function loadFonts(
  sources: readonly FontFaceSource[],
  { pageFamilies = [], onFontError, faces }: FontLoading,
): Promise<void> {
  const set = fontSet();
  const load = (source: FontFaceSource): Promise<void> =>
    onFontError === undefined
      ? loadFont(source, set, faces)
      : loadFont(source, set, faces).catch((error: unknown) => {
          onFontError(source, error instanceof Error ? error : new Error(String(error)));
        });
  await Promise.all([...sources.map(load), loadPageFaces(set, pageFamilies, faces)]);
}
