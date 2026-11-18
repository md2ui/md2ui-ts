// Charts: which values a chart or a line takes, and which runs of rows draw as one
// (md2ui: pipeline/grouper_charts.py; ADR-204).
//
// A chart value is a number: `%`, a currency and a magnitude stand alone, every other
// unit is written bare and declared once. A run of `- Key: value` rows in one unit is
// a bar chart (`chart_group`); a run of `- Key: a → b → c` lines in one unit, with as
// many points each, is several lines on one axis (`line_group`). md2ui's reasons for a
// refusal feed its `check` command, which is not ported: here a refusal is null.

import { asDict, type DataPoint } from "./detect/types.ts";
import {
  bareContent,
  clearDatapointDisplays,
  dpScalar,
  pyStr,
  subtreeDps,
  subtreeText,
} from "./display-vocab.ts";
import { GroupNode } from "./node.ts";
import type { RegexKit } from "./py/re.ts";
import { charAt, isspace, rstrip, split, strip } from "./py/str.ts";
import { declaredUnit, withoutUnit } from "./value-format.ts";

type ChartData = NonNullable<GroupNode["chart_data"]>;
type LineData = NonNullable<GroupNode["line_data"]>;

/** One point of a line: its value with its sign, the value as written, its tick label. */
interface LinePoint {
  readonly value: number;
  readonly text: string;
  readonly tick: string | null;
}

// An arrow chain of values (`$710.14 → $713.94 → $720.65`) is a value over time.
const LINE_ARROW = "→";
const LINE_MIN_POINTS = 3;
// Numbers that draw their own display, or name a place rather than measure.
const NOT_MEASURES: readonly string[] = Object.freeze([
  "score",
  "ratio",
  "ranking",
  "ordinal",
  "date",
  "time",
]);

/**
 * md2ui: `_value_unit`. The unit a value is written in, which a chart's values must
 * share: `currency <code>`, `%`, `magnitude`, or `""` for a plain number. Null when a
 * chart cannot draw it: every other unit is written bare and declared (ADR-204).
 */
function valueUnit(dp: DataPoint): string | null {
  const v = asDict(dp.value);
  if (dp.type === "currency" && v !== null) return `currency ${pyStr(v["currency"])}`;
  if (dp.type === "percentage") return "%";
  if (dp.type === "quantity" && v !== null) {
    if (v["unit"]) return null;
    return v["magnitude"] ? "magnitude" : "";
  }
  if (dp.type === "number") return "";
  if (dp.type === "change" && v !== null) {
    // `+5.26%`, `+$2.30`, `+12`: the same units, written with their sign.
    if (v["type"] === "currency") return `currency ${pyStr(v["currency"])}`;
    if (v["type"] === "percentage") return "%";
    return v["type"] === "bare" ? "" : null;
  }
  return null;
}

/** md2ui: `unit_kind`. A unit as a chart compares it: a magnitude is a plain number. */
function unitKind(unit: string | null): string | null {
  return unit === "magnitude" ? "" : unit;
}

/** md2ui: `_run_unit`. `magnitude` only when every value is one, `""` when any is plain. */
function runUnit(units: readonly string[]): string {
  if (units.length > 0 && units.every((u) => u === "magnitude")) return "magnitude";
  return units.includes("") ? "" : (units[0] ?? "");
}

/** md2ui: `_signed_scalar`. A change carries its sign as a direction. */
function signedScalar(dp: DataPoint): number | null {
  const x = dpScalar(dp);
  const v = asDict(dp.value);
  return x !== null && v !== null && v["direction"] === "decrease" ? -Math.abs(x) : x;
}

/** md2ui: `uncharted`. A measured number in a unit no chart takes (`24°`, `120 bpm`). */
function uncharted(dp: DataPoint): boolean {
  return valueUnit(dp) === null && !NOT_MEASURES.includes(dp.type) && dpScalar(dp) !== null;
}

/** md2ui: `_is_marked`. A value with a mark (`%`, currency, magnitude, sign, unit). */
function isMarked(dp: DataPoint): boolean {
  return Boolean(valueUnit(dp)) || dp.type === "change" || uncharted(dp);
}

