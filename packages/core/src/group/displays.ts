// Datapoint displays and the table flag (md2ui: pipeline/grouper_displays.py).
//
// A number can stay text, or become a bar, a ring, a date chip or a line; this module
// stamps that decision on one node for the renderer. `try*` decide for one leaf or its
// container; `flagTableGroups` decides across a run of siblings, because "these rows
// are a table" is a property of the run. Charts are `charts.ts`.
import { parseLine } from "./charts.ts";
import { asDict } from "./detect/types.ts";
import {
  bareContent,
  clearDatapointDisplays,
  coveringDp,
  dpScalar,
  dpUnit,
  pyStr,
  subtreeDps,
  subtreeText,
  truthy,
} from "./display-vocab.ts";
import { GroupNode } from "./node.ts";
import type { RegexKit } from "./py/re.ts";
import { pyFloat, split, strip } from "./py/str.ts";
import { declaredUnit, isBare } from "./value-format.ts";

type Payload = NonNullable<GroupNode["datapoint_payload"]>;

// md2ui: _stamp_table_role. Every descendant without a role takes the cell's.
function stampTableRole(node: GroupNode, role: NonNullable<GroupNode["table_role"]>): void {
  for (const child of node.children) {
    child.table_role ??= role;
    stampTableRole(child, role);
  }
}

const isTableRow = (node: GroupNode): boolean =>
  node.type === "table_header" || node.type === "table_row";

/**
 * md2ui: `_flag_table_groups` (Phase 6.05). Post-order: a contiguous run of table
 * rows (a header starts a new run) is flagged `table_group`, in place when it is
 * all of a node's children, else wrapped; each cell's role reaches its split pieces.
 */
export function flagTableGroups(node: GroupNode): void {
  for (const child of node.children) flagTableGroups(child);
  if (!node.children.some(isTableRow)) return;
  for (const row of node.children) {
    if (!isTableRow(row)) continue;
    for (const cell of row.children) {
      if (cell.table_role !== null && cell.children.length > 0)
        stampTableRole(cell, cell.table_role);
    }
  }
  const runs: [number, number][] = [];
  const n = node.children.length;
  for (let i = 0; i < n; ) {
    if (!isTableRow(node.children[i] as GroupNode)) {
      i += 1;
      continue;
    }
    let j = i + 1;
    while (j < n && node.children[j]?.type === "table_row") j += 1;
    runs.push([i, j]);
    i = j;
  }
  const only = runs[0];
  if (runs.length === 1 && only !== undefined && only[0] === 0 && only[1] === n && !node.content) {
    node.table_group = true;
    return;
  }
  const out: GroupNode[] = [];
  let pos = 0;
  for (const [start, end] of runs) {
    out.push(...node.children.slice(pos, start));
    const wrapper = new GroupNode("", "group");
    wrapper.table_group = true;
    wrapper.children = node.children.slice(start, end);
    out.push(wrapper);
    pos = end;
  }
  out.push(...node.children.slice(pos));
  node.children = out;
}

/** md2ui: `_STAR_SCORE_LABELS`. Star-rating SCORE labels: the starred rendering owns them. */
export const STAR_SCORE_LABELS: readonly string[] = Object.freeze(["stars", "star", "rating"]);

function set(
  node: GroupNode,
  display: NonNullable<GroupNode["datapoint_display"]>,
  payload: Payload,
): void {
  node.datapoint_display = display;
  node.datapoint_payload = payload;
}

/** md2ui: `_try_leaf_display`. A date chip, a ratio bar or a unit ratio on one leaf. */
export function tryLeafDisplay(node: GroupNode, starContext: boolean): void {
  const covering = coveringDp(node);
  if (covering !== null) {
    const v = asDict(covering.value);
    // `Mon-15`: weekday or month and a day, joined by a DASH, no year.
    if (
      covering.type === "date" &&
      v !== null &&
      (v["subtype"] === "weekday_day" || v["subtype"] === "partial") &&
      v["connector"] === "dash" &&
      !truthy(v["has_year"]) &&
      v["day"] !== undefined &&
      v["day"] !== null
    ) {
      set(node, "date_chip", {
        key: rstripChars(split(covering.matched, "-")[0] ?? "", ". "),
        day: Math.trunc(pyFloat(v["day"]) ?? 0),
        subtype: pyStr(v["subtype"]),
      });
      return;
    }
    // A bare `4/8`.
    if (covering.type === "ratio" && !starContext && v !== null && v["format"] === "slash") {
      set(node, "ratio_bar", {
        value: pyFloat(v["left"]) ?? 0,
        max: pyFloat(v["right"]) ?? 0,
        text: bareContent(node.content),
      });
      return;
    }
  }
  // `25/100 progress`: one SCORE fraction, the rest exactly one word.
  const only = node.data_points[0];
  if (node.data_points.length === 1 && only !== undefined && !starContext) {
    const v = asDict(only.value);
    if (only.type === "score" && v !== null) {
      const label = truthy(v["label"]) ? pyStr(v["label"]) : "";
      if (STAR_SCORE_LABELS.includes(label.toLowerCase())) return;
      const content = bareContent(node.content);
      const matched = strip(only.matched);
      if (content.startsWith(matched)) {
        const unit = strip(content.slice(matched.length)) || label;
        if (unit && !unit.includes(" ")) {
          set(node, "unit_ratio", {
            value: pyFloat(v["score"]) ?? 0,
            max: pyFloat(v["max"]) ?? 0,
            unit,
          });
          return;
        }
      }
    }
  }
  // `75/100g`: two data points with a bare `/` between, the second with the unit. It
  // must be the whole leaf, wrappers aside, as the score fraction above must: a sentence
  // that mentions `75/100g` stays text, where a ring would drop every word around it.
  const [left, right] = node.data_points;
  if (node.data_points.length === 2 && left !== undefined && right !== undefined && !starContext) {
    const between = strip(node.content.slice(left.end, right.start));
    const construct = strip(node.content.slice(left.start, right.end));
    if (between === "/" && bareContent(node.content) === construct) {
      const value = dpScalar(left);
      const mx = dpScalar(right);
      const unit = dpUnit(right);
      if (value !== null && mx && unit) set(node, "unit_ratio", { value, max: mx, unit });
    }
  }
}

