// Turning a match into a value: one parser per data-point type (md2ui `detector_parsers`).
//
// Each takes the text a pattern matched and returns the typed value it stands for, in
// md2ui's serialized form (a `Decimal` is a number, a `datetime` its ISO string). A
// parser raises `ValueError` for a match that is not a value, and the scan then drops
// it silently, so a pattern and its parser have to agree. Only the parsers of the
// types the pipeline scans for are ported (ADR-102).

import { type DateTime, datetime, isoformat, strptime } from "../py/datetime.ts";
import { compile, type RegexKit } from "../py/re.ts";
import { lstrip, rstrip, strip } from "../py/str.ts";
import { decimal, decimalTimes, pyInt, ValueError } from "../py/value.ts";
import type { DataPointValue } from "./types.ts";
import {
  CURRENCY_SYMBOLS,
  DATE_CHIP_JOIN,
  DAY_NAMES_RE,
  DIMENSION_UNITS,
  DURATION_UNIT_SECONDS,
  EMOJI_CHAR_PATTERN,
  ISO_CURRENCY_CODES,
  MAGNITUDE,
  MAGNITUDE_MULTIPLIERS,
  MAGNITUDE_WORDS,
  MINUS,
  MONTH_NAMES,
  MONTH_NAMES_LONG,
  MONTH_NAMES_SHORT,
  ORDINAL_SUFFIX,
  QUANTITY_UNITS,
  RANGE_OP,
  SIGN,
  SPEED_UNITS,
  SYMBOL_CURRENCY,
} from "./vocabulary.ts";

/** A parser: the matched text to its value. */
export type Parser = (matched: string, kit: RegexKit) => DataPointValue;

type Fields = { [key: string]: DataPointValue };

const i = { i: true } as const;

/** `table.get(key)` of a plain table: undefined when the key is absent. */
function lookup<T>(table: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined;
}

/** `"a".capitalize()` for the ASCII names the patterns admit. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

// ---------------------------------------------------------------- dates and times

// py: strptime formats of the parsers below
const STRP_B = strptime("%b");
const STRP_B_D_Y = strptime("%b %d, %Y");
const STRP_B_D = strptime("%b %d");
const STRP_B_Y = strptime("%b %Y");
const STRP_BIG_B = strptime("%B");
const STRP_BIG_B_D_Y = strptime("%B %d, %Y");
const STRP_BIG_B_D = strptime("%B %d");
const STRP_BIG_B_Y = strptime("%B %Y");
const STRP_ISO_DATE = strptime("%Y-%m-%d");
const STRP_ISO_MONTH = strptime("%Y-%m");
const STRP_MONTH_YEAR = strptime("%m/%Y");
const STRP_DOTTED_SHORT_YEAR = strptime("%d.%m.%y");
const STRP_FULL_DAY_MONTH = [
  strptime("%d %B %Y"),
  strptime("%d %b %Y"),
  strptime("%B %d %Y"),
  strptime("%b %d %Y"),
] as const;

const WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
const WEEKDAY_ABBREVIATIONS: Readonly<Record<string, readonly [string, number]>> = Object.freeze({
  mon: ["Monday", 0],
  tue: ["Tuesday", 1],
  tues: ["Tuesday", 1],
  wed: ["Wednesday", 2],
  thu: ["Thursday", 3],
  thur: ["Thursday", 3],
  thurs: ["Thursday", 3],
  fri: ["Friday", 4],
  sat: ["Saturday", 5],
  sun: ["Sunday", 6],
});

/** `list.index(item)`: raises `ValueError` when absent. */
function indexOf(list: readonly string[], item: string): number {
  const at = list.indexOf(item);
  if (at < 0) throw new ValueError(`${item} is not in list`);
  return at;
}

// md2ui: detector_parsers._combine_date_time
function combineDateTime(date: DateTime, time: string, period: string | undefined): Fields {
  const parts = time.split(":");
  let hour = pyInt(parts[0] as string);
  // A bare hour ("3 PM") carries no colon; it means minute 0.
  const minute = parts.length > 1 ? pyInt(parts[1] as string) : 0;
  const second = parts.length > 2 ? pyInt(parts[2] as string) : 0;
  if (period) {
    const p = period.toUpperCase();
    if (p === "PM" && hour !== 12) hour += 12;
    else if (p === "AM" && hour === 12) hour = 0;
  }
  const combined = datetime(date.year, date.month, date.day, hour, minute, second);
  return {
    datetime: isoformat(combined),
    date: isoformat(date),
    hour,
    minute,
    second,
    subtype: "datetime",
    has_year: true,
  };
}

// py: rf"({_MONTH_NAMES})\.? (\d{{1,2}})(?:{_ORDINAL_SUFFIX})?"
// py: rf"(?:, (\d{{4}}))?[,.]\s*"
// py: rf"(\d{{1,2}}(?::\d{{2}})?(?::\d{{2}})?)\s*(AM|PM|am|pm)?"
const DATETIME_COMMA = compile(
  String.raw`(${MONTH_NAMES})\.? (\d{1,2})(?:${ORDINAL_SUFFIX})?` +
    String.raw`(?:, (\d{4}))?[,.]\s*` +
    String.raw`(\d{1,2}(?::\d{2})?(?::\d{2})?)\s*(AM|PM|am|pm)?`,
  i,
);

// md2ui: detector_parsers._parse_datetime_comma
export function parseDatetimeComma(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(DATETIME_COMMA).match(matched);
  if (!match) throw new ValueError("Invalid comma datetime");
  const monthName = match.text(1);
  const day = match.text(2);
  const year = match.group(3);
  const timeStr = match.text(4);
  const period = match.group(5);
  const monthNum = STRP_B(monthName.slice(0, 3)).month;
  if (year) return combineDateTime(datetime(pyInt(year), monthNum, pyInt(day)), timeStr, period);
  const parts = timeStr.split(":");
  let hour = pyInt(parts[0] as string);
  const minute = parts.length > 1 ? pyInt(parts[1] as string) : 0;
  if (period) {
    const p = period.toUpperCase();
    if (p === "PM" && hour !== 12) hour += 12;
    else if (p === "AM" && hour === 12) hour = 0;
  }
  return {
    month: monthNum,
    day: pyInt(day),
    hour,
    minute,
    subtype: "datetime",
    has_year: false,
  };
}

// py: rf"({_DAY_NAMES_RE}),\s+({_MONTH_NAMES})\.? (\d{{1,2}})"
// py: rf"(?:{_ORDINAL_SUFFIX})?(?:, (\d{{4}}))?"
const WEEKDAY_DATE = compile(
  String.raw`(${DAY_NAMES_RE}),\s+(${MONTH_NAMES})\.? (\d{1,2})` +
    String.raw`(?:${ORDINAL_SUFFIX})?(?:, (\d{4}))?`,
  i,
);

// md2ui: detector_parsers._parse_weekday_date
export function parseWeekdayDate(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(WEEKDAY_DATE).match(matched);
  if (!match) throw new ValueError("Invalid weekday date");
  const year = match.group(4);
  const value: Fields = {
    day_name: rstrip(match.text(1), "."),
    month: STRP_B(match.text(2).slice(0, 3)).month,
    day: pyInt(match.text(3)),
    subtype: "weekday_date",
    has_year: year !== undefined,
  };
  if (year) value["year"] = pyInt(year);
  return value;
}

// py: rf"((?:{_MONTH_NAMES_LONG}) \d{{1,2}}, \d{{4}})\s+at\s+(\d{{1,2}}:\d{{2}}(?::\d{{2}})?)\s*(AM|PM|am|pm)?"
const DATETIME_LONG_MONTH = compile(
  String.raw`((?:${MONTH_NAMES_LONG}) \d{1,2}, \d{4})\s+at\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(AM|PM|am|pm)?`,
  i,
);

// md2ui: detector_parsers._parse_datetime_long_month ("February 3, 2026 at 4:45 PM")
export function parseDatetimeLongMonth(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(DATETIME_LONG_MONTH).match(matched);
  if (match) {
    return combineDateTime(STRP_BIG_B_D_Y(match.text(1)), match.text(2), match.group(3));
  }
  throw new ValueError("Invalid long-month datetime");
}

