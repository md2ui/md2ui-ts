// A lookahead for the characters a match can start with. Prefixed to a
// pattern, it lets a search skip every other character without entering the pattern.
// It pays where a pattern is searched through long texts that seldom hold it, as the
// detector's are; on every pattern it costs more than it saves. A module of its own, so
// a bundle that compiles no detector pattern does not carry it.
import { type Flags, Pattern } from "./re.ts";

/**
 * What can begin a match of a span of translated `source`: the class pieces of the
 * characters that may come first, and whether the span can match empty.
 */
interface Firsts {
  /** Class bodies (`a`, `\p{Nd}`, `0-9`) or whole negated classes (`[^ab]`). */
  readonly pieces: string[];
  readonly nullable: boolean;
}

/** The end of the class that opens at `i` in translated source (the index after `]`). */
function classEnd(source: string, i: number): number {
  let j = i + 1;
  if (source[j] === "^") j += 1;
  while (j < source.length && source[j] !== "]") j += source[j] === "\\" ? 2 : 1;
  return j + 1;
}

/** The end of the escape at `i` in translated source. */
function escapeEnd(source: string, i: number): number {
  const next = source[i + 1];
  if (next === "p" || next === "P" || next === "k" || (next === "u" && source[i + 2] === "{")) {
    return source.indexOf(next === "k" ? ">" : "}", i) + 1;
  }
  if (next === "u") return i + 6;
  if (next === "x") return i + 4;
  return i + ((source.codePointAt(i + 1) ?? 0) > 0xffff ? 3 : 2);
}

/**
 * The firsts of the disjunction starting at `at` and ending at an unmatched `)` or the
 * end, and where it ends. Reads only what `translate` writes. Null where a match may
 * begin with what this reading does not follow (an anchor, a back reference, `[^]`):
 * the pattern is then left without a lookahead.
 */
function firstsOf(source: string, at: number): [Firsts | null, number] {
  const pieces: string[] = [];
  let nullable = false;
  let failed = false;
  let i = at;
  // One alternative at a time: its terms add their firsts until one cannot match empty.
  while (i <= source.length) {
    let open = true;
    while (i < source.length && source[i] !== "|" && source[i] !== ")") {
      const c = source[i] as string;
      let term: Firsts | null;
      let end: number;
      if (c === "(") {
        const lookaround = /^\(\?<?[=!]/.test(source.slice(i, i + 4));
        const head = source.startsWith("(?:", i)
          ? 3
          : source.startsWith("(?<", i) && !lookaround
            ? source.indexOf(">", i) - i + 1
            : lookaround
              ? source[i + 2] === "<"
                ? 4
                : 3
              : 1;
        const [inner, close] = firstsOf(source, i + head);
        term = lookaround ? { pieces: [], nullable: true } : inner;
        end = close + 1;
      } else if (c === "[") {
        end = classEnd(source, i);
        const body = source.slice(i + 1, end - 1);
        term = body.startsWith("^")
          ? body === "^"
            ? null
            : { pieces: [source.slice(i, end)], nullable: false }
          : { pieces: [body], nullable: false };
      } else if (c === "\\") {
        end = escapeEnd(source, i);
        const next = source[i + 1] as string;
        term = /[1-9k]/.test(next)
          ? null
          : next === "b" || next === "B"
            ? { pieces: [], nullable: true }
            : { pieces: [source.slice(i, end)], nullable: false };
      } else if (c === "$") {
        end = i + 1;
        term = { pieces: [], nullable: true };
      } else if (c === "^" || c === "." || c === "*" || c === "+" || c === "?" || c === "{") {
        // An anchor, any character, or a quantifier with nothing before it.
        end = i + 1;
        term = null;
      } else {
        end = i + ((c.codePointAt(0) ?? 0) > 0xffff ? 2 : 1);
        term = { pieces: ["-^".includes(c) ? `\\${c}` : source.slice(i, end)], nullable: false };
      }
      // A quantifier that allows none makes the term optional.
      const quantifier = /^(?:[*?]|\{0,?\d*\}|\+|\{\d+,?\d*\})\??/.exec(
        source.slice(end, end + 16),
      );
      if (quantifier !== null) {
        end += quantifier[0].length;
        if (term !== null && /^[*?]|^\{0/.test(quantifier[0])) term = { ...term, nullable: true };
      }
      if (!open) {
        // Past a term that cannot match empty: read only to find the alternative's end.
      } else if (term === null) failed = true;
      else {
        pieces.push(...term.pieces);
        open = term.nullable;
      }
      i = end;
    }
    nullable ||= open;
    if (source[i] !== "|") break;
    i += 1;
  }
  return [failed ? null : { pieces, nullable }, i];
}

/**
 * `(?=[…])`: a lookahead for the characters a match of translated `source` can start
 * with, or "" where every match need not start with one (it can match empty) or the
 * source holds what `firstsOf` does not follow.
 */
function firstLookahead(source: string): string {
  const [firsts] = firstsOf(source, 0);
  if (firsts === null || firsts.nullable || firsts.pieces.length === 0) return "";
  // One class where pieces can share one, which a search scans fastest; a negated class,
  // or a body with a dash at an edge (joined, it could make a range), stands alone.
  const alone = (piece: string): boolean =>
    piece.startsWith("[^") || piece.startsWith("-") || /(?<!\\)-$/.test(piece);
  const bodies = firsts.pieces.filter((piece) => !alone(piece));
  const others = firsts.pieces
    .filter(alone)
    .map((piece) => (piece.startsWith("[^") ? piece : `[${piece}]`));
  const alternatives = [...(bodies.length > 0 ? [`[${bodies.join("")}]`] : []), ...others];
  return `(?=${alternatives.join("|")})`;
}

/**
 * `compile(pattern, flags)`, led by a lookahead for the characters a match can start
 * with where every match starts with one of a known set. It finds what `compile`'s
 * pattern finds.
 */
export function compileFirst(pattern: string, flags: Flags = {}): Pattern {
  return new Pattern(pattern, flags, firstLookahead);
}