/**
 * md2ui: `_parse_line`. The points of a value written `a → b → c`, or null. Every
 * piece of the text is accounted for: values joined by `→`, each with an optional
 * `(tick)` naming its point and holding no second value. Three or more values in one
 * kind; a chain holding a plain number draws only when its key `declared` the unit.
 */
export function parseLine(value: GroupNode, declared: boolean): LinePoint[] | null {
  if (value.children.length > 0) return null;
  const text = value.content;
  const n = text.length;
  const dps = [...value.data_points].sort((a, b) => a.start - b.start);
  const starts = new Map(dps.map((d) => [d.start, d]));
  const skipSpace = (p: number): number => {
    let q = p;
    while (q < n && isspace(charAt(text, q))) q += 1;
    return q;
  };
  const points: LinePoint[] = [];
  const units = new Set<string>();
  let plain = false;
  let pos = 0;
  for (;;) {
    pos = skipSpace(pos);
    const dp = starts.get(pos);
    if (dp === undefined || uncharted(dp)) return null;
    const unit = valueUnit(dp);
    const scalar = signedScalar(dp);
    if (unit === null || scalar === null) return null;
    plain ||= unit === "";
    units.add(unitKind(unit) ?? "");
    let tick: string | null = null;
    pos = skipSpace(dp.end);
    if (pos < n && text[pos] === "(") {
      const close = text.indexOf(")", pos);
      if (close < 0) return null;
      tick = strip(text.slice(pos + 1, close));
      if (!tick || tick.includes("(")) return null;
      const open = pos;
      if (dps.some((d) => open < d.start && d.start < close && isMarked(d))) return null;
      pos = skipSpace(close + 1);
    }
    points.push({ value: scalar, text: strip(dp.matched), tick });
    if (pos >= n) break;
    const arrow = starts.get(pos);
    if (arrow === undefined || strip(arrow.matched) !== LINE_ARROW) return null;
    pos = arrow.end;
  }
  if (points.length < LINE_MIN_POINTS || units.size !== 1) return null;
  return plain && !declared ? null : points;
}

/** The `key` and `value` of a bullet item whose sole content is one `Key: value` pair. */
function bulletPair(node: GroupNode): [GroupNode, GroupNode] | null {
  if (node.type !== "list_item" && node.type !== "ordered_item") return null;
  const contentKids = node.children.filter((c) => subtreeText(c));
  const kv = contentKids[0];
  if (contentKids.length !== 1 || kv === undefined || kv.type !== "key-value") return null;
  const key = kv.children.find((c) => c.type === "key");
  const value = kv.children.find((c) => c.type === "value");
  return key === undefined || value === undefined ? null : [key, value];
}

/** A chart row: its label, its values with their signs, as written, and their unit. */
type ChartRow = readonly [label: string, values: number[], texts: string[], unit: string];

/**
 * md2ui: `_parse_chart_row` (`_chart_row_info`). The row a bullet `Key: value(s)` pair
 * makes, or null: its values alone, comma-separated, in one kind; a plain number only
 * when the run `declared` its unit above it.
 */
function chartRow(node: GroupNode, declared: boolean): ChartRow | null {
  const pair = bulletPair(node);
  if (pair === null) return null;
  const [key, value] = pair;
  const dps = subtreeDps(value).filter((d) => valueUnit(d) !== null || uncharted(d));
  if (dps.length === 0) return null;
  let rest = bareContent(subtreeText(value));
  for (const d of dps) rest = rest.replace(strip(d.matched), () => "");
  if (strip(rest.replaceAll(",", ""), "*_` ")) return null;
  if (dps.some(uncharted)) return null;
  const written = dps.map((d) => valueUnit(d) ?? "");
  if (new Set(written.map(unitKind)).size !== 1) return null;
  const unit = runUnit(written);
  if (!unit && !declared) return null;
  const values: number[] = [];
  for (const d of dps) {
    const x = signedScalar(d);
    if (x === null) return null;
    values.push(x);
  }
  return [subtreeText(key), values, dps.map((d) => strip(d.matched)), unit];
}

