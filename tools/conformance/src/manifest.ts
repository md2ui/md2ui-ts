// The fixtures' manifest.json (md2ui `scripts/export_ts_fixtures.py`): which md2ui
// commit made them, the corpus and its inputs, the themes, the grouper's phases, the
// layout widths and variants, and the font files md2ui measured with. Every input a stage takes is in the fixtures, so nothing
// reads an md2ui checkout.
// It is read strictly: a fixture format this runner does not know is an error, not a
// guess.
import { join } from "node:path";
import { openSync } from "fontkit";
import { SetupError } from "./errors.ts";
import { isArray, isObject, type Json, type JsonObject, readJson } from "./json.ts";

export interface Document {
  /** The fixture name: the path under md2ui's `data/markdown`, `/` written `__`. */
  readonly doc: string;
  /** The Markdown file's path in md2ui, as `--doc` names it. */
  readonly path: string;
  /** The Markdown file's copy in the fixtures, relative to the fixtures directory. */
  readonly input: string;
  /** The theme it renders with: a key under `theme/`. */
  readonly theme: string;
}

export interface Theme {
  /** The key under `theme/`: `_defaults` (no THEME file), `THEME`, `data__markdown__…`. */
  readonly theme: string;
  /** The THEME file's path in md2ui and its copy in the fixtures; null for `_defaults`. */
  readonly file: { readonly path: string; readonly input: string } | null;
}

export interface Phase {
  /** md2ui's name for the phase, from its `# Phase N —` comment: `2.1`, `safety-net`. */
  readonly phase: string;
  /** The directory its trees are in: `02-phase-2.1`. */
  readonly dir: string;
}

export interface LayoutLabel {
  /** `767`, `1280`, or a variant: `1280-overlays`. */
  readonly label: string;
  readonly width: number;
  /** md2ui render flags of a variant; empty for a plain width. */
  readonly flags: readonly string[];
  readonly docs: readonly Document[];
}

/** Where md2ui set a variable font's axes for one of its faces (`fonts.axes`). */
export interface FaceInstance {
  /** Axis tag → the coordinate md2ui's face was made at. */
  readonly coordinates: Readonly<Record<string, number>>;
  /** Axis tag → the font's `[min, max]` on it, which md2ui clamps an asked value to. */
  readonly ranges: Readonly<Record<string, readonly [number, number]>>;
}

/** A font file md2ui measured with (`fonts/` in the fixtures). */
export interface FontFile {
  /** md2ui's face key: `family|PostScript|weight|width|slant`. */
  readonly face: string;
  /** Relative to the fixtures directory. */
  readonly path: string;
  readonly sha256: string;
  /**
   * Where md2ui read it: the path a theme names it by (`assets/fonts/…`), or a system
   * file's absolute path (`…/Courier.ttc#0` for a collection's face).
   */
  readonly source: string;
  /** Set when the face is an instance of a variable font, which the file holds whole. */
  readonly instance?: FaceInstance;
}

export interface Manifest {
  readonly commit: string;
  readonly dirty: boolean;
  readonly date: string;
  readonly corpus: readonly Document[];
  readonly phases: readonly Phase[];
  readonly themes: readonly Theme[];
  readonly layouts: readonly LayoutLabel[];
  /**
   * Theme key → the files of the faces its documents were measured in. A face md2ui
   * reached only as a per-glyph system fallback has no file and is not listed.
   */
  readonly fonts: ReadonlyMap<string, readonly FontFile[]>;
  /**
   * Theme key → each family name md2ui resolved by name to a face of another family,
   * from the system: a code block's `monospace` → `Courier`.
   */
  readonly families: ReadonlyMap<string, Readonly<Record<string, string>>>;
}

/**
 * 2: the font files, `fonts/` and the manifest's `fonts`. 3: `fonts.families`. 4: a
 * text question carries `scale_x` (a stretched font) and `shaped` (an emoji run measured
 * whole) where they apply; `fonts.axes`, where present, names a variable font's instances.
 */
const FORMAT_VERSION = 4;

