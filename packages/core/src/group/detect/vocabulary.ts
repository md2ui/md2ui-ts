// The words the detector knows: month names, currencies, units, emoji (md2ui
// `detector_vocabulary`). Neither patterns nor parsing: the tables both are written in
// terms of, so a month name in the regex that finds a date and in the parser that reads
// it cannot disagree. Only what the pipeline's patterns and parsers use is ported.

import { compile } from "../py/re.ts";

// md2ui: detector_vocabulary._EMOJI_BY_DEFAULT. Emoji outside the blocks below, from
// Unicode's emoji-test.txt (Emoji 16.0), kept in step with `measure/text-runs.ts`'s copy:
// these are emoji on their own (🀄 🃏 🆗 🈚) ...
const EMOJI_BY_DEFAULT =
  // py: r"\U0001F004\U0001F0CF\U0001F18E\U0001F191-\U0001F19A\U0001F201\U0001F21A"
  String.raw`\U0001F004\U0001F0CF\U0001F18E\U0001F191-\U0001F19A\U0001F201\U0001F21A` +
  // py: r"\U0001F22F\U0001F232-\U0001F236\U0001F238-\U0001F23A\U0001F250\U0001F251"
  String.raw`\U0001F22F\U0001F232-\U0001F236\U0001F238-\U0001F23A\U0001F250\U0001F251`;
// md2ui: detector_vocabulary._EMOJI_WITH_SELECTOR. ... and these only with U+FE0F after
// them: bare, they are text (`© 2026`, `™`).
const EMOJI_WITH_SELECTOR =
  // py: r"\u00A9\u00AE\u203C\u2049\u2122\u2139\u24C2\u2934\u2935\u3030\u303D\u3297"
  String.raw`\u00A9\u00AE\u203C\u2049\u2122\u2139\u24C2\u2934\u2935\u3030\u303D\u3297` +
  // py: r"\u3299\U0001F170\U0001F171\U0001F17E\U0001F17F\U0001F202\U0001F237"
  String.raw`\u3299\U0001F170\U0001F171\U0001F17E\U0001F17F\U0001F202\U0001F237`;

// md2ui: detector_vocabulary._EMOJI_CHAR_RANGES (one Python string, concatenated). A run
// holds keycaps and joiners, but never starts or ends with a joiner.
export const EMOJI_CHAR_RANGES =
  // py: r"(?!\u200d)(?:[0-9#*]\uFE0F?\u20E3|[" + _EMOJI_WITH_SELECTOR + r"]\uFE0F"
  String.raw`(?!\u200d)(?:[0-9#*]\uFE0F?\u20E3|[` +
  EMOJI_WITH_SELECTOR +
  String.raw`]\uFE0F` +
  // py: r"|[" + _EMOJI_BY_DEFAULT + r"\U0001F600-\U0001F64F"  # Emoticons
  "|[" +
  EMOJI_BY_DEFAULT +
  String.raw`\U0001F600-\U0001F64F` +
  // py: r"\U0001F300-\U0001F5FF"  # Misc Symbols and Pictographs
  String.raw`\U0001F300-\U0001F5FF` +
  // py: r"\U0001F680-\U0001F6FF"  # Transport and Map
  String.raw`\U0001F680-\U0001F6FF` +
  // py: r"\U0001F700-\U0001F77F"  # Alchemical Symbols
  String.raw`\U0001F700-\U0001F77F` +
  // py: r"\U0001F780-\U0001F7FF"  # Geometric Shapes Extended
  String.raw`\U0001F780-\U0001F7FF` +
  // py: r"\U0001F800-\U0001F8FF"  # Supplemental Arrows-C
  String.raw`\U0001F800-\U0001F8FF` +
  // py: r"\U0001F900-\U0001F9FF"  # Supplemental Symbols and Pictographs
  String.raw`\U0001F900-\U0001F9FF` +
  // py: r"\U0001FA00-\U0001FA6F"  # Chess Symbols
  String.raw`\U0001FA00-\U0001FA6F` +
  // py: r"\U0001FA70-\U0001FAFF"  # Symbols and Pictographs Extended-A
  String.raw`\U0001FA70-\U0001FAFF` +
  // py: r"\U00002190-\U000021FF"  # Arrows
  String.raw`\U00002190-\U000021FF` +
  // py: r"\U00002702-\U000027B0"  # Dingbats
  String.raw`\U00002702-\U000027B0` +
  // py: r"\U0000231A-\U0000231B"  # Watch, Hourglass
  String.raw`\U0000231A-\U0000231B` +
  // py: r"\U00002328"  # Keyboard
  String.raw`\U00002328` +
  // py: r"\U000023CF"  # Eject
  String.raw`\U000023CF` +
  // py: r"\U000023E9-\U000023F3"  # Media controls
  String.raw`\U000023E9-\U000023F3` +
  // py: r"\U000023F8-\U000023FA"  # Media controls
  String.raw`\U000023F8-\U000023FA` +
  // py: r"\U00002580-\U0000259F"  # Block Elements
  String.raw`\U00002580-\U0000259F` +
  // py: r"\U000025A0-\U000025FF"  # Geometric Shapes
  String.raw`\U000025A0-\U000025FF` +
  // py: r"\U00002600-\U000026FF"  # Misc symbols
  String.raw`\U00002600-\U000026FF` +
  // py: r"\U00002700-\U000027BF"  # Dingbats
  String.raw`\U00002700-\U000027BF` +
  // py: r"\U00002B00-\U00002BFF"  # Miscellaneous Symbols and Arrows
  String.raw`\U00002B00-\U00002BFF` +
  // py: r"\U0000FE00-\U0000FE0F\u200D"  # Variation Selectors, the joiner
  String.raw`\U0000FE00-\U0000FE0F\u200D` +
  // py: r"\U000E0020-\U000E007F"  # Tags: England, Scotland and Wales are 🏴 + tags
  String.raw`\U000E0020-\U000E007F` +
  // py: r"\U0001F1E0-\U0001F1FF])+(?<!\u200d)"  # Flags
  String.raw`\U0001F1E0-\U0001F1FF])+(?<!\u200d)`;

