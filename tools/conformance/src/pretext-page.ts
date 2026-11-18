// The browser side of layout conformance (stage C) and of placement, bundled and
// loaded into a page by `pretext-browser.ts`. Layout runs end to end as it ships:
// `sizingMeasurer` over the Pretext measurer, with Pretext itself answered at its canvas
// `measureText` boundary by md2ui's recorded font answers (ADR-002, ADR-403). What md2ui
// never measured is measured in md2ui's own face, from the font files the fixtures carry,
// so no answer depends on the machine's fonts. Placement places md2ui's own baked tree
// the same way, so a layout difference never shows up in it. Every answer is traced
// (`pretext-trace.ts`). Nothing runs on import: the page calls `pretextSession()`.
import type { FontSpec, GroupingNode } from "@md2ui/contracts";
import {
  autoLayout,
  bakeLayout,
  documentSizer,
  type EmojiVariation,
  effectiveWidth,
  generate,
  type LayoutNode,
  layoutInput,
  parseTheme,
  placeScene,
  RegexKit,
  sizingMeasurer,
} from "@md2ui/core";
import {
  type FamilyFace,
  installReplayCanvas,
  loadFaces,
  loadFamilies,
  type ReplaySource,
} from "@md2ui/text-conformance";
import { createFontFaces, createPretextMeasurer } from "@md2ui/text-pretext";
import { recordedAnswers } from "./closure-replay.ts";
import {
  type FaceSource,
  type FontAnswers,
  fontAnswers,
  fontReplay,
  themeFonts,
} from "./font-replay.ts";
import { parseJson } from "./json.ts";
import { type AnswerDifference, closureTrace, tracedMeasurer } from "./pretext-trace.ts";
import { sizingCause } from "./sizing-classes.ts";

/** One document at one width, as text: the page parses it. */
export interface PagePayload {
  /** md2ui's final grouping tree (C1), offsets in UTF-16 units. */
  readonly grouping: string;
  /** The THEME file's text; `null` is no THEME file. */
  readonly theme: string | null;
  /** `measure/<label>/<doc>.jsonl` and `measure-layout/<label>/<doc>.jsonl`. */
  readonly measure: string;
  readonly measureLayout: string;
  readonly width: number;
  /** The faces md2ui measured the theme's documents in, each loaded by `loadFonts`. */
  readonly fonts: readonly FaceSource[];
  /** Family names md2ui resolved to another family's face (`fontAnswers`). */
  readonly families: Readonly<Record<string, string>>;
}

export interface PageResult {
  /** The LayoutNode tree before and after the bakes, as JSON. */
  readonly generated: string;
  readonly baked: string;
  readonly differences: readonly AnswerDifference[];
}

/** A document to place: md2ui's baked layout tree beside the layout payload. */
export interface PlacePayload extends PagePayload {
  readonly layout: string;
}

export interface PlaceResult {
  /** The placed scene (`boxes/`'s form, without `asked_width`), as JSON. */
  readonly scene: string;
  readonly differences: readonly AnswerDifference[];
}

/** One md2ui face and its font file (`fonts/` in the fixtures), base64. */
export interface PageFont {
  /** md2ui's face key, `family|PostScript|weight|width|slant`: the family it is loaded as. */
  readonly face: string;
  readonly data: string;
  /** An instance's coordinates (`FaceInstance`), which it is loaded at. */
  readonly axes?: Readonly<Record<string, number>>;
}

export interface PretextSession {
  /** Loads faces into the page; the caller sends each face once. */
  loadFonts(fonts: readonly PageFont[]): Promise<void>;
  layout(payload: PagePayload): Promise<PageResult>;
  place(payload: PlacePayload): Promise<PlaceResult>;
}

/** VARIATION SELECTOR-15 and -16. */
const TEXT_PRESENTATION = "\uFE0E";
const EMOJI_PRESENTATION = "\uFE0F";

