import { describe, expect, test } from "vitest";
import { compare, type Shape } from "../src/diff.ts";
import type { Json, JsonObject } from "../src/json.ts";

const GROUPING: Shape = {
  identity: ["type", "content"],
  ids: {
    node_id: "node",
    glued_content_id: "glue",
    source_line_id: "source-line",
    fingerprint_hash: "fingerprint",
  },
};

function node(
  type: string,
  content: string,
  id: number,
  glue: number | null,
  children: readonly Json[] = [],
  extra: JsonObject = {},
): JsonObject {
  return {
    type,
    content,
    node_id: id,
    glued_content_id: glue,
    glued_content_group: true,
    source_line_id: id * 10,
    children,
    ...extra,
  };
}

/** Root with four children; the first two share a glue id, the second has a child of its own. */
function tree(): JsonObject[] {
  return [
    node("text", "A", 1, 10),
    node("text", "B", 2, 10, [node("leaf", "B1", 5, 20)]),
    node("kv", "C", 3, 11),
    node("text", "D", 4, 12),
  ];
}

function root(children: readonly Json[]): JsonObject {
  return node("root", "", 0, null, children);
}

const expected = root(tree());

function withChild(index: number, change: (child: JsonObject) => JsonObject): JsonObject {
  return root(tree().map((child, i) => (i === index ? change(child) : child)));
}

function relabel(value: Json): Json {
  if (Array.isArray(value)) return value.map(relabel);
  if (typeof value !== "object" || value === null || typeof value === "bigint") return value;
  const out: { [key: string]: Json } = {};
  for (const [key, inner] of Object.entries(value)) {
    if (key === "children") out[key] = relabel(inner);
    else if (key === "node_id" && typeof inner === "number") out[key] = inner + 1000;
    else if (key === "glued_content_id" && typeof inner === "number") out[key] = inner * 7 + 3;
    else out[key] = inner;
  }
  return out;
}

describe("compare on a grouping tree", () => {
  test("identical trees have no differences", () => {
    expect(compare(expected, root(tree()), GROUPING)).toEqual([]);
  });

  test("a changed flag is one flag difference at the node", () => {
    const actual = withChild(1, (c) => ({ ...c, glued_content_group: false }));
    const found = compare(expected, actual, GROUPING);
    expect(found).toHaveLength(1);
    expect(found[0]?.class).toBe("flag");
    expect(found[0]?.path.startsWith("1 ")).toBe(true);
    expect(found[0]?.field).toBe("glued_content_group");
  });

  test("an extra child is reported once and its later siblings are aligned", () => {
    const children = tree();
    children.splice(2, 0, node("text", "X", 9, 30));
    const found = compare(expected, root(children), GROUPING);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ class: "tree", field: "children[2]", expected: "absent" });
  });

  test("a missing child is one tree difference with an absent actual", () => {
    const children = tree();
    children.splice(1, 1);
    const found = compare(expected, root(children), GROUPING);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ class: "tree", field: "children[1]", actual: "absent" });
  });

  test("a changed content is a content difference, not an extra and a missing node", () => {
    const found = compare(
      expected,
      withChild(2, (c) => ({ ...c, content: "C2" })),
      GROUPING,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ class: "tree", field: "content" });
  });

  test("a node that joins a glue id it did not share is a merge", () => {
    const found = compare(
      expected,
      withChild(2, (c) => ({ ...c, glued_content_id: 10 })),
      GROUPING,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.class).toBe("id");
    expect(found[0]?.actual.startsWith("merged")).toBe(true);
  });

  test("two nodes that shared a glue id and no longer do are a split", () => {
    const found = compare(
      expected,
      withChild(1, (c) => ({ ...c, glued_content_id: 99 })),
      GROUPING,
    );
    expect(found).toHaveLength(1);
    expect(found[0]?.class).toBe("id");
    expect(found[0]?.actual.startsWith("split")).toBe(true);
  });

  test("ids relabelled by a bijection are not a difference", () => {
    expect(compare(expected, relabel(expected), GROUPING)).toEqual([]);
  });

  test("a null id that becomes non-null is an id difference", () => {
    const found = compare(
      root([node("text", "A", 1, null)]),
      root([node("text", "A", 1, 77)]),
      GROUPING,
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ class: "id", field: "glued_content_id" });
  });
});

describe("compare on a document that is not a tree", () => {
  const plain: Shape = { ids: {} };

  test("a nested array difference is a value difference with a readable path", () => {
    const found = compare({ a: { list: [1, 2, 3] } }, { a: { list: [1, 9, 3] } }, plain);
    expect(found).toEqual([
      { class: "value", path: "a.list[1]", field: "", expected: "2", actual: "9" },
    ]);
  });

  test("the string Infinity in a fixture equals the number Infinity", () => {
    expect(compare("Infinity", Number.POSITIVE_INFINITY, plain)).toEqual([]);
    expect(compare({ w: "-Infinity" }, { w: Number.NEGATIVE_INFINITY }, plain)).toEqual([]);
  });

  test("a bigint equals the same bigint and differs from another", () => {
    expect(compare(8150907237997192671n, 8150907237997192671n, plain)).toEqual([]);
    expect(compare(8150907237997192671n, 8150907237997192670n, plain)).toHaveLength(1);
  });
});