// Python `s.rstrip(chars)`, here for the date-chip key.
function rstripChars(s: string, chars: string): string {
  let end = s.length;
  while (end > 0 && chars.includes(s[end - 1] ?? "")) end -= 1;
  return s.slice(0, end);
}

/** md2ui: `_try_container_display`. A key-value display, or a split unit ratio. */
export function tryContainerDisplay(kit: RegexKit, node: GroupNode, starContext: boolean): void {
  if (node.type === "key-value") {
    tryKvDisplay(kit, node);
    return;
  }
  if (starContext) return;
  const kids = node.children;
  const leafDps = kids.map(coveringDp);
  const texts = kids.map((c) => bareContent(c.content));
  const plain = kids.map((c) => c.children.length === 0 && c.data_points.length === 0);
  // `75/100g` split to [number, "/", quantity-with-unit].
  const [d0, , d2] = leafDps;
  if (kids.length === 3 && d0 && d2 && plain[1] && texts[1] === "/") {
    const value = dpScalar(d0);
    const mx = dpScalar(d2);
    const unit = dpUnit(d2);
    if (value !== null && mx && unit) set(node, "unit_ratio", { value, max: mx, unit });
    return;
  }
  // `750/1800` + `Kcal`: a SCORE fraction beside its one-word unit.
  const unitText = texts[1] ?? "";
  if (
    kids.length === 2 &&
    d0 &&
    plain[1] &&
    unitText &&
    !unitText.includes(" ") &&
    d0.type === "score"
  ) {
    const v = asDict(d0.value);
    if (
      v !== null &&
      !STAR_SCORE_LABELS.includes((truthy(v["label"]) ? pyStr(v["label"]) : "").toLowerCase())
    ) {
      set(node, "unit_ratio", {
        value: pyFloat(v["score"]) ?? 0,
        max: pyFloat(v["max"]) ?? 0,
        unit: unitText,
      });
    }
  }
}

/**
 * md2ui: `_try_kv_display`. `Minutes: 7/8` a unit ratio (`Disk (GB): 61/128` with the
 * declared unit on its leaf), `Progress: 60%` a percent bar, `Price: $1 → $2 → $3` a
 * line.
 */
function tryKvDisplay(kit: RegexKit, node: GroupNode): void {
  const key = node.children.find((c) => c.type === "key");
  const value = node.children.find((c) => c.type === "value");
  if (key === undefined || value === undefined) return;
  const dps = subtreeDps(value);
  const dp = dps[0];
  // The whole-value paths need one data point covering the whole value text.
  if (dps.length === 1 && dp !== undefined) {
    const v = asDict(dp.value);
    const vtext = subtreeText(value);
    const matched = strip(dp.matched);
    const covered = strip(strip(strip(vtext), "*_`")) === matched;
    const ends =
      dp.type === "ratio" && covered && v !== null && v["format"] === "slash"
        ? ([pyFloat(v["left"]) ?? 0, pyFloat(v["right"]) ?? 0] as const)
        : null;
    if (ends !== null) {
      const shown = declaredUnit(kit, subtreeText(key));
      let leaf = value;
      while (leaf.children.length === 1) leaf = leaf.children[0] as GroupNode;
      clearDatapointDisplays(node);
      if (shown !== null && leaf.children.length === 0) {
        // The key declares the unit, drawn as `Disk: 61/128 GB` is.
        set(leaf, "unit_ratio", { value: ends[0], max: ends[1], unit: shown });
      } else {
        set(node, "unit_ratio", {
          value: ends[0],
          max: ends[1],
          unit: subtreeText(key),
          text: matched,
          from_kv: true,
        });
      }
      return;
    }
    if (dp.type === "percentage" && vtext.startsWith(matched) && split(vtext).length <= 3) {
      const scalar = dpScalar(dp);
      if (scalar !== null) {
        clearDatapointDisplays(node);
        set(node, "kv_percent_bar", { percent: scalar, value_text: vtext });
      }
      return;
    }
  }
  const shown = declaredUnit(kit, subtreeText(key));
  const points = parseLine(value, shown !== null);
  if (points !== null) {
    clearDatapointDisplays(node);
    // `High (°C): 24 → 23 → 21`: the key declares the unit its bare values are in.
    const bare = shown !== null && points.every((p) => isBare(kit, p.text));
    set(node, "line_chart", { points, ...(bare ? { display_unit: shown } : {}) });
  }
}
