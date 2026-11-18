// The grids' and the fit votes' own cases, with expected values from md2ui:
//  - `_balance_cols` and `_balance_kind_cols`: md2ui `tests/layout_balance_cols_tests.py`
//    and `tests/layout_balance_kind_cols_tests.py`, ported (pure arithmetic);
//  - `_aspect_cap`: md2ui `tests/layout_aspect_cap_tests.py`'s cases, with the same
//    stand-in heights in place of measured ones (a gap of 0, as md2ui's theme-less run);
//  - generated layouts (`layout-grids.expected.json`), measured on md2ui by a scratch
//    script outside both repositories with the stand-in measurer below on both sides (a
//    word is 7 px a character, a line 7 px a character, a subtree 20 px per leaf):
//    `Orphan row: center` / `stretch` on the root and on a level (md2ui `tests/layout_orphan_row_tests.py`; no
//    corpus theme sets the key, so these are its only oracle).
import type { GroupingNode } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { GroupNode } from "../src/group/node.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { aspectCap, balanceCols, balanceKindCols } from "../src/layout/aspect.ts";
import { FitPoll } from "../src/layout/fit-votes.ts";
import { generate } from "../src/layout/generate.ts";
import { layoutInput } from "../src/layout/input.ts";
import type { LayoutMeasurer } from "../src/layout/measurer.ts";
import type { LayoutNode } from "../src/layout/node.ts";
import { parseTheme } from "../src/theme/parse.ts";
import expected from "./layout-grids.expected.json" with { type: "json" };

type Dict = Record<string, unknown> & { children?: Dict[] };

/** Every leaf of a built subtree. */
function leaves(n: LayoutNode): number {
  return n.children.length === 0 ? 1 : n.children.reduce((s, c) => s + leaves(c), 0);
}

/** The stand-in measurer the expected values were measured with. */
const MEASURER: LayoutMeasurer = {
  leafMinWidth: (node) => {
    if (node.type === "image") return null;
    if (node.type === "emoji") return 24;
    const words = node.content.split(/\s+/).filter((w) => w !== "");
    return Math.max(0, ...words.map((w) => w.length)) * 7;
  },
  leafLineWidth: (node) => (node.type === "image" ? null : node.content.length * 7),
  markerWidth: (props) => (props["size"] as number) + 1.5,
  blockWidth: () => {
    throw new Error("not asked here");
  },
  layoutHeight: (built) => 20 * leaves(built),
};

const leaf = (content: string, cat = "one_word", fields: Dict = {}): Dict => ({
  type: "text",
  content,
  content_length_category: cat,
  text_length_category: cat,
  ...fields,
});
const group = (children: Dict[], flags: Record<string, unknown> = {}): Dict => ({
  type: "group",
  content: "",
  children,
  ...flags,
});

/** md2ui's tree-path ids (`0.1.2`), which its analyzer gives a hand-built tree. */
function withPaths(d: Dict, id = ""): GroupingNode {
  const children = (d.children ?? []).map((c, i) =>
    withPaths(c, id === "" ? `${i}` : `${id}.${i}`),
  );
  return { ...d, node_id: id, fingerprint_hash: null, children } as unknown as GroupingNode;
}

/** The fields the expected values were written with. */
function compact(n: LayoutNode): unknown[] {
  const out: unknown[] = [n.type];
  if (n.ratios.length > 0) out.push(n.ratios);
  if (n.content_id !== null) out.push(n.content_id);
  if (n.render_properties !== null && Object.keys(n.render_properties).length > 0) {
    out.push(n.render_properties);
  }
  const extra: Record<string, unknown> = {};
  for (const k of ["is_card", "grid", "spring", "line_split", "column_row"] as const) {
    if (n[k]) extra[k] = true;
  }
  if (n.grid_cols) extra["grid_cols"] = n.grid_cols;
  if (n.flow_run) extra["flow_run"] = n.flow_run;
  if (n.section_level !== null) extra["section_level"] = n.section_level;
  if (Object.keys(extra).length > 0) out.push(extra);
  if (n.children.length > 0) out.push(n.children.map(compact));
  return out;
}

const layoutOf = (doc: GroupingNode, width: number, themeText = ""): unknown[] =>
  compact(generate(layoutInput(new RegexKit(), doc), width, parseTheme(themeText), MEASURER));

/** Last-row fill of an `n`-item run at `cols` columns (a short run is full). */
function lastFill(cols: number, n: number): number {
  if (n <= cols) return 1;
  const rows = Math.ceil(n / cols);
  return (n - (rows - 1) * cols) / cols;
}