// py: rf"((?:{_MONTH_NAMES_SHORT})\.? \d{{1,2}}, \d{{4}})\s+at\s+(\d{{1,2}}:\d{{2}}(?::\d{{2}})?)\s*(AM|PM|am|pm)?"
const DATETIME_SHORT_MONTH = compile(
  String.raw`((?:${MONTH_NAMES_SHORT})\.? \d{1,2}, \d{4})\s+at\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(AM|PM|am|pm)?`,
  i,
);

// md2ui: detector_parsers._parse_datetime_short_month ("Feb 3, 2026 at 4:45 PM")
export function parseDatetimeShortMonth(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(DATETIME_SHORT_MONTH).match(matched);
  if (match) {
    return combineDateTime(
      STRP_B_D_Y(match.text(1).replaceAll(".", "")),
      match.text(2),
      match.group(3),
    );
  }
  throw new ValueError("Invalid short-month datetime");
}

// py: r"(\d{4}-\d{2}-\d{2})\s+at\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(AM|PM|am|pm)?"
const DATETIME_ISO = compile(
  String.raw`(\d{4}-\d{2}-\d{2})\s+at\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*(AM|PM|am|pm)?`,
  i,
);

// md2ui: detector_parsers._parse_datetime_iso ("2024-01-15 at 14:30")
export function parseDatetimeIso(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(DATETIME_ISO).match(matched);
  if (match) return combineDateTime(STRP_ISO_DATE(match.text(1)), match.text(2), match.group(3));
  throw new ValueError("Invalid ISO datetime");
}

// py: rf"({_MONTH_NAMES_LONG}) (\d{{1,2}})-(\d{{1,2}}), (\d{{4}})"
const DATE_RANGE = compile(String.raw`(${MONTH_NAMES_LONG}) (\d{1,2})-(\d{1,2}), (\d{4})`, i);

// md2ui: detector_parsers._parse_date_range ("January 12-28, 2026")
export function parseDateRange(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(DATE_RANGE).match(matched);
  if (match) {
    const [month, startDay, endDay, year] = [1, 2, 3, 4].map((n) => match.text(n)) as [
      string,
      string,
      string,
      string,
    ];
    return {
      start: isoformat(STRP_BIG_B_D_Y(`${month} ${startDay}, ${year}`)),
      end: isoformat(STRP_BIG_B_D_Y(`${month} ${endDay}, ${year}`)),
    };
  }
  throw new ValueError("Invalid date range");
}

// py: rf"({_MONTH_NAMES_SHORT}) (\d{{1,2}})-(\d{{1,2}}), (\d{{4}})"
const DATE_RANGE_SHORT = compile(
  String.raw`(${MONTH_NAMES_SHORT}) (\d{1,2})-(\d{1,2}), (\d{4})`,
  i,
);

// md2ui: detector_parsers._parse_date_range_short ("Jan 12-28, 2026")
export function parseDateRangeShort(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(DATE_RANGE_SHORT).match(matched);
  if (match) {
    const [month, startDay, endDay, year] = [1, 2, 3, 4].map((n) => match.text(n)) as [
      string,
      string,
      string,
      string,
    ];
    return {
      start: isoformat(STRP_B_D_Y(`${month} ${startDay}, ${year}`)),
      end: isoformat(STRP_B_D_Y(`${month} ${endDay}, ${year}`)),
    };
  }
  throw new ValueError("Invalid date range");
}

// py: r"\s+[-–—]\s+"
const RANGE_DASH_SPLIT = compile(String.raw`\s+[-–—]\s+`);

// md2ui: detector_parsers._parse_date_range_endpoint. One endpoint of a two-endpoint range.
function parseDateRangeEndpoint(text: string): Fields {
  const s = rstrip(strip(text), ".");
  const formats: readonly (readonly [(s: string) => DateTime, boolean])[] = [
    [STRP_BIG_B_D_Y, true],
    [STRP_B_D_Y, true],
    [STRP_BIG_B_D, false],
    [STRP_B_D, false],
  ];
  for (const [parse, hasYear] of formats) {
    let dt: DateTime;
    try {
      dt = parse(s);
    } catch (error) {
      if (error instanceof ValueError) continue;
      throw error;
    }
    if (hasYear) return { datetime: isoformat(dt), has_year: true };
    return { month: dt.month, day: dt.day, has_year: false };
  }
  throw new ValueError(`Cannot parse date range endpoint: ${s}`);
}

// md2ui: detector_parsers._parse_date_range_two_endpoints ("Jul 5 - Dec 5")
export function parseDateRangeTwoEndpoints(matched: string, kit: RegexKit): DataPointValue {
  const parts = kit.re(RANGE_DASH_SPLIT).split(matched, 1);
  if (parts.length !== 2) throw new ValueError("Invalid two-endpoint date range");
  const start = parseDateRangeEndpoint(parts[0] as string);
  const end = parseDateRangeEndpoint(parts[1] as string);
  return { start, end, has_year: start["has_year"] === true && end["has_year"] === true };
}

/** md2ui: detector_parsers._connector: which spelling joined a date to its day. */
function connector(join: string): string {
  return join === "-" ? "dash" : "space";
}

// py: rf"({_MONTH_NAMES_LONG})({_DATE_CHIP_JOIN})(\d{{1,2}})"
const DATE_PARTIAL_LONG = compile(String.raw`(${MONTH_NAMES_LONG})(${DATE_CHIP_JOIN})(\d{1,2})`, i);

// md2ui: detector_parsers._parse_date_partial_long ("January 15", "March 5th")
export function parseDatePartialLong(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(DATE_PARTIAL_LONG).match(matched);
  if (match) {
    return {
      month: STRP_BIG_B(match.text(1)).month,
      day: pyInt(match.text(3)),
      subtype: "partial",
      connector: connector(match.text(2)),
      has_year: false,
    };
  }
  throw new ValueError("Invalid partial date");
}

// py: rf"({_MONTH_NAMES_SHORT})\.?({_DATE_CHIP_JOIN})(\d{{1,2}})"
const DATE_PARTIAL_SHORT = compile(
  String.raw`(${MONTH_NAMES_SHORT})\.?(${DATE_CHIP_JOIN})(\d{1,2})`,
  i,
);

// md2ui: detector_parsers._parse_date_partial_short ("Jan 15", "Mar 5th")
export function parseDatePartialShort(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(DATE_PARTIAL_SHORT).match(matched);
  if (match) {
    return {
      month: STRP_B(match.text(1).slice(0, 3)).month,
      day: pyInt(match.text(3)),
      subtype: "partial",
      connector: connector(match.text(2)),
      has_year: false,
    };
  }
  throw new ValueError("Invalid partial date");
}

// py: rf"(\d{{1,2}})(?:{_ORDINAL_SUFFIX})"
const DAY_ORDINAL = compile(String.raw`(\d{1,2})(?:${ORDINAL_SUFFIX})`, i);
// py: r"\b(?:the|of)\b"
const THE_OF = compile(String.raw`\b(?:the|of)\b`, i);
// py: r"\s+"
const SPACE_RUN = compile(String.raw`\s+`);

// md2ui: detector_parsers._parse_full_date_with_month_name ("20 May 2017", "May 20th, 2017")
export function parseFullDateWithMonthName(matched: string, kit: RegexKit): DataPointValue {
  let s = kit.re(DAY_ORDINAL).sub(String.raw`\1`, matched);
  s = kit.re(THE_OF).sub(" ", s);
  s = s.replaceAll(",", " ").replaceAll(".", " ");
  s = strip(kit.re(SPACE_RUN).sub(" ", s));
  for (const parse of STRP_FULL_DAY_MONTH) {
    let dt: DateTime;
    try {
      dt = parse(s);
    } catch (error) {
      if (error instanceof ValueError) continue;
      throw error;
    }
    return { datetime: isoformat(dt), subtype: "full", has_year: true };
  }
  throw new ValueError("Invalid full date");
}

