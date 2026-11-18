// What the data-point detector finds (md2ui `data_point_types.DataPointType` and the
// result dicts of `DataPointDetector._scan`).

/** md2ui's `DataPointType` values. */
export type DataPointType =
  | "date"
  | "date_range"
  | "time"
  | "duration"
  | "quarter"
  | "currency"
  | "percentage"
  | "number"
  | "quantity"
  | "ratio"
  | "rate"
  | "score"
  | "ranking"
  | "frequency"
  | "measurement"
  | "age"
  | "range"
  | "identifier"
  | "change"
  | "statistical"
  | "phone"
  | "email"
  | "url"
  | "version"
  | "file_size"
  | "dimension"
  | "blood_type"
  | "ordinal"
  | "emoji"
  | "link"
  | "image"
  | "drawing_element";

/**
 * A parsed value, already in md2ui's serialized form (`_serialize_dp_value`): a
 * `Decimal` is a number and a `datetime` its ISO string, so the value crosses into
 * the grouping AST unchanged.
 */
export type DataPointValue =
  | number
  | string
  | boolean
  | null
  | readonly DataPointValue[]
  | { readonly [key: string]: DataPointValue };

/**
 * A data point as a node carries it: what the grouping AST keeps of one, with its
 * type, so the tree rebuilt from that AST holds the same thing as the live one.
 * `start`/`end` index the node's content (UTF-16 units).
 */
export interface DataPoint {
  readonly type: DataPointType;
  readonly matched: string;
  readonly value: DataPointValue;
  readonly start: number;
  readonly end: number;
}

/** One detected data point: md2ui's detector also reports a `~` approximation. */
export interface DetectedPoint extends DataPoint {
  readonly is_approximate: boolean;
}

/** A value as a dict, or null (md2ui's `isinstance(v, dict)`). */
export function asDict(v: DataPointValue): { readonly [key: string]: DataPointValue } | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as { readonly [key: string]: DataPointValue })
    : null;
}