/** md2ui: `_series_header_names`. The series of a `Key 1, Key 2:` header line. */
function seriesHeaderNames(kit: RegexKit, node: GroupNode): string[] | null {
  if (node.children.length > 0 || (node.type !== "text" && node.type !== "segment")) return null;
  const text = withoutUnit(kit, rstrip(bareContent(node.content), ":"));
  if (!text.includes(",")) return null;
  const names = text.split(",").map((p) => strip(p));
  return names.some((name) => !name) ? null : names;
}

/** md2ui: `_header_unit`. The unit a short line declares for the run below it (`Temperature (°C):`). */
function headerUnit(kit: RegexKit, node: GroupNode): string | null {
  if (node.children.length > 0 || (node.type !== "text" && node.type !== "segment")) return null;
  const text = rstrip(bareContent(node.content), ":");
  return split(text).length <= 6 ? declaredUnit(kit, text) : null;
}

/**
 * Each child's row, read with the unit a header line right above its run declares,
 * carried down the run until a child is no row.
 */
function declaredRows<T>(
  kids: readonly GroupNode[],
  units: readonly (string | null)[],
  read: (child: GroupNode, declaring: string | null) => T | null,
): (T | null)[] {
  const rows: (T | null)[] = [];
  let declaring: string | null = null;
  kids.forEach((child, k) => {
    declaring = (k > 0 ? units[k - 1] : null) || declaring;
    const row = read(child, declaring);
    if (row === null) declaring = null;
    rows.push(row);
  });
  return rows;
}

/**
 * Replaces each `[start, end)` run of `node`'s children with a new group carrying its
 * flag, or flags `node` itself when one run is all of its children; the rows' own
 * display flags clear (the run's display wins).
 */
function wrapRuns(
  node: GroupNode,
  runs: readonly (readonly [start: number, end: number, flag: (g: GroupNode) => void])[],
): void {
  const n = node.children.length;
  const only = runs[0];
  if (runs.length === 1 && only !== undefined && only[0] === 0 && only[1] === n && !node.content) {
    clearDatapointDisplays(node);
    only[2](node);
    return;
  }
  const out: GroupNode[] = [];
  let pos = 0;
  for (const [start, end, flag] of runs) {
    out.push(...node.children.slice(pos, start));
    const wrapper = new GroupNode("", "group");
    flag(wrapper);
    wrapper.children = node.children.slice(start, end);
    // Keep the wrapper a well-behaved direct child of a glued group.
    wrapper.glued_content_id = wrapper.children[0]?.glued_content_id ?? null;
    for (const c of wrapper.children) clearDatapointDisplays(c);
    out.push(wrapper);
    pos = end;
  }
  out.push(...node.children.slice(pos));
  node.children = out;
}

/**
 * md2ui: `_flag_chart_groups`. Post-order: 3+ single-value rows in one unit, or 2+
 * N-value rows under an N-name series header, become a bar chart.
 */
function flagChartGroups(kit: RegexKit, node: GroupNode, inTable: boolean): void {
  const tableHere = inTable || node.table_group;
  for (const child of node.children) flagChartGroups(kit, child, tableHere);
  if (tableHere || node.chart_group || node.children.length === 0) return;
  const kids = node.children;
  const units = kids.map((c) => headerUnit(kit, c));
  const infos = declaredRows(kids, units, (c, declaring) => chartRow(c, declaring !== null));
  if (!infos.some((info) => info !== null)) return;

  const runs: [number, number, string[] | null, number][] = [];
  const n = kids.length;
  for (let i = 0; i < n; ) {
    const info = infos[i];
    if (info === null || info === undefined) {
      i += 1;
      continue;
    }
    const width = info[1].length;
    const kind = unitKind(info[3]);
    let j = i + 1;
    for (let next = infos[j]; next && next[1].length === width && unitKind(next[3]) === kind; ) {
      j += 1;
      next = infos[j];
    }
    if (width === 1) {
      if (j - i >= 3) runs.push([i, j, null, i]);
    } else if (j - i >= 2 && i > 0) {
      const names = seriesHeaderNames(kit, kids[i - 1] as GroupNode);
      if (names !== null && names.length === width) runs.push([i - 1, j, names, i]);
    }
    i = j;
  }
  if (runs.length === 0) return;

  const chartData = (series: string[] | null, first: number, end: number): ChartData => {
    const rows = infos.slice(first, end).filter((info) => info !== null);
    const unit = runUnit(rows.map((row) => row[3]));
    const shown = first > 0 ? units[first - 1] : null;
    return {
      series,
      unit,
      rows: rows.map(([label, values, texts]) => ({ label, values, texts })),
      ...(!unit && shown ? { display_unit: shown } : {}),
    };
  };
  wrapRuns(
    node,
    runs.map(([start, end, series, first]) => [
      start,
      end,
      (g: GroupNode) => {
        g.chart_group = true;
        g.chart_data = chartData(series, first, end);
      },
    ]),
  );
}