// md2ui: detector_parsers._parse_month_year ("May 2017", "2017-05", "05/2017")
export function parseMonthYear(matched: string, kit: RegexKit): DataPointValue {
  const s = kit.re(SPACE_RUN).sub(" ", strip(matched.replaceAll(",", " ")));
  for (const parse of [STRP_BIG_B_Y, STRP_B_Y, STRP_ISO_MONTH, STRP_MONTH_YEAR]) {
    let dt: DateTime;
    try {
      dt = parse(s);
    } catch (error) {
      if (error instanceof ValueError) continue;
      throw error;
    }
    return { month: dt.month, year: dt.year, subtype: "month_year", has_year: true };
  }
  throw new ValueError("Invalid month-year");
}

// md2ui: detector_parsers._parse_date_dotted_short_year ("20.05.17", D.M.YY)
export function parseDateDottedShortYear(matched: string): DataPointValue {
  return {
    datetime: isoformat(STRP_DOTTED_SHORT_YEAR(matched)),
    subtype: "full",
    has_year: true,
  };
}

// py: r"(\d{1,2})"
const DAY_DIGITS = compile(String.raw`(\d{1,2})`);

// md2ui: detector_parsers._parse_date_day_only ("the 15th")
export function parseDateDayOnly(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(DAY_DIGITS).search(matched);
  if (match) return { day: pyInt(match.text(1)), subtype: "day_only", has_year: false };
  throw new ValueError("Invalid day-only date");
}

// md2ui: detector_parsers._parse_day_of_week ("Monday")
export function parseDayOfWeek(matched: string): DataPointValue {
  return {
    day_name: capitalize(matched),
    day_index: indexOf(WEEKDAYS, matched.toLowerCase()),
    subtype: "day_of_week",
    has_year: false,
  };
}

// md2ui: detector_parsers._parse_day_of_week_short ("Mon", "Tues.")
export function parseDayOfWeekShort(matched: string): DataPointValue {
  const found = lookup(WEEKDAY_ABBREVIATIONS, rstrip(matched.toLowerCase(), "."));
  if (found) {
    return { day_name: found[0], day_index: found[1], subtype: "day_of_week", has_year: false };
  }
  throw new ValueError("Invalid day of week");
}

// py: rf"(\w+)({_DATE_CHIP_JOIN})(\d{{1,2}})"
const WEEKDAY_DAY = compile(String.raw`(\w+)(${DATE_CHIP_JOIN})(\d{1,2})`);

// md2ui: detector_parsers._parse_weekday_day ("Monday 15", "Friday 3rd")
export function parseWeekdayDay(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(WEEKDAY_DAY).match(matched);
  if (match) {
    const dayName = match.text(1);
    return {
      day_name: capitalize(dayName),
      day_index: indexOf(WEEKDAYS, dayName.toLowerCase()),
      day: pyInt(match.text(3)),
      subtype: "weekday_day",
      connector: connector(match.text(2)),
      has_year: false,
    };
  }
  throw new ValueError("Invalid weekday+day date");
}

// py: rf"(\w+)\.?({_DATE_CHIP_JOIN})(\d{{1,2}})"
const WEEKDAY_DAY_SHORT = compile(String.raw`(\w+)\.?(${DATE_CHIP_JOIN})(\d{1,2})`);

// md2ui: detector_parsers._parse_weekday_day_short ("Mon 15", "Tue 10")
export function parseWeekdayDayShort(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(WEEKDAY_DAY_SHORT).match(matched);
  if (match) {
    const found = lookup(WEEKDAY_ABBREVIATIONS, match.text(1).toLowerCase());
    if (found) {
      return {
        day_name: found[0],
        day_index: found[1],
        day: pyInt(match.text(3)),
        subtype: "weekday_day",
        connector: connector(match.text(2)),
        has_year: false,
      };
    }
  }
  throw new ValueError("Invalid weekday+day date");
}

// ------------------------------------------------------------ money and magnitudes

// py: rf"(\d{{1,3}}(?:,\d{{3}})*(?:\.\d+)?)\s*({_MAGNITUDE_WORDS})"
const MAGNITUDE_QUANTITY = compile(
  String.raw`(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(${MAGNITUDE_WORDS})`,
  i,
);

/** A magnitude word's multiplier; the patterns admit only these words. */
function multiplier(word: string): bigint {
  const found = lookup(MAGNITUDE_MULTIPLIERS, word.toLowerCase());
  if (found === undefined) throw new ValueError(`unknown magnitude ${word}`);
  return found;
}

// md2ui: detector_parsers._parse_magnitude ("3.7 million", "5,000 million")
export function parseMagnitude(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(MAGNITUDE_QUANTITY).match(matched);
  if (match) {
    const baseValue = match.text(1).replaceAll(",", "");
    const unit = match.text(2);
    return {
      value: decimalTimes(baseValue, multiplier(unit)),
      base_value: decimal(baseValue),
      unit: unit.toLowerCase(),
    };
  }
  throw new ValueError("Invalid magnitude");
}

// py: rf"\b({_ISO_CURRENCY_CODES})\s+{_CURRENCY_SYMBOLS}?(\d{{1,3}}(?:,\d{{3}})*(?:\.\d+)?)"
const ISO_CURRENCY_PREFIX = compile(
  String.raw`\b(${ISO_CURRENCY_CODES})\s+${CURRENCY_SYMBOLS}?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)`,
  i,
);
// py: rf"{_CURRENCY_SYMBOLS}?(\d{{1,3}}(?:,\d{{3}})*(?:\.\d+)?)\s+({_ISO_CURRENCY_CODES})\b"
const ISO_CURRENCY_SUFFIX = compile(
  String.raw`${CURRENCY_SYMBOLS}?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s+(${ISO_CURRENCY_CODES})\b`,
  i,
);

// md2ui: detector_parsers._parse_iso_currency ("MXN 85.00", "$85.00 MXN", "1,200 USD")
export function parseIsoCurrency(matched: string, kit: RegexKit): DataPointValue {
  const s = strip(matched);
  let m = kit.re(ISO_CURRENCY_PREFIX).match(s);
  if (m) {
    return {
      amount: decimal(m.text(2).replaceAll(",", "")),
      currency: m.text(1).toUpperCase(),
    };
  }
  m = kit.re(ISO_CURRENCY_SUFFIX).match(s);
  if (m) {
    return {
      amount: decimal(m.text(1).replaceAll(",", "")),
      currency: m.text(2).toUpperCase(),
    };
  }
  throw new ValueError(`Could not parse ISO currency: ${matched}`);
}

// py: r"\d+(?:[.,]\d+)*"
const AMOUNT_DIGITS = compile(String.raw`\d+(?:[.,]\d+)*`);

// md2ui: detector_parsers._normalize_amount. Mixed '.'/',' grouping to one number: with
// both, the rightmost is the decimal point; a lone ',' is a decimal point unless it
// groups exactly three digits; a lone '.' is a decimal point; a repeated '.' can only be
// a thousands separator, so every group after the first must be three digits. Anything
// else ('25.12.2021', '1.2.3') is not an amount, and says so with `ValueError`.
function normalizeAmount(num: string): number {
  let text = num;
  if (text.includes(".") && text.includes(",")) {
    if (text.lastIndexOf(".") > text.lastIndexOf(",")) text = text.replaceAll(",", "");
    else text = text.replaceAll(".", "").replaceAll(",", ".");
  } else if (text.includes(",")) {
    const parts = text.split(",");
    const last = parts[1] as string;
    if (parts.length === 2 && [...last].length !== 3) text = text.replaceAll(",", ".");
    else text = text.replaceAll(",", "");
  } else {
    const [, ...groups] = text.split(".");
    if (groups.length > 1) {
      if (groups.some((group) => [...group].length !== 3))
        throw new ValueError(`Not an amount: ${num}`);
      text = text.replaceAll(".", "");
    }
  }
  return decimal(text);
}

// md2ui: detector_parsers._parse_currency_trailing_symbol ("2,36 €", "45€", "$2.36 €")
export function parseCurrencyTrailingSymbol(matched: string, kit: RegexKit): DataPointValue {
  const s = strip(matched);
  const trailing = [...s].at(-1) as string;
  const digits = kit.re(AMOUNT_DIGITS).search(s);
  if (!digits) throw new ValueError(`Invalid trailing-symbol currency: ${matched}`);
  return {
    amount: normalizeAmount(digits.text()),
    currency: lookup(SYMBOL_CURRENCY, trailing) ?? trailing,
  };
}

