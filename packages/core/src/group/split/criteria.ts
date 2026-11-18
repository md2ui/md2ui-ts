// The structural criteria the grouper asks about a line, answered by rules
// (md2ui: pipeline/grouper_split_criteria.py).
//
// Each criterion is decided from characters so an author can predict it: the
// comma-list signals, the styled-key prefixes and the prose shapes. Where the
// key-value rules abstain, the text is structured.

import { compile, RegexKit } from "../py/re.ts";
import { isalpha, islower, isupper, rstrip, split, strip } from "../py/str.ts";

/** md2ui: `Criterion`, the independent structural questions. */
export type Criterion = "KEY_VALUE" | "ELEMENT";

// md2ui: _seg_first_alpha
function segFirstAlpha(seg: string): string | null {
  for (const c of seg) {
    if (isalpha(c)) return c;
  }
  return null;
}

// py: re.compile(r",\s+(and|or|but|nor|yet)\b", re.IGNORECASE)
const PROSE_CONNECTORS = compile(String.raw`,\s+(and|or|but|nor|yet)\b`, { i: true });
// py: re.compile(r"(?<!\.)\.\s+[A-Z]")
const SENTENCE_BOUNDARY_RE = compile(String.raw`(?<!\.)\.\s+[A-Z]`);
// py: (r"(?:January|February|March|April|May|June|July|August|"
// py:  r"September|October|November|December|Jan|Feb|Mar|Apr|"
// py:  r"Jun|Jul|Aug|Sep|Oct|Nov|Dec)")
const MONTH_NAMES =
  "(?:January|February|March|April|May|June|July|August|" +
  "September|October|November|December|Jan|Feb|Mar|Apr|" +
  "Jun|Jul|Aug|Sep|Oct|Nov|Dec)";
// py: re.compile(rf"^{_MONTH_NAMES}\s+\d+$", re.IGNORECASE)
const DATE_IN_SEG = compile(`^${MONTH_NAMES}\\s+\\d+$`, { i: true });
// py: (r"(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|"
// py:  r"Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\.?")
const DAY_NAMES =
  "(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|" +
  String.raw`Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)\.?`;
// Spans whose commas are not list separators: a date, a number, a bracketed span.
// py: re.compile(
// py:     r"\([^)]*\)|\[[^\]]*\]|\"[^\"]*\"|"
// py:     rf"{_DAY_NAMES},\s+{_MONTH_NAMES}(?:\s+\d{{1,2}})?|"
// py:     rf"{_MONTH_NAMES}\s+\d{{1,2}},\s*\d{{4}}|"
// py:     r"\d,\d{3}",
// py:     re.IGNORECASE,
// py: )
const NON_LIST_COMMA_SPAN = compile(
  String.raw`\([^)]*\)|\[[^\]]*\]|\"[^\"]*\"|` +
    `${DAY_NAMES},\\s+${MONTH_NAMES}(?:\\s+\\d{1,2})?|` +
    `${MONTH_NAMES}\\s+\\d{1,2},\\s*\\d{4}|` +
    String.raw`\d,\d{3}`,
  { i: true },
);
// A separator that carries real structure: a spaced `| - – — • :` or a `...` spring.
// py: re.compile(r"\S\s+[|\-–—•:]\s+\S|(?:^|\S\s)\.\.\.(?:\s\S|$)")
const STRUCTURAL_SEPARATOR = compile(String.raw`\S\s+[|\-–—•:]\s+\S|(?:^|\S\s)\.\.\.(?:\s\S|$)`);

/**
 * md2ui: `_rule_applicable`. ELEMENT owns the span-aware regular-text answer supplied
 * by its splitter (`null`: not asked). md2ui also passes the text, which no rule
 * reads any more.
 */
export function ruleApplicable(elementHasRegularText: boolean | null): ReadonlySet<Criterion> {
  const criteria = new Set<Criterion>();
  if (elementHasRegularText === false) criteria.add("ELEMENT");
  return criteria;
}

// md2ui: _mask_non_list_commas. Commas are BMP, so UTF-16 indices are safe.
function maskNonListCommas(kit: RegexKit, text: string): string {
  const chars = text.split("");
  for (const m of kit.re(NON_LIST_COMMA_SPAN).finditer(text)) {
    for (let i = m.start(); i < m.end(); i += 1) {
      if (chars[i] === ",") chars[i] = " ";
    }
  }
  return chars.join("");
}

// py: re.compile(
// py:     r"\b(in|at|on|from|for|with|until|after|before|about|"
// py:     r"around|during|through|into|onto|upon)\b",
// py:     re.IGNORECASE,
// py: )
const PREPOSITIONS = compile(
  String.raw`\b(in|at|on|from|for|with|until|after|before|about|` +
    String.raw`around|during|through|into|onto|upon)\b`,
  { i: true },
);
// py: re.search(r",?\s*etc\.?$", ..., re.IGNORECASE)
const TRAILING_ETC = compile(String.raw`,?\s*etc\.?$`, { i: true });
// py: re.search(r"[a-zA-Z]'[a-z]", text)
const CONTRACTION = compile("[a-zA-Z]'[a-z]");

// md2ui: CommaSignalRules.has_prose_signal. The unambiguous prose tells.
function hasProseSignal(kit: RegexKit, text: string, segs: readonly string[]): boolean {
  if (kit.re(PROSE_CONNECTORS).test(text)) return true;
  if (kit.re(TRAILING_ETC).test(rstrip(text))) return true;
  if (segs.some((seg) => kit.re(SENTENCE_BOUNDARY_RE).test(seg))) return true;
  if (kit.re(CONTRACTION).test(text)) return true;
  return rstrip(text).endsWith(".");
}