// md2ui: detector_vocabulary.EMOJI_CHAR_PATTERN = re.compile(_EMOJI_CHAR_RANGES)
export const EMOJI_CHAR_PATTERN = compile(EMOJI_CHAR_RANGES);

// md2ui: detector_vocabulary._MAGNITUDE_WORDS
export const MAGNITUDE_WORDS = "hundred|thousand|million|billion|trillion";

// md2ui: detector_vocabulary._MAGNITUDE_MULTIPLIERS (Decimal values; exact integers here)
export const MAGNITUDE_MULTIPLIERS: Readonly<Record<string, bigint>> = Object.freeze({
  hundred: 100n,
  thousand: 1000n,
  million: 1000000n,
  billion: 1000000000n,
  trillion: 1000000000000n,
});

// md2ui: detector_vocabulary._ISO_CURRENCY_CODES
export const ISO_CURRENCY_CODES =
  // py: r"USD|EUR|GBP|JPY|MXN|CAD|AUD|CHF|CNY|INR|BRL|KRW|SGD|HKD|NOK|SEK|DKK"
  "USD|EUR|GBP|JPY|MXN|CAD|AUD|CHF|CNY|INR|BRL|KRW|SGD|HKD|NOK|SEK|DKK" +
  // py: r"|NZD|ZAR|ARS|COP|TRY|AED|SAR|THB|MYR|IDR|PHP|PLN|CZK|HUF|ILS|QAR"
  "|NZD|ZAR|ARS|COP|TRY|AED|SAR|THB|MYR|IDR|PHP|PLN|CZK|HUF|ILS|QAR" +
  // py: r"|KWD|NGN|EGP|TWD|VND|CLP|PEN|PKR"
  "|KWD|NGN|EGP|TWD|VND|CLP|PEN|PKR";

// md2ui: detector_vocabulary._MINUS. A written minus: the ASCII hyphen or the
// typographic minus U+2212, which LLMs write in finance and statistics answers. Either
// reads as negative, since the parsers test only for "+". The hyphen leads every class
// built from it, where it is literal.
// py: _MINUS = "-\u2212"
export const MINUS = "-\u2212";

// md2ui: detector_vocabulary._SIGN. A written sign.
// py: _SIGN = rf"[{_MINUS}+]"
export const SIGN = `[${MINUS}+]`;