// py: rf"[^\d]*(\d+(?:\.\d+)?)\s*({_MAGNITUDE_WORDS})"
const CURRENCY_MAGNITUDE = compile(String.raw`[^\d]*(\d+(?:\.\d+)?)\s*(${MAGNITUDE_WORDS})`, i);

// md2ui: detector_parsers._parse_currency_magnitude ("$89 billion", "£1.2 trillion")
export function parseCurrencyMagnitude(
  kit: RegexKit,
  matched: string,
  currency: string,
): DataPointValue {
  const m = kit.re(CURRENCY_MAGNITUDE).match(matched);
  if (m) {
    const base = m.text(1);
    const word = m.text(2);
    return {
      amount: decimalTimes(base, multiplier(word)),
      base_value: decimal(base),
      magnitude: word.toLowerCase(),
      currency,
    };
  }
  throw new ValueError("Invalid currency magnitude");
}

const SUFFIX_MULTIPLIERS: Readonly<Record<string, bigint>> = Object.freeze({
  k: 1000n,
  m: 1000000n,
  b: 1000000000n,
  t: 1000000000000n,
});

// py: r"(\d+(?:\.\d+)?)([KkMmBbTt])\b"
const SHORTHAND_MAGNITUDE = compile(String.raw`(\d+(?:\.\d+)?)([KkMmBbTt])\b`);

// md2ui: detector_parsers._parse_shorthand_magnitude ("2.5B", "500K")
export function parseShorthandMagnitude(matched: string, kit: RegexKit): DataPointValue {
  const m = kit.re(SHORTHAND_MAGNITUDE).match(matched);
  if (m) {
    const base = m.text(1);
    const suffix = m.text(2);
    return {
      value: decimalTimes(base, SUFFIX_MULTIPLIERS[suffix.toLowerCase()] as bigint),
      base_value: decimal(base),
      magnitude: suffix.toUpperCase(),
    };
  }
  throw new ValueError("Invalid shorthand magnitude");
}

// py: r"[^\d]*(\d+(?:\.\d+)?)([KkMmBbTt])\b"
const CURRENCY_SHORTHAND = compile(String.raw`[^\d]*(\d+(?:\.\d+)?)([KkMmBbTt])\b`);

// md2ui: detector_parsers._parse_currency_shorthand ("$50M", "€1.2B", "£500K")
export function parseCurrencyShorthand(
  kit: RegexKit,
  matched: string,
  currency: string,
): DataPointValue {
  const m = kit.re(CURRENCY_SHORTHAND).match(matched);
  if (m) {
    const base = m.text(1);
    const suffix = m.text(2);
    return {
      amount: decimalTimes(base, SUFFIX_MULTIPLIERS[suffix.toLowerCase()] as bigint),
      base_value: decimal(base),
      magnitude: suffix.toUpperCase(),
      currency,
    };
  }
  throw new ValueError("Invalid currency shorthand");
}

// py: r"(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(\w+)"
const QUANTITY = compile(String.raw`(\d{1,3}(?:,\d{3})*(?:\.\d+)?)\s*(\w+)`, i);

// md2ui: detector_parsers._parse_quantity ("250 units", "100 kg", "5,000 units")
export function parseQuantity(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(QUANTITY).match(matched);
  if (match) {
    return { value: decimal(match.text(1).replaceAll(",", "")), unit: match.text(2).toLowerCase() };
  }
  throw new ValueError("Invalid quantity");
}

// ------------------------------------------------------------------ ratios and rates

// md2ui: detector_parsers._parse_ratio_colon ("3:1")
export function parseRatioColon(matched: string): DataPointValue {
  const parts = matched.split(":");
  return { left: pyInt(parts[0] as string), right: pyInt(parts[1] as string), format: "colon" };
}

// md2ui: detector_parsers._parse_ratio_slash ("50/50")
export function parseRatioSlash(matched: string): DataPointValue {
  const parts = matched.split("/");
  return { left: pyInt(parts[0] as string), right: pyInt(parts[1] as string), format: "slash" };
}

// py: r"(?:([NSEW]{1,3})\s+)?(\d+(?:\.\d+)?)\s*(\w+/?(?:\w+)?)"
const RATE_SPEED = compile(String.raw`(?:([NSEW]{1,3})\s+)?(\d+(?:\.\d+)?)\s*(\w+/?(?:\w+)?)`);

// md2ui: detector_parsers._parse_rate_speed ("60 mph", "100 km/h", "N 2 mph")
export function parseRateSpeed(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(RATE_SPEED).match(matched);
  if (match) {
    const bearing = match.group(1);
    const out: Fields = {
      value: decimal(match.text(2)),
      unit: match.text(3).toLowerCase(),
      rate_type: "speed",
    };
    if (bearing) out["bearing"] = bearing;
    return out;
  }
  throw new ValueError("Invalid speed rate");
}

// py: rf"(?:([NSEW]{{1,3}})\s+)?(\d+(?:\.\d+)?)\s*{_RANGE_OP}\s*"
// py: rf"(\d+(?:\.\d+)?)\s*({_SPEED_UNITS})"
const RATE_SPEED_RANGE = compile(
  String.raw`(?:([NSEW]{1,3})\s+)?(\d+(?:\.\d+)?)\s*${RANGE_OP}\s*` +
    String.raw`(\d+(?:\.\d+)?)\s*(${SPEED_UNITS})`,
  i,
);

// md2ui: detector_parsers._parse_rate_speed_range ("7-10 mph", "15-20 km/h")
export function parseRateSpeedRange(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(RATE_SPEED_RANGE).match(matched);
  if (match) {
    const bearing = match.group(1);
    const out: Fields = {
      min: decimal(match.text(2)),
      max: decimal(match.text(3)),
      unit: match.text(4).toLowerCase(),
      rate_type: "speed",
    };
    if (bearing) out["bearing"] = bearing;
    return out;
  }
  throw new ValueError("Invalid speed range");
}

// py: rf"({_CURRENCY_SYMBOLS})(\d[\d,]*)(?:\.(\d+))?/(\w+)"
const RATE_COMMODITY = compile(String.raw`(${CURRENCY_SYMBOLS})(\d[\d,]*)(?:\.(\d+))?/(\w+)`);

// md2ui: detector_parsers._parse_rate_commodity ("$2,048/oz", "€73.45/barrel")
export function parseRateCommodity(matched: string, kit: RegexKit): DataPointValue {
  const m = kit.re(RATE_COMMODITY).match(matched);
  if (m) {
    const symbol = m.text(1);
    let amount = m.text(2).replaceAll(",", "");
    const decimalPart = m.group(3);
    if (decimalPart) amount += `.${decimalPart}`;
    return {
      value: decimal(amount),
      currency: lookup(SYMBOL_CURRENCY, symbol) ?? symbol,
      per: m.text(4).toLowerCase(),
      rate_type: "price",
    };
  }
  throw new ValueError("Invalid commodity rate");
}

// py: r"\$(\d+(?:\.\d+)?)/(\w+)"
const RATE_PRICE = compile(String.raw`\$(\d+(?:\.\d+)?)/(\w+)`, i);

// md2ui: detector_parsers._parse_rate_price ("$15/hour")
export function parseRatePrice(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(RATE_PRICE).match(matched);
  if (match) {
    return {
      value: decimal(match.text(1)),
      currency: "USD",
      per: match.text(2).toLowerCase(),
      rate_type: "price",
    };
  }
  throw new ValueError("Invalid price rate");
}

// py: r"(\d+(?:\.\d+)?)%\s*(\w+(?:\s+\w+)?)"
const RATE_PERCENTAGE = compile(String.raw`(\d+(?:\.\d+)?)%\s*(\w+(?:\s+\w+)?)`, i);

