// Python `re` semantics on JavaScript's RegExp (ADR-002, the regex dialect table).
//
// md2ui's grouper and detector are mostly regex, and a hand-translated pattern fails
// silently: `\w`, `\d` and `\b` are Unicode in Python and ASCII in JavaScript, `$`
// matches before a trailing newline, `.` and multiline `^`/`$` treat U+2028 (md2ui's
// hard break) differently. So patterns are written here in md2ui's own spelling,
// copied verbatim, and `compile` translates each construct once into the JavaScript
// that matches the same strings. The methods below then mirror `re.Pattern`'s:
// `match` anchors at the start, `fullmatch` at both ends, `sub` and `split` follow
// Python's empty-match rules.
//
// Offsets are JavaScript string indices (UTF-16 units); only the fixture boundary
// converts md2ui's code points.

import type { DataPoint } from "../detect/types.ts";

/** Python's `re` flags that md2ui uses. */
export interface Flags {
  /** `re.IGNORECASE` */
  readonly i?: boolean;
  /** `re.MULTILINE` */
  readonly m?: boolean;
  /** `re.DOTALL` */
  readonly s?: boolean;
}

/** Python's `\w` (`str.isalnum()` or `_`): letters and numbers of every script. */
const WORD = "\\p{L}\\p{N}_";
/**
 * The code points of Python's `str.isspace()`, which is also what `\s`, `strip()` and
 * `split()` treat as white space. Generated with
 * `python3 -c "import sys; print([hex(c) for c in range(sys.maxunicode+1) if chr(c).isspace()])"`
 * and written as inclusive ranges. The one definition: the wire's `isBlank` repeats it,
 * as one class, because `wire` cannot import `core`.
 */
export const PY_SPACE_RANGES: readonly (readonly [number, number])[] = Object.freeze([
  [0x09, 0x0d],
  [0x1c, 0x20],
  [0x85, 0x85],
  [0xa0, 0xa0],
  [0x1680, 0x1680],
  [0x2000, 0x200a],
  [0x2028, 0x2029],
  [0x202f, 0x202f],
  [0x205f, 0x205f],
  [0x3000, 0x3000],
]);
const unit = (code: number): string => `\\u${code.toString(16).padStart(4, "0")}`;
/** `PY_SPACE_RANGES` as the body of a regex character class. */
export const PY_SPACE_CLASS = PY_SPACE_RANGES.map(([lo, hi]) =>
  lo === hi ? unit(lo) : `${unit(lo)}-${unit(hi)}`,
).join("");
/** The characters JavaScript lets a `u` pattern escape outside a class. */
const SYNTAX = "^$\\.*+?()[]{}|/";