// md2ui: CommaSignalRules.verdict. 1 for structured content, 0 for prose.
function commaVerdict(kit: RegexKit, text: string, segs: readonly string[]): number {
  if (hasProseSignal(kit, text, segs)) return 0;
  if (segs.some((seg) => kit.re(DATE_IN_SEG).match(seg) !== null)) return 0;
  const first = segs[0] ?? "";
  if (split(first).length >= 2 && kit.re(PREPOSITIONS).test(first)) return 0;
  const alphaFirsts: string[] = [];
  for (const seg of segs) {
    const c = segFirstAlpha(seg);
    if (c !== null) alphaFirsts.push(c);
  }
  if (alphaFirsts.length > 0) {
    if (alphaFirsts.every((c) => isupper(c))) return 1;
    if (alphaFirsts.every((c) => islower(c))) return 1;
  }
  return 0;
}

// py: re.compile(r"^[^:\n]*[A-Za-z][^:\n]*:\s+\S")
const KV_PREFIX_CANDIDATE = compile(String.raw`^[^:\n]*[A-Za-z][^:\n]*:\s+\S`);
// py: re.compile(r"(?:^|[.]\s+)[^:\n]{1,40}:\s+\S")
const SENTENCE_LABEL = compile(String.raw`(?:^|[.]\s+)[^:\n]{1,40}:\s+\S`);

// md2ui: _is_labelled_paragraph. Several sentences, each opening with a label.
function isLabelledParagraph(kit: RegexKit, text: string): boolean {
  return (
    kit.re(SENTENCE_BOUNDARY_RE).test(text) && kit.re(SENTENCE_LABEL).findall(text).length >= 2
  );
}

// py: re.compile(r"(?:^|\s):[A-Za-z]")
const DETACHED_COLON = compile(String.raw`(?:^|\s):[A-Za-z]`);
// py: re.compile(r"\S \.\.\. [a-z].*[.!?]$")
const ELLIPSIS_PAUSE = compile(String.raw`\S \.\.\. [a-z].*[.!?]$`);
// py: re.compile(r"^[^.]*\w \.\.\.$")
const TRAILING_TRUNCATION = compile(String.raw`^[^.]*\w \.\.\.$`);

// md2ui: _prose_shape. 0 for one of the measured prose shapes, else null.
function proseShape(kit: RegexKit, text: string): number | null {
  const t = strip(text);
  if (!t.includes(": ") && kit.re(DETACHED_COLON).test(t)) return 0;
  // Each pattern's literal checked first: a regex scan of every text costs more than
  // the rare match.
  if (t.includes(" ... ") && kit.re(ELLIPSIS_PAUSE).test(t)) return 0;
  if (
    t.includes(" ...") &&
    kit.re(TRAILING_TRUNCATION).match(t) !== null &&
    !kit.re(STRUCTURAL_SEPARATOR).test([...t].slice(0, -4).join(""))
  ) {
    return 0;
  }
  return null;
}

// py: re.match(r"^\*\*[^*:]+:\*\*\s+\S", text) and its four styled-key siblings
const STYLED_KEYS = [
  compile(String.raw`^\*\*[^*:]+:\*\*\s+\S`),
  compile(String.raw`^\*\*\*(?!\s)[^*:]+:\*\*\*\s+\S`),
  compile(String.raw`^\*(?!\s)[^*:]+:\*\s+\S`),
  compile(String.raw`^__[^_:]+:__\s+\S`),
  compile(String.raw`^~~[^~:]+:~~\s+\S`),
] as const;
// py: re.sub(r"(\d),(\d{3})", r"\1\2", text)
const THOUSANDS_COMMA = compile(String.raw`(\d),(\d{3})`);

// md2ui: _shared_structural_rule (and _key_value_rule, which is it). null: abstain.
function keyValueRule(kit: RegexKit, text: string): number | null {
  if (STYLED_KEYS.some((rule) => kit.re(rule).match(text) !== null)) return 1;
  const prose = proseShape(kit, text);
  if (prose !== null) return prose;

  const textForSegs = kit.re(THOUSANDS_COMMA).sub(String.raw`\1\2`, text);
  const segs = textForSegs
    .split(",")
    .map((s) => strip(s))
    .filter((s) => s !== "");
  if (segs.length < 2) return null;

  if (
    kit.re(STRUCTURAL_SEPARATOR).test(text) &&
    maskNonListCommas(kit, textForSegs)
      .split(",")
      .filter((s) => strip(s) !== "").length < 2 &&
    !hasProseSignal(kit, text, segs)
  ) {
    return null;
  }

  const verdict = commaVerdict(kit, text, segs);
  if (
    verdict === 0 &&
    // Without a colon the pattern cannot match, and its scan backtracks quadratically.
    text.includes(":") &&
    kit.re(KV_PREFIX_CANDIDATE).match(text) !== null &&
    !isLabelledParagraph(kit, text)
  ) {
    return 1;
  }
  return verdict;
}

/**
 * md2ui: `SplitCriteria.applicable`. KEY_VALUE unless the rules say prose; ELEMENT is
 * never answered here, since this question carries no detector spans.
 */
export function applicable(text: string, kit: RegexKit = new RegexKit()): ReadonlySet<Criterion> {
  return new Set<Criterion>(keyValueRule(kit, text) !== 0 ? ["KEY_VALUE"] : []);
}
