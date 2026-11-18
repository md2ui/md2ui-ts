// The display list over md2ui's whole corpus, in Node, so with no DOM: each
// document is placed exactly as `boxes-replay` places it, then painted. The display list
// has no md2ui fixture (md2ui records pixels, not draw calls), so this checks what C4
// promises instead: the list round-trips through JSON; every colour is `#rrggbbaa`; every
// entry names a node of the document and has finite bounds holding its unclipped
// geometry; every target names an ordinal whose payload has its kind; the outline lists
// real ordinals; and the list with no host state is the list. Painting asks the measurer
// questions md2ui never recorded (a pinned piece's offset, a code token's), which the
// fake measurer answers here. Runs only when MD2UI_FIXTURES names the fixtures.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";
import type {
  DisplayEntry,
  DisplayList,
  GroupingNode,
  PreparedText,
  Rect,
  TextMeasurer,
} from "@md2ui/contracts";
import {
  createFakeMeasurer,
  documentSizer,
  effectiveWidth,
  type LayoutNode,
  layoutInput,
  loadCodeHighlighter,
  paintScene,
  parseTheme,
  placeScene,
  RegexKit,
  sizingMeasurer,
  targetTable,
} from "@md2ui/core";
import { expect, test } from "vitest";
import { fontAnswers, fontReplay, themeFonts } from "../src/font-replay.ts";
import { readJson, readJsonLines } from "../src/json.ts";
import { readManifest } from "../src/manifest.ts";

const fixtures = env["MD2UI_FIXTURES"] ?? "";

/** md2ui's recorded answers, and the fake measurer's for a question md2ui never asked. */
function lenient(recorded: TextMeasurer): TextMeasurer {
  const fake = createFakeMeasurer();
  const either = <T>(first: () => T, second: () => T): T => {
    try {
      return first();
    } catch {
      return second();
    }
  };
  return {
    prepare: (spans): PreparedText => {
      const b = fake.prepare(spans);
      const a = either<PreparedText>(
        () => recorded.prepare(spans),
        () => b,
      );
      return {
        lineWidth: () => either(a.lineWidth, b.lineWidth),
        minWidth: () => either(a.minWidth, b.minWidth),
        lineCount: (w) =>
          either(
            () => a.lineCount(w),
            () => b.lineCount(w),
          ),
        lines: (w) =>
          either(
            () => a.lines(w),
            () => b.lines(w),
          ),
      };
    },
    // A lone space md2ui never measured is NaN in the replay (`font-replay.ts`): here,
    // as any other unasked question, the fake measurer's.
    advance: (t, f) => {
      const a = either(
        () => recorded.advance(t, f),
        () => Number.NaN,
      );
      return Number.isNaN(a) ? fake.advance(t, f) : a;
    },
    fontMetrics: (f) =>
      either(
        () => recorded.fontMetrics(f),
        () => fake.fontMetrics(f),
      ),
    inkBounds: (t, f) =>
      either(
        () => recorded.inkBounds(t, f),
        () => fake.inkBounds(t, f),
      ),
  };
}

const COLOR = /^#[0-9a-f]{8}$/u;
const SLACK = 1e-6;

const finite = (r: Rect): boolean =>
  [r.x, r.y, r.width, r.height].every(Number.isFinite) && r.width >= 0 && r.height >= 0;

const holds = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x - SLACK &&
  inner.y >= outer.y - SLACK &&
  inner.x + inner.width <= outer.x + outer.width + SLACK &&
  inner.y + inner.height <= outer.y + outer.height + SLACK;

/** Every colour string anywhere in a value. */
function colors(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const v of value) colors(v, out);
  else if (value !== null && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "color" || k === "fade") {
        if (typeof v === "string") out.push(v);
      } else colors(v, out);
    }
  }
  return out;
}

/** What an entry's own geometry covers, when it has no clip to cut its ink. */
function geometry(e: DisplayEntry): Rect | null {
  if ("clip" in e && e.clip !== undefined) return null;
  switch (e.type) {
    case "fill":
    case "image":
    case "scroll":
      return e.shape;
    case "stroke":
      return {
        x: e.shape.x - e.width / 2,
        y: e.shape.y - e.width / 2,
        width: e.shape.width + e.width,
        height: e.shape.height + e.width,
      };
    case "line":
      return {
        x: Math.min(e.x0, e.x1),
        y: Math.min(e.y0, e.y1),
        width: Math.abs(e.x1 - e.x0),
        height: Math.abs(e.y1 - e.y0),
      };
    case "arc":
      return { x: e.cx - e.radius, y: e.cy - e.radius, width: 2 * e.radius, height: 2 * e.radius };
    default:
      return null;
  }
}

