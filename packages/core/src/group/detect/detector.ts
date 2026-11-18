// Single-pass detection of dates, currencies, percentages and the rest (md2ui
// `data_point_detector.DataPointDetector.detect_pipeline`).
//
// Only the pipeline's scope is ported (ADR-102, md2ui `detector_scope._PIPELINE_TYPES`):
// the patterns whose type something downstream consumes or whose span protects one that
// is, in md2ui's registration order, because `_remove_overlaps` keeps the longest match
// and ties go to the pattern registered first. The types outside the scope (age, blood
// type, frequency, identifier, ordinal, statistical) are not scanned for.

import { type DateTime, isoformat, strptime } from "../py/datetime.ts";
import { compileFirst } from "../py/first-lookahead.ts";
import { type Pattern, RegexKit } from "../py/re.ts";
import { cpLen, lstrip, rstrip } from "../py/str.ts";
import { decimal, pyInt, ValueError } from "../py/value.ts";
import { LINK_DESTINATION } from "../split/link-syntax.ts";
import {
  type Parser,
  PHONE_INTERNATIONAL_PATTERN,
  parseChangeBare,
  parseChangeCurrency,
  parseChangeDirection,
  parseChangePercentage,
  parseChangeQuantity,
  parseCurrencyMagnitude,
  parseCurrencyShorthand,
  parseCurrencyTrailingSymbol,
  parseDateDayOnly,
  parseDateDottedShortYear,
  parseDatePartialLong,
  parseDatePartialShort,
  parseDateRange,
  parseDateRangeShort,
  parseDateRangeTwoEndpoints,
  parseDatetimeComma,
  parseDatetimeIso,
  parseDatetimeLongMonth,
  parseDatetimeShortMonth,
  parseDayOfWeek,
  parseDayOfWeekShort,
  parseDimension,
  parseDimensionPerUnit,
  parseDuration,
  parseDurationCompound,
  parseEmoji,
  parseFileSize,
  parseFullDateWithMonthName,
  parseIsoCurrency,
  parseMagnitude,
  parseMarkdownLink,
  parseMeasurementHeight,
  parseMeasurementTemp,
  parseMeasurementTempDual,
  parseMonthYear,
  parsePhone,
  parsePhoneInternational,
  parseQuantity,
  parseQuarter,
  parseRangeBetween,
  parseRangeCurrency,
  parseRangeCurrencyShared,
  parseRangePercentage,
  parseRangeUnit,
  parseRankingHash,
  parseRankingPlace,
  parseRankingTop,
  parseRateCommodity,
  parseRateGeneric,
  parseRatePercentage,
  parseRatePrice,
  parseRateSpeed,
  parseRateSpeedRange,
  parseRatioColon,
  parseRatioSlash,
  parseScoreFraction,
  parseScoreGrade,
  parseScoreSingleStar,
  parseScoreStars,
  parseShorthandMagnitude,
  parseSignedPercentage,
  parseTime12h,
  parseTime24h,
  parseTimeHoursOnly,
  parseTimeRange12h,
  parseTimeRange24h,
  parseUnicodeFraction,
  parseVersion,
  parseWeekdayDate,
  parseWeekdayDay,
  parseWeekdayDayShort,
} from "./parsers.ts";
import { takeSign } from "./signs.ts";
import type { DataPointType, DataPointValue, DetectedPoint } from "./types.ts";
import {
  CURRENCY_SYMBOLS,
  DATE_CHIP_JOIN,
  DAY_NAMES_RE,
  DIMENSION_UNITS,
  EMOJI_CHAR_RANGES,
  ISO_CURRENCY_CODES,
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
} from "./vocabulary.ts";

// py: _MAGNITUDE_SUFFIX = r"[KMBT]"  # K=thousand, M=million, B=billion, T=trillion
const MAGNITUDE_SUFFIX = "[KMBT]";
// py: _AMPM = r"AM|PM|am|pm"
const AMPM = "AM|PM|am|pm";
// py: _DAY_OF_MONTH = r"(?:3[01]|[12]\d|0?[1-9])"
const DAY_OF_MONTH = String.raw`(?:3[01]|[12]\d|0?[1-9])`;
// py: _RANGE_DASH = r"\s+[-–—]\s+"
const RANGE_DASH = String.raw`\s+[-–—]\s+`;
// The time half of a comma-spelled datetime: a clock time, or a bare hour that carries
// AM/PM (without the meridiem "March 5, 10" would read as a timestamp).
// py: rf"(?:\d{{1,2}}:\d{{2}}(?::\d{{2}})?\s*(?:{_AMPM})?"
// py: rf"|(?:1[0-2]|0?[1-9])\s*(?:{_AMPM}))"
const TIME_TAIL =
  String.raw`(?:\d{1,2}:\d{2}(?::\d{2})?\s*(?:${AMPM})?` +
  String.raw`|(?:1[0-2]|0?[1-9])\s*(?:${AMPM}))`;

// A drawing-element token: a task control `[ ]` / `[x]` or a slider `[65%]` / `[3/10]`.
// py: r"[ xX]|(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%|\d{1,4}(?:\.\d+)?/\d{1,4}"
const CONTROL = String.raw`[ xX]|(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%|\d{1,4}(?:\.\d+)?/\d{1,4}`;

interface Entry {
  readonly pattern: Pattern;
  readonly type: DataPointType;
  readonly parser: Parser;
}

/**
 * md2ui: `DataPointDetector.register`: every pattern is case-insensitive. Each is
 * searched through every text, and most texts hold none, so each leads with the
 * lookahead for its first characters (`compileFirst`).
 */
function register(pattern: string, type: DataPointType, parser: Parser): Entry {
  return { pattern: compileFirst(pattern, { i: true }), type, parser };
}

/** A full date read by one `strptime` format. */
function fullDate(parse: (s: string) => DateTime): Parser {
  return (m) => ({ datetime: isoformat(parse(m)), subtype: "full", has_year: true });
}

const PARSE_ISO = strptime("%Y-%m-%d");
const PARSE_US = strptime("%m/%d/%Y");
const PARSE_DAY_FIRST = strptime("%d-%m-%Y");
const PARSE_LONG = strptime("%B %d, %Y");
const PARSE_SHORT = strptime("%b %d, %Y");
const PARSE_DOTTED = strptime("%d.%m.%Y");

/** A currency amount: the symbol and thousands marks dropped, in a fixed currency. */
function amount(symbol: string, currency: string, text: (m: string) => string): Parser {
  return (m) => ({ amount: decimal(text(m.replaceAll(symbol, ""))), currency });
}