// md2ui: detector_parsers._parse_rate_percentage ("5% annual growth")
export function parseRatePercentage(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(RATE_PERCENTAGE).match(matched);
  if (match) {
    return {
      value: decimal(match.text(1)),
      period: match.text(2).toLowerCase(),
      rate_type: "percentage",
    };
  }
  throw new ValueError("Invalid percentage rate");
}

// py: r"(\d+(?:\.\d+)?)\s*(?:per|/)\s*(\w+)"
const RATE_GENERIC = compile(String.raw`(\d+(?:\.\d+)?)\s*(?:per|/)\s*(\w+)`, i);

// md2ui: detector_parsers._parse_rate_generic ("10 per hour")
export function parseRateGeneric(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(RATE_GENERIC).match(matched);
  if (match) {
    return {
      value: decimal(match.text(1)),
      per: match.text(2).toLowerCase(),
      rate_type: "generic",
    };
  }
  throw new ValueError("Invalid generic rate");
}

// ------------------------------------------------------------------------- scores

// py: r"(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)\s*(\w*)"
const SCORE_FRACTION = compile(String.raw`(\d+(?:\.\d+)?)/(\d+(?:\.\d+)?)\s*(\w*)`, i);

// md2ui: detector_parsers._parse_score_fraction ("4.5/5 stars", "87/100")
export function parseScoreFraction(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(SCORE_FRACTION).match(matched);
  if (match) {
    const label = match.text(3);
    return {
      score: decimal(match.text(1)),
      max: decimal(match.text(2)),
      label: label ? label.toLowerCase() : null,
    };
  }
  throw new ValueError("Invalid score fraction");
}

// md2ui: detector_parsers._parse_score_stars ("⭐⭐⭐⭐☆" is 4 of 5)
export function parseScoreStars(matched: string): DataPointValue {
  let filled = 0;
  let empty = 0;
  for (const c of matched) {
    if (c === "⭐" || c === "★") filled += 1;
    else if (c === "☆") empty += 1;
  }
  if (filled === 0) throw new ValueError("Star rating requires at least one filled star");
  return { score: filled, max: filled + empty, label: "stars" };
}

// py: r"\d+(?:\.\d+)?"
const NUMBER_DIGITS = compile(String.raw`\d+(?:\.\d+)?`);

// md2ui: detector_parsers._parse_score_single_star ("⭐ 4.9", "4.9⭐")
export function parseScoreSingleStar(matched: string, kit: RegexKit): DataPointValue {
  const glyph = [...matched].find((c) => "⭐★☆".includes(c)) ?? "⭐";
  const digits = kit.re(NUMBER_DIGITS).search(matched);
  if (!digits) throw new ValueError("Invalid single-star score");
  return { score: decimal(digits.text()), glyph, subtype: "single_star" };
}

// py: r"([A-F][+-]?)"
const GRADE = compile("([A-F][+-]?)", i);

/** md2ui: detector_parsers._grade_to_numeric. Float arithmetic, as in Python. */
function gradeToNumeric(grade: string): number {
  const baseValues: Readonly<Record<string, number>> = { A: 4.0, B: 3.0, C: 2.0, D: 1.0, F: 0.0 };
  let base = lookup(baseValues, grade.charAt(0)) ?? 0.0;
  if (grade.length > 1) {
    if (grade[1] === "+") base += 0.3;
    else if (grade[1] === "-") base -= 0.3;
  }
  return decimal(`${base}`);
}

// md2ui: detector_parsers._parse_score_grade ("Grade A", "A+")
export function parseScoreGrade(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(GRADE).search(matched);
  if (match) {
    const grade = match.text(1).toUpperCase();
    return { grade, numeric: gradeToNumeric(grade) };
  }
  throw new ValueError("Invalid grade");
}

// ------------------------------------------------------------------------ rankings

// md2ui: detector_parsers._parse_ranking_hash ("#1")
export function parseRankingHash(matched: string): DataPointValue {
  return { rank: pyInt(matched.slice(1)), format: "hash" };
}

// py: r"(\d+)(%?)"
const RANKING_TOP = compile(String.raw`(\d+)(%?)`, i);

// md2ui: detector_parsers._parse_ranking_top ("top 10", "top 10%")
export function parseRankingTop(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(RANKING_TOP).search(matched);
  if (match) {
    return { value: pyInt(match.text(1)), is_percentage: match.text(2) !== "", format: "top" };
  }
  throw new ValueError("Invalid top ranking");
}

const ORDINAL_WORDS: readonly (readonly [string, number])[] = Object.freeze([
  ["first", 1],
  ["1st", 1],
  ["second", 2],
  ["2nd", 2],
  ["third", 3],
  ["3rd", 3],
  ["fourth", 4],
  ["4th", 4],
  ["fifth", 5],
  ["5th", 5],
]);

// py: rf"(\d+)(?:{_ORDINAL_SUFFIX})"
const RANKING_ORDINAL = compile(String.raw`(\d+)(?:${ORDINAL_SUFFIX})`);

// md2ui: detector_parsers._parse_ranking_place ("first place", "3rd place"). The word
// test is a substring one, as in md2ui, so "21st place" reads as rank 1.
export function parseRankingPlace(matched: string, kit: RegexKit): DataPointValue {
  const lower = matched.toLowerCase();
  for (const [word, rank] of ORDINAL_WORDS) {
    if (lower.includes(word)) return { rank, format: "place" };
  }
  const match = kit.re(RANKING_ORDINAL).search(lower);
  if (match) return { rank: pyInt(match.text(1)), format: "place" };
  throw new ValueError("Invalid place ranking");
}

// ------------------------------------------------------------------- measurements

// py: r"(\d+(?:\.\d+)?)\s*°([FC])\s*\(\s*(\d+(?:\.\d+)?)\s*°([FC])\s*\)"
const TEMP_DUAL = compile(
  String.raw`(\d+(?:\.\d+)?)\s*°([FC])\s*\(\s*(\d+(?:\.\d+)?)\s*°([FC])\s*\)`,
  i,
);

// md2ui: detector_parsers._parse_measurement_temp_dual ("68°F (20°C)")
export function parseMeasurementTempDual(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(TEMP_DUAL).match(matched);
  if (match) {
    return {
      value: decimal(match.text(1)),
      unit: match.text(2).toUpperCase(),
      alt_value: decimal(match.text(3)),
      alt_unit: match.text(4).toUpperCase(),
      measurement_type: "temperature",
    };
  }
  throw new ValueError("Invalid dual-unit temperature");
}

// py: r"(\d+(?:\.\d+)?)\s*°([FC]?)"
const TEMP = compile(String.raw`(\d+(?:\.\d+)?)\s*°([FC]?)`, i);

// md2ui: detector_parsers._parse_measurement_temp ("98.6°F", "37°C", a bare "75°")
export function parseMeasurementTemp(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(TEMP).match(matched);
  if (match) {
    return {
      value: decimal(match.text(1)),
      unit: match.text(2).toUpperCase(),
      measurement_type: "temperature",
    };
  }
  throw new ValueError("Invalid temperature");
}

// py: r"(\d+)\s*(?:feet|foot|ft)\s*(?:(\d+)\s*(?:inches|inch|in))?"
const HEIGHT = compile(String.raw`(\d+)\s*(?:feet|foot|ft)\s*(?:(\d+)\s*(?:inches|inch|in))?`, i);

// md2ui: detector_parsers._parse_measurement_height ("6 feet", "5 feet 10 inches")
export function parseMeasurementHeight(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(HEIGHT).match(matched);
  if (match) {
    const feet = pyInt(match.text(1));
    const inchesText = match.group(2);
    const inches = inchesText ? pyInt(inchesText) : 0;
    return { feet, inches, total_inches: feet * 12 + inches, measurement_type: "height" };
  }
  throw new ValueError("Invalid height");
}

// ----------------------------------------------------------------------- time

/** The 24-hour clock hour of a 12-hour reading. */
function hour24(hour: number, period: string): number {
  if (period.toUpperCase() === "PM" && hour !== 12) return hour + 12;
  if (period.toUpperCase() === "AM" && hour === 12) return 0;
  return hour;
}

// py: r"(\d{1,2}):(\d{2})\s*(AM|PM)"
const TIME_12H = compile(String.raw`(\d{1,2}):(\d{2})\s*(AM|PM)`, i);