/** What a list breaks of C4's promises, each named. */
function problems(list: DisplayList, ids: ReadonlySet<string>, grouping: GroupingNode): string[] {
  const found: string[] = [];
  const entries = list.entries.flatMap((e): DisplayEntry[] =>
    e.type === "scroll" ? [e, ...e.entries] : [e],
  );
  entries.forEach((e, i) => {
    if (e.nodeId !== "" && !ids.has(e.nodeId)) found.push(`entry ${i}: unknown node ${e.nodeId}`);
    if (!finite(e.bounds)) found.push(`entry ${i} (${e.type}): bounds ${JSON.stringify(e.bounds)}`);
    const g = geometry(e);
    if (g !== null && !holds(e.bounds, g))
      found.push(`entry ${i} (${e.type}): bounds miss its geometry`);
  });
  for (const c of colors(list)) if (!COLOR.test(c)) found.push(`colour ${c}`);
  const table = targetTable(grouping);
  for (const t of list.targets) {
    if (!finite(t.rect)) found.push(`target ${t.kind}: rect ${JSON.stringify(t.rect)}`);
    if (t.kind === "copy") continue;
    const payload = table[t.ordinal];
    if (payload === undefined) found.push(`target ${t.ordinal}: no payload`);
    else if (payload.kind !== t.kind)
      found.push(`target ${t.ordinal}: ${t.kind} is ${payload.kind}`);
  }
  if (JSON.stringify(JSON.parse(JSON.stringify(list))) !== JSON.stringify(list)) {
    found.push("does not round-trip through JSON");
  }
  return found;
}

test.skipIf(fixtures === "")(
  "every corpus document paints a list C4 accepts, with no DOM",
  async () => {
    expect(typeof (globalThis as { document?: unknown }).document).toBe("undefined");
    const manifest = readManifest(fixtures);
    const raw = JSON.parse(readFileSync(join(fixtures, "manifest.json"), "utf8")) as {
      corpus: { doc: string; theme_input: string | null }[];
    };
    const themeInputs = new Map(raw.corpus.map((e) => [e.doc, e.theme_input]));
    const failures: string[] = [];
    const types = new Map<string, number>();
    const highlighters = new Map<string, Awaited<ReturnType<typeof loadCodeHighlighter>>>();
    let docLabels = 0;
    for (const layout of manifest.layouts) {
      for (const doc of layout.docs) {
        docLabels += 1;
        const name = `${layout.label}/${doc.doc}`;
        try {
          const themeInput = themeInputs.get(doc.doc) ?? null;
          const theme = parseTheme(
            themeInput === null ? "" : readFileSync(join(fixtures, themeInput), "utf8"),
          );
          const records = readJsonLines(
            join(fixtures, "measure", layout.label, `${doc.doc}.jsonl`),
          );
          const fonts = manifest.fonts.get(doc.theme) ?? [];
          const { context, emojiFamily } = themeFonts(
            theme,
            fonts,
            manifest.families.get(doc.theme) ?? {},
          );
          const text = fontReplay(fontAnswers(records, context));
          const grouping = readJson(
            join(fixtures, "grouper", "final", `${doc.doc}.json`),
          ) as unknown as GroupingNode;
          const input = layoutInput(new RegexKit(), grouping);
          const options = { emojiFamily };
          const width = effectiveWidth(
            input,
            theme,
            sizingMeasurer(input, theme, text, options),
            layout.width,
          );
          const baked = readJson(
            join(fixtures, "layout", layout.label, `${doc.doc}.json`),
          ) as unknown as LayoutNode;
          const scene = placeScene(
            documentSizer(input, theme, text, options),
            baked,
            grouping,
            width,
          );
          const painter = documentSizer(input, theme, lenient(text), options);
          const ids = new Set<string>();
          const languages = new Set<string>();
          const visit = (n: GroupingNode): void => {
            ids.add(n.node_id);
            if (n.type === "code_block" && n.code_language) languages.add(n.code_language);
            n.children.forEach(visit);
          };
          visit(grouping);
          // One highlighter per style and language set, as a host keeps one per view.
          const key = `${theme.code_blocks.syntax_style}|${[...languages].sort().join(",")}`;
          let highlight = highlighters.get(key) ?? null;
          if (highlight === null && languages.size > 0) {
            highlight = await loadCodeHighlighter(theme, languages);
            highlighters.set(key, highlight);
          }
          const painted = paintScene(painter, scene, grouping, highlight);
          const broken = problems(painted.list, ids, grouping);
          const slots = targetTable(grouping).length;
          for (const item of painted.outline) {
            if (item.role === "target" && item.ordinal >= slots) {
              broken.push(`outline target ${item.ordinal} past the ${slots} ordinals`);
            }
          }
          if (JSON.stringify(painted.withStates(new Map())) !== JSON.stringify(painted.list)) {
            broken.push("withStates with no state is not the list");
          }
          for (const e of painted.list.entries) types.set(e.type, (types.get(e.type) ?? 0) + 1);
          if (broken.length > 0) failures.push(`${name}: ${broken.length} problems; ${broken[0]}`);
        } catch (error) {
          failures.push(`${name}: threw ${error instanceof Error ? error.stack : String(error)}`);
        }
      }
    }
    console.log(
      [
        `paint replay: ${docLabels - failures.length} of ${docLabels} pass`,
        `entries by type: ${[...types].map(([t, n]) => `${t} ${n}`).join(", ")}`,
        ...failures,
      ].join("\n"),
    );
    // Every document of every layout label was replayed: none was skipped.
    expect(docLabels).toBe(manifest.layouts.reduce((n, layout) => n + layout.docs.length, 0));
    expect(failures).toEqual([]);
  },
  600_000,
);
