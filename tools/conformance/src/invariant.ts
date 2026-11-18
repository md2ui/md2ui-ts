// What a measurer divergence cannot explain. A layout unit with
// differences is `diverged` only when measurer answers explain them; this module finds the
// differences no measurer answer can have caused, so that one of them fails the unit.
//
// The rule. A measurer answer that differs moves the geometry, and through it the
// arrangement:
//   - every later `x`, `y`, `width`, `height` and `ratios`;
//   - where a line wraps, so the number of boxes and link regions a piece of text takes;
//   - which nodes the generator builds around the content: a row of three cards against a
//     row of six, a line flowed into one row or two, so tree shape and indices shift.
// It never changes which content is laid out, or how each piece of it is identified and
// painted. So the outputs are compared a second time, keyed by content instead of by
// position, on everything but the fields measurement moves. What differs there is not
// explained by any divergence.
//
// A layout tree (`layout-generated`, `layout`) is keyed by node: a node is its type and
// the content ids of its subtree, its span, in tree order among nodes with the same
// type and span. A node both sides build is the same node wherever it sits, so a card
// keeps its span when its grid regroups and is compared with its counterpart. A node only
// one side builds is an arrangement (a row the other side wrapped differently, a col
// that became a row): it must be a bare row or col, with nothing of its own to paint or
// name (`OWN`), and is otherwise not compared. The content ids themselves must match: a
// piece of content laid out on one side only is a difference. So must where each is
// tiled: a piece inside a bento mosaic (under a node marked `bento`) on one side only is a
// difference, since measurement reshapes a mosaic's cells but never builds or drops one.
// Not compared on a node: the fields the flow writes from measured widths (`ARRANGED`).
//
// A scene (`boxes`) is keyed by content, without geometry (`GEOMETRY`):
//   - boxes and scrollables by `content_id`: the distinct records of each, so a text that
//     wraps into more boxes compares as one record;
//   - link regions as the set of distinct actions: a link that wraps takes two regions;
//   - sections by position, and their count must match: no wrap adds or drops one;
//   - anchors by name; every other top-level field as it is.
//
// The layout stages take md2ui's own grouping, so a content id is md2ui's on both sides
// and is compared as a value here.
//
// Conservative by construction: a field is excused only when it is listed below as one
// measurement moves, and a node only when it is a bare arrangement. Anything else that
// differs is reported.
import { compare, type Difference, type DifferenceClass } from "./diff.ts";
import { isArray, isObject, type Json, type JsonArray, type JsonObject, render } from "./json.ts";

/**
 * Layout node fields written from measured widths:
 * - `ratios`, `grid`, `grid_cols`: the sizes and grid decisions;
 * - `flow_run`: the run a wrapped line's rows share, only when it wrapped;
 * - `line_split`, `gap_in_line`: line flags md2ui `_flow_line_group` writes on the node
 *   its flow produced, which is the leaf itself when the line keeps one piece, or a row or
 *   col of the pieces when it wraps;
 * - `render_properties.fill_row`: marked on the cells of a row that a wrap filled.
 *
 * Only the fields a diverged unit differs in. The same flow also writes `spring`,
 * `heading_line`, `block_line` and `held_floor`, but no unit differs in them, so they are
 * compared: a regression in one fails rather than hiding behind a measurer divergence.
 */
const ARRANGED = new Set(["ratios", "grid", "grid_cols", "flow_run", "line_split", "gap_in_line"]);
const ARRANGED_PROPERTIES = new Set(["fill_row"]);

/**
 * What a layout node paints or names of its own: a card, a background, a link, a heading
 * anchor, a section style, render properties. An arrangement node has none of them.
 */
const OWN = [
  "is_card",
  "card_kind",
  "background_kind",
  "card_bg_url",
  "link_url",
  "link_node_id",
  "heading_id",
  "section_style_key",
  "render_properties",
];

/** Scene fields that are positions and sizes: a box's, a section's clip, a scroll extent. */
const GEOMETRY = new Set(["x", "y", "width", "height", "clip", "content_width"]);

const asArray = (value: Json | undefined): JsonArray => (isArray(value) ? value : []);