test("_balance_cols keeps a balanced grid and steps an orphaned last row down", () => {
  expect([balanceCols(6, 10), balanceCols(3, 8), balanceCols(3, 11)]).toEqual([6, 3, 3]);
  expect([balanceCols(5, 6), balanceCols(4, 9), balanceCols(3, 4), balanceCols(3, 10)]).toEqual([
    3, 3, 2, 2,
  ]);
  expect([balanceCols(6, 7), balanceCols(5, 7)]).toEqual([4, 4]);
  expect([balanceCols(2, 5), balanceCols(2, 3), balanceCols(1, 9)]).toEqual([2, 2, 1]);
  expect([balanceCols(4, 4), balanceCols(6, 6)]).toEqual([4, 6]);
  for (let cols = 1; cols < 9; cols++) {
    for (let n = cols; n < 20; n++) expect(balanceCols(cols, n)).toBeLessThanOrEqual(cols);
  }
  for (let cols = 3; cols < 9; cols++) {
    for (let n = cols + 1; n < 25; n++) {
      const k = balanceCols(cols, n);
      expect(k >= 2 && k <= cols).toBe(true);
      expect(k === 2 || lastFill(k, n) >= 0.5).toBe(true);
    }
  }
});

test("_balance_kind_cols votes the fill rule across a kind's runs", () => {
  for (let fit = 1; fit < 10; fit++) {
    for (let n = 1; n < 26; n++) expect(balanceKindCols(fit, [n])).toBe(balanceCols(fit, n));
  }
  expect(balanceKindCols(3, [2, 2, 3, 3, 3, 3, 4, 4, 4, 5, 5, 6, 7])).toBe(3);
  expect([balanceKindCols(4, [3, 5]), balanceKindCols(4, [5]), balanceKindCols(3, [4, 5])]).toEqual(
    [3, 3, 2],
  );
  expect([balanceKindCols(4, [2, 2, 3]), balanceKindCols(4, [2, 3, 3, 5])]).toEqual([4, 4]);
  expect(balanceKindCols(4, [1, 1, 1])).toBe(4);
  expect(balanceKindCols(4, [1, 5])).toBe(balanceKindCols(4, [5]));
  expect([balanceKindCols(4, []), balanceKindCols(1, [])]).toEqual([4, 1]);
  // A third of the runs reaches the share: one bad run in three steps the count down.
  expect(balanceKindCols(3, [2, 2, 4])).toBe(2);
  expect([balanceKindCols(4, [4, 8]), balanceKindCols(6, [6, 12])]).toEqual([4, 6]);
  for (let fit = 1; fit < 9; fit++) {
    for (let a = 1; a < 12; a++) {
      for (let b = 1; b < 12; b++) expect(balanceKindCols(fit, [a, b])).toBeLessThanOrEqual(fit);
    }
  }
  for (let fit = 3; fit < 9; fit++) {
    for (let a = 2; a < 14; a++) {
      for (let b = 2; b < 14; b++) {
        const k = balanceKindCols(fit, [a, b]);
        expect(k >= 2 && k <= fit).toBe(true);
        if (k !== fit && k !== 2) expect(lastFill(k, a) >= 0.5 && lastFill(k, b) >= 0.5).toBe(true);
      }
    }
  }
});

test("_aspect_cap widens a tall-thin grid only when that makes it shorter", () => {
  const run = (n: number): GroupNode[] =>
    Array.from({ length: n }, () => new GroupNode("", "group"));
  const cap = (heightOf: (w: number) => number, cols: number, n = 6, width = 1216): number =>
    aspectCap(run(n), cols, width, 0, (_m, w) => heightOf(w));
  const wrapping = (w: number): number => 300000 / w;
  expect(cap(() => 300, 4)).toBe(4);
  const k = cap(wrapping, 4);
  expect(k).toBeLessThan(4);
  expect(wrapping(1216 / k) / (1216 / k) <= 1.5 || k === 1).toBe(true);
  expect(cap(() => 1400, 3)).toBe(3);
  expect(cap((w) => 1400 - (1216 - w) / 1216, 3)).toBe(3);
  expect(cap((w) => (1216 / 3.5 < w && w < 500 ? 900 : 1300), 4)).toBe(3);
  expect(cap((w) => 3 * w, 2, 2, 800)).toBe(2);
  for (const hf of [() => 300, () => 1200, (w: number) => 3 * w]) {
    for (let cols = 1; cols < 6; cols++) expect(cap(hf, cols)).toBeLessThanOrEqual(cols);
  }
  const k5 = cap(wrapping, 5);
  expect(wrapping(1216 / k5) / (1216 / k5) <= 1.5 || k5 === 1).toBe(true);
});

test("a fit poll finds a node's member and path by tree position, whatever the ids", () => {
  const kv = (): GroupNode => {
    const pair = new GroupNode("", "key-value");
    pair.children = [new GroupNode("Key", "key"), new GroupNode("Value", "value")];
    const card = new GroupNode("", "group");
    card.children = [new GroupNode("Title", "text"), pair];
    return card;
  };
  const members = [kv(), kv(), kv()];
  const target = (members[1] as GroupNode).children[1]?.children[1] as GroupNode;
  const ids = (label: (path: string) => string): void => {
    members.forEach((m, i) => {
      const walk = (n: GroupNode, path: string): void => {
        n.node_id = label(path);
        n.children.forEach((c, k) => {
          walk(c, `${path}.${k}`);
        });
      };
      walk(m, `${i}`);
    });
  };
  ids((path) => path);
  const byPath = new FitPoll(members, false).locate(target);
  ids((path) => `opaque-${path.length}`);
  const byOpaque = new FitPoll(members, false).locate(target);
  expect(byPath).toEqual([1, ".1.1"]);
  expect(byOpaque).toEqual(byPath);
  // A cell the generator makes (a drawn separator) is in no member's subtree.
  expect(new FitPoll(members, false).locate(new GroupNode("|", "text"))).toBeNull();
  // Every plain `Key: value` pair seeds a stack vote at its path.
  expect([...(new FitPoll(members, false).seeds.get(".1") ?? [])]).toEqual([0, 1, 2]);
});