/** A line item: its series name, its points, its unit kind, the unit declared for it. */
type LineRow = readonly [name: string, points: LinePoint[], kind: string, declared: string | null];

/**
 * md2ui: `_line_row`. The line a bullet `Key: a → b → c` pair draws, its unit declared
 * in its key or, for the run, on the line above (`declaring`); null otherwise.
 */
function lineRow(kit: RegexKit, node: GroupNode, declaring: string | null): LineRow | null {
  const pair = bulletPair(node);
  if (pair === null) return null;
  const [key, value] = pair;
  const name = subtreeText(key);
  const own = declaredUnit(kit, name) ?? declaring;
  const points = parseLine(value, own !== null);
  const first = subtreeDps(value).find((d) => valueUnit(d) !== null);
  if (points === null || first === undefined) return null;
  return [withoutUnit(kit, name), points, unitKind(valueUnit(first)) ?? "", own];
}

/** md2ui: `_merged_labels`. One label per position, or null when two series disagree. */
function mergedLabels(series: readonly (readonly LinePoint[])[]): (string | null)[] | null {
  const labels: (string | null)[] = [];
  for (let i = 0; i < (series[0]?.length ?? 0); i += 1) {
    const written = new Set(series.map((points) => points[i]?.tick).filter((t) => t));
    if (written.size > 1) return null;
    labels.push([...written][0] ?? null);
  }
  return labels;
}

/** md2ui: `_line_runs`. Each run of 2+ consecutive line items in one declared unit kind. */
function lineRuns(kit: RegexKit, node: GroupNode): [number, number, LineRow[]][] {
  const kids = node.children;
  const units = kids.map((c) => headerUnit(kit, c));
  const rows = declaredRows(kids, units, (c, declaring) => lineRow(kit, c, declaring));
  const runs: [number, number, LineRow[]][] = [];
  for (let i = 0; i < kids.length; ) {
    const row = rows[i];
    if (row === null || row === undefined) {
      i += 1;
      continue;
    }
    const run = [row];
    for (let other = rows[i + 1]; other && other[2] === row[2] && other[3] === row[3]; ) {
      run.push(other);
      other = rows[i + run.length];
    }
    if (run.length >= 2) runs.push([i, i + run.length, run]);
    i += run.length;
  }
  return runs;
}

/**
 * md2ui: `_flag_line_groups`. Post-order: a run of line items is one chart when every
 * line has as many points and no two label one position differently; else every line
 * stays its own. The keys name the series.
 */
function flagLineGroups(kit: RegexKit, node: GroupNode): void {
  for (const child of node.children) flagLineGroups(kit, child);
  if (node.chart_group || node.line_group || node.table_group || node.children.length === 0) return;
  const flagged: [number, number, (g: GroupNode) => void][] = [];
  for (const [start, end, rows] of lineRuns(kit, node)) {
    if (new Set(rows.map((r) => r[1].length)).size > 1) continue;
    const labels = mergedLabels(rows.map((r) => r[1]));
    if (labels === null) continue;
    const data: LineData = {
      series: rows.map(([name, points]) => ({ name, points: [...points] })),
      labels,
      display_unit: rows[0]?.[3] ?? null,
    };
    flagged.push([
      start,
      end,
      (g) => {
        g.line_group = true;
        g.line_data = data;
      },
    ]);
  }
  if (flagged.length > 0) wrapRuns(node, flagged);
}

/** md2ui: `_flag_charts` (Phase 6.07). Bar charts first, then lines on one axis over the rest. */
export function flagCharts(kit: RegexKit, ast: GroupNode): void {
  flagChartGroups(kit, ast, false);
  flagLineGroups(kit, ast);
}
