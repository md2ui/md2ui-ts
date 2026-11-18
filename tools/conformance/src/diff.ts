// The comparison every check reports through: expected (md2ui's fixture) against
// actual (the port's output), as a list of differences a person can read.
//
// A difference has a class:
//   tree   a node's identity (for the grouping tree: `type` and `content`) or its
//          children: one missing, one extra;
//   flag   any other field of a node: the annotations;
//   id     an id field, compared as a partition (ADR-104): which values are shared,
//          never the values themselves;
//   value  any field of a document that is not a node tree.
//
// Children are aligned on their identity before they are compared, so one extra child
// is reported once instead of shifting every sibling after it.
import { diffArrays } from "diff";
import { isArray, isObject, type Json, type JsonArray, type JsonObject, render } from "./json.ts";

export type DifferenceClass = "tree" | "flag" | "id" | "value";

export interface Difference {
  readonly class: DifferenceClass;
  /** Where: a node path (`root`, `3.1`) and its label, or a JSON path. */
  readonly path: string;
  readonly field: string;
  readonly expected: string;
  readonly actual: string;
}

export interface Shape {
  /** Present when the document is a node tree: the fields that are the node itself. */
  readonly identity?: readonly string[];
  /** Id fields, wherever they occur, each with its namespace: one partition each. */
  readonly ids: Readonly<Record<string, string>>;
  /**
   * Fields md2ui records that only its server reads, so the port leaves them out: one is
   * compared only where the port has it.
   */
  readonly serverOnly?: readonly string[];
}

/** A node in a tree: where it is, and how a person recognises it. */
interface Place {
  readonly chain: string;
  readonly label: string;
}

interface IdPair {
  readonly namespace: string;
  readonly field: string;
  readonly path: string;
  readonly expected: Json;
  readonly actual: Json;
}

const CHILDREN = "children";

export function compare(expected: Json, actual: Json, shape: Shape): Difference[] {
  return new Comparison(shape).run(expected, actual);
}

class Comparison {
  private readonly differences: Difference[] = [];
  private readonly idPairs: IdPair[] = [];
  private readonly shape: Shape;

  constructor(shape: Shape) {
    this.shape = shape;
  }

  run(expected: Json, actual: Json): Difference[] {
    const { identity } = this.shape;
    if (identity !== undefined && isObject(expected) && isObject(actual)) {
      this.node(expected, actual, { chain: "root", label: this.label(expected) }, identity);
    } else {
      this.value(expected, actual, "", undefined, "value");
    }
    this.partitions();
    return this.differences;
  }

  private add(
    cls: DifferenceClass,
    path: string,
    field: string,
    expected: string,
    actual: string,
  ): void {
    this.differences.push({ class: cls, path, field, expected, actual });
  }

  private label(node: JsonObject): string {
    const parts = (this.shape.identity ?? []).map((field) => node[field]);
    return parts
      .filter((part) => part !== undefined && part !== "")
      .map((part) => (typeof part === "string" && part.length <= 40 ? part : render(part)))
      .join(" ");
  }

  private node(
    expected: JsonObject,
    actual: JsonObject,
    place: Place,
    identity: readonly string[],
  ): void {
    const path = `${place.chain} (${place.label})`;
    for (const field of identity) {
      if (!same(expected[field], actual[field])) {
        this.add("tree", path, field, render(expected[field]), render(actual[field]));
      }
    }
    for (const field of unionKeys(expected, actual)) {
      if (field === CHILDREN || identity.includes(field)) continue;
      this.value(expected[field], actual[field], `${path} · ${field}`, field, "flag");
    }
    this.children(asArray(expected[CHILDREN]), asArray(actual[CHILDREN]), place, identity);
  }

  private children(
    expected: JsonArray,
    actual: JsonArray,
    parent: Place,
    identity: readonly string[],
  ): void {
    const key = (node: Json): string =>
      isObject(node) ? identity.map((f) => render(node[f])).join("\u0000") : render(node);
    const parentPath = `${parent.chain} (${parent.label})`;
    const childChain = (index: number): string =>
      parent.chain === "root" ? `${index}` : `${parent.chain}.${index}`;
    for (const step of align(expected.map(key), actual.map(key))) {
      const e = step.expected === undefined ? undefined : expected[step.expected];
      const a = step.actual === undefined ? undefined : actual[step.actual];
      if (step.expected !== undefined && isObject(e) && isObject(a)) {
        this.node(e, a, { chain: childChain(step.expected), label: this.label(e) }, identity);
      } else if (step.expected !== undefined && e !== undefined && a === undefined) {
        this.add("tree", parentPath, `children[${step.expected}]`, this.describe(e), "absent");
      } else if (step.actual !== undefined && a !== undefined && e === undefined) {
        this.add("tree", parentPath, `children[${step.actual}]`, "absent", this.describe(a));
      } else {
        this.add("tree", parentPath, `children[${step.expected}]`, render(e), render(a));
      }
    }
  }

  private describe(node: Json): string {
    return isObject(node) ? `node (${this.label(node)})` : render(node);
  }