// The default patterns, in md2ui's registration order (`_register_default_patterns`),
// narrowed to the pipeline's types.
const PIPELINE_PATTERNS: readonly Entry[] = Object.freeze([
  // Datetime patterns (registered first: the combined match is longer than DATE + TIME)
  // py: rf"\b(?:{_MONTH_NAMES_LONG}) \d{{1,2}}, \d{{4}}\s+at\s+\d{{1,2}}:\d{{2}}\s*(?:{_AMPM})?\b"
  register(
    String.raw`\b(?:${MONTH_NAMES_LONG}) \d{1,2}, \d{4}\s+at\s+\d{1,2}:\d{2}\s*(?:${AMPM})?\b`,
    "date",
    parseDatetimeLongMonth,
  ),
  // py: rf"\b(?:{_MONTH_NAMES_SHORT})\.? \d{{1,2}}, \d{{4}}\s+at\s+\d{{1,2}}:\d{{2}}\s*(?:{_AMPM})?\b"
  register(
    String.raw`\b(?:${MONTH_NAMES_SHORT})\.? \d{1,2}, \d{4}\s+at\s+\d{1,2}:\d{2}\s*(?:${AMPM})?\b`,
    "date",
    parseDatetimeShortMonth,
  ),
  // py: rf"\b\d{{4}}-\d{{2}}-\d{{2}}\s+at\s+\d{{1,2}}:\d{{2}}(?::\d{{2}})?\s*(?:{_AMPM})?\b"
  register(
    String.raw`\b\d{4}-\d{2}-\d{2}\s+at\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:${AMPM})?\b`,
    "date",
    parseDatetimeIso,
  ),
  // The same thing spelled with a COMMA instead of "at" ("February 04, 9:17 PM"); the
  // year is optional here.
  // py: rf"\b{_MONTH_NAMES}\.? \d{{1,2}}(?:{_ORDINAL_SUFFIX})?"
  // py: rf"(?:, \d{{4}})?[,.]\s*{_TIME_TAIL}\b"
  register(
    String.raw`\b${MONTH_NAMES}\.? \d{1,2}(?:${ORDINAL_SUFFIX})?` +
      String.raw`(?:, \d{4})?[,.]\s*${TIME_TAIL}\b`,
    "date",
    parseDatetimeComma,
  ),
  // A weekday introducing a date ("Fri, Aug 14"); the tail must be a MONTH date.
  // py: rf"\b{_DAY_NAMES_RE},\s+{_MONTH_NAMES}\.? \d{{1,2}}"
  // py: rf"(?:{_ORDINAL_SUFFIX})?(?:, \d{{4}})?\b"
  register(
    String.raw`\b${DAY_NAMES_RE},\s+${MONTH_NAMES}\.? \d{1,2}` +
      String.raw`(?:${ORDINAL_SUFFIX})?(?:, \d{4})?\b`,
    "date",
    parseWeekdayDate,
  ),

  // Date patterns - full dates (with year). The (?<!sep)...(?!sep) guards keep a date
  // out of a hyphenated/slashed/dotted identifier like ORD-2026-02-04-78923.
  // py: r"(?<!-)\b\d{4}-\d{2}-\d{2}\b(?!-)"
  register(String.raw`(?<!-)\b\d{4}-\d{2}-\d{2}\b(?!-)`, "date", fullDate(PARSE_ISO)),
  // py: r"(?<!/)\b\d{2}/\d{2}/\d{4}\b(?!/)"
  register(String.raw`(?<!/)\b\d{2}/\d{2}/\d{4}\b(?!/)`, "date", fullDate(PARSE_US)),
  // py: r"(?<!-)\b\d{1,2}-\d{1,2}-\d{4}\b(?!-)"
  register(String.raw`(?<!-)\b\d{1,2}-\d{1,2}-\d{4}\b(?!-)`, "date", fullDate(PARSE_DAY_FIRST)),
  // py: rf"\b(?:{_MONTH_NAMES_LONG}) \d{{1,2}}, \d{{4}}\b"
  register(String.raw`\b(?:${MONTH_NAMES_LONG}) \d{1,2}, \d{4}\b`, "date", fullDate(PARSE_LONG)),
  // py: rf"\b(?:{_MONTH_NAMES_SHORT}) \d{{1,2}}, \d{{4}}\b"
  register(String.raw`\b(?:${MONTH_NAMES_SHORT}) \d{1,2}, \d{4}\b`, "date", fullDate(PARSE_SHORT)),
  // py: r"(?<!\.)\b\d{2}\.\d{2}\.\d{4}\b(?!\.)"
  register(String.raw`(?<!\.)\b\d{2}\.\d{2}\.\d{4}\b(?!\.)`, "date", fullDate(PARSE_DOTTED)),

  // Day-first full dates: 20 May 2017, 20th May, 2017, 5 Jan 2024
  // py: rf"\b\d{{1,2}}(?:{_ORDINAL_SUFFIX})? {_MONTH_NAMES}\.?,? \d{{4}}\b"
  register(
    String.raw`\b\d{1,2}(?:${ORDINAL_SUFFIX})? ${MONTH_NAMES}\.?,? \d{4}\b`,
    "date",
    parseFullDateWithMonthName,
  ),
  // Month-first full dates without a comma: May 20 2017, May 20th 2017
  // py: rf"\b{_MONTH_NAMES}\.? \d{{1,2}}(?:{_ORDINAL_SUFFIX})? \d{{4}}\b"
  register(
    String.raw`\b${MONTH_NAMES}\.? \d{1,2}(?:${ORDINAL_SUFFIX})? \d{4}\b`,
    "date",
    parseFullDateWithMonthName,
  ),
  // Month-first full dates with ordinal + comma: May 20th, 2017
  // py: rf"\b{_MONTH_NAMES}\.? \d{{1,2}}(?:{_ORDINAL_SUFFIX}), \d{{4}}\b"
  register(
    String.raw`\b${MONTH_NAMES}\.? \d{1,2}(?:${ORDINAL_SUFFIX}), \d{4}\b`,
    "date",
    parseFullDateWithMonthName,
  ),
  // Day "of" month year: 20th of May 2017, the 20 of May 2017
  // py: rf"\b(?:the )?\d{{1,2}}(?:{_ORDINAL_SUFFIX})? of {_MONTH_NAMES}\.? \d{{4}}\b"
  register(
    String.raw`\b(?:the )?\d{1,2}(?:${ORDINAL_SUFFIX})? of ${MONTH_NAMES}\.? \d{4}\b`,
    "date",
    parseFullDateWithMonthName,
  ),
  // Month + year, no day: May 2017, May, 2017, Jul. 2017
  // py: rf"\b{_MONTH_NAMES}\.?,? \d{{4}}\b"
  register(String.raw`\b${MONTH_NAMES}\.?,? \d{4}\b`, "date", parseMonthYear),
  // ISO year-month: 2017-05 (guards mirror the ISO full-date pattern)
  // py: r"(?<!\d)(?<!-)\b\d{4}-\d{2}\b(?!-)(?!\d)"
  register(String.raw`(?<!\d)(?<!-)\b\d{4}-\d{2}\b(?!-)(?!\d)`, "date", parseMonthYear),
  // Numeric month/year: 05/2017, 5/2017 (registered before RATIO to win ties)
  // py: r"(?<!\d)(?<!/)\b\d{1,2}/\d{4}\b(?!/)(?!\d)"
  register(String.raw`(?<!\d)(?<!/)\b\d{1,2}/\d{4}\b(?!/)(?!\d)`, "date", parseMonthYear),
  // 2-digit-year dotted date: 20.05.17 (registered before VERSION to win ties)
  // py: r"(?<!\d)(?<!\.)\b\d{2}\.\d{2}\.\d{2}\b(?!\.)(?!\d)"
  register(
    String.raw`(?<!\d)(?<!\.)\b\d{2}\.\d{2}\.\d{2}\b(?!\.)(?!\d)`,
    "date",
    parseDateDottedShortYear,
  ),

  // Date patterns - partial dates (without year)
  // py: rf"\b(?:{_MONTH_NAMES_LONG}){_DATE_CHIP_JOIN}"
  // py: rf"\d{{1,2}}(?:{_ORDINAL_SUFFIX})?\b(?!, \d{{4}})"
  register(
    String.raw`\b(?:${MONTH_NAMES_LONG})${DATE_CHIP_JOIN}` +
      String.raw`\d{1,2}(?:${ORDINAL_SUFFIX})?\b(?!, \d{4})`,
    "date",
    parseDatePartialLong,
  ),
  // py: rf"\b(?:{_MONTH_NAMES_SHORT})\.?{_DATE_CHIP_JOIN}"
  // py: rf"\d{{1,2}}(?:{_ORDINAL_SUFFIX})?\b(?!, \d{{4}})"
  register(
    String.raw`\b(?:${MONTH_NAMES_SHORT})\.?${DATE_CHIP_JOIN}` +
      String.raw`\d{1,2}(?:${ORDINAL_SUFFIX})?\b(?!, \d{4})`,
    "date",
    parseDatePartialShort,
  ),
  // py: rf"\bthe \d{{1,2}}(?:{_ORDINAL_SUFFIX})\b"
  register(String.raw`\bthe \d{1,2}(?:${ORDINAL_SUFFIX})\b`, "date", parseDateDayOnly),

  // Date patterns - day of week
  // py: r"\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b"
  register(
    String.raw`\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b`,
    "date",
    parseDayOfWeek,
  ),
  // py: r"\b(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\.?\b"
  register(
    String.raw`\b(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\.?\b`,
    "date",
    parseDayOfWeekShort,
  ),

  // Weekday + day-of-month combo: "Monday 15", "Mon 15th", "Tue 10"
  // py: rf"\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)"
  // py: rf"{_DATE_CHIP_JOIN}{_DAY_OF_MONTH}(?:{_ORDINAL_SUFFIX})?\b"
  register(
    String.raw`\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)` +
      String.raw`${DATE_CHIP_JOIN}${DAY_OF_MONTH}(?:${ORDINAL_SUFFIX})?\b`,
    "date",
    parseWeekdayDay,
  ),
  // py: rf"\b(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\.?"
  // py: rf"{_DATE_CHIP_JOIN}{_DAY_OF_MONTH}(?:{_ORDINAL_SUFFIX})?\b"
  register(
    String.raw`\b(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\.?` +
      String.raw`${DATE_CHIP_JOIN}${DAY_OF_MONTH}(?:${ORDINAL_SUFFIX})?\b`,
    "date",
    parseWeekdayDayShort,
  ),

  // Date range patterns
  // py: rf"\b({_MONTH_NAMES_LONG}) (\d{{1,2}})-(\d{{1,2}}), (\d{{4}})\b"
  register(
    String.raw`\b(${MONTH_NAMES_LONG}) (\d{1,2})-(\d{1,2}), (\d{4})\b`,
    "date_range",
    parseDateRange,
  ),
  // py: rf"\b({_MONTH_NAMES_SHORT}) (\d{{1,2}})-(\d{{1,2}}), (\d{{4}})\b"
  register(
    String.raw`\b(${MONTH_NAMES_SHORT}) (\d{1,2})-(\d{1,2}), (\d{4})\b`,
    "date_range",
    parseDateRangeShort,
  ),
  // Two-endpoint date range: "Jul 5 - Dec 5", "Jul 5, 2025 — Dec 5, 2025".
  // py: rf"\b{_MONTH_NAMES}\.? \d{{1,2}}(?:, \d{{4}})?{_RANGE_DASH}"
  // py: rf"{_MONTH_NAMES}\.? \d{{1,2}}(?:, \d{{4}})?\b"
  register(
    String.raw`\b${MONTH_NAMES}\.? \d{1,2}(?:, \d{4})?${RANGE_DASH}` +
      String.raw`${MONTH_NAMES}\.? \d{1,2}(?:, \d{4})?\b`,
    "date_range",
    parseDateRangeTwoEndpoints,
  ),

  // Currency + shorthand suffix: $50M, €1.2B, £500K, ¥2T
  // py: rf"\$\d+(?:\.\d+)?{_sfx}\b"
  register(String.raw`\$\d+(?:\.\d+)?${MAGNITUDE_SUFFIX}\b`, "currency", (m, kit) =>
    parseCurrencyShorthand(kit, m, "USD"),
  ),
  // py: rf"€\d+(?:\.\d+)?{_sfx}\b"
  register(String.raw`€\d+(?:\.\d+)?${MAGNITUDE_SUFFIX}\b`, "currency", (m, kit) =>
    parseCurrencyShorthand(kit, m, "EUR"),
  ),
  // py: rf"£\d+(?:\.\d+)?{_sfx}\b"
  register(String.raw`£\d+(?:\.\d+)?${MAGNITUDE_SUFFIX}\b`, "currency", (m, kit) =>
    parseCurrencyShorthand(kit, m, "GBP"),
  ),
  // py: rf"¥\d+(?:\.\d+)?{_sfx}\b"
  register(String.raw`¥\d+(?:\.\d+)?${MAGNITUDE_SUFFIX}\b`, "currency", (m, kit) =>
    parseCurrencyShorthand(kit, m, "JPY"),
  ),

  // Currency + magnitude: $89 billion, €3.5 million, etc.
  // py: rf"\$\d+(?:\.\d+)?\s*(?:{_mag})\b"
  register(String.raw`\$\d+(?:\.\d+)?\s*(?:${MAGNITUDE_WORDS})\b`, "currency", (m, kit) =>
    parseCurrencyMagnitude(kit, m, "USD"),
  ),
  // py: rf"€\d+(?:\.\d+)?\s*(?:{_mag})\b"
  register(String.raw`€\d+(?:\.\d+)?\s*(?:${MAGNITUDE_WORDS})\b`, "currency", (m, kit) =>
    parseCurrencyMagnitude(kit, m, "EUR"),
  ),
  // py: rf"£\d+(?:\.\d+)?\s*(?:{_mag})\b"
  register(String.raw`£\d+(?:\.\d+)?\s*(?:${MAGNITUDE_WORDS})\b`, "currency", (m, kit) =>
    parseCurrencyMagnitude(kit, m, "GBP"),
  ),
  // py: rf"¥\d+(?:\.\d+)?\s*(?:{_mag})\b"
  register(String.raw`¥\d+(?:\.\d+)?\s*(?:${MAGNITUDE_WORDS})\b`, "currency", (m, kit) =>
    parseCurrencyMagnitude(kit, m, "JPY"),
  ),

  // ISO currency suffix: $85.00 MXN, 85.00 MXN, 1,200.00 MXN
  // py: rf"(?:{_CURRENCY_SYMBOLS})?\d{{1,3}}(?:,\d{{3}})*(?:\.\d+)?\s+(?:{_ISO_CURRENCY_CODES})\b"
  register(
    String.raw`(?:${CURRENCY_SYMBOLS})?\d{1,3}(?:,\d{3})*(?:\.\d+)?\s+(?:${ISO_CURRENCY_CODES})\b`,
    "currency",
    parseIsoCurrency,
  ),
  // ISO currency prefix: MXN 85.00, USD 1,200.00
  // py: rf"\b(?:{_ISO_CURRENCY_CODES})\s+(?:{_CURRENCY_SYMBOLS})?\d{{1,3}}(?:,\d{{3}})*(?:\.\d+)?"
  register(
    String.raw`\b(?:${ISO_CURRENCY_CODES})\s+(?:${CURRENCY_SYMBOLS})?\d{1,3}(?:,\d{3})*(?:\.\d+)?`,
    "currency",
    parseIsoCurrency,
  ),
  // Trailing currency symbol: "2,36 €", "45€", "$2.36 €"; the trailing symbol decides
  // the currency, and the longest match wins over the bare "$2.36".
  // py: rf"(?<![\d.,])(?:{_CURRENCY_SYMBOLS})?\d+(?:[.,]\d+)*\s*(?:{_CURRENCY_SYMBOLS})"
  register(
    String.raw`(?<![\d.,])(?:${CURRENCY_SYMBOLS})?\d+(?:[.,]\d+)*\s*(?:${CURRENCY_SYMBOLS})`,
    "currency",
    parseCurrencyTrailingSymbol,
  ),

  // Currency patterns
  // py: r"\$\d{1,3}(?:,\d{3})*(?:\.\d+)?"
  register(
    String.raw`\$\d{1,3}(?:,\d{3})*(?:\.\d+)?`,
    "currency",
    amount("$", "USD", (m) => m.replaceAll(",", "")),
  ),
  // py: r"€\d{1,3}(?:\.\d{3})*(?:,\d{2})?"
  register(
    String.raw`€\d{1,3}(?:\.\d{3})*(?:,\d{2})?`,
    "currency",
    amount("€", "EUR", (m) => m.replaceAll(".", "").replaceAll(",", ".")),
  ),
  // py: r"£\d{1,3}(?:,\d{3})*(?:\.\d+)?"
  register(
    String.raw`£\d{1,3}(?:,\d{3})*(?:\.\d+)?`,
    "currency",
    amount("£", "GBP", (m) => m.replaceAll(",", "")),
  ),
  // py: r"¥\d{1,3}(?:,\d{3})*"
  register(
    String.raw`¥\d{1,3}(?:,\d{3})*`,
    "currency",
    amount("¥", "JPY", (m) => m.replaceAll(",", "")),
  ),

  // Percentage patterns
  // py: rf"~?[{_MINUS}]?\d+\.\d+%"
  register(String.raw`~?[${MINUS}]?\d+\.\d+%`, "percentage", parseSignedPercentage),
  // py: rf"~?[{_MINUS}]?\d+%"
  register(String.raw`~?[${MINUS}]?\d+%`, "percentage", parseSignedPercentage),
  // py: r"~?\d+(?:\.\d+)?\s*percent\b"
  register(String.raw`~?\d+(?:\.\d+)?\s*percent\b`, "percentage", (m) =>
    decimal(lstrip(m, "~").toLowerCase().replaceAll("percent", "").trim()),
  ),

  // Integer/count patterns
  // py: r"(?<![$€£¥])\b\d{1,3}(?:,\d{3})+\b"
  register(String.raw`(?<![$€£¥])\b\d{1,3}(?:,\d{3})+\b`, "number", (m) =>
    pyInt(m.replaceAll(",", "")),
  ),
  // Formatted decimal: 4,783.45 / 1,234,567.89
  // py: r"(?<![$€£¥])\b\d{1,3}(?:,\d{3})+\.\d+\b"
  register(String.raw`(?<![$€£¥])\b\d{1,3}(?:,\d{3})+\.\d+\b`, "number", (m) => ({
    value: decimal(m.replaceAll(",", "")),
    type: "decimal",
  })),

  // Quantity patterns (value + unit). Magnitude words: 3.7 million, 2 billion, etc.
  // py: rf"(?<![$€£¥,.\d])\b\d{{1,3}}(?:,\d{{3}})*(?:\.\d+)?\s*(?:{_MAGNITUDE_WORDS})\b"
  register(
    String.raw`(?<![$€£¥,.\d])\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:${MAGNITUDE_WORDS})\b`,
    "quantity",
    parseMagnitude,
  ),
  // Shorthand magnitude: 2.5B, 500K, 1.2M, 3T
  // py: rf"(?<![$€£¥,.\d])\b\d+(?:\.\d+)?{_MAGNITUDE_SUFFIX}\b"
  register(
    String.raw`(?<![$€£¥,.\d])\b\d+(?:\.\d+)?${MAGNITUDE_SUFFIX}\b`,
    "quantity",
    parseShorthandMagnitude,
  ),
  // Common units: 250 units, 100 kg, 50 miles, etc.
  // py: rf"(?<![$€£¥,.\d])\b\d{{1,3}}(?:,\d{{3}})*(?:\.\d+)?\s*(?:{_QUANTITY_UNITS})\b"
  register(
    String.raw`(?<![$€£¥,.\d])\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\s*(?:${QUANTITY_UNITS})\b`,
    "quantity",
    parseQuantity,
  ),

  // Ratio patterns: 3:1, 1:100, 50/50
  // py: r"\b\d+:\d+\b"
  register(String.raw`\b\d+:\d+\b`, "ratio", parseRatioColon),
  // A BARE fraction is a ratio; a fraction followed by a word is a SCORE carrying that
  // word as its unit (`750/1800 kcal`).
  // py: r"\b\d+/\d+\b(?!\s*(?:stars?|rating))(?!\s+[A-Za-z])"
  register(
    String.raw`\b\d+/\d+\b(?!\s*(?:stars?|rating))(?!\s+[A-Za-z])`,
    "ratio",
    parseRatioSlash,
  ),

  // Rate patterns: 60 mph, $15/hour, 5% annual growth
  // py: rf"(?:(?-i:\b[NSEW]{{1,3}})\s+)?"
  // py: rf"(?<![$€£¥,.\d])\b\d+(?:\.\d+)?\s*(?:{_SPEED_UNITS})\b"
  register(
    String.raw`(?:(?-i:\b[NSEW]{1,3})\s+)?` +
      String.raw`(?<![$€£¥,.\d])\b\d+(?:\.\d+)?\s*(?:${SPEED_UNITS})\b`,
    "rate",
    parseRateSpeed,
  ),
  // A speed RANGE: `7-10 mph`, `15-20 km/h`. Registered after the plain pattern because
  // the longest match wins in _remove_overlaps.
  // py: rf"(?:(?-i:\b[NSEW]{{1,3}})\s+)?"
  // py: rf"(?<![$€£¥,.\d])\b\d+(?:\.\d+)?\s*{_RANGE_OP}\s*\d+(?:\.\d+)?\s*(?:{_SPEED_UNITS})\b"
  register(
    String.raw`(?:(?-i:\b[NSEW]{1,3})\s+)?` +
      String.raw`(?<![$€£¥,.\d])\b\d+(?:\.\d+)?\s*${RANGE_OP}\s*\d+(?:\.\d+)?\s*(?:${SPEED_UNITS})\b`,
    "rate",
    parseRateSpeedRange,
  ),
  // Price per commodity unit: $2,048/oz, $73.45/barrel, €1,200/kg
  // py: rf"{_CURRENCY_SYMBOLS}\d{{1,3}}(?:,\d{{3}})*(?:\.\d+)?/(?:{_QUANTITY_UNITS})\b"
  register(
    String.raw`${CURRENCY_SYMBOLS}\d{1,3}(?:,\d{3})*(?:\.\d+)?/(?:${QUANTITY_UNITS})\b`,
    "rate",
    parseRateCommodity,
  ),
  // py: r"\$\d+(?:\.\d+)?/(?:hour|hr|day|week|month|year|unit|item)\b"
  register(
    String.raw`\$\d+(?:\.\d+)?/(?:hour|hr|day|week|month|year|unit|item)\b`,
    "rate",
    parseRatePrice,
  ),
  // py: r"\b\d+(?:\.\d+)?%\s*(?:annual|monthly|daily|weekly|yearly|per\s+(?:year|month|day|week))\b"
  register(
    String.raw`\b\d+(?:\.\d+)?%\s*(?:annual|monthly|daily|weekly|yearly|per\s+(?:year|month|day|week))\b`,
    "rate",
    parseRatePercentage,
  ),
  // py: r"(?<![$€£¥,.\d])\b\d+(?:\.\d+)?\s*(?:per|/)\s*(?:hour|day|week|month|year|second|minute)\b"
  register(
    String.raw`(?<![$€£¥,.\d])\b\d+(?:\.\d+)?\s*(?:per|/)\s*(?:hour|day|week|month|year|second|minute)\b`,
    "rate",
    parseRateGeneric,
  ),

  // Score/Rating patterns: 4.5/5 stars, 4.8/5.0, 87/100, Grade A
  // py: r"\b\d+(?:\.\d+)?/\d+(?:\.\d+)?\s*(?:stars?|rating)?\b"
  register(
    String.raw`\b\d+(?:\.\d+)?/\d+(?:\.\d+)?\s*(?:stars?|rating)?\b`,
    "score",
    parseScoreFraction,
  ),
  // py: r"\b(?:grade|score|rating)\s*[A-F][+-]?\b"
  register(String.raw`\b(?:grade|score|rating)\s*[A-F][+-]?\b`, "score", parseScoreGrade),
  // py: r"\b[A-F][+-]?\s*(?:grade|rating)\b"
  register(String.raw`\b[A-F][+-]?\s*(?:grade|rating)\b`, "score", parseScoreGrade),
  // Single-star with adjacent decimal: ⭐ 4.9, ★4.9, 4.9⭐, 4.9 ☆
  // py: r"(?:[⭐★☆]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*[⭐★☆])"
  register(
    String.raw`(?:[⭐★☆]\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*[⭐★☆])`,
    "score",
    parseScoreSingleStar,
  ),
  // Star-rating patterns: ⭐⭐⭐⭐⭐ (5/5), ⭐⭐⭐⭐☆ (4/5), ★★★☆☆ (3/5)
  // py: r"[⭐★☆]{2,}"
  register("[⭐★☆]{2,}", "score", parseScoreStars),

  // Ranking patterns: #1, top 10%, first place, 3rd place
  // py: r"#\d+\b"
  register(String.raw`#\d+\b`, "ranking", parseRankingHash),
  // py: r"\btop\s*\d+%?\b"
  register(String.raw`\btop\s*\d+%?\b`, "ranking", parseRankingTop),
  // py: rf"\b(?:first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|\d+(?:{_ORDINAL_SUFFIX}))\s*place\b"
  register(
    String.raw`\b(?:first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|\d+(?:${ORDINAL_SUFFIX}))\s*place\b`,
    "ranking",
    parseRankingPlace,
  ),

  // Measurement patterns: 6 feet, 75 kg, 500 ml, 98.6°F. A DUAL-unit reading first:
  // `68°F (20°C)` is one temperature quoted twice.
  // py: r"(?<![$€£¥,.\d])\b\d+(?:\.\d+)?\s*°[FC]\s*\(\s*"
  // py: r"\d+(?:\.\d+)?\s*°[FC]\s*\)"
  register(
    String.raw`(?<![$€£¥,.\d])\b\d+(?:\.\d+)?\s*°[FC]\s*\(\s*` +
      String.raw`\d+(?:\.\d+)?\s*°[FC]\s*\)`,
    "measurement",
    parseMeasurementTempDual,
  ),
  // py: r"(?<![$€£¥,.\d])\b\d+(?:\.\d+)?\s*°[FC]?(?![FC\w])"
  register(
    String.raw`(?<![$€£¥,.\d])\b\d+(?:\.\d+)?\s*°[FC]?(?![FC\w])`,
    "measurement",
    parseMeasurementTemp,
  ),
  // py: r"(?<![$€£¥,.\d])\b\d+\s*(?:feet|foot|ft)\s*(?:\d+\s*(?:inches|inch|in))?\b"
  register(
    String.raw`(?<![$€£¥,.\d])\b\d+\s*(?:feet|foot|ft)\s*(?:\d+\s*(?:inches|inch|in))?\b`,
    "measurement",
    parseMeasurementHeight,
  ),

  // Time range patterns: 8:00 AM - 9:00 PM, 08:00 - 17:00
  // py: rf"\b\d{{1,2}}:\d{{2}}\s*(?:AM|PM)\s*{_RANGE_OP}\s*\d{{1,2}}:\d{{2}}\s*(?:AM|PM)\b"
  register(
    String.raw`\b\d{1,2}:\d{2}\s*(?:AM|PM)\s*${RANGE_OP}\s*\d{1,2}:\d{2}\s*(?:AM|PM)\b`,
    "time",
    parseTimeRange12h,
  ),
  // py: rf"\b(?:[01]?\d|2[0-3]):[0-5]\d\s*{_RANGE_OP}\s*(?:[01]?\d|2[0-3]):[0-5]\d\b"
  register(
    String.raw`\b(?:[01]?\d|2[0-3]):[0-5]\d\s*${RANGE_OP}\s*(?:[01]?\d|2[0-3]):[0-5]\d\b`,
    "time",
    parseTimeRange24h,
  ),

  // Time patterns: 3:00 PM, 14:30, 2:30 PM
  // py: rf"\b\d{{1,2}}:\d{{2}}\s*(?:{_AMPM})\b"
  register(String.raw`\b\d{1,2}:\d{2}\s*(?:${AMPM})\b`, "time", parseTime12h),
  // py: r"\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\s*(?:hours?)?\b"
  register(
    String.raw`\b(?:[01]?\d|2[0-3]):[0-5]\d(?::[0-5]\d)?\s*(?:hours?)?\b`,
    "time",
    parseTime24h,
  ),
  // Hours-only 12-hour time: 3 PM, 11 AM, 3pm, 11am
  // py: rf"\b(?:1[0-2]|0?[1-9])\s*(?:{_AMPM})\b"
  register(String.raw`\b(?:1[0-2]|0?[1-9])\s*(?:${AMPM})\b`, "time", parseTimeHoursOnly),

  // Duration patterns. COMPOUND first: `4 hours 35 minutes`, `1h 20m` are one span.
  // py: r"(?<![$€£¥,.\d])\b\d+\s*(?:h|hr|hrs|hour|hours|d|day|days|"
  // py: r"m|min|mins|minute|minutes|w|week|weeks)\s+"
  // py: r"\d+\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes|"
  // py: r"s|sec|secs|second|seconds)\b"
  register(
    String.raw`(?<![$€£¥,.\d])\b\d+\s*(?:h|hr|hrs|hour|hours|d|day|days|` +
      String.raw`m|min|mins|minute|minutes|w|week|weeks)\s+` +
      String.raw`\d+\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes|` +
      String.raw`s|sec|secs|second|seconds)\b`,
    "duration",
    parseDurationCompound,
  ),
  // py: r"(?<![$€£¥,.\d])\b\d+[-\s](?:year|month|week|day|hour|minute|second)s?\s*(?:period|long)?\b"
  register(
    String.raw`(?<![$€£¥,.\d])\b\d+[-\s](?:year|month|week|day|hour|minute|second)s?\s*(?:period|long)?\b`,
    "duration",
    parseDuration,
  ),

  // Quarter patterns: Q3 2023, Q1 2024
  // py: r"\bQ[1-4]\s*\d{4}\b"
  register(String.raw`\bQ[1-4]\s*\d{4}\b`, "quarter", parseQuarter),
  // py: r"\b\d{4}\s*Q[1-4]\b"
  register(String.raw`\b\d{4}\s*Q[1-4]\b`, "quarter", parseQuarter),

  // Range patterns: 20-30 units, between $100-$500, $100-$500
  // py: r"\bbetween\s*\$?\d+(?:,\d{3})*(?:\.\d+)?\s*(?:and|-)\s*\$?\d+(?:,\d{3})*(?:\.\d+)?\b"
  register(
    String.raw`\bbetween\s*\$?\d+(?:,\d{3})*(?:\.\d+)?\s*(?:and|-)\s*\$?\d+(?:,\d{3})*(?:\.\d+)?\b`,
    "range",
    parseRangeBetween,
  ),
  // py: r"\$\d+(?:,\d{3})*(?:\.\d+)?\s*-\s*\$\d+(?:,\d{3})*(?:\.\d+)?"
  register(
    String.raw`\$\d+(?:,\d{3})*(?:\.\d+)?\s*-\s*\$\d+(?:,\d{3})*(?:\.\d+)?`,
    "range",
    parseRangeCurrency,
  ),
  // A currency range that names its symbol ONCE and may share a magnitude suffix:
  // `€180-200M` means €180M to €200M.
  // py: rf"{_CURRENCY_SYMBOLS}\d+(?:,\d{{3}})*(?:\.\d+)?\s*{_RANGE_OP}\s*"
  // py: rf"{_CURRENCY_SYMBOLS}?\d+(?:,\d{{3}})*(?:\.\d+)?\s*[KMBT]\b"
  register(
    String.raw`${CURRENCY_SYMBOLS}\d+(?:,\d{3})*(?:\.\d+)?\s*${RANGE_OP}\s*` +
      String.raw`${CURRENCY_SYMBOLS}?\d+(?:,\d{3})*(?:\.\d+)?\s*[KMBT]\b`,
    "range",
    parseRangeCurrencyShared,
  ),
  // py: rf"(?<![$€£¥,.\d])\b\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*(?:{_QUANTITY_UNITS})\b"
  register(
    String.raw`(?<![$€£¥,.\d])\b\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?\s*(?:${QUANTITY_UNITS})\b`,
    "range",
    parseRangeUnit,
  ),
  // Percentage range: 15-20%, ~15-20%, 10.5-15.5%
  // py: rf"~?\d+(?:\.\d+)?\s*{_RANGE_OP}\s*\d+(?:\.\d+)?%"
  register(
    String.raw`~?\d+(?:\.\d+)?\s*${RANGE_OP}\s*\d+(?:\.\d+)?%`,
    "range",
    parseRangePercentage,
  ),

  // Change patterns: +15% increase, -$200 decrease, up 10%. Signed quantity change:
  // (?<!\w) keeps signs attached to a preceding letter/digit (OAX-2024-789456) out.
  // py: rf"(?<!\w){_SIGN}\d+(?:\.\d+)?\s*(?:{_QUANTITY_UNITS})\b"
  register(
    String.raw`(?<!\w)${SIGN}\d+(?:\.\d+)?\s*(?:${QUANTITY_UNITS})\b`,
    "change",
    parseChangeQuantity,
  ),
  // py: rf"(?<!\w){_SIGN}\d+(?:\.\d+)?%\s*(?:increase|decrease|change|growth|decline)?"
  register(
    String.raw`(?<!\w)${SIGN}\d+(?:\.\d+)?%\s*(?:increase|decrease|change|growth|decline)?`,
    "change",
    parseChangePercentage,
  ),
  // py: rf"(?<!\w){_SIGN}\$\d+(?:,\d{{3}})*(?:\.\d+)?\s*(?:increase|decrease|change)?"
  register(
    String.raw`(?<!\w)${SIGN}\$\d+(?:,\d{3})*(?:\.\d+)?\s*(?:increase|decrease|change)?`,
    "change",
    parseChangeCurrency,
  ),
  // py: r"\b(?:up|down|increased|decreased|grew|fell|rose|dropped)\s*(?:by\s*)?\d+(?:\.\d+)?%?"
  register(
    String.raw`\b(?:up|down|increased|decreased|grew|fell|rose|dropped)\s*(?:by\s*)?\d+(?:\.\d+)?%?`,
    "change",
    parseChangeDirection,
  ),
  // Bare signed number: +3, -5, +2.5. Registered after the specific patterns so +3%,
  // +3 points, +$3 etc. keep winning via _remove_overlaps.
  // py: rf"(?<!\w){_SIGN}\d+(?:\.\d+)?"
  register(String.raw`(?<!\w)${SIGN}\d+(?:\.\d+)?`, "change", parseChangeBare),

  // International phone: +CC LocalNumber (+52 951 514 4173, +44 20 7946 0958)
  // py: r"\+(?P<cc>\d{1,3})(?P<sep>[ .\-])(?:(?:\d{2,5})(?P=sep))*(?:\d{2,8})\b"
  register(`${PHONE_INTERNATIONAL_PATTERN}\\b`, "phone", parsePhoneInternational),

  // Phone patterns: (555) 123-4567, +1-555-123-4567, 555.123.4567
  // py: r"\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"
  register(String.raw`\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b`, "phone", parsePhone),

  // Email patterns: user@example.com
  // py: r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b"
  register(String.raw`\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b`, "email", (m) => ({
    address: m.toLowerCase(),
  })),

  // Markdown image: ``![alt](url)``. The link twin below excludes it with a lookbehind.
  // The match is the PROTECTED RANGE that stops the separator and colon splits cutting
  // inside the alt text or the URL; the parser is the link's, handed the span without `!`.
  // py: rf"!\[[^\]]*\]\({LINK_DESTINATION}\)"
  register(String.raw`!\[[^\]]*\]\(${LINK_DESTINATION}\)`, "image", (m, kit) =>
    parseMarkdownLink(m.slice(1), kit),
  ),

  // Drawing-element token: a task control `[ ]` / `[x]` or a slider `[65%]` / `[3/10]`,
  // bare or as the linked `[[x]](url)` / `[[65%]](url)`. A guard, like IMAGE above.
  // py: rf"\[\[(?:{_control})\]\]\((?=[^)]){LINK_DESTINATION}\)"
  // py: rf"|(?<!!)\[(?:{_control})\](?!\()"
  register(
    String.raw`\[\[(?:${CONTROL})\]\]\((?=[^)])${LINK_DESTINATION}\)` +
      String.raw`|(?<!!)\[(?:${CONTROL})\](?!\()`,
    "drawing_element",
    (m) => ({ token: m }),
  ),

  // Markdown link: ``[label](url)``; the lookbehind keeps images out. Registered before
  // URL so the LINK span wins against the URL inside the parens.
  // py: rf"(?<!!)\[[^\]]*\]\((?=[^)]){LINK_DESTINATION}\)"
  register(String.raw`(?<!!)\[[^\]]*\]\((?=[^)])${LINK_DESTINATION}\)`, "link", parseMarkdownLink),

  // Angle-bracket autolink (``<https://...>``): the match spans the brackets so the
  // whole autolink stays ONE node.
  // py: r"<https?://[^\s<>]+>"
  register(String.raw`<https?://[^\s<>]+>`, "url", (m) => ({
    url: m.slice(1, -1),
    scheme: m.slice(1, -1).split("://")[0] as string,
  })),

  // URL patterns. The classes exclude the markdown-link delimiters ``( ) [ ]`` so a URL
  // cannot run past a link's closing paren into the next link.
  // py: r"https?://[^\s<>\"'\[\]()]+"
  register(String.raw`https?://[^\s<>\"'\[\]()]+`, "url", (m) => ({
    url: m,
    scheme: m.split("://")[0] as string,
  })),
  // py: r"\b(?:www\.)[^\s\[\]()]+\.[a-z]{2,}(?:/[^\s\[\]()]*)?\b"
  // py: r"|\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:com|org|net|io|co|dev|app|ai|edu|gov)\b"
  register(
    String.raw`\b(?:www\.)[^\s\[\]()]+\.[a-z]{2,}(?:/[^\s\[\]()]*)?\b` +
      String.raw`|\b[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.(?:com|org|net|io|co|dev|app|ai|edu|gov)\b`,
    "url",
    (m) => ({ url: m, scheme: null }),
  ),

  // Version patterns: require a version signal (a `v` prefix, a 3rd part, or a
  // `-suffix`), so a bare two-part decimal is NOT a version.
  // py: r"\b(?:v\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?"
  // py: r"|(?<!,)\d+\.\d+\.\d+(?:-[\w.]+)?"
  // py: r"|(?<!,)\d+\.\d+-[\w.]+)\b"
  register(
    String.raw`\b(?:v\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?` +
      String.raw`|(?<!,)\d+\.\d+\.\d+(?:-[\w.]+)?` +
      String.raw`|(?<!,)\d+\.\d+-[\w.]+)\b`,
    "version",
    parseVersion,
  ),

  // File size patterns: 500 MB, 1.5 GB, 2 TB, 100 KB
  // py: r"(?<![$€£¥,.\d])\b\d+(?:\.\d+)?\s*(?:TB|GB|MB|KB|B|tb|gb|mb|kb|bytes?)\b"
  register(
    String.raw`(?<![$€£¥,.\d])\b\d+(?:\.\d+)?\s*(?:TB|GB|MB|KB|B|tb|gb|mb|kb|bytes?)\b`,
    "file_size",
    parseFileSize,
  ),

  // Per-unit dimensions: 24 cm × 33 cm, 9.5 in × 13 in, 9.5 in by 13 in
  // py: rf"(?<![$€£¥,.\d])\b\d+(?:\.\d+)?\s*(?:{_DIMENSION_UNITS})\s*(?:[xX×]|\bby\b)\s*\d+(?:\.\d+)?\s*(?:{_DIMENSION_UNITS})\b"
  register(
    String.raw`(?<![$€£¥,.\d])\b\d+(?:\.\d+)?\s*(?:${DIMENSION_UNITS})\s*(?:[xX×]|\bby\b)\s*\d+(?:\.\d+)?\s*(?:${DIMENSION_UNITS})\b`,
    "dimension",
    parseDimensionPerUnit,
  ),

  // Dimension patterns: 1920x1080, 8.5" x 11", 4 x 6 inches
  // py: r'(?<![$€£¥,.\d])\b\d+(?:\.\d+)?\s*["\']?\s*[xX×]\s*\d+(?:\.\d+)?\s*["\']?\s*(?:inches|inch|in|cm|mm|px|pixels?)?\b'
  register(
    String.raw`(?<![$€£¥,.\d])\b\d+(?:\.\d+)?\s*["\']?\s*[xX×]\s*\d+(?:\.\d+)?\s*["\']?\s*(?:inches|inch|in|cm|mm|px|pixels?)?\b`,
    "dimension",
    parseDimension,
  ),

  // Emoji patterns (Unicode ranges)
  // py: _EMOJI_CHAR_RANGES
  register(EMOJI_CHAR_RANGES, "emoji", parseEmoji),

  // Unicode fraction patterns: ¼, ½, ¾, ⅓, ⅔, etc.
  // py: r"[\u00BC-\u00BE\u2150-\u215E]+"
  register(String.raw`[\u00BC-\u00BE\u2150-\u215E]+`, "number", parseUnicodeFraction),

  // Generic number patterns (registered last as fallback). Decimals: 3.14, 0.5, 100.25
  // py: r"(?<!\w-)\b\d+\.\d+\b(?!-\w)"
  register(String.raw`(?<!\w-)\b\d+\.\d+\b(?!-\w)`, "number", (m) => ({
    value: decimal(m),
    type: "decimal",
  })),
  // Integers: 42, 100, 7. (?<!\w-) / (?!-\w) keep digits embedded between word
  // characters via hyphens (X-2026, 2024-X) out.
  // py: r"(?<!\w-)\b\d+\b(?!-\w)"
  register(String.raw`(?<!\w-)\b\d+\b(?!-\w)`, "number", (m) => ({
    value: pyInt(m),
    type: "integer",
  })),
]);