/** The canvas font shorthand Pretext is given (`text-pretext`'s `cssFont`), read back. */
const FONT = /^(italic )?(\d+) ([\d.]+)px (.+)$/u;
const FAMILY = /"((?:[^"\\]|\\.)*)"|([^,\s][^,]*)/gu;

function fontOf(css: string): FontSpec | undefined {
  const m = FONT.exec(css);
  if (m === null) return undefined;
  const [, italic, weight = "", size = "", list = ""] = m;
  const families = [...list.matchAll(FAMILY)].map(([, quoted, bare]) =>
    quoted === undefined ? (bare ?? "").trim() : quoted.replace(/\\(.)/gu, "$1"),
  );
  // `cssFont` ends every stack in a generic family that md2ui never names.
  families.pop();
  return { families, size: Number(size), weight: Number(weight), italic: italic !== undefined };
}

function attempt<T>(run: () => T): T | undefined {
  try {
    return run();
  } catch {
    return undefined;
  }
}

/**
 * md2ui's faces as a canvas font, each loaded under its key (`loadFaces`). Italic asked
 * of an upright face is asked italic: md2ui slants it (`styled_font`), and the browser
 * synthesizes the same oblique for a family loaded with no italic face. Neither moves an
 * advance (`oblique.browser.test.ts`).
 */
function canvasFont(faces: readonly string[], font: FontSpec, loaded: ReadonlySet<string>): string {
  for (const face of faces) {
    if (!loaded.has(face)) throw new Error(`md2ui's face ${face} has no font file in the fixtures`);
  }
  const slant = font.italic && faces[0]?.endsWith("|0") ? "italic " : "";
  return `${slant}${font.size}px ${faces.map((face) => JSON.stringify(face)).join(", ")}`;
}

/**
 * md2ui's font answers at the canvas boundary: a text md2ui never measured is a gap,
 * measured in md2ui's faces.
 */
function fontSource(answers: FontAnswers, loaded: ReadonlySet<string>): ReplaySource {
  return (css, canvas) => {
    const font = fontOf(css);
    if (font === undefined) throw new Error(`a canvas font Pretext never sets: ${css}`);
    // The text as authored: the Pretext measurer hands a named face VS16 as VS15
    // (`canvasText`), which md2ui never sees. The corpus writes no VS15 of its own.
    const text = canvas.replaceAll(TEXT_PRESENTATION, EMOJI_PRESENTATION);
    // md2ui never measured a lone space in a face it measured only whole labels in;
    // `advance` answers NaN for it, which is a gap here too.
    const advance = attempt(() => answers.advance(text, font));
    const width = advance === undefined || Number.isNaN(advance) ? undefined : advance;
    const metrics = attempt(() => answers.fontMetrics(font));
    const ink = answers.ink(text, font);
    return {
      face: answers.face(font),
      canvasFont: canvasFont(answers.faces(font), font, loaded),
      ...(width === undefined ? {} : { width }),
      ...(metrics === undefined ? {} : { metrics }),
      ...(ink === undefined ? {} : { ink }),
    };
  };
}

const lines = (text: string) =>
  text
    .split("\n")
    .filter((line) => line !== "")
    .map(parseJson);

/**
 * Installs the replay canvas, then makes the Pretext measurer; call once per page.
 * `fitEpsilon` is Pretext's line-fit epsilon in the page's engine.
 */