  /**
   * Any value that is not a tree node. `key` is the object key it sits under, which
   * is what makes it an id field; `where` is the path printed for it.
   */
  private value(
    expected: Json | undefined,
    actual: Json | undefined,
    where: string,
    key: string | undefined,
    cls: "flag" | "value",
  ): void {
    if (actual === undefined && key !== undefined && this.shape.serverOnly?.includes(key)) return;
    const namespace = key === undefined ? undefined : this.shape.ids[key];
    const split = splitPath(where, key);
    if (namespace !== undefined && key !== undefined) {
      if (expected === undefined || actual === undefined) {
        if (expected !== actual)
          this.add("id", split.path, split.field, render(expected), render(actual));
      } else {
        this.idPairs.push({ namespace, field: key, path: split.path, expected, actual });
      }
      return;
    }
    if (isArray(expected) && isArray(actual)) {
      const length = Math.max(expected.length, actual.length);
      for (let i = 0; i < length; i++) {
        this.value(expected[i], actual[i], `${where}[${i}]`, undefined, cls);
      }
      return;
    }
    if (isObject(expected) && isObject(actual)) {
      for (const field of unionKeys(expected, actual)) {
        const inner = where === "" ? field : `${where}.${field}`;
        this.value(expected[field], actual[field], inner, field, cls);
      }
      return;
    }
    if (!same(expected, actual)) {
      this.add(cls, split.path, split.field, render(expected), render(actual));
    }
  }

  /**
   * Ids are compared as partitions: two places that share a value in md2ui must share
   * one in the port, and two that differ must differ. Each break is reported against
   * the first place that fixed the pairing. `null` is not an id and must stay `null`.
   */
  private partitions(): void {
    const byExpected = new Map<string, { readonly actual: Json; readonly path: string }>();
    const byActual = new Map<string, { readonly expected: Json; readonly path: string }>();
    for (const pair of this.idPairs) {
      const { namespace, field, path, expected, actual } = pair;
      if (expected === null || actual === null) {
        if (expected !== actual) this.add("id", path, field, render(expected), render(actual));
        continue;
      }
      const e = `${namespace}\u0000${canonical(expected)}`;
      const a = `${namespace}\u0000${canonical(actual)}`;
      const seenExpected = byExpected.get(e);
      const seenActual = byActual.get(a);
      if (seenExpected !== undefined && canonical(seenExpected.actual) !== canonical(actual)) {
        this.add(
          "id",
          path,
          field,
          `the same ${namespace} id as ${seenExpected.path}`,
          `split: ${render(actual)} here, ${render(seenExpected.actual)} there`,
        );
      } else if (
        seenActual !== undefined &&
        canonical(seenActual.expected) !== canonical(expected)
      ) {
        this.add(
          "id",
          path,
          field,
          `a different ${namespace} id from ${seenActual.path}`,
          `merged: both ${render(actual)}`,
        );
      }
      if (seenExpected === undefined) byExpected.set(e, { actual, path });
      if (seenActual === undefined) byActual.set(a, { expected, path });
    }
  }
}

/** The path and field a difference is printed with: the last key is the field. */
function splitPath(where: string, key: string | undefined): { path: string; field: string } {
  const at = where.lastIndexOf(" · ");
  if (at >= 0) return { path: where.slice(0, at), field: where.slice(at + 3) };
  if (key !== undefined && where.endsWith(key)) {
    const path = where.slice(0, where.length - key.length).replace(/\.$/, "");
    return { path: path === "" ? "(document)" : path, field: key };
  }
  return { path: where === "" ? "(document)" : where, field: "" };
}

function canonical(value: Json): string {
  return `${typeof value}:${typeof value === "object" ? render(value) : String(value)}`;
}

function asArray(value: Json | undefined): JsonArray {
  return isArray(value) ? value : [];
}

function unionKeys(a: JsonObject, b: JsonObject): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
}

/**
 * Leaf equality, across the fixture boundary: md2ui writes non-finite floats as the
 * strings "Infinity", "-Infinity" and "NaN"; an integer outside the safe range is a
 * `bigint` on the fixture side.
 */
function same(expected: Json | undefined, actual: Json | undefined): boolean {
  if (typeof expected === "string" && typeof actual === "number" && !Number.isFinite(actual)) {
    return expected === String(actual);
  }
  if (typeof expected === "bigint" || typeof actual === "bigint") {
    return integer(expected) !== undefined && integer(expected) === integer(actual);
  }
  if (isArray(expected) && isArray(actual)) {
    return expected.length === actual.length && expected.every((e, i) => same(e, actual[i]));
  }
  if (isObject(expected) && isObject(actual)) {
    const keys = unionKeys(expected, actual);
    return keys.every((key) => same(expected[key], actual[key]));
  }
  return expected === actual;
}

function integer(value: Json | undefined): bigint | undefined {
  if (typeof value === "bigint") return value;
  return typeof value === "number" && Number.isInteger(value) ? BigInt(value) : undefined;
}

interface Step {
  readonly expected?: number;
  readonly actual?: number;
}

/**
 * Pairs two sequences of keys. jsdiff's longest common subsequence pairs equal keys;
 * the elements between two such pairs are paired by position and the rest left
 * single, so a changed element is compared with its counterpart and an inserted one
 * shows up alone.
 */
function align(expected: readonly string[], actual: readonly string[]): Step[] {
  const steps: Step[] = [];
  const removed: number[] = [];
  const added: number[] = [];
  const flush = (): void => {
    const paired = Math.min(removed.length, added.length);
    for (let k = 0; k < paired; k++) {
      steps.push({ expected: removed[k] ?? 0, actual: added[k] ?? 0 });
    }
    for (const i of removed.slice(paired)) steps.push({ expected: i });
    for (const j of added.slice(paired)) steps.push({ actual: j });
    removed.length = 0;
    added.length = 0;
  };
  let i = 0;
  let j = 0;
  for (const change of diffArrays([...expected], [...actual])) {
    for (let k = 0; k < change.count; k++) {
      if (change.removed) {
        removed.push(i++);
      } else if (change.added) {
        added.push(j++);
      } else {
        flush();
        steps.push({ expected: i++, actual: j++ });
      }
    }
  }
  flush();
  return steps;
}