/**
 * md2ui: `DataPointDetector._blank_marker_underscores`. The text with emphasis underscore
 * runs replaced by spaces, same length. A run counts as emphasis when whitespace or a
 * string edge touches it on at least one side, which is what `___x___`, `_x_` and
 * `__x__` look like and `snake_case` never does.
 */
function blankMarkerUnderscores(text: string): string {
  return text.replace(/_+/g, (run, offset: number) => {
    const before = offset === 0 || /^\s$/u.test(text[offset - 1] as string);
    const end = offset + run.length;
    const after = end === text.length || /^\s$/u.test(text[end] as string);
    return before || after ? " ".repeat(run.length) : run;
  });
}

interface Found {
  readonly point: DetectedPoint;
  /** Length in code points, which is how md2ui compares spans. */
  readonly length: number;
}

/** md2ui: `DataPointDetector._remove_overlaps`: the longest of overlapping matches stays. */
function removeOverlaps(found: readonly Found[]): DetectedPoint[] {
  const sorted = [...found].sort((a, b) => a.point.start - b.point.start || b.length - a.length);
  const filtered: Found[] = [];
  for (const current of sorted) {
    const last = filtered.at(-1);
    if (last === undefined) {
      filtered.push(current);
    } else if (current.point.start < last.point.end) {
      if (current.length > last.length) filtered[filtered.length - 1] = current;
    } else {
      filtered.push(current);
    }
  }
  return filtered.map((entry) => entry.point);
}

