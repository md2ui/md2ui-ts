// Whether an `unmeasured-word` divergence explains a document's differences. The
// class says Pretext measured a word on its own that md2ui measured only
// inside a longer run; it is evidence for a difference only where that word is written.
// So every unmeasured word must occur in the text of an entry that differs: a box, a
// region, or a layout node with its subtree. A difference the port's own plan makes (a ring label
// shrunk one step less than md2ui's) shows in an entry that holds none of the
// words, and is no longer accepted as one.
import type { Difference } from "./diff.ts";
import type { Divergence } from "./divergence.ts";
import { isArray, isObject, type Json, type JsonArray } from "./json.ts";

const asArray = (value: Json | undefined): JsonArray => (isArray(value) ? value : []);

/** Each grouping node's content, by node id. */
function contents(grouping: Json): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (node: Json): void => {
    if (!isObject(node)) return;
    if (typeof node["node_id"] === "string" && typeof node["content"] === "string") {
      out.set(node["node_id"], node["content"]);
    }
    for (const child of asArray(node["children"])) walk(child);
  };
  walk(grouping);
  return out;
}

/**
 * The texts an entry writes, subtree included: every string it holds (a ring's text, a
 * link's label) and the content of every node it names (`content_id`, `node_id`).
 */
function textsOf(entry: Json | undefined, byId: ReadonlyMap<string, string>, out: string[]): void {
  if (typeof entry === "string") out.push(entry);
  else if (isArray(entry)) for (const v of entry) textsOf(v, byId, out);
  else if (isObject(entry)) {
    for (const [key, v] of Object.entries(entry)) {
      if ((key === "content_id" || key === "node_id") && typeof v === "string") {
        out.push(byId.get(v) ?? "");
      } else {
        textsOf(v, byId, out);
      }
    }
  }
}

/**
 * The entry a difference names in md2ui's output: a scene's `boxes[i]`, `regions[i]` and
 * the like, or a node chain (`root`, `3.1`, followed by its label) in a layout tree.
 */
function entryAt(expected: Json, path: string): Json | undefined {
  const listed = /^(\w+)\[(\d+)\]/u.exec(path);
  if (listed !== null) {
    return isObject(expected)
      ? asArray(expected[listed[1] as string])[Number(listed[2])]
      : undefined;
  }
  const chain = /^(root|\d+(?:\.\d+)*) \(/u.exec(path)?.[1];
  if (chain === undefined) return undefined;
  let node: Json | undefined = expected;
  if (chain === "root") return node;
  for (const step of chain.split(".")) {
    node = isObject(node) ? asArray(node["children"])[Number(step)] : undefined;
  }
  return node;
}

/**
 * The divergences that may explain `differences`: every class but `unmeasured-word`, and
 * an `unmeasured-word` one only when each of its words is written in a differing entry.
 */
export function explaining(
  divergences: readonly Divergence[],
  differences: readonly Difference[],
  expected: Json,
  grouping: Json,
): Divergence[] {
  let written: string[] | undefined;
  const texts = (): string[] => {
    if (written === undefined) {
      const byId = contents(grouping);
      written = [];
      for (const d of differences) textsOf(entryAt(expected, d.path), byId, written);
    }
    return written;
  };
  return divergences.filter(
    (d) =>
      d.class !== "unmeasured-word" ||
      (d.words.length > 0 && d.words.every((w) => texts().some((t) => t.includes(w)))),
  );
}
