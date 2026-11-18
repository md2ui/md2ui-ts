// Python `str` semantics that JavaScript's String does not share (ADR-002).
//
// - `strip()` and `split()` use Python's white space (`str.isspace`), which is not
//   JavaScript's `trim()` set.
// - `splitlines()` also breaks at U+2028, md2ui's hard break, and at \v \f \x1c-\x1e \x85.
// - `len()` counts code points. A length that decides something (a threshold, a
//   category, a comparison of two spans) is a code-point length, `cpLen`; an index
//   into a string stays a JavaScript index.
// - The `is*` predicates are Unicode, by general category.

import { compile, PY_SPACE_CLASS, PY_SPACE_RANGES, type RegexKit } from "./re.ts";

const SPACE = new RegExp(`^[${PY_SPACE_CLASS}]+$`, "u");
const SPACE_RUN = new RegExp(`[${PY_SPACE_CLASS}]+`, "u");
/** `str.splitlines()` boundaries; `\r\n` is one. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: Python's line boundaries include \x1c-\x1e.
const LINE_BREAK = /\r\n|[\n\v\f\r\x1c-\x1e\x85\u2028\u2029]/u;

// py: textwrap._whitespace_only_re = re.compile('^[ \t]+$', re.MULTILINE)
const WHITESPACE_ONLY = compile("^[ \t]+$", { m: true });
// py: textwrap._leading_whitespace_re = re.compile('(^[ \t]*)(?:[^ \t\n])', re.MULTILINE)
const LEADING_WHITESPACE = compile("(^[ \t]*)(?:[^ \t\n])", { m: true });

/** `len(s)`: the number of code points. */
export function cpLen(s: string): number {
  let n = 0;
  for (const _ of s) n += 1;
  return n;
}

/** `s.strip(chars)`; with no `chars`, Python's white space. */
export function strip(s: string, chars?: string): string {
  return rstrip(lstrip(s, chars), chars);
}

/**
 * One UTF-16 unit of Python's white space: every such character is in the Basic
 * Multilingual Plane, so stripping reads char codes and never builds a string.
 */
function isPySpace(c: number): boolean {
  for (const [lo, hi] of PY_SPACE_RANGES) {
    if (c < lo) return false;
    if (c <= hi) return true;
  }
  return false;
}

/** `s.lstrip(chars)`. */
export function lstrip(s: string, chars?: string): string {
  if (chars === undefined) {
    let start = 0;
    while (start < s.length && isPySpace(s.charCodeAt(start))) start += 1;
    return start === 0 ? s : s.slice(start);
  }
  let i = 0;
  while (i < s.length) {
    const c = String.fromCodePoint(s.codePointAt(i) ?? 0);
    if (!chars.includes(c)) break;
    i += c.length;
  }
  return s.slice(i);
}

/** `s.rstrip(chars)`. */
export function rstrip(s: string, chars?: string): string {
  let end = s.length;
  if (chars === undefined) {
    while (end > 0 && isPySpace(s.charCodeAt(end - 1))) end -= 1;
    return end === s.length ? s : s.slice(0, end);
  }
  while (end > 0) {
    const width = charBefore(s, end).length;
    if (!chars.includes(s.slice(end - width, end))) break;
    end -= width;
  }
  return s.slice(0, end);
}

/**
 * `s.split(sep, maxsplit)`. With no `sep`, splits on runs of white space and drops
 * empty strings, as Python does.
 */
export function split(s: string, sep?: string, maxsplit = -1): string[] {
  const out: string[] = [];
  if (sep === undefined) {
    let rest = lstrip(s);
    while (rest !== "") {
      if (maxsplit >= 0 && out.length >= maxsplit) {
        out.push(rest);
        return out;
      }
      const run = SPACE_RUN.exec(rest);
      if (run === null) {
        out.push(rest);
        return out;
      }
      out.push(rest.slice(0, run.index));
      rest = rest.slice(run.index + run[0].length);
    }
    return out;
  }
  let rest = s;
  for (;;) {
    const at = rest.indexOf(sep);
    if (at < 0 || (maxsplit >= 0 && out.length >= maxsplit)) break;
    out.push(rest.slice(0, at));
    rest = rest.slice(at + sep.length);
  }
  out.push(rest);
  return out;
}