/** The differences between two layout trees that no measurer answer explains. */
export function treeInvariants(expected: Json, actual: Json): Difference[] {
  const e = nodes(expected);
  const a = nodes(actual);
  const out = contentDifferences(e.contents, a.contents, "nodes");
  out.push(...contentDifferences(e.tiled, a.tiled, "tiled"));
  for (const [key, mine] of e.byKey) {
    const theirs = a.byKey.get(key) ?? [];
    mine.forEach((node, i) => {
      const other = theirs[i];
      if (other !== undefined) out.push(...under(node.place, "flag", node.record, other.record));
      else if (!node.bare)
        out.push(difference("tree", node.place, "node", render(node.record), "absent"));
    });
  }
  for (const [key, theirs] of a.byKey) {
    for (const node of theirs.slice(e.byKey.get(key)?.length ?? 0)) {
      if (!node.bare) {
        out.push(difference("tree", `port ${node.place}`, "node", "absent", render(node.record)));
      }
    }
  }
  return out;
}

/** The differences between two scenes that no measurer answer explains. */
export function sceneInvariants(expected: Json, actual: Json): Difference[] {
  const e = isObject(expected) ? expected : {};
  const a = isObject(actual) ? actual : {};
  const out: Difference[] = [];
  const top = (o: JsonObject): JsonObject =>
    Object.fromEntries(
      Object.entries(o).filter(
        ([k]) =>
          !GEOMETRY.has(k) &&
          !["boxes", "scrollables", "regions", "sections", "anchors"].includes(k),
      ),
    );
  out.push(...under("(document)", "value", top(e), top(a)));
  for (const list of ["boxes", "scrollables"]) {
    out.push(...grouped(list, byContent(e[list]), byContent(a[list])));
  }
  const actions = (o: JsonObject): Map<string, Json[]> =>
    new Map([["", distinct(asArray(o["regions"]).map(withoutGeometry).map(withoutHints))]]);
  out.push(...grouped("regions", actions(e), actions(a)));
  const se = asArray(e["sections"]);
  const sa = asArray(a["sections"]);
  if (se.length !== sa.length) {
    out.push(difference("value", "sections", "length", `${se.length}`, `${sa.length}`));
  } else {
    se.forEach((s, i) => {
      out.push(...under(`sections[${i}]`, "value", withoutGeometry(s), withoutGeometry(sa[i])));
    });
  }
  const names = (o: JsonObject): Json =>
    isObject(o["anchors"]) ? Object.keys(o["anchors"]).sort() : [];
  out.push(...under("anchors", "value", names(e), names(a)));
  return out;
}

interface Keyed {
  /** Where the node is, as the tree comparison prints it: `0.1 (row)`. */
  readonly place: string;
  readonly record: JsonObject;
  /** A row or col with nothing of its own (`OWN`): an arrangement, when unmatched. */
  readonly bare: boolean;
}

/**
 * Every node of a tree by its key (type and span), in tree order (a node before its
 * children, so an outer node pairs with the outer one); its content ids, and those of
 * them inside a bento mosaic.
 */
function nodes(tree: Json): { byKey: Map<string, Keyed[]>; contents: string[]; tiled: string[] } {
  const order: { key: string; node: Keyed }[] = [];
  const contents: string[] = [];
  const tiled: string[] = [];
  const walk = (node: Json, chain: string, inMosaic: boolean): string[] => {
    if (!isObject(node)) return [];
    const record = unarranged(node);
    const bare =
      (node["type"] === "row" || node["type"] === "col") &&
      OWN.every((k) => record[k] === undefined || record[k] === null || record[k] === false);
    const entry = { key: "", node: { place: `${chain} (${String(node["type"])})`, record, bare } };
    order.push(entry);
    const span: string[] = [];
    const mosaic = inMosaic || node["bento"] === true;
    const id = node["content_id"];
    if (typeof id === "string") {
      span.push(id);
      contents.push(id);
      if (mosaic) tiled.push(id);
    }
    asArray(node["children"]).forEach((child, i) => {
      span.push(...walk(child, chain === "root" ? `${i}` : `${chain}.${i}`, mosaic));
    });
    entry.key = `${render(node["type"])}\u0000${[...span].sort().join("\u0000")}`;
    return span;
  };
  walk(tree, "root", false);
  const byKey = new Map<string, Keyed[]>();
  for (const { key, node } of order) byKey.set(key, [...(byKey.get(key) ?? []), node]);
  return { byKey, contents, tiled };
}

/**
 * A node's own fields that measurement does not move. Render properties left empty by
 * the removal are `null`, as md2ui writes none: a cell only a wrap filled is `{fill_row}`.
 */
function unarranged(node: JsonObject): JsonObject {
  const out: Record<string, Json> = {};
  for (const [k, v] of Object.entries(node)) {
    if (k === "children" || k === "type" || k === "content_id" || ARRANGED.has(k)) continue;
    if (k === "render_properties" && isObject(v)) {
      const kept = without(v, ARRANGED_PROPERTIES);
      const emptied = Object.keys(kept).length === 0 && Object.keys(v).length > 0;
      out[k] = emptied ? null : kept;
    } else {
      out[k] = v;
    }
  }
  return out;
}

