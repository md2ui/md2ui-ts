// Python's `datetime.strptime` and `datetime.isoformat` for the formats md2ui reads (ADR-002).
//
// md2ui parses a matched date with `strptime` and stores `isoformat()` of the result,
// and a match that is not a real date (`2026-02-30`) raises `ValueError`, which drops
// the data point. So the calendar is checked, and the directives behave as Python's:
// `%d` and `%m` take one or two digits, `%y` pivots at 68, month names ignore case, a
// format space is one or more white space, and anything left over is an error.

import { pyInt, ValueError } from "./value.ts";

/** The fields of a `datetime` (naive, no microseconds). */
export interface DateTime {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}

const MONTHS_LONG: readonly string[] = Object.freeze([
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
]);
const MONTHS_SHORT: readonly string[] = Object.freeze(MONTHS_LONG.map((name) => name.slice(0, 3)));

function daysInMonth(year: number, month: number): number {
  if (month === 2) return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** `datetime(year, month, day, hour, minute, second)`: raises `ValueError` out of range. */
export function datetime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
): DateTime {
  if (year < 1 || year > 9999) throw new ValueError(`year ${year} is out of range`);
  if (month < 1 || month > 12) throw new ValueError("month must be in 1..12");
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new ValueError("day is out of range for month");
  }
  if (hour < 0 || hour > 23) throw new ValueError("hour must be in 0..23");
  if (minute < 0 || minute > 59) throw new ValueError("minute must be in 0..59");
  if (second < 0 || second > 59) throw new ValueError("second must be in 0..59");
  return { year, month, day, hour, minute, second };
}

/** `dt.isoformat()`. */
export function isoformat(dt: DateTime): string {
  const two = (n: number): string => `${n}`.padStart(2, "0");
  const date = `${`${dt.year}`.padStart(4, "0")}-${two(dt.month)}-${two(dt.day)}`;
  return `${date}T${two(dt.hour)}:${two(dt.minute)}:${two(dt.second)}`;
}

/** Longest first, as Python's `_strptime` orders the names, so no name hides a longer one. */
function names(list: readonly string[]): string {
  return [...list].sort((a, b) => b.length - a.length).join("|");
}

const DIRECTIVES: Readonly<Record<string, string>> = Object.freeze({
  Y: String.raw`(\p{Nd}{4})`,
  y: String.raw`(\p{Nd}{2})`,
  m: "(1[0-2]|0[1-9]|[1-9])",
  d: String.raw`(3[0-1]|[1-2]\p{Nd}|0[1-9]|[1-9]| [1-9])`,
  B: `(${names(MONTHS_LONG)})`,
  b: `(${names(MONTHS_SHORT)})`,
});

/** `datetime.strptime(s, format)` for a format of the directives above, parsed once. */
export function strptime(format: string): (s: string) => DateTime {
  let source = "";
  const fields: string[] = [];
  for (let i = 0; i < format.length; i += 1) {
    const c = format[i] as string;
    if (c === "%") {
      i += 1;
      const directive = format[i] as string;
      fields.push(directive);
      source += DIRECTIVES[directive] as string;
    } else if (c === " ") {
      source += String.raw`\s+`;
    } else {
      source += c === "." ? String.raw`\.` : c;
    }
  }
  const pattern = new RegExp(source, "iuy");
  return (s) => {
    pattern.lastIndex = 0;
    const found = pattern.exec(s);
    if (found === null) throw new ValueError(`time data '${s}' does not match format '${format}'`);
    if (found[0].length !== s.length) throw new ValueError("unconverted data remains");
    let year = 1900;
    let month = 1;
    let day = 1;
    for (const [index, directive] of fields.entries()) {
      const text = (found[index + 1] as string).trim();
      if (directive === "Y") year = pyInt(text);
      else if (directive === "y") year = pyInt(text) + (pyInt(text) <= 68 ? 2000 : 1900);
      else if (directive === "m") month = pyInt(text);
      else if (directive === "d") day = pyInt(text);
      else if (directive === "B") month = MONTHS_LONG.indexOf(text.toLowerCase()) + 1;
      else month = MONTHS_SHORT.indexOf(text.toLowerCase()) + 1;
    }
    return datetime(year, month, day);
  };
}