/** `s.splitlines(keepends)`. */
export function splitlines(s: string, keepends = false): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest !== "") {
    const brk = LINE_BREAK.exec(rest);
    if (brk === null) {
      out.push(rest);
      break;
    }
    const end = brk.index + brk[0].length;
    out.push(rest.slice(0, keepends ? end : brk.index));
    rest = rest.slice(end);
  }
  return out;
}

/** `s.isspace()`. */
export function isspace(s: string): boolean {
  return SPACE.test(s);
}

/** `s.isalpha()`: non-empty, every character a letter. */
export function isalpha(s: string): boolean {
  return /^\p{L}+$/u.test(s);
}

/** `s.isdecimal()`. */
function isdecimal(s: string): boolean {
  return /^\p{Nd}+$/u.test(s);
}

/** `s.isdigit()`: decimal digits and the other digits (superscripts, circled). */
export function isdigit(s: string): boolean {
  return /^(?:\p{Nd}|\p{No})+$/u.test(s) && /^[^⅐-↏¼-¾]+$/u.test(s);
}

/** `s.isalnum()`. */
export function isalnum(s: string): boolean {
  return /^[\p{L}\p{N}]+$/u.test(s);
}

/** `s.isupper()`: has a cased character, and no lowercase one. */
export function isupper(s: string): boolean {
  return /[\p{Lu}\p{Lt}]/u.test(s) && !/\p{Ll}/u.test(s);
}

/** `s.islower()`: has a cased character, and no uppercase one. */
export function islower(s: string): boolean {
  return /\p{Ll}/u.test(s) && !/[\p{Lu}\p{Lt}]/u.test(s);
}

/** `s[:1]`: the first code point, or `""`. */
export function first(s: string): string {
  const code = s.codePointAt(0);
  return code === undefined ? "" : String.fromCodePoint(code);
}

/** `textwrap.dedent(text)`: the common leading spaces and tabs removed from every line. */
export function dedent(kit: RegexKit, text: string): string {
  const blanked = kit.re(WHITESPACE_ONLY).sub("", text);
  let margin: string | null = null;
  for (const m of kit.re(LEADING_WHITESPACE).finditer(blanked)) {
    const indent = m.text(1);
    if (margin === null || margin.startsWith(indent)) margin = indent;
    else if (!indent.startsWith(margin)) {
      let i = 0;
      while (i < margin.length && i < indent.length && margin[i] === indent[i]) i += 1;
      if (i < margin.length && i < indent.length) margin = margin.slice(0, i);
    }
  }
  if (!margin) return blanked;
  // py: re.sub(r'(?m)^' + margin, '', text)
  return kit.re(compile(`^${margin}`, { m: true })).sub("", blanked);
}

/**
 * The value of one Unicode decimal digit. Unicode lays every script's digits out as
 * consecutive runs of 0-9, so it is the distance from the start of its run, modulo 10.
 */
function digitValue(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  let zero = code;
  while (zero > 0 && isdecimal(String.fromCodePoint(zero - 1))) zero -= 1;
  return (code - zero) % 10;
}

/** `s` with every Unicode decimal digit as its ASCII digit, which is how `int()` and `float()` read them. */
export function asciiDigits(s: string): string {
  return /^[0-9.\-+]*$/.test(s) ? s : s.replace(/\p{Nd}/gu, (c) => String(digitValue(c)));
}

/** `int(s)` for a run of decimal digits of any script, as `\d+` matches them. */
export function toInt(s: string): number {
  return Number(asciiDigits(s));
}

/** `int(re.search(r"\d+", s).group())`, or `undefined` where there is no digit run. */
export function firstInt(s: string): number | undefined {
  const m = /\p{Nd}+/u.exec(s);
  return m === null ? undefined : toInt(m[0]);
}

