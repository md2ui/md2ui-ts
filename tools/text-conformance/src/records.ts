// md2ui's recorded font answers (`measure/<label>/<doc>.jsonl`), indexed the way
// md2ui's ledger keys them: by the whole question. A face key is
// `family|PostScript|weight|width|slant`.
import type { FontSpec } from "@md2ui/contracts";

/** One leaf whose one-line width md2ui asked (`leaf_line_width`). */
export interface LeafLine {
  readonly doc: string;
  readonly nodeId: string;
  readonly type: string;
  readonly content: string;
  /** md2ui's answer: the leaf's width on one line. */
  readonly width: number;
  /** md2ui's `leaf_min_width` answer for the same node and role, when it asked. */
  readonly minWidth: number | undefined;
}

interface FontMetricsRecord {
  readonly ascent: number;
  readonly descent: number;
}

export interface Records {
  /** `questionKey` of an `advance` question → advance. */
  readonly advance: ReadonlyMap<string, number>;
  /** `questionKey` of a `metrics` question → ascent and descent, both positive. */
  readonly metrics: ReadonlyMap<string, FontMetricsRecord>;
  /** `questionKey` of an `ink` question → `[advance, left, top, right, bottom]` of the ink box. */
  readonly ink: ReadonlyMap<string, readonly number[]>;
  /** `text` → every `face|size` it was measured at. */
  readonly sizesOf: ReadonlyMap<string, readonly string[]>;
  /** `family|weight|italic` → face key. */
  readonly faceOf: ReadonlyMap<string, string>;
  readonly leaves: readonly LeafLine[];
}

interface Raw extends Readonly<Record<string, unknown>> {
  readonly q: string;
  readonly a: unknown;
  readonly face?: string;
  readonly size?: number;
  readonly text?: string;
  readonly kv_role?: string | null;
  readonly node?: { node_id: string; type: string; content: string | null };
}

export function faceSize(face: string, size: number): string {
  return `${face}|${size}`;
}

/**
 * A ledger question as md2ui keys it: every field but the answer `a` and the count `n`.
 * Fields that apply only to some questions (`scale_x` on a stretched font, `shaped` on
 * an emoji run measured whole) are part of the question, so a question asked without
 * them finds only the record md2ui made without them.
 */
export function questionKey(question: Readonly<Record<string, unknown>>): string {
  return JSON.stringify(
    Object.keys(question)
      .filter((field) => field !== "a" && field !== "n")
      .sort()
      .map((field) => [field, question[field]]),
  );
}

/** md2ui's advance of `text` in `face` at `size`, unstretched and not shaped as a sequence. */
export function plainAdvance(
  records: Records,
  face: string,
  size: number,
  text: string,
): number | undefined {
  return records.advance.get(questionKey({ q: "advance", face, size, text }));
}

/** md2ui's ink box of `text` in `face` at `size`, unstretched. */
export function plainInk(
  records: Records,
  face: string,
  size: number,
  text: string,
): readonly number[] | undefined {
  return records.ink.get(questionKey({ q: "ink", face, size, text }));
}

/** md2ui's metrics of `face` at `size`, unstretched. */
export function plainMetrics(
  records: Records,
  face: string,
  size: number,
): FontMetricsRecord | undefined {
  return records.metrics.get(questionKey({ q: "metrics", face, size }));
}

/** The theme-level font a recorded face stands for. */
export function fontOfFace(face: string, size: number): FontSpec {
  const [family = "", , weight = "400", , slant = "0"] = face.split("|");
  return { families: [family], size, weight: Number(weight), italic: slant !== "0" };
}

function styleKey(family: string, weight: number, italic: boolean): string {
  return `${family}|${weight}|${italic}`;
}

/** The face key md2ui measured `font` with, if it measured with one. */
export function faceKeyOf(records: Records, font: FontSpec): string | undefined {
  const family = font.families[0];
  return family === undefined
    ? undefined
    : records.faceOf.get(styleKey(family, font.weight, font.italic));
}

/** Indexes the `.jsonl` files of one or more documents (`docs` maps doc → file text). */
export function indexRecords(docs: ReadonlyMap<string, string>): Records {
  const advance = new Map<string, number>();
  const metrics = new Map<string, FontMetricsRecord>();
  const ink = new Map<string, readonly number[]>();
  const sizesOf = new Map<string, string[]>();
  const faceOf = new Map<string, string>();
  const pending: { leaf: Omit<LeafLine, "minWidth">; key: string }[] = [];
  const minWidths = new Map<string, number>();
  for (const [doc, text] of docs) {
    for (const line of text.split("\n")) {
      if (line === "") continue;
      const r = JSON.parse(line) as Raw;
      if (r.face !== undefined) {
        const style = fontOfFace(r.face, 0);
        faceOf.set(styleKey(style.families[0] ?? "", style.weight, style.italic), r.face);
      }
      if (
        r.q === "advance" &&
        r.face !== undefined &&
        r.size !== undefined &&
        r.text !== undefined
      ) {
        const at = faceSize(r.face, r.size);
        advance.set(questionKey(r), r.a as number);
        const sizes = sizesOf.get(r.text) ?? [];
        if (!sizes.includes(at)) sizes.push(at);
        sizesOf.set(r.text, sizes);
      } else if (r.q === "metrics" && r.face !== undefined && r.size !== undefined) {
        const m = r.a as { fAscent: number; fDescent: number };
        metrics.set(questionKey(r), { ascent: -m.fAscent, descent: m.fDescent });
      } else if (r.q === "ink" && r.face !== undefined && r.size !== undefined) {
        ink.set(questionKey(r), r.a as number[]);
      } else if (r.q === "leaf_min_width" && r.node !== undefined && typeof r.a === "number") {
        minWidths.set(`${doc}|${r.node.node_id}|${r.kv_role ?? ""}`, r.a);
      } else if (r.q === "leaf_line_width" && r.node !== undefined && typeof r.a === "number") {
        pending.push({
          leaf: {
            doc,
            nodeId: r.node.node_id,
            type: r.node.type,
            content: r.node.content ?? "",
            width: r.a,
          },
          key: `${doc}|${r.node.node_id}|${r.kv_role ?? ""}`,
        });
      }
    }
  }
  return {
    advance,
    metrics,
    ink,
    sizesOf,
    faceOf,
    leaves: pending.map(({ leaf, key }) => ({ ...leaf, minWidth: minWidths.get(key) })),
  };
}
