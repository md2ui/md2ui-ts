// JSON as the fixtures hold it, and as a stage hands its output back.
//
// md2ui writes Python values: integers of any size (fingerprints are 64-bit) and
// repr-exact floats. An integer outside JavaScript's safe range is read as a
// `bigint`, so it keeps every digit; everything else reads as plain JSON.
import { readFileSync } from "node:fs";

export type Json = null | boolean | number | bigint | string | JsonArray | JsonObject;
export type JsonArray = readonly Json[];
export interface JsonObject {
  readonly [key: string]: Json;
}

export function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isArray(value: Json | undefined): value is JsonArray {
  return Array.isArray(value);
}

const INTEGER = /^-?\d+$/;

/** `JSON.parse`'s reviver, with the source text of each value (ES2025, Node 21+). */
function revive(_key: string, value: unknown, context?: { readonly source?: string }): unknown {
  const source = context?.source;
  if (
    typeof value === "number" &&
    !Number.isSafeInteger(value) &&
    source !== undefined &&
    INTEGER.test(source)
  ) {
    return BigInt(source);
  }
  return value;
}

export function parseJson(text: string): Json {
  return JSON.parse(text, revive) as Json;
}

/** `JSON.rawJSON` (ES2025; Node 21+, every supported browser), which TypeScript's libraries do not declare yet. */
type WithRawJson = JSON & { rawJSON(text: string): unknown };

/** JSON text of a value; a `bigint` is written as a number with every digit, as md2ui wrote it. */
export function stringifyJson(value: Json): string {
  const json = JSON as WithRawJson;
  return json.stringify(value, (_key, v: unknown) =>
    typeof v === "bigint" ? json.rawJSON(v.toString()) : v,
  );
}

export function readJson(path: string): Json {
  return parseJson(readFileSync(path, "utf8"));
}

export function readJsonLines(path: string): Json[] {
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map(parseJson);
}

/** A short, one-line rendering of a value for a difference report. */
export function render(value: Json | undefined): string {
  if (value === undefined) return "absent";
  const text = JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? `${v}n` : v));
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}