export function readManifest(fixtures: string): Manifest {
  const raw = readJson(join(fixtures, "manifest.json"));
  const m = object(raw, "manifest");
  if (m["format_version"] !== FORMAT_VERSION) {
    throw new SetupError(
      `manifest: format_version ${String(m["format_version"])}, expected ${FORMAT_VERSION}: re-export the fixtures with md2ui's scripts/export_ts_fixtures.py`,
    );
  }
  if (m["string_offsets"] !== "code points") {
    throw new SetupError(
      `manifest: string_offsets ${String(m["string_offsets"])}, expected code points`,
    );
  }
  const corpus = list(m["corpus"], "corpus").map((entry, i): Document => {
    const e = object(entry, `corpus[${i}]`);
    return {
      doc: text(e["doc"], `corpus[${i}].doc`),
      path: text(e["path"], `corpus[${i}].path`),
      input: text(e["input"], `corpus[${i}].input`),
      theme: text(e["theme"], `corpus[${i}].theme`),
    };
  });
  const byPath = new Map(corpus.map((d) => [d.path, d]));
  const widths = list(m["widths"], "widths").map((w, i) => int(w, `widths[${i}]`));
  const variants = list(m["variants"], "variants").map((entry, i): LayoutLabel => {
    const v = object(entry, `variants[${i}]`);
    const width = int(v["width"], `variants[${i}].width`);
    const path = text(v["doc"], `variants[${i}].doc`);
    const doc = byPath.get(path);
    if (doc === undefined)
      throw new SetupError(`manifest: variants[${i}].doc ${path} is not in the corpus`);
    return {
      label: `${width}-${text(v["name"], `variants[${i}].name`)}`,
      width,
      flags: list(v["flags"], `variants[${i}].flags`).map((f, j) => text(f, `flags[${j}]`)),
      docs: [doc],
    };
  });
  return {
    commit: text(m["md2ui_commit"], "md2ui_commit"),
    dirty: m["md2ui_dirty"] === true,
    date: text(m["date"], "date"),
    corpus,
    phases: list(m["phases"], "phases").map((entry, i): Phase => {
      const p = object(entry, `phases[${i}]`);
      return {
        phase: text(p["phase"], `phases[${i}].phase`),
        dir: text(p["dir"], `phases[${i}].dir`),
      };
    }),
    themes: list(m["themes"], "themes").map((entry, i): Theme => {
      const t = object(entry, `themes[${i}]`);
      const path = t["theme_path"];
      return {
        theme: text(t["theme"], `themes[${i}].theme`),
        file:
          path === null
            ? null
            : {
                path: text(path, `themes[${i}].theme_path`),
                input: text(t["theme_input"], `themes[${i}].theme_input`),
              },
      };
    }),
    layouts: [
      ...widths.map((width) => ({ label: `${width}`, width, flags: [], docs: corpus })),
      ...variants,
    ],
    fonts: fontsOf(object(m["fonts"], "fonts"), fixtures),
    families: familiesOf(object(m["fonts"], "fonts")),
  };
}

/** The `[min, max]` of each variation axis of the font file at `path`. */
function axisRanges(path: string): Record<string, readonly [number, number]> {
  const font = openSync(path);
  if (!("variationAxes" in font)) throw new SetupError(`${path} is a collection, not a font`);
  return Object.fromEntries(
    Object.entries(font.variationAxes).flatMap(([tag, axis]) =>
      axis === undefined ? [] : [[tag, [axis.min, axis.max] as const]],
    ),
  );
}

function fontsOf(fonts: JsonObject, fixtures: string): ReadonlyMap<string, readonly FontFile[]> {
  const faces = object(fonts["faces"], "fonts.faces");
  const files = object(fonts["files"], "fonts.files");
  // Absent before md2ui exported variable-font instances.
  const axes = fonts["axes"] === undefined ? {} : object(fonts["axes"], "fonts.axes");
  const ranges = new Map<string, Record<string, readonly [number, number]>>();
  const instanceOf = (face: string, file: string): FaceInstance | undefined => {
    const set = axes[face];
    if (set === undefined) return undefined;
    const coordinates = Object.fromEntries(
      Object.entries(object(set, `fonts.axes[${face}]`)).map(([tag, value]) => {
        if (typeof value !== "number") {
          throw new SetupError(`manifest: fonts.axes[${face}].${tag} is not a number`);
        }
        return [tag, value];
      }),
    );
    let range = ranges.get(file);
    if (range === undefined) {
      range = axisRanges(join(fixtures, file));
      ranges.set(file, range);
    }
    return { coordinates, ranges: range };
  };
  const fileOf = (face: string): FontFile | undefined => {
    const path = faces[face];
    if (path === undefined) throw new SetupError(`manifest: fonts.faces has no ${face}`);
    if (path === null) return undefined;
    const name = text(path, `fonts.faces[${face}]`);
    const file = object(files[name], `fonts.files[${name}]`);
    const instance = instanceOf(face, name);
    return {
      face,
      path: name,
      sha256: text(file["sha256"], `fonts.files[${name}].sha256`),
      source: text(file["source"], `fonts.files[${name}].source`),
      ...(instance === undefined ? {} : { instance }),
    };
  };
  return new Map(
    Object.entries(object(fonts["themes"], "fonts.themes")).map(([theme, used]) => [
      theme,
      list(used, `fonts.themes[${theme}]`).flatMap((face, i) => {
        const file = fileOf(text(face, `fonts.themes[${theme}][${i}]`));
        return file === undefined ? [] : [file];
      }),
    ]),
  );
}

function familiesOf(fonts: JsonObject): ReadonlyMap<string, Readonly<Record<string, string>>> {
  return new Map(
    Object.entries(object(fonts["families"], "fonts.families")).map(([theme, names]) => [
      theme,
      Object.fromEntries(
        Object.entries(object(names, `fonts.families[${theme}]`)).map(([name, family]) => [
          name,
          text(family, `fonts.families[${theme}][${name}]`),
        ]),
      ),
    ]),
  );
}

function object(value: Json | undefined, what: string): JsonObject {
  if (!isObject(value)) throw new SetupError(`manifest: ${what} is not an object`);
  return value;
}

function list(value: Json | undefined, what: string): readonly Json[] {
  if (!isArray(value)) throw new SetupError(`manifest: ${what} is not a list`);
  return value;
}

function text(value: Json | undefined, what: string): string {
  if (typeof value !== "string") throw new SetupError(`manifest: ${what} is not a string`);
  return value;
}

function int(value: Json | undefined, what: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new SetupError(`manifest: ${what} is not an integer`);
  }
  return value;
}