// md2ui: detector_vocabulary._QUANTITY_UNITS
export const QUANTITY_UNITS =
  // py: r"units?|items?|pieces?|kg|g|mg|lb|lbs|oz|km|m|cm|mm|mi|miles?"
  "units?|items?|pieces?|kg|g|mg|lb|lbs|oz|km|m|cm|mm|mi|miles?" +
  // py: r"|ft|feet|inch|inches|in|l|ml|gal|gallons?|hrs?|hours?|mins?"
  "|ft|feet|inch|inches|in|l|ml|gal|gallons?|hrs?|hours?|mins?" +
  // py: r"|minutes?|secs?|seconds?|days?|weeks?|months?|years?|people|persons?"
  "|minutes?|secs?|seconds?|days?|weeks?|months?|years?|people|persons?" +
  // py: r"|users?|customers?|employees?|transactions?|kcal|sessions?"
  "|users?|customers?|employees?|transactions?|kcal|sessions?" +
  // py: r"|barrels?|bbl|tons?|tonnes?|shares?|sqft|acres?|kwh|mwh|bushels?|points?"
  "|barrels?|bbl|tons?|tonnes?|shares?|sqft|acres?|kwh|mwh|bushels?|points?";

// md2ui: detector_vocabulary._DIMENSION_UNITS
// py: r"cm|mm|m|km|in|inch|inches|ft|feet|px|pixels?|mi|miles?|yd|yards?"
export const DIMENSION_UNITS = "cm|mm|m|km|in|inch|inches|ft|feet|px|pixels?|mi|miles?|yd|yards?";

// md2ui: detector_vocabulary._MONTH_NAMES_LONG
export const MONTH_NAMES_LONG =
  // py: r"January|February|March|April|May|June"
  "January|February|March|April|May|June" +
  // py: r"|July|August|September|October|November|December"
  "|July|August|September|October|November|December";

// md2ui: detector_vocabulary._MONTH_NAMES_SHORT
// py: r"Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec"
export const MONTH_NAMES_SHORT = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec";

// md2ui: detector_vocabulary._ORDINAL_SUFFIX
// py: r"st|nd|rd|th"
export const ORDINAL_SUFFIX = "st|nd|rd|th";

// md2ui: detector_vocabulary._DATE_CHIP_JOIN. What joins a month or weekday to its
// day-of-month: a space is prose, a dash is the author's request for the chip.
// py: r"[ \-]"
export const DATE_CHIP_JOIN = String.raw`[ \-]`;

// md2ui: detector_vocabulary._CURRENCY_SYMBOLS
// py: r"[$€£¥]"
export const CURRENCY_SYMBOLS = "[$€£¥]";

// md2ui: detector_vocabulary._RANGE_OP
// py: r"[-–to]+"
export const RANGE_OP = "[-–to]+";

// md2ui: detector_vocabulary._SPEED_UNITS
// py: r"mph|km/h|kmh|kph|m/s|ft/s"
export const SPEED_UNITS = "mph|km/h|kmh|kph|m/s|ft/s";

// md2ui: detector_vocabulary._MONTH_NAMES
// py: rf"(?:{_MONTH_NAMES_LONG}|{_MONTH_NAMES_SHORT})"
export const MONTH_NAMES = `(?:${MONTH_NAMES_LONG}|${MONTH_NAMES_SHORT})`;

// md2ui: detector_vocabulary._DAY_NAMES_RE
export const DAY_NAMES_RE =
  // py: r"(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|"
  "(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|" +
  // py: r"Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\.?"
  String.raw`Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\.?`;

// md2ui: detector_vocabulary._DURATION_UNIT_SECONDS
export const DURATION_UNIT_SECONDS: Readonly<Record<string, number>> = Object.freeze({
  w: 604800,
  week: 604800,
  d: 86400,
  day: 86400,
  h: 3600,
  hr: 3600,
  hour: 3600,
  m: 60,
  min: 60,
  minute: 60,
  s: 1,
  sec: 1,
  second: 1,
});

// md2ui: detector_vocabulary._SYMBOL_CURRENCY
export const SYMBOL_CURRENCY: Readonly<Record<string, string>> = Object.freeze({
  $: "USD",
  "€": "EUR",
  "£": "GBP",
  "¥": "JPY",
});

// md2ui: detector_vocabulary._MAGNITUDE
export const MAGNITUDE: Readonly<Record<string, bigint>> = Object.freeze({
  K: 1_000n,
  M: 1_000_000n,
  B: 1_000_000_000n,
  T: 1_000_000_000_000n,
});