// md2ui: detector_parsers._parse_time_12h ("3:00 PM", "11:30 am")
export function parseTime12h(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(TIME_12H).match(matched);
  if (match) {
    const period = match.text(3);
    return {
      hour: hour24(pyInt(match.text(1)), period),
      minute: pyInt(match.text(2)),
      subtype: "time_12h",
      period: period.toUpperCase(),
    };
  }
  throw new ValueError("Invalid 12h time");
}

// py: r"(\d{1,2})\s*(AM|PM)"
const TIME_HOURS_ONLY = compile(String.raw`(\d{1,2})\s*(AM|PM)`, i);

// md2ui: detector_parsers._parse_time_hours_only ("3 PM", "11 AM")
export function parseTimeHoursOnly(matched: string, kit: RegexKit): DataPointValue {
  const m = kit.re(TIME_HOURS_ONLY).match(matched);
  if (m) {
    const period = m.text(2);
    return {
      hour: hour24(pyInt(m.text(1)), period),
      minute: 0,
      subtype: "time_12h",
      period: period.toUpperCase(),
    };
  }
  throw new ValueError("Invalid hours-only time");
}

// py: r"(\d{1,2}):(\d{2})(?::(\d{2}))?"
const TIME_24H = compile(String.raw`(\d{1,2}):(\d{2})(?::(\d{2}))?`);

// md2ui: detector_parsers._parse_time_24h ("14:30", "09:15")
export function parseTime24h(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(TIME_24H).match(matched);
  if (match) {
    const second = match.group(3);
    return {
      hour: pyInt(match.text(1)),
      minute: pyInt(match.text(2)),
      second: second ? pyInt(second) : 0,
      subtype: "time_24h",
    };
  }
  throw new ValueError("Invalid 24h time");
}

// py: rf"(\d{{1,2}}):(\d{{2}})\s*(AM|PM)\s*{_RANGE_OP}\s*(\d{{1,2}}):(\d{{2}})\s*(AM|PM)"
const TIME_RANGE_12H = compile(
  String.raw`(\d{1,2}):(\d{2})\s*(AM|PM)\s*${RANGE_OP}\s*(\d{1,2}):(\d{2})\s*(AM|PM)`,
  i,
);

// md2ui: detector_parsers._parse_time_range_12h ("8:00 AM - 5:00 PM")
export function parseTimeRange12h(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(TIME_RANGE_12H).match(matched);
  if (match) {
    return {
      start: { hour: hour24(pyInt(match.text(1)), match.text(3)), minute: pyInt(match.text(2)) },
      end: { hour: hour24(pyInt(match.text(4)), match.text(6)), minute: pyInt(match.text(5)) },
      subtype: "time_range",
    };
  }
  throw new ValueError("Invalid 12h time range");
}

// py: rf"(\d{{1,2}}):(\d{{2}})\s*{_RANGE_OP}\s*(\d{{1,2}}):(\d{{2}})"
const TIME_RANGE_24H = compile(String.raw`(\d{1,2}):(\d{2})\s*${RANGE_OP}\s*(\d{1,2}):(\d{2})`);

// md2ui: detector_parsers._parse_time_range_24h ("08:00 - 17:00")
export function parseTimeRange24h(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(TIME_RANGE_24H).match(matched);
  if (match) {
    return {
      start: { hour: pyInt(match.text(1)), minute: pyInt(match.text(2)) },
      end: { hour: pyInt(match.text(3)), minute: pyInt(match.text(4)) },
      subtype: "time_range",
    };
  }
  throw new ValueError("Invalid 24h time range");
}

// ------------------------------------------------------------ durations and quarters

// py: r"(\d+)\s*([A-Za-z]+)"
const DURATION_PART = compile(String.raw`(\d+)\s*([A-Za-z]+)`);

// md2ui: detector_parsers._parse_duration_compound ("4 hours 35 minutes", "1h 20m")
export function parseDurationCompound(matched: string, kit: RegexKit): DataPointValue {
  let total = 0;
  const kept: DataPointValue[] = [];
  for (const part of kit.re(DURATION_PART).findall(matched)) {
    const [value, unit] = part as [string, string];
    const key = rstrip(unit.toLowerCase(), "s") || unit.toLowerCase();
    const secs = lookup(DURATION_UNIT_SECONDS, key);
    if (secs === undefined) throw new ValueError("Invalid compound duration");
    total += pyInt(value) * secs;
    kept.push({ value: pyInt(value), unit: key });
  }
  if (kept.length < 2) throw new ValueError("Invalid compound duration");
  return { seconds: total, parts: kept, compound: true };
}

// py: r"(\d+)[-\s]*(\w+)"
const DURATION = compile(String.raw`(\d+)[-\s]*(\w+)`, i);
const DURATION_UNITS = ["year", "month", "week", "day", "hour", "minute", "second"] as const;

// md2ui: detector_parsers._parse_duration ("3-year period", "2 weeks")
export function parseDuration(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(DURATION).match(matched);
  if (match) {
    let unit = rstrip(match.text(2).toLowerCase(), "s");
    if (unit === "period" || unit === "long") {
      for (const u of DURATION_UNITS) {
        if (matched.toLowerCase().includes(u)) {
          unit = u;
          break;
        }
      }
    }
    return { value: pyInt(match.text(1)), unit };
  }
  throw new ValueError("Invalid duration");
}

// py: r"Q([1-4])\s*(\d{4})|(\d{4})\s*Q([1-4])"
const QUARTER = compile(String.raw`Q([1-4])\s*(\d{4})|(\d{4})\s*Q([1-4])`, i);

// md2ui: detector_parsers._parse_quarter ("Q3 2023", "2024 Q1")
export function parseQuarter(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(QUARTER).search(matched);
  if (match) {
    if (match.group(1)) return { quarter: pyInt(match.text(1)), year: pyInt(match.text(2)) };
    return { quarter: pyInt(match.text(4)), year: pyInt(match.text(3)) };
  }
  throw new ValueError("Invalid quarter");
}

// ---------------------------------------------------------------------- ranges

// py: r"\$?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:and|-)\s*\$?(\d+(?:,\d{3})*(?:\.\d+)?)"
const RANGE_BETWEEN = compile(
  String.raw`\$?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(?:and|-)\s*\$?(\d+(?:,\d{3})*(?:\.\d+)?)`,
  i,
);

// md2ui: detector_parsers._parse_range_between ("between $100 and $500")
export function parseRangeBetween(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(RANGE_BETWEEN).search(matched);
  if (match) {
    return {
      min: decimal(match.text(1).replaceAll(",", "")),
      max: decimal(match.text(2).replaceAll(",", "")),
      is_currency: matched.includes("$"),
    };
  }
  throw new ValueError("Invalid between range");
}

// py: r"\$(\d+(?:,\d{3})*(?:\.\d+)?)\s*-\s*\$(\d+(?:,\d{3})*(?:\.\d+)?)"
const RANGE_CURRENCY = compile(
  String.raw`\$(\d+(?:,\d{3})*(?:\.\d+)?)\s*-\s*\$(\d+(?:,\d{3})*(?:\.\d+)?)`,
);

// md2ui: detector_parsers._parse_range_currency ("$100-$500")
export function parseRangeCurrency(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(RANGE_CURRENCY).match(matched);
  if (match) {
    return {
      min: decimal(match.text(1).replaceAll(",", "")),
      max: decimal(match.text(2).replaceAll(",", "")),
      currency: "USD",
    };
  }
  throw new ValueError("Invalid currency range");
}

// py: rf"({_CURRENCY_SYMBOLS})(\d+(?:,\d{{3}})*(?:\.\d+)?)\s*{_RANGE_OP}\s*"
// py: rf"{_CURRENCY_SYMBOLS}?(\d+(?:,\d{{3}})*(?:\.\d+)?)\s*([KMBT])"
const RANGE_CURRENCY_SHARED = compile(
  String.raw`(${CURRENCY_SYMBOLS})(\d+(?:,\d{3})*(?:\.\d+)?)\s*${RANGE_OP}\s*` +
    String.raw`${CURRENCY_SYMBOLS}?(\d+(?:,\d{3})*(?:\.\d+)?)\s*([KMBT])`,
  i,
);