export async function pretextSession(fitEpsilon: number): Promise<PretextSession> {
  let source: ReplaySource = () => ({ face: undefined });
  const log = installReplayCanvas((css, text) => source(css, text));
  const faces = createFontFaces();
  const pretext = await createPretextMeasurer([], { faces });
  const loaded = new Set<string>();
  const files: PageFont[] = [];
  const varied = new Set<string>();
  /**
   * The theme's emoji font instances under their own families, made from md2ui's file of
   * the font each varies as a client page makes them (`@md2ui/dom` `emojiInstances`):
   * what Pretext measures outside the canvas resolves to them.
   */
  const loadVariations = async (variations: Iterable<EmojiVariation>): Promise<void> => {
    const families: FamilyFace[] = [];
    for (const variation of variations) {
      if (varied.has(variation.family)) continue;
      varied.add(variation.family);
      const asked = variation.weight ?? 400;
      const own = files.filter(
        (file) => file.axes === undefined && file.face.split("|")[0] === variation.base,
      );
      const weightOf = (file: PageFont): number => Number(file.face.split("|")[2]);
      const rank = (file: PageFont): number =>
        Math.abs(weightOf(file) - asked) * 1000 + weightOf(file);
      const file = own.sort((a, b) => rank(a) - rank(b))[0];
      if (file === undefined) continue;
      families.push({
        family: variation.family,
        data: file.data,
        weight: variation.weight ?? weightOf(file),
        variationSettings: variation.settings,
      });
    }
    // Loaded before the document is measured, so Pretext never caches a fallback for one.
    await loadFamilies(families);
  };
  /** One document's measurers under Pretext, every answer traced. */
  const traced = async (payload: PagePayload) => {
    const theme = parseTheme(payload.theme ?? "");
    const records = lines(payload.measure);
    const { context, emojiFamily } = themeFonts(theme, payload.fonts, payload.families);
    await loadVariations(context.variations.values());
    const answers = fontAnswers(records, context);
    source = fontSource(answers, loaded);
    const md2ui = fontReplay(answers);
    const grouping = parseJson(payload.grouping) as unknown as GroupingNode;
    const input = layoutInput(new RegexKit(), grouping);
    const trace = closureTrace(
      recordedAnswers(records, lines(payload.measureLayout)),
      (question, recorded, port) => sizingCause({ theme, records }, question, recorded, port),
    );
    const md2uiText = { measurer: md2ui, monospaced: answers.monospaced };
    const text = tracedMeasurer(pretext, faces, md2uiText, log, fitEpsilon, trace.text);
    const measurer = trace.measurer(sizingMeasurer(input, theme, text, { emojiFamily }));
    const width = effectiveWidth(input, theme, measurer, payload.width);
    return { theme, grouping, input, text, trace, measurer, width, emojiFamily };
  };
  return {
    async loadFonts(fonts) {
      await loadFaces(fonts);
      for (const font of fonts) {
        loaded.add(font.face);
        files.push(font);
      }
    },
    async layout(payload) {
      const { theme, grouping, input, text, trace, measurer, width, emojiFamily } =
        await traced(payload);
      const sizer = documentSizer(input, theme, text, { emojiFamily });
      // `Layout: Auto` decides as md2ui's export does: each document and width is the
      // first layout in its band, so a measured band builds and places both.
      //
      // The empty area is measured untraced, by Pretext over md2ui's canvas answers, as
      // the port ships: md2ui records no closure answer for it (its own measurer, outside
      // the generator's), and a line it measured whole is no layout difference. A choice
      // that measuring moves shows as a different tree.
      const lines = sizingMeasurer(input, theme, pretext, { emojiFamily });
      const { generated, baked } = autoLayout(input, theme, lines).choose(width, (tiles) => {
        const tree = generate(input, width, theme, measurer, tiles);
        const before = JSON.stringify(tree);
        bakeLayout(tree, theme);
        // Placed only when the choice reads it: a layout no band measures is not placed.
        return {
          generated: before,
          baked: tree,
          get scene() {
            return trace.past(() => placeScene(sizer, tree, grouping, width));
          },
        };
      });
      return {
        generated,
        baked: JSON.stringify(baked),
        differences: trace.differences,
      };
    },
    async place(payload) {
      const { theme, grouping, input, text, trace, width, emojiFamily } = await traced(payload);
      const layout = parseJson(payload.layout) as unknown as LayoutNode;
      const sizer = documentSizer(input, theme, text, { emojiFamily });
      const scene = trace.past(() => placeScene(sizer, layout, grouping, width));
      return { scene: JSON.stringify(scene), differences: trace.differences };
    },
  };
}