/** Translates a Python pattern into the JavaScript source that matches the same strings. */
function translate(pattern: string, flags: Flags = {}): string {
  const boundaries = new Map<number, string>();
  wordEdges(pattern, 0, boundaries);
  let out = "";
  let i = 0;
  const n = pattern.length;
  while (i < n) {
    const c = pattern[i] as string;
    const boundary = boundaries.get(i);
    if (boundary !== undefined) {
      out += boundary;
      i += 2;
    } else if (c === "\\") {
      const [text, width] = escapeAt(pattern, i, false);
      out += text;
      i += width;
    } else if (c === "[") {
      const [text, width] = charClass(pattern, i);
      out += text;
      i += width;
    } else if (c === ".") {
      out += flags.s ? "[^]" : "[^\\n]";
      i += 1;
    } else if (c === "^") {
      out += flags.m ? "(?<![^\\n])" : "^";
      i += 1;
    } else if (c === "$") {
      out += flags.m ? "(?![^\\n])" : "(?=\\n?$)";
      i += 1;
    } else if (c === "(") {
      const [text, width] = group(pattern, i);
      out += text;
      i += width;
    } else if (c === "{") {
      const quantifier = /^\{(\d*)(?:(,)(\d*))?\}/.exec(pattern.slice(i));
      if (quantifier !== null && (quantifier[1] !== "" || quantifier[2] !== undefined)) {
        const [whole, low, comma, high] = quantifier;
        out += comma === undefined ? `{${low}}` : `{${low === "" ? "0" : low},${high}}`;
        i += whole.length;
      } else {
        out += "\\{";
        i += 1;
      }
    } else if (c === "}" || c === "]") {
      out += `\\${c}`;
      i += 1;
    } else if (c === "/") {
      out += "\\/";
      i += 1;
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

function group(pattern: string, i: number): [string, number] {
  const rest = pattern.slice(i);
  if (rest.startsWith("(?P<")) return ["(?<", 4];
  const backReference = /^\(\?P=(\w+)\)/.exec(rest);
  if (backReference !== null) return [`\\k<${backReference[1]}>`, backReference[0].length];
  if (rest.startsWith("(?#")) {
    const close = pattern.indexOf(")", i);
    return ["", close - i + 1];
  }
  if (/^\(\?[aiLmsux]/.test(rest) || rest.startsWith("(?>") || rest.startsWith("(?(")) {
    throw new Error(`python re: unsupported group ${rest.slice(0, 4)} in ${pattern}`);
  }
  return ["(", 1];
}

/** One `\x` escape at `i`; inside a class some translate differently. */
function escapeAt(pattern: string, i: number, inClass: boolean): [string, number] {
  const next = pattern[i + 1];
  if (next === undefined) throw new Error(`python re: trailing backslash in ${pattern}`);
  switch (next) {
    case "w":
      return [inClass ? WORD : `[${WORD}]`, 2];
    case "W":
      return [inClass ? `\0W` : `[^${WORD}]`, 2];
    case "d":
      return ["\\p{Nd}", 2];
    case "D":
      return ["\\P{Nd}", 2];
    case "s":
      return [inClass ? PY_SPACE_CLASS : `[${PY_SPACE_CLASS}]`, 2];
    case "S":
      return [inClass ? `\0S` : `[^${PY_SPACE_CLASS}]`, 2];
    case "b":
      // Outside a class `\b` is a word boundary, which `translate` writes itself.
      if (inClass) return ["\\x08", 2];
      throw new Error(`python re: \\b outside a class reached escapeAt in ${pattern}`);
    case "B":
      return [`(?:(?<=[${WORD}])(?=[${WORD}])|(?<![${WORD}])(?![${WORD}]))`, 2];
    case "A":
      return ["^", 2];
    case "Z":
      return ["$", 2];
    case "U": {
      const hex = pattern.slice(i + 2, i + 10);
      return [`\\u{${hex.replace(/^0+(?=.)/, "")}}`, 10];
    }
    case "u":
      return [pattern.slice(i, i + 6), 6];
    case "x":
      return [pattern.slice(i, i + 4), 4];
    case "n":
    case "t":
    case "r":
    case "f":
    case "v":
      return [`\\${next}`, 2];
    default:
      break;
  }
  if (/[1-9]/.test(next)) return [`\\${next}`, 2];
  if (next === "0") return ["\\0", 2];
  if (/[A-Za-z]/.test(next)) {
    throw new Error(`python re: unsupported escape \\${next} in ${pattern}`);
  }
  if (SYNTAX.includes(next) || (inClass && next === "-")) return [`\\${next}`, 2];
  const code = next.codePointAt(0) ?? 0;
  return [`\\u{${code.toString(16)}}`, 1 + (code > 0xffff ? 2 : 1)];
}

/**
 * A `[...]` class at `i`: a leading `]` is literal in Python, and escapes translate.
 * `\S` and `\W` cannot be written inside a `u` class, so a class holding one becomes
 * an alternation: `[a\S]` is `(?:[a]|[^space])`, `[^a\S]` is `(?!(?:[a]|[^space]))[^]`.
 */
function charClass(pattern: string, i: number): [string, number] {
  let body = "";
  const negatedShorthands: string[] = [];
  let negated = false;
  let j = i + 1;
  if (pattern[j] === "^") {
    negated = true;
    j += 1;
  }
  if (pattern[j] === "]") {
    body += "\\]";
    j += 1;
  }
  while (j < pattern.length && pattern[j] !== "]") {
    const c = pattern[j] as string;
    if (c === "\\") {
      const [text, width] = escapeAt(pattern, j, true);
      if (text === "\0S") negatedShorthands.push(`[^${PY_SPACE_CLASS}]`);
      else if (text === "\0W") negatedShorthands.push(`[^${WORD}]`);
      else body += text;
      j += width;
    } else if ("[/{}|()".includes(c)) {
      body += `\\${c}`;
      j += 1;
    } else {
      body += c;
      j += 1;
    }
  }
  if (j >= pattern.length) throw new Error(`python re: unterminated class in ${pattern}`);
  const width = j - i + 1;
  if (negatedShorthands.length === 0) return [`[${negated ? "^" : ""}${body}]`, width];
  const any = `(?:${[...(body === "" ? [] : [`[${body}]`]), ...negatedShorthands].join("|")})`;
  return [negated ? `(?!${any})[^]` : any, width];
}

/** Python's `\w` as one class, which `\b` asks of the characters either side of it. */
const WORD_CHAR = `[${WORD}]`;
/**
 * `\b`, which JavaScript's `u` patterns read as ASCII, written as lookarounds on
 * Python's `\w`, by what is known of its neighbours (`wordEdges`): where one side is
 * surely a word character, only the other side is asked. Most of the detector's `\b`
 * have such a neighbour, and its patterns then compile in about half the time, which
 * each engine pays on a Worker's first documents.
 */
const BOUNDARY = Object.freeze({
  after: `(?<!${WORD_CHAR})`,
  before: `(?!${WORD_CHAR})`,
  neither: `(?:(?<=${WORD_CHAR})(?!${WORD_CHAR})|(?<!${WORD_CHAR})(?=${WORD_CHAR}))`,
});

/** ASCII word characters, `\d`, `\w` and ranges of one kind: a class of word characters only. */
const WORD_CLASS = /^(?:[A-Za-z0-9_]|\\[dw]|[A-Z]-[A-Z]|[a-z]-[a-z]|[0-9]-[0-9])+$/;
/** A quantifier as `translate` reads one: `*`, `+`, `?` or `{m,n}`, its least count, lazy `?`. */
const QUANTIFIER = /^(?:([*+?])|\{(\d*)(?:(,)\d*)?\})\??/;

/**
 * Reads the alternatives from `start` to their closing `)` or the end, stepping as
 * `translate` does, and records each `\b` outside a class in `boundaries`, by its index,
 * as `BOUNDARY` writes it. Answers whether every match of the alternatives begins
 * (`first`) and ends (`last`) with a word character, and the index where they end.
 *
 * A character the pattern reads case-insensitively is still a word character when its
 * neighbour in the pattern is an ASCII letter, a digit, `_`, `\d` or `\w`: each matches
 * only letters, numbers or `_` either way (the Kelvin sign for `k`, long s for `s`).
 */
function wordEdges(
  pattern: string,
  start: number,
  boundaries: Map<number, string>,
): { first: boolean; last: boolean; end: number } {
  let first = true;
  let last = true;
  let i = start;
  for (;;) {
    /** This alternative's terms: where a `\b` stands (or -1), and their word edges. */
    const terms: { boundary: number; first: boolean; last: boolean }[] = [];
    while (i < pattern.length && pattern[i] !== "|" && pattern[i] !== ")") {
      const c = pattern[i] as string;
      let boundary = -1;
      let word = false;
      let edges = { first: false, last: false };
      if (c === "\\" && pattern[i + 1] === "b") {
        boundary = i;
        i += 2;
      } else if (c === "\\") {
        word = pattern[i + 1] === "d" || pattern[i + 1] === "w";
        i += escapeAt(pattern, i, false)[1];
      } else if (c === "[") {
        const width = charClass(pattern, i)[1];
        word = WORD_CLASS.test(pattern.slice(i + 1, i + width - 1));
        i += width;
      } else if (c === "(") {
        // A group's head; a back reference or a comment is the whole group.
        const head = /^\((?:\?P<\w+>|\?:|\?<?[=!]|\?-[a-zA-Z]+:|\?P=\w+\)|\?#[^)]*\))?/.exec(
          pattern.slice(i),
        ) as RegExpExecArray;
        i += head[0].length;
        if (!head[0].endsWith(")")) {
          const inner = wordEdges(pattern, i, boundaries);
          // A lookaround consumes nothing, so it says nothing of its neighbours.
          if (!/^\(\?<?[=!]/.test(head[0])) edges = inner;
          i = inner.end + 1;
        }
      } else {
        word = /[A-Za-z0-9_]/.test(c);
        // A `{` with nothing to repeat is read as a quantifier below, as `translate` does.
        if (c !== "{") i += 1;
      }
      if (word) edges = { first: true, last: true };
      const quantifier = QUANTIFIER.exec(pattern.slice(i, i + 16));
      if (
        quantifier !== null &&
        (quantifier[1] !== undefined || quantifier[2] !== "" || quantifier[3] !== undefined)
      ) {
        i += quantifier[0].length;
        // A quantifier that allows none leaves nothing known at either edge.
        if (quantifier[1] === "*" || quantifier[1] === "?" || Number(quantifier[2]) === 0) {
          edges = { first: false, last: false };
        }
        // A quantified `\b` is written whole.
        if (boundary >= 0) boundaries.set(boundary, BOUNDARY.neither);
        boundary = -1;
      } else if (c === "{") {
        i += 1;
      }
      terms.push({ boundary, ...edges });
    }
    terms.forEach(({ boundary }, k) => {
      if (boundary < 0) return;
      const text = terms[k + 1]?.first
        ? BOUNDARY.after
        : terms[k - 1]?.last
          ? BOUNDARY.before
          : BOUNDARY.neither;
      boundaries.set(boundary, text);
    });
    first &&= terms[0]?.first ?? false;
    last &&= terms.at(-1)?.last ?? false;
    if (pattern[i] !== "|") return { first, last, end: i };
    i += 1;
  }
}

/** A match, read the way `re.Match` is read. Positions are UTF-16 indices. */
export class Match {
  readonly string: string;
  private readonly found: RegExpExecArray;

  constructor(string: string, found: RegExpExecArray) {
    this.string = string;
    this.found = found;
  }

  /** `m.group(g)`; `undefined` where Python answers `None`. */
  group(g: number | string = 0): string | undefined {
    return typeof g === "number" ? this.found[g] : this.found.groups?.[g];
  }

  /** `m.group(g)` of a group that always takes part in a match. */
  text(g: number | string = 0): string {
    const value = this.group(g);
    if (value === undefined) throw new Error(`python re: group ${g} did not take part`);
    return value;
  }

  /** `m.expand(template)`: a Python replacement template filled from this match. */
  expand(repl: string): string {
    return template(repl)(this);
  }

  /** `m.groups()`. */
  groups(): (string | undefined)[] {
    return this.found.slice(1);
  }

  start(g: number | string = 0): number {
    return this.span(g)[0];
  }

  end(g: number | string = 0): number {
    return this.span(g)[1];
  }

  /** `m.span(g)`; `[-1, -1]` for a group that did not take part. */
  span(g: number | string = 0): [number, number] {
    const indices = this.found.indices;
    const span = typeof g === "number" ? indices?.[g] : indices?.groups?.[g];
    return span === undefined ? [-1, -1] : [span[0], span[1]];
  }
}

/**
 * A Python pattern: `re.compile(pattern, flags)`, as an immutable description (the
 * Python original, the translated source, the flags). It compiles nothing it keeps
 * and matches nothing itself: a run matches through `RegexKit.re(pattern)`, which
 * compiles once per run.
 */
export class Pattern {
  /** md2ui's pattern, as written in Python. */
  readonly pattern: string;
  /** The JavaScript source that matches what the Python pattern matches. */
  readonly source: string;
  /** The JavaScript flags (`d`, `u`, and `i` for `re.IGNORECASE`). */
  readonly flags: string;
  /** What a kit knows the pattern by: two patterns with one key match the same strings. */
  readonly key: string;

  /**
   * `lead`: what precedes the translated source, a lookahead or nothing
   * (`compileFirst`).
   */
  constructor(pattern: string, flags: Flags = {}, lead: (source: string) => string = () => "") {
    this.pattern = pattern;
    const source = translate(pattern, flags);
    const lookahead = lead(source);
    // Grouped, so a lookahead leads every top-level alternative, not only the first.
    this.source = lookahead === "" ? source : `${lookahead}(?:${source})`;
    this.flags = `du${flags.i ? "i" : ""}`;
    this.key = `${this.flags}/${this.source}`;
    // Compile once now, so a pattern this translation cannot express fails on load.
    new RegExp(this.source, this.flags);
  }
}

/**
 * The regexes of one run of the pipeline (one `groupMarkdown`, `detectDataPoints`,
 * `applicable` call, or what its caller hands in): each Pattern compiled once, on
 * first use, and kept for the rest of the run, as md2ui keeps one
 * `session.load_grouping_kit()` for a run.
 *
 * A kit outlives its runs (a view keeps one, ADR-104), and some patterns are built per
 * call from the text (a fence's closer, a dedent margin, a styled span), so a new
 * Pattern object often repeats one compiled before. Patterns are found by their key,
 * and a pattern built during a run is forgotten once two runs have not used it, so a
 * kit holds the module patterns plus at most two runs' built ones.
 *
 * A kit also remembers the data points of each text it detected, by the text (the
 * detector is a pure function of it; md2ui ADR-103: the grouper memoizes its
 * detection by text). A view keeps one kit across the documents it shows (ADR-104), so a
 * re-sent or streamed document re-detects only text the last one did not hold. Each
 * grouping starts a run, and what the run before it did not use is forgotten, so the
 * memo never holds more than two documents' texts.
 */
export class RegexKit {
  /** By the Pattern object: what a module declares once is found without its key. */
  private readonly byPattern = new WeakMap<Pattern, CompiledPattern>();
  /** By key, what this run and the last one looked up by a new Pattern object. */
  private compiled = new Map<string, CompiledPattern>();
  private compiledBefore = new Map<string, CompiledPattern>();
  private detected = new Map<string, DataPoint[]>();
  private detectedBefore = new Map<string, DataPoint[]>();

  /** `pattern`, compiled for this run. */
  re(pattern: Pattern): CompiledPattern {
    let found = this.byPattern.get(pattern);
    if (found !== undefined) return found;
    found =
      this.compiled.get(pattern.key) ??
      this.compiledBefore.get(pattern.key) ??
      new CompiledPattern(pattern);
    this.compiled.set(pattern.key, found);
    this.byPattern.set(pattern, found);
    return found;
  }

  /**
   * Starts a grouping: only what the last one detected, and the patterns it built,
   * stay remembered.
   */
  startRun(): void {
    this.compiledBefore = this.compiled;
    this.compiled = new Map();
    this.detectedBefore = this.detected;
    this.detected = new Map();
  }

  /**
   * The data points of `text`, as `detect` finds them, remembered by the text. The
   * array is shared by every caller that asks for the same text and must not be
   * changed.
   */
  dataPoints(text: string, detect: (text: string) => DataPoint[]): DataPoint[] {
    let found = this.detected.get(text) ?? this.detectedBefore.get(text);
    if (found === undefined) found = detect(text);
    this.detected.set(text, found);
    return found;
  }
}

/**
 * A Pattern's RegExps, compiled once and kept for one run: what a `RegexKit` hands
 * out. Holds the pattern's methods (`re.Pattern`'s).
 *
 * A RegExp carries `lastIndex`, which is state, so it must never be observable:
 * every use sets `lastIndex` itself immediately before a synchronous `exec` / `test`,
 * and `finditer` collects all its matches before it yields the first, so no caller
 * can interleave two uses. What it answers depends only on its arguments. It is
 * never module-level (ADR-003): a kit owns it for one call of the pipeline.
 */
export class CompiledPattern {
  private readonly source: string;
  private readonly flags: string;

  private stickyRe: RegExp | null = null;
  private globalRe: RegExp | null = null;
  private wholeRe: RegExp | null = null;

  constructor(pattern: Pattern) {
    this.source = pattern.source;
    this.flags = pattern.flags;
  }

  private sticky(): RegExp {
    this.stickyRe ??= new RegExp(this.source, `${this.flags}y`);
    return this.stickyRe;
  }

  private global(): RegExp {
    this.globalRe ??= new RegExp(this.source, `${this.flags}g`);
    return this.globalRe;
  }

  /** `pattern.match(s, pos)`: a match starting exactly at `pos`. */
  match(s: string, pos = 0): Match | null {
    const re = this.sticky();
    re.lastIndex = pos;
    const found = re.exec(s);
    return found === null ? null : new Match(s, found);
  }

  /** `pattern.fullmatch(s)`. */
  fullmatch(s: string): Match | null {
    this.wholeRe ??= new RegExp(`(?:${this.source})$`, `${this.flags}y`);
    const re = this.wholeRe;
    re.lastIndex = 0;
    const found = re.exec(s);
    return found === null ? null : new Match(s, found);
  }

  /** `pattern.search(s, pos)`. */
  search(s: string, pos = 0): Match | null {
    const re = this.global();
    re.lastIndex = pos;
    const found = re.exec(s);
    return found === null ? null : new Match(s, found);
  }

  /** `bool(pattern.search(s))`. */
  test(s: string): boolean {
    const re = this.global();
    re.lastIndex = 0;
    return re.test(s);
  }

  /**
   * `pattern.finditer(s)`, with Python's (and JavaScript's) empty-match stepping: an
   * empty match moves on by one character (one code point).
   */
  *finditer(s: string): Generator<Match> {
    const re = this.global();
    re.lastIndex = 0;
    const found: Match[] = [];
    for (let m = re.exec(s); m !== null; m = re.exec(s)) {
      found.push(new Match(s, m));
      if (m[0] === "") re.lastIndex += (s.codePointAt(re.lastIndex) ?? 0) > 0xffff ? 2 : 1;
    }
    yield* found;
  }

  /** `pattern.findall(s)`: the whole match, the one group, or a tuple of groups. */
  findall(s: string): (string | string[])[] {
    const out: (string | string[])[] = [];
    for (const m of this.finditer(s)) {
      const groups = m.groups().map((g) => g ?? "");
      if (groups.length === 0) out.push(m.text());
      else if (groups.length === 1) out.push(groups[0] as string);
      else out.push(groups);
    }
    return out;
  }

  /**
   * `pattern.sub(repl, s, count)`. A string `repl` is a Python template (`\1`,
   * `\g<name>`, `\n`); a function receives each match.
   */
  sub(repl: string | ((m: Match) => string), s: string, count = 0): string {
    return this.subn(repl, s, count)[0];
  }

  /** `pattern.subn(repl, s, count)`. */
  subn(repl: string | ((m: Match) => string), s: string, count = 0): [string, number] {
    const expand = typeof repl === "string" ? template(repl) : repl;
    let out = "";
    let last = 0;
    let done = 0;
    for (const m of this.finditer(s)) {
      if (count > 0 && done >= count) break;
      out += s.slice(last, m.start()) + expand(m);
      last = m.end();
      done += 1;
    }
    return [out + s.slice(last), done];
  }

  /** `pattern.split(s, maxsplit)`: captured groups are kept, `undefined` for `None`. */
  split(s: string, maxsplit = 0): (string | undefined)[] {
    const out: (string | undefined)[] = [];
    let last = 0;
    let done = 0;
    for (const m of this.finditer(s)) {
      if (maxsplit > 0 && done >= maxsplit) break;
      out.push(s.slice(last, m.start()), ...m.groups());
      last = m.end();
      done += 1;
    }
    out.push(s.slice(last));
    return out;
  }
}

/** `re.compile(pattern, flags)`. */
export function compile(pattern: string, flags: Flags = {}): Pattern {
  return new Pattern(pattern, flags);
}

/** `re.escape(s)`: a backslash before each character Python's escape table names. */
export function reEscape(s: string): string {
  return s.replace(/[()[\]{}?*+\-|^$\\.&~# \t\n\r\v\f]/g, (c) => `\\${c}`);
}

/** A Python replacement template as a function of the match. */
function template(repl: string): (m: Match) => string {
  if (!repl.includes("\\")) return () => repl;
  const parts: (string | number)[] = [];
  let literal = "";
  for (let i = 0; i < repl.length; i += 1) {
    const c = repl[i] as string;
    if (c !== "\\") {
      literal += c;
      continue;
    }
    const rest = repl.slice(i + 1);
    const named = /^g<(\w+)>/.exec(rest);
    const numbered = /^(\d{1,2})/.exec(rest);
    const simple: Record<string, string> = { n: "\n", t: "\t", r: "\r", "\\": "\\" };
    if (named !== null) {
      parts.push(literal);
      literal = "";
      const name = named[1] as string;
      parts.push(/^\d+$/.test(name) ? Number(name) : `\0${name}`);
      i += named[0].length;
    } else if (numbered !== null) {
      parts.push(literal, Number(numbered[1]));
      literal = "";
      i += (numbered[1] as string).length;
    } else if (rest[0] !== undefined && rest[0] in simple) {
      literal += simple[rest[0]];
      i += 1;
    } else {
      literal += c;
    }
  }
  parts.push(literal);
  return (m) =>
    parts
      .map((part) => {
        if (typeof part === "number") return m.group(part) ?? "";
        return part.startsWith("\0") ? (m.group(part.slice(1)) ?? "") : part;
      })
      .join("");
}
