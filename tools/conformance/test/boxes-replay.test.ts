// Placement against md2ui: md2ui's baked layout tree, placed at md2ui's width over
// md2ui's recorded FONT answers (`fontReplay`, the exact oracle sizing was proved on),
// must give md2ui's scene exactly: every box, section box, click region, heading anchor
// and scrollable code block (`boxes/`). The input is md2ui's, so a layout difference never
// shows up here. Three differences are allowed: a scrollable's content width that the
// `code-line-runs` cause proves from the recording, case by case; a box moved by button
// labels' `emoji-gap` widths, by no more than they can sum to; and a marker box whose
// height md2ui rounded to float32 (`float32-height`, proved from the recorded outline).
// Anything else fails, printed with its first difference. Runs only when MD2UI_FIXTURES
// names the fixtures.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";
import type { GroupingNode } from "@md2ui/contracts";
import {
  documentSizer,
  effectiveWidth,
  type LayoutNode,
  layoutInput,
  parseTheme,
  placeScene,
  RegexKit,
  sizingMeasurer,
} from "@md2ui/core";
import { expect, test } from "vitest";
import { BOXES } from "../src/checks.ts";
import { compare, type Difference } from "../src/diff.ts";
import { float32Heights } from "../src/float32-height.ts";
import { fontAnswers, fontReplay, themeFonts } from "../src/font-replay.ts";
import { isObject, type Json, readJson, readJsonLines } from "../src/json.ts";
import { readManifest } from "../src/manifest.ts";
import { emojiGapError, type SizingContext, sizingCause } from "../src/sizing-classes.ts";

const fixtures = env["MD2UI_FIXTURES"] ?? "";

const describe = (d: Difference): string =>
  `${d.class} at ${d.path} ${d.field}: expected ${d.expected}, got ${d.actual}`;

/**
 * A scrollable's content width that md2ui's code-line runs explain: the width is the code
 * block plan's, whose only accepted difference is `code-line-runs`, proved here from
 * the recorded runs of that block's content.
 */
function provedCodeWidth(
  ctx: SizingContext,
  grouping: ReadonlyMap<string, GroupingNode>,
  scene: Json,
  d: Difference,
): boolean {
  const at = /^scrollables\[(\d+)\]$/.exec(d.path);
  if (at === null || d.field !== "content_width" || !isObject(scene)) return false;
  const scrollables = scene["scrollables"];
  const entry = Array.isArray(scrollables) ? scrollables[Number(at[1])] : undefined;
  const content = isObject(entry) ? grouping.get(String(entry["content_id"]))?.content : undefined;
  if (content === undefined) return false;
  const node = {
    node_id: "",
    type: "code_block",
    content,
    heading_ctx: 0,
    atx_level: 0,
    text_style: null,
    text_style_chain: [],
    code_variant: null,
    code_language: null,
    emoji_kind: null,
    emoji_index: 0,
    emoji_variant: null,
    in_key: false,
    table_role: null,
    link_variant: null,
    link_label: null,
    link_is_emoji: false,
    link_disabled: false,
    drawing_element: null,
  } as const;
  const q = { kind: "code_block", node, role: null, field: "width", what: d.path };
  return sizingCause(ctx, q, Number(d.expected), Number(d.actual)) === "code-line-runs";
}

/**
 * A value moved by `emoji-gap` widths: md2ui's stretched space misses the gap by a few
 * ulps, and a box can move by that once for each gap before it, at most two per button.
 */
function provedGapShift(
  ctx: SizingContext,
  grouping: ReadonlyMap<string, GroupingNode>,
  d: Difference,
): boolean {
  const error = emojiGapError(ctx);
  const shift = Math.abs(Number(d.expected) - Number(d.actual));
  if (error === 0 || Number.isNaN(shift)) return false;
  const links = [...grouping.values()].filter((n) => n.type === "link").length;
  return shift <= 2 * links * error;
}

/** Every node of a grouping tree by id. */
function byId(root: GroupingNode): Map<string, GroupingNode> {
  const nodes = new Map<string, GroupingNode>();
  const visit = (n: GroupingNode): void => {
    nodes.set(n.node_id, n);
    n.children.forEach(visit);
  };
  visit(root);
  return nodes;
}

test.skipIf(fixtures === "")(
  "placement replays md2ui's scenes",
  () => {
    const manifest = readManifest(fixtures);
    const raw = JSON.parse(readFileSync(join(fixtures, "manifest.json"), "utf8")) as {
      corpus: { doc: string; theme_input: string | null }[];
    };
    const themeInputs = new Map(raw.corpus.map((e) => [e.doc, e.theme_input]));
    const failures: string[] = [];
    const proved: string[] = [];
    let docLabels = 0;
    for (const layout of manifest.layouts) {
      for (const doc of layout.docs) {
        const wanted = join(fixtures, "boxes", layout.label, `${doc.doc}.json`);
        if (!existsSync(wanted)) continue;
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
          const actual = JSON.parse(
            JSON.stringify({ asked_width: layout.width, ...scene }),
          ) as Json;
          const ctx: SizingContext = { theme, records };
          const nodes = byId(grouping);
          const expected = readJson(wanted);
          const all = compare(expected, actual, BOXES);
          const heights = float32Heights(expected, actual, records, all);
          const diffs = all.filter((d) => {
            const cause = heights.has(d)
              ? "float32-height"
              : provedCodeWidth(ctx, nodes, actual, d)
                ? "code-line-runs"
                : provedGapShift(ctx, nodes, d)
                  ? "emoji-gap"
                  : null;
            if (cause === null) return true;
            proved.push(`${name}: ${cause} at ${d.path}: md2ui ${d.expected}, port ${d.actual}`);
            return false;
          });
          if (diffs.length > 0) {
            failures.push(
              `${name}: ${diffs.length} differences; ${describe(diffs[0] as Difference)}`,
            );
          }
        } catch (error) {
          failures.push(`${name}: threw ${error instanceof Error ? error.stack : String(error)}`);
        }
      }
    }
    console.log(
      [
        `boxes replay: ${docLabels - failures.length} of ${docLabels} pass`,
        ...proved,
        ...failures,
      ].join("\n"),
    );
    // Every document of every layout label was replayed: none was skipped.
    expect(docLabels).toBe(manifest.layouts.reduce((n, layout) => n + layout.docs.length, 0));
    expect(failures).toEqual([]);
  },
  600_000,
);