/** `s.partition(sep)`: before, whether `sep` was found, after. */
export function partition(s: string, sep: string): [string, boolean, string] {
  const at = s.indexOf(sep);
  return at < 0 ? [s, false, ""] : [s.slice(0, at), true, s.slice(at + sep.length)];
}

/**
 * `s[i]` read as a character: the code point starting at UTF-16 index `i`, or `""`
 * past the end. Python indexes code points, so a neighbour test (`isalnum`,
 * `isspace`) must see the whole character, not half a surrogate pair.
 */
export function charAt(s: string, i: number): string {
  if (i < 0 || i >= s.length) return "";
  return String.fromCodePoint(s.codePointAt(i) ?? 0);
}

/** `s[i - 1]` read as a character: the code point ending at UTF-16 index `i`, or `""`. */
export function charBefore(s: string, i: number): string {
  if (i <= 0 || i > s.length) return "";
  const low = s.charCodeAt(i - 1);
  const start = low >= 0xdc00 && low <= 0xdfff && i >= 2 ? i - 2 : i - 1;
  return String.fromCodePoint(s.codePointAt(start) ?? 0);
}

/**
 * `format(x, ".{precision}g")`: `precision` significant digits, trailing zeros dropped,
 * exponent form below 1e-4 or from 10**precision. Ties round as JavaScript does (half up
 * on the stored value) where Python rounds half to even; only a value with more
 * significant digits than `precision`, ending exactly in 5, can tell them apart.
 */
export function formatGTo(x: number, precision: number): string {
  if (x === 0) return Object.is(x, -0) ? "-0" : "0";
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
  const [mantissa = "", exp = "0"] = x.toExponential(precision - 1).split("e");
  const exponent = Number(exp);
  if (exponent < -4 || exponent >= precision) {
    const digits = mantissa.includes(".") ? mantissa.replace(/\.?0+$/, "") : mantissa;
    return `${digits}e${exponent < 0 ? "-" : "+"}${String(Math.abs(exponent)).padStart(2, "0")}`;
  }
  const fixed = x.toFixed(Math.max(0, precision - 1 - exponent));
  return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

/** `format(x, "g")`: `formatGTo` at Python's default six digits. */
export function formatG(x: number): string {
  return formatGTo(x, 6);
}

/** `float(s)` for a decimal written in any script's digits, as `\d` matches them. */
export function toFloat(s: string): number {
  return Number(asciiDigits(s));
}

// Python's float() literal after its digits are ASCII: sign, digits with single
// underscores, a fraction, an exponent.
const FLOAT_TEXT =
  /^[+-]?(?:[0-9](?:_?[0-9])*(?:\.(?:[0-9](?:_?[0-9])*)?)?|\.[0-9](?:_?[0-9])*)(?:[eE][+-]?[0-9](?:_?[0-9])*)?$/;
const FLOAT_SPECIAL = /^([+-]?)(inf|infinity|nan)$/i;

/**
 * `s` without the white space `int()` and `float()` strip from a number's text: Python's,
 * but not the separators U+001C-U+001F that `str.strip()` also strips, so
 * `int("1\x1c")` and `float("1\x1c")` raise. (`Decimal()` strips all of it: `strip`.)
 */
export function numberStrip(s: string): string {
  let start = 0;
  let end = s.length;
  const pad = (c: number): boolean => isPySpace(c) && (c < 0x1c || c > 0x1f);
  while (start < end && pad(s.charCodeAt(start))) start += 1;
  while (end > start && pad(s.charCodeAt(end - 1))) end -= 1;
  return s.slice(start, end);
}

/**
 * `float(v)` for a parsed value: a number as is, a bool as 1 or 0, a string by Python's
 * grammar; null where Python raises.
 */
export function pyFloat(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v !== "string") return null;
  const text = asciiDigits(numberStrip(v));
  const special = FLOAT_SPECIAL.exec(text);
  if (special !== null) {
    if ((special[2] ?? "").toLowerCase() === "nan") return Number.NaN;
    return special[1] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  }
  return FLOAT_TEXT.test(text) ? Number(text.replaceAll("_", "")) : null;
}