// md2ui: detector_parsers._parse_range_currency_shared ("€180-200M": the suffix is both ends')
export function parseRangeCurrencyShared(matched: string, kit: RegexKit): DataPointValue {
  const m = kit.re(RANGE_CURRENCY_SHARED).match(matched);
  if (!m) throw new ValueError("Invalid shared-magnitude currency range");
  const magnitude = m.text(4).toUpperCase();
  const factor = MAGNITUDE[magnitude] as bigint;
  return {
    min: decimalTimes(m.text(2).replaceAll(",", ""), factor),
    max: decimalTimes(m.text(3).replaceAll(",", ""), factor),
    currency: lookup(SYMBOL_CURRENCY, m.text(1)) ?? "USD",
    magnitude,
  };
}

// py: r"(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(\w+)"
const RANGE_UNIT = compile(String.raw`(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)\s*(\w+)`);

// md2ui: detector_parsers._parse_range_unit ("20-30 units")
export function parseRangeUnit(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(RANGE_UNIT).match(matched);
  if (match) {
    return {
      min: decimal(match.text(1)),
      max: decimal(match.text(2)),
      unit: match.text(3).toLowerCase(),
    };
  }
  throw new ValueError("Invalid unit range");
}

// py: rf"~?(\d+(?:\.\d+)?)\s*{_RANGE_OP}\s*(\d+(?:\.\d+)?)%"
const RANGE_PERCENTAGE = compile(String.raw`~?(\d+(?:\.\d+)?)\s*${RANGE_OP}\s*(\d+(?:\.\d+)?)%`);

// md2ui: detector_parsers._parse_range_percentage ("15-20%", "~15-20%", "10.5 to 15.5%")
export function parseRangePercentage(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(RANGE_PERCENTAGE).match(matched);
  if (match) {
    return { min: decimal(match.text(1)), max: decimal(match.text(2)), unit: "percent" };
  }
  throw new ValueError("Invalid percentage range");
}

// --------------------------------------------------------------------- changes

/** The sign of a change as a multiplier (`1 if sign == "+" else -1`): either minus is negative. */
function signed(sign: string, value: number): number {
  return value * (sign === "+" ? 1 : -1);
}

/** md2ui: `_parse_signed_percentage` ("~12%", "−1.55%"): either minus is negative. */
export function parseSignedPercentage(matched: string): DataPointValue {
  const value = rstrip(lstrip(matched, "~"), "%");
  const head = value.slice(0, 1);
  return decimal(head !== "" && MINUS.includes(head) ? `-${value.slice(1)}` : value);
}

// py: rf"({_SIGN})(\d+(?:\.\d+)?)%\s*(\w*)"
const CHANGE_PERCENTAGE = compile(String.raw`(${SIGN})(\d+(?:\.\d+)?)%\s*(\w*)`);

// md2ui: detector_parsers._parse_change_percentage ("+15% increase")
export function parseChangePercentage(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(CHANGE_PERCENTAGE).match(matched);
  if (match) {
    const sign = match.text(1);
    const direction = match.text(3);
    return {
      value: signed(sign, decimal(match.text(2))),
      direction: direction ? direction.toLowerCase() : sign === "+" ? "increase" : "decrease",
      type: "percentage",
    };
  }
  throw new ValueError("Invalid percentage change");
}

// py: rf"({_SIGN})(\d+(?:\.\d+)?)\s*({_QUANTITY_UNITS})"
const CHANGE_QUANTITY = compile(String.raw`(${SIGN})(\d+(?:\.\d+)?)\s*(${QUANTITY_UNITS})`, i);

// md2ui: detector_parsers._parse_change_quantity ("+3 points", "-5 units")
export function parseChangeQuantity(matched: string, kit: RegexKit): DataPointValue {
  const m = kit.re(CHANGE_QUANTITY).match(matched);
  if (m) {
    const sign = m.text(1);
    return {
      value: signed(sign, decimal(m.text(2))),
      unit: m.text(3).toLowerCase(),
      direction: sign === "+" ? "increase" : "decrease",
      type: "quantity",
    };
  }
  throw new ValueError("Invalid quantity change");
}

// py: rf"({_SIGN})\$(\d+(?:,\d{{3}})*(?:\.\d+)?)\s*(\w*)"
const CHANGE_CURRENCY = compile(String.raw`(${SIGN})\$(\d+(?:,\d{3})*(?:\.\d+)?)\s*(\w*)`);

// md2ui: detector_parsers._parse_change_currency ("-$200 decrease")
export function parseChangeCurrency(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(CHANGE_CURRENCY).match(matched);
  if (match) {
    const sign = match.text(1);
    const direction = match.text(3);
    return {
      value: signed(sign, decimal(match.text(2).replaceAll(",", ""))),
      currency: "USD",
      direction: direction ? direction.toLowerCase() : sign === "+" ? "increase" : "decrease",
      type: "currency",
    };
  }
  throw new ValueError("Invalid currency change");
}

// py: r"(\d+(?:\.\d+)?)\s*(%?)"
const CHANGE_DIRECTION = compile(String.raw`(\d+(?:\.\d+)?)\s*(%?)`);

// md2ui: detector_parsers._parse_change_direction ("up 10%", "increased by 5"). The
// direction test is a substring one, as in md2ui.
export function parseChangeDirection(matched: string, kit: RegexKit): DataPointValue {
  const lower = matched.toLowerCase();
  const isPositive = ["up", "increased", "grew", "rose"].some((w) => lower.includes(w));
  const match = kit.re(CHANGE_DIRECTION).search(matched);
  if (match) {
    return {
      value: decimal(match.text(1)) * (isPositive ? 1 : -1),
      direction: isPositive ? "increase" : "decrease",
      is_percentage: match.text(2) !== "",
    };
  }
  throw new ValueError("Invalid directional change");
}

// py: rf"({_SIGN})(\d+(?:\.\d+)?)"
const CHANGE_BARE = compile(String.raw`(${SIGN})(\d+(?:\.\d+)?)`);

// md2ui: detector_parsers._parse_change_bare ("+3", "-5")
export function parseChangeBare(matched: string, kit: RegexKit): DataPointValue {
  const m = kit.re(CHANGE_BARE).match(matched);
  if (m) {
    const sign = m.text(1);
    return {
      value: signed(sign, decimal(m.text(2))),
      direction: sign === "+" ? "increase" : "decrease",
      type: "bare",
    };
  }
  throw new ValueError("Invalid bare change");
}

// -------------------------------------------------------- phone, version, file size

// py: r"\D"
const NON_DIGIT = compile(String.raw`\D`);

/** `(digits[a:b])` by code point. */
function slice(digits: readonly string[], from: number, to?: number): string {
  return digits.slice(from, to).join("");
}

/** The `+1 (555) 123-4567` form of eleven digits starting with 1. */
function northAmerican(digits: readonly string[]): string {
  return `+1 (${slice(digits, 1, 4)}) ${slice(digits, 4, 7)}-${slice(digits, 7)}`;
}

// md2ui: detector_parsers._parse_phone ("(555) 123-4567", "+1-555-123-4567")
export function parsePhone(matched: string, kit: RegexKit): DataPointValue {
  const digits = kit.re(NON_DIGIT).sub("", matched);
  const chars = [...digits];
  let formatted: string;
  if (chars.length === 10) {
    formatted = `(${slice(chars, 0, 3)}) ${slice(chars, 3, 6)}-${slice(chars, 6)}`;
  } else if (chars.length === 11 && chars[0] === "1") {
    formatted = northAmerican(chars);
  } else {
    formatted = matched;
  }
  return { digits, formatted };
}

// py: r"\+(?P<cc>\d{1,3})(?P<sep>[ .\-])(?:(?:\d{2,5})(?P=sep))*(?:\d{2,8})"
export const PHONE_INTERNATIONAL_PATTERN = String.raw`\+(?P<cc>\d{1,3})(?P<sep>[ .\-])(?:(?:\d{2,5})(?P=sep))*(?:\d{2,8})`;
const PHONE_INTERNATIONAL = compile(PHONE_INTERNATIONAL_PATTERN);