/**
 * Content ids counted differently on the two sides: laid out (`nodes`), or tiled
 * (`tiled`). Measurement never adds or drops a piece, or a mosaic around one.
 */
function contentDifferences(
  expected: readonly string[],
  actual: readonly string[],
  field: "nodes" | "tiled",
): Difference[] {
  const count = (ids: readonly string[]): Map<string, number> => {
    const m = new Map<string, number>();
    for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
    return m;
  };
  const e = count(expected);
  const a = count(actual);
  const out: Difference[] = [];
  for (const id of [...new Set([...e.keys(), ...a.keys()])].sort()) {
    const ne = e.get(id) ?? 0;
    const na = a.get(id) ?? 0;
    if (ne !== na) {
      out.push(difference("tree", `content ${id}`, field, `${ne}`, `${na}`));
    }
  }
  return out;
}

/** A list's entries without geometry, the distinct records of each content id. */
function byContent(list: Json | undefined): Map<string, Json[]> {
  const by = new Map<string, Json[]>();
  for (const entry of asArray(list)) {
    const id = isObject(entry) ? entry["content_id"] : null;
    const key = typeof id === "string" ? id : render(id ?? null);
    const records = by.get(key) ?? [];
    records.push(withoutGeometry(entry));
    by.set(key, records);
  }
  for (const [id, records] of by) by.set(id, distinct(records));
  return by;
}

/**
 * Two groups of distinct records compared: field by field when each side has one record,
 * else as sets, each record the other side lacks reported whole.
 */
function grouped(
  list: string,
  expected: ReadonlyMap<string, Json[]>,
  actual: ReadonlyMap<string, Json[]>,
): Difference[] {
  const out: Difference[] = [];
  for (const id of [...new Set([...expected.keys(), ...actual.keys()])].sort()) {
    const where = id === "" ? list : `${list} of content ${id}`;
    const e = expected.get(id) ?? [];
    const a = actual.get(id) ?? [];
    const [one] = e;
    const [other] = a;
    if (e.length === 1 && a.length === 1 && one !== undefined && other !== undefined) {
      out.push(...under(where, "value", one, other));
      continue;
    }
    const inActual = new Set(a.map(canonical));
    const inExpected = new Set(e.map(canonical));
    for (const r of e) {
      if (!inActual.has(canonical(r)))
        out.push(difference("value", where, "", render(r), "absent"));
    }
    for (const r of a) {
      if (!inExpected.has(canonical(r)))
        out.push(difference("value", where, "", "absent", render(r)));
    }
  }
  return out;
}

/** `compare` on two records, its paths placed under `where`. */
function under(
  where: string,
  cls: DifferenceClass,
  expected: Json,
  actual: Json | undefined,
): Difference[] {
  return compare(expected, actual ?? null, { ids: {} }).map((d) => ({
    ...d,
    class: cls,
    path: d.path === "(document)" ? where : `${where} · ${d.path}`,
  }));
}

function withoutGeometry(entry: Json | undefined): Json {
  return isObject(entry) ? without(entry, GEOMETRY) : (entry ?? null);
}

/** A region without its action's `hints`, which only md2ui's `check` reads (`SERVER_ONLY`). */
function withoutHints(region: Json): Json {
  if (!isObject(region) || !isObject(region["action"])) return region;
  return { ...region, action: without(region["action"], new Set(["hints"])) };
}

function without(o: JsonObject, keys: ReadonlySet<string>): JsonObject {
  return Object.fromEntries(Object.entries(o).filter(([k]) => !keys.has(k)));
}

function distinct(records: readonly Json[]): Json[] {
  const seen = new Map<string, Json>();
  for (const r of records) seen.set(canonical(r), r);
  return [...seen.values()];
}

/**
 * A record as one string, the same on both sides of the fixture boundary: keys sorted,
 * a non-finite float as md2ui writes it, a `bigint` as its digits.
 */
function canonical(value: Json): string {
  if (isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonical(value[k] ?? null)}`).join(",")}}`;
  }
  if (typeof value === "bigint") return `${value}`;
  if (typeof value === "number")
    return Number.isFinite(value) ? `${value}` : JSON.stringify(String(value));
  return JSON.stringify(value);
}

function difference(
  cls: DifferenceClass,
  path: string,
  field: string,
  expected: string,
  actual: string,
): Difference {
  return { class: cls, path, field, expected, actual };
}