/**
 * md2ui: `DataPointDetector.detect_pipeline` (`_scan`). The data points of `text`, in
 * order, `start`/`end` indexing `text`.
 */
export function detectDataPoints(text: string, kit: RegexKit = new RegexKit()): DetectedPoint[] {
  // `_` is a regex word character, so every `\b`-anchored pattern goes blind inside
  // underscores. Scan a copy in which marker underscore runs are blanked: same length,
  // so every offset still refers to `text`.
  const scan = text.includes("_") ? blankMarkerUnderscores(text) : text;

  const results: Found[] = [];
  for (const { pattern, type, parser } of PIPELINE_PATTERNS) {
    for (const match of kit.re(pattern).finditer(scan)) {
      const whole = match.text();
      // The match crossed a blanked marker underscore; not a value.
      const raw = text.slice(match.start(), match.end());
      if (raw.includes("_") && raw !== whole) continue;
      // Trim whitespace the pattern happened to swallow, and move the span with it, so
      // `matched`, `start` and `end` stay consistent.
      const lead = whole.length - lstrip(whole).length;
      const trail = whole.length - rstrip(whole).length;
      const matched = whole.slice(lead, whole.length - trail);
      if (matched === "") continue;
      let value: DataPointValue;
      try {
        value = parser(matched, kit);
      } catch (error) {
        if (error instanceof ValueError) continue;
        throw error;
      }
      results.push({
        point: {
          type,
          matched,
          value,
          start: match.start() + lead,
          end: match.end() - trail,
          is_approximate: matched.startsWith("~"),
        },
        length: cpLen(matched),
      });
    }
  }
  // A sign written right before an unsigned value belongs to it (`-€200`, `-5°C`).
  // The signed match is longer, so it beats a half-match such as `-$5`; appended last,
  // it loses a tie to a pattern that already read the sign (`-$200`).
  for (const { point } of [...results]) {
    const signedPoint = takeSign(point, text);
    if (signedPoint !== null) {
      results.push({ point: signedPoint, length: cpLen(signedPoint.matched) });
    }
  }
  results.sort((a, b) => a.point.start - b.point.start);
  return removeOverlaps(results);
}