// md2ui: detector_parsers._parse_phone_international ("+52 951 514 4173", "+44-20-7946-0958")
export function parsePhoneInternational(matched: string, kit: RegexKit): DataPointValue {
  const m = kit.re(PHONE_INTERNATIONAL).match(matched);
  if (!m) throw new ValueError(`Cannot parse international phone: ${matched}`);
  const countryCode = m.text("cc");
  const digits = kit.re(NON_DIGIT).sub("", matched);
  const chars = [...digits];
  if (!(chars.length >= 7 && chars.length <= 15)) {
    throw new ValueError(`Digit count ${chars.length} outside E.164 range: ${matched}`);
  }
  let formatted = matched;
  if (countryCode === "1" && chars.length === 11) formatted = northAmerican(chars);
  return { digits, country_code: countryCode, formatted };
}

// py: r"(\d+)\.(\d+)(?:\.(\d+))?(?:-(.+))?"
const VERSION = compile(String.raw`(\d+)\.(\d+)(?:\.(\d+))?(?:-(.+))?`);

// md2ui: detector_parsers._parse_version ("v1.2.3", "2.0.0-beta")
export function parseVersion(matched: string, kit: RegexKit): DataPointValue {
  const versionStr = lstrip(matched, "vV");
  const parts = kit.re(VERSION).match(versionStr);
  if (parts) {
    const patch = parts.group(3);
    return {
      major: pyInt(parts.text(1)),
      minor: pyInt(parts.text(2)),
      patch: patch ? pyInt(patch) : 0,
      prerelease: parts.group(4) ?? null,
      string: versionStr,
    };
  }
  throw new ValueError("Invalid version");
}

// py: r"(\d+(?:\.\d+)?)\s*(\w+)"
const FILE_SIZE = compile(String.raw`(\d+(?:\.\d+)?)\s*(\w+)`, i);
const FILE_SIZE_MULTIPLIERS: Readonly<Record<string, bigint>> = Object.freeze({
  B: 1n,
  KB: 1024n,
  MB: 1024n ** 2n,
  GB: 1024n ** 3n,
  TB: 1024n ** 4n,
});

// md2ui: detector_parsers._parse_file_size ("500 MB", "1.5 GB")
export function parseFileSize(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(FILE_SIZE).match(matched);
  if (match) {
    const value = match.text(1);
    let unit = rstrip(match.text(2).toUpperCase(), "S");
    if (unit === "BYTE") unit = "B";
    return {
      value: decimal(value),
      unit,
      bytes: decimalTimes(value, lookup(FILE_SIZE_MULTIPLIERS, unit) ?? 1n),
    };
  }
  throw new ValueError("Invalid file size");
}

// ------------------------------------------------------------------- dimensions

// py: r'(\d+(?:\.\d+)?)\s*["\']?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*["\']?\s*(\w*)'
const DIMENSION = compile(
  String.raw`(\d+(?:\.\d+)?)\s*["\']?\s*[xX×]\s*(\d+(?:\.\d+)?)\s*["\']?\s*(\w*)`,
);

// md2ui: detector_parsers._parse_dimension ("1920x1080", "8.5 x 11 inches")
export function parseDimension(matched: string, kit: RegexKit): DataPointValue {
  const match = kit.re(DIMENSION).match(matched);
  if (match) {
    const unit = match.text(3);
    return {
      width: decimal(match.text(1)),
      height: decimal(match.text(2)),
      unit: unit ? unit.toLowerCase() : null,
    };
  }
  throw new ValueError("Invalid dimension");
}

// py: rf"(\d+(?:\.\d+)?)\s*({_DIMENSION_UNITS})\s*(?:[xX×]|by)\s*(\d+(?:\.\d+)?)\s*({_DIMENSION_UNITS})"
const DIMENSION_PER_UNIT = compile(
  String.raw`(\d+(?:\.\d+)?)\s*(${DIMENSION_UNITS})\s*(?:[xX×]|by)\s*(\d+(?:\.\d+)?)\s*(${DIMENSION_UNITS})`,
  i,
);

// md2ui: detector_parsers._parse_dimension_per_unit ("24 cm × 33 cm", "9.5 in by 13 in")
export function parseDimensionPerUnit(matched: string, kit: RegexKit): DataPointValue {
  const m = kit.re(DIMENSION_PER_UNIT).match(matched);
  if (m) {
    return {
      width: decimal(m.text(1)),
      height: decimal(m.text(3)),
      unit: m.text(2).toLowerCase(),
    };
  }
  throw new ValueError("Invalid per-unit dimension");
}

// ------------------------------------------------------------ fractions, links, emoji

/** A Unicode fraction: its notation and its value at 28 decimals (a `Decimal` quotient). */
const FRACTIONS: Readonly<Record<string, readonly [string, bigint]>> = Object.freeze({
  "¼": ["1/4", 2500000000000000000000000000n],
  "½": ["1/2", 5000000000000000000000000000n],
  "¾": ["3/4", 7500000000000000000000000000n],
  "⅐": ["1/7", 1428571428571428571428571429n],
  "⅑": ["1/9", 1111111111111111111111111111n],
  "⅒": ["1/10", 1000000000000000000000000000n],
  "⅓": ["1/3", 3333333333333333333333333333n],
  "⅔": ["2/3", 6666666666666666666666666667n],
  "⅕": ["1/5", 2000000000000000000000000000n],
  "⅖": ["2/5", 4000000000000000000000000000n],
  "⅗": ["3/5", 6000000000000000000000000000n],
  "⅘": ["4/5", 8000000000000000000000000000n],
  "⅙": ["1/6", 1666666666666666666666666667n],
  "⅚": ["5/6", 8333333333333333333333333333n],
  "⅛": ["1/8", 1250000000000000000000000000n],
  "⅜": ["3/8", 3750000000000000000000000000n],
  "⅝": ["5/8", 6250000000000000000000000000n],
  "⅞": ["7/8", 8750000000000000000000000000n],
});

/** A scaled fraction total as the float of its decimal text. */
function fractionValue(scaled: bigint): number {
  const digits = scaled.toString().padStart(29, "0");
  return decimal(`${digits.slice(0, -28)}.${digits.slice(-28)}`);
}

// md2ui: detector_parsers._parse_unicode_fraction ("¼", "½¼")
export function parseUnicodeFraction(matched: string): DataPointValue {
  const only = [...matched].length === 1 ? lookup(FRACTIONS, matched) : undefined;
  if (only) {
    return { value: fractionValue(only[1]), notation: only[0], char: matched, type: "fraction" };
  }
  let total = 0n;
  const notations: string[] = [];
  for (const char of matched) {
    const fraction = lookup(FRACTIONS, char);
    if (fraction) {
      total += fraction[1];
      notations.push(fraction[0]);
    }
  }
  return {
    value: fractionValue(total),
    notation: notations.join(" + "),
    chars: matched,
    type: "fraction",
  };
}

// md2ui: detector_parsers._parse_emoji
export function parseEmoji(matched: string): {
  emojis: DataPointValue[];
  count: number;
  text: string;
} {
  const emojis = [...matched];
  return {
    emojis: emojis.map((emoji) => ({
      char: emoji,
      codepoint: `U+${(emoji.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0")}`,
    })),
    count: emojis.length,
    text: matched,
  };
}

// md2ui: detector_parsers._parse_markdown_link. Splits at the first "](" (the only legal
// one under the pattern that matched the span) and keeps any emoji of the label.
export function parseMarkdownLink(matched: string, kit: RegexKit): DataPointValue {
  const boundary = matched.indexOf("](");
  if (boundary < 0) throw new ValueError("substring not found");
  const label = matched.slice(1, boundary);
  const value: Fields = { text: label, url: matched.slice(boundary + 2, -1), matched };
  const emojis: DataPointValue[] = [];
  for (const m of kit.re(EMOJI_CHAR_PATTERN).finditer(label))
    emojis.push(...parseEmoji(m.text()).emojis);
  if (emojis.length > 0) value["emojis"] = emojis;
  return value;
}