/** A card of a title over a key/value pair. */
const kvCard = (title: string, key: string, value: string): Dict =>
  group(
    [
      leaf(title, "short"),
      group(
        [
          { type: "key", content: key, content_length_category: "one_word" },
          { type: "value", content: value, content_length_category: "one_word" },
        ].map((d) => ({ ...d, text_length_category: "one_word" })),
        { type: "key-value", text_length_category: "one_word" },
      ),
    ],
    { glued_content_group: true, content_length_category: "short" },
  );
const KV_RUN = group([
  kvCard("Alpha card", "Price", "12"),
  kvCard("Beta card", "Price", "Averyveryverylongvalue"),
  kvCard("Gamma card", "Price", "7"),
]);

/** The built node holding `contentId` as a direct leaf, in `layoutOf`'s form. */
function holderOf(built: unknown, contentId: string): unknown[] | null {
  if (!Array.isArray(built)) return null;
  const kids = built.at(-1);
  if (Array.isArray(kids) && kids.some((k) => Array.isArray(k) && k[1] === contentId)) {
    return built;
  }
  for (const k of Array.isArray(kids) ? kids : []) {
    const hit = holderOf(k, contentId);
    if (hit !== null) return hit;
  }
  return null;
}

// md2ui `_always_stacks` / `vote`: with the spring pair gone (ADR-205), a plain
// `Key: value` pair always stacks, at every width, whatever its run.
test("in a grid run of key/value cards every pair stacks", () => {
  for (const width of [760, 520]) {
    const built = layoutOf(withPaths(KV_RUN), width);
    for (const card of ["0", "1", "2"]) {
      expect(holderOf(built, `${card}.1.0`)?.[0], `${width} ${card}`).toBe("col");
    }
  }
});

test("the fit votes do not depend on what the ids look like", () => {
  const paths = withPaths(KV_RUN);
  const relabelled = JSON.parse(JSON.stringify(paths)) as GroupingNode;
  const back = new Map<string, string>();
  const walk = (n: GroupingNode, i: number): number => {
    const opaque = `id-${(i * 2654435761) % 4294967296}`;
    back.set(opaque, n.node_id);
    n.node_id = opaque;
    let next = i + 1;
    for (const c of n.children) next = walk(c, next);
    return next;
  };
  walk(relabelled, 1);
  // The stand-in measurer reads no id, so only the content ids need mapping back.
  const restore = (built: unknown): unknown =>
    JSON.parse(JSON.stringify(built), (_k, v: unknown) =>
      typeof v === "string" && back.has(v) ? back.get(v) : v,
    );
  expect(restore(layoutOf(relabelled, 520))).toEqual(layoutOf(paths, 520));
});

/** A card of a title over one line of three pieces, which wraps at a column's width. */
const orphanCard = (i: number): Dict =>
  group(
    [
      leaf(`Item ${i} is one card of a run`, "short"),
      group([leaf("Quantity in kg"), leaf("Stocked at store"), leaf("Delivered daily")], {
        line_split_group: true,
        source_line_id: 7,
      }),
    ],
    { glued_content_group: true, content_length_category: "short" },
  );
const ORPHANS = group([1, 2, 3, 4, 5].map(orphanCard));
const ROOT_ORPHAN = (mode: string): string =>
  `## Background styles and Spacing\n### Root\nOrphan row: ${mode}\n`;

test("Orphan row: left is inert, center stamps the ragged row, stretch shares it", () => {
  const left = layoutOf(withPaths(ORPHANS), 560, ROOT_ORPHAN("left"));
  expect(left).toEqual(expected.orphan_left);
  expect(layoutOf(withPaths(ORPHANS), 560)).toEqual(left);
  expect(layoutOf(withPaths(ORPHANS), 560, ROOT_ORPHAN("center"))).toEqual(expected.orphan_center);
  expect(layoutOf(withPaths(ORPHANS), 560, ROOT_ORPHAN("stretch"))).toEqual(
    expected.orphan_stretch,
  );
});

test("a level's Orphan row beats the root's", () => {
  const section = group(
    [leaf("## Items", "short", { type: "heading2" }), ...[1, 2, 3, 4, 5].map(orphanCard)],
    { heading_group: true, heading_level: 2 },
  );
  const theme =
    "## Background styles and Spacing\n### Root\nOrphan row: center\n### Heading 2\nOrphan row: stretch\n";
  expect(layoutOf(withPaths(section), 560, theme)).toEqual(expected.orphan_level);
});
