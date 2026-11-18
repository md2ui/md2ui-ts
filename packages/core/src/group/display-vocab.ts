// The data-point vocabulary drawn displays and charts are written in (md2ui:
// pipeline/grouper_display_vocab.py): a data point's scalar and unit, a subtree's text
// and data points, and clearing the display flags a wider display takes over. Read by
// `displays.ts` (one node's display) and `charts.ts` (a run's).

import { asDict, type DataPoint, type DataPointValue } from "./detect/types.ts";
import type { GroupNode } from "./node.ts";
import { pyFloat, strip } from "./py/str.ts";

/** Python truthiness of a parsed value. */
export function truthy(v: DataPointValue | undefined): boolean {
  if (v === undefined || v === null || v === false || v === 0 || v === "") return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

/** Python `str(v)` of a parsed scalar. */
export function pyStr(v: DataPointValue | undefined): string {
  if (v === undefined || v === null) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  return String(v);
}

/** md2ui: `_dp_scalar`. The value's magnitude, whatever its shape, or null. */
export function dpScalar(dp: DataPoint): number | null {
  let v: DataPointValue | undefined = dp.value;
  const dict = asDict(dp.value);
  if (dict !== null) {
    const key = ["value", "amount", "score"].find((k) => k in dict);
    if (key === undefined) return null;
    v = dict[key];
  }
  return v === undefined || v === null ? null : pyFloat(v);
}

/** md2ui: `_dp_unit`. */
export function dpUnit(dp: DataPoint): string | null {
  const dict = asDict(dp.value);
  if (dict === null) return null;
  const u = truthy(dict["unit"]) ? dict["unit"] : dict["currency"];
  return truthy(u) ? pyStr(u) : null;
}

/** md2ui: `_bare_content`. Content without its preserved bold/italic/code markers. */
export function bareContent(text: string): string {
  return strip(strip(strip(text), "*_`"));
}

/** md2ui: `_covering_dp`. The node's single data point when it spans the whole content. */
export function coveringDp(node: GroupNode): DataPoint | null {
  const dp = node.data_points[0];
  if (node.children.length > 0 || node.data_points.length !== 1 || dp === undefined) return null;
  return bareContent(node.content) === strip(dp.matched) ? dp : null;
}

/** md2ui: `_subtree_text`. */
export function subtreeText(node: GroupNode): string {
  if (strip(node.content)) return strip(node.content);
  return node.children
    .map(subtreeText)
    .filter((p) => p)
    .join(" ");
}

/** md2ui: `_subtree_dps`. */
export function subtreeDps(node: GroupNode): DataPoint[] {
  return [...node.data_points, ...node.children.flatMap(subtreeDps)];
}

/** md2ui: `_clear_datapoint_displays`. */
export function clearDatapointDisplays(node: GroupNode): void {
  node.datapoint_display = null;
  node.datapoint_payload = null;
  for (const c of node.children) clearDatapointDisplays(c);
}
