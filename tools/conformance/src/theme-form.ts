// A resolved theme (C2) in md2ui's fixture form (`theme/*.json`): `fixed_section_levels`
// flattened to md2ui's `(key, level)` tuple keys, written as JSON-array text with
// Python's `, ` separator, a fixed emoji pin's scope words space-joined as md2ui keeps
// them, and non-finite numbers written as strings. md2ui-ts's own
// fields are not in md2ui's form, so they are left out: `motion` (`## Motion`, TS-first),
// which md2ui neither parses nor exports. Every field md2ui has is still compared.
import type { ResolvedTheme } from "@md2ui/contracts";
import type { Difference } from "./diff.ts";
import type { DivergenceClass } from "./divergence.ts";
import { isObject, type Json } from "./json.ts";

/** The resolved-theme fields md2ui has and the port declines, each with its class. */
const DECLINED_FIELDS: readonly { path: string; field: string; class: DivergenceClass }[] = [
  { path: "charts.line", field: "fill", class: "line-chart-unported" },
];

/** The class of a theme difference that is a declined field absent from the port, else null. */
export function declinedThemeField(d: Difference): DivergenceClass | null {
  if (d.actual !== "absent") return null;
  return DECLINED_FIELDS.find((u) => u.path === d.path && u.field === d.field)?.class ?? null;
}

// md2ui: theme_assets._PATH_FIELDS, the fields that name an asset file.
const PATH_FIELDS: readonly string[] = ["font_paths", "font_path", "bg_image"];

/**
 * md2ui rewrites a relative asset reference to the file beside the THEME.md when that
 * file exists (`theme_assets.resolve_asset`); the port's parse keeps it as written, and
 * the host resolves it against the theme's URL (`core/src/theme/assets.ts`), since a
 * client cannot ask whether a file exists. `expected` with each reference md2ui resolved
 * beside the theme (in folder `dir`) put back as the port wrote it, and where each was.
 */
export function assetsBesideTheme(
  expected: Json,
  actual: Json,
  dir: string,
): { expected: Json; fields: string[] } {
  const fields: string[] = [];
  const beside = (e: Json, a: Json, where: string): Json => {
    if (typeof e !== "string" || typeof a !== "string" || a === "" || e !== `${dir}/${a}`) {
      return e;
    }
    fields.push(where);
    return a;
  };
  const walk = (e: Json, a: Json, where: string): Json => {
    if (Array.isArray(e)) {
      const as = Array.isArray(a) ? a : [];
      return e.map((v, i) => walk(v, as[i] ?? null, `${where}[${i}]`));
    }
    if (!isObject(e)) return e;
    const ao = isObject(a) ? a : {};
    return Object.fromEntries(
      Object.entries(e).map(([key, v]) => {
        const at = where === "" ? key : `${where}.${key}`;
        if (!PATH_FIELDS.includes(key)) return [key, walk(v, ao[key] ?? null, at)];
        const av = ao[key] ?? null;
        if (Array.isArray(v)) {
          const as = Array.isArray(av) ? av : [];
          return [key, v.map((x, i) => beside(x, as[i] ?? null, `${at}[${i}]`))];
        }
        return [key, beside(v, av, at)];
      }),
    );
  };
  return { expected: walk(expected, actual, ""), fields };
}

export function themeFixtureForm(theme: ResolvedTheme): Json {
  const levels: Record<string, unknown> = {};
  for (const [key, byLevel] of Object.entries(theme.fixed_section_levels)) {
    for (const [level, style] of Object.entries(byLevel)) {
      levels[`[${JSON.stringify(key)}, ${level}]`] = style;
    }
  }
  const emoji = Object.fromEntries(
    Object.entries(theme.fixed.emoji).map(([glyph, [color, words]]) => [
      glyph,
      [color, words.join(" ")],
    ]),
  );
  const { motion: _tsOnly, ...md2ui } = theme;
  return plain({ ...md2ui, fixed: { ...theme.fixed, emoji }, fixed_section_levels: levels });
}

function plain(value: unknown): Json {
  if (typeof value === "number" && !Number.isFinite(value)) {
    return Number.isNaN(value) ? "NaN" : value > 0 ? "Infinity" : "-Infinity";
  }
  if (Array.isArray(value)) return value.map(plain);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value as Json;
}
