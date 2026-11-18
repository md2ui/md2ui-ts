// Signs, fractions and chart values in the grouper and the detector: the typographic minus
// U+2212 reads as negative beside the ASCII hyphen, and a sign written right before an
// amount, a count or a temperature belongs to it; a score fraction reads a decimal
// maximum whole (`0.8/1.5`); a chart's value is a number in one declared unit
// (ADR-204: `Storage (GB):`); and a list of `Key: a → b → c` chains is one chart of
// several lines on one axis. Expected values are md2ui's own tests; these run without
// fixtures.
import { expect, test } from "vitest";
import { detectDataPoints } from "../src/group/detect/detector.ts";
import { takeSign } from "../src/group/detect/signs.ts";
import {
  asDict,
  type DataPointType,
  type DataPointValue,
  type DetectedPoint,
} from "../src/group/detect/types.ts";
import { groupDocument } from "../src/group/grouper.ts";
import type { GroupNode } from "../src/group/node.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { declaredUnit } from "../src/group/value-format.ts";

const kit = new RegexKit();

function nodes(root: GroupNode): GroupNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

// --- the detector ------------------------------------------------------------------------

function only(text: string): DetectedPoint {
  const found = detectDataPoints(text);
  expect(
    found.map((r) => [r.type, r.matched]),
    text,
  ).toHaveLength(1);
  return found[0] as DetectedPoint;
}

/** A value's number, whether the detector gave it bare or as a dict's `key`. */
function amount(value: DataPointValue, key = "value"): number {
  const dict = asDict(value);
  return Number(dict === null ? value : dict[key]);
}

function field(point: DetectedPoint, key: string): DataPointValue | undefined {
  return asDict(point.value)?.[key];
}

function assertNegative(text: string, type: DataPointType, expected: number): void {
  const r = only(text);
  expect(r.type, text).toBe(type);
  expect(r.matched.startsWith("−"), `${text}: sign left out of ${r.matched}`).toBe(true);
  expect(amount(r.value), text).toBe(expected);
}

function assertSigned(
  text: string,
  type: DataPointType,
  expected: number,
  fields: Record<string, DataPointValue> = {},
): void {
  const r = only(text);
  expect(r.type, `${text}: ${r.matched}`).toBe(type);
  expect(r.matched, text).toBe(text.split(": ").at(-1));
  expect(amount(r.value), text).toBe(expected);
  for (const [key, want] of Object.entries(fields)) {
    expect(field(r, key), `${text}: ${key}`).toBe(want);
  }
}

// md2ui data_point_detector_minus_sign_tests: test_a_percentage_keeps_its_typographic_minus
test("a percentage keeps its typographic minus", () => {
  assertNegative("−1.55%", "percentage", -1.55);
  assertNegative("−12%", "percentage", -12);
});

// md2ui data_point_detector_minus_sign_tests: test_signed_changes_keep_their_typographic_minus
test("signed changes keep their typographic minus", () => {
  assertNegative("−5% decrease", "change", -5);
  assertNegative("−$120.00", "change", -120);
  assertNegative("−3 points", "change", -3);
  assertNegative("−2.5", "change", -2.5);
});

// md2ui data_point_detector_minus_sign_tests: test_both_minuses_read_the_same
test("both minuses read the same", () => {
  for (const asciiText of ["-1.55%", "-$120.00", "-3 points", "-2.5"]) {
    const a = only(asciiText);
    const b = only(asciiText.replace("-", "−"));
    expect([a.type, a.value], asciiText).toEqual([b.type, b.value]);
  }
});

// md2ui data_point_detector_minus_sign_tests: test_a_signed_amount_is_a_change_in_its_own_currency
test("a signed amount is a change in its own currency", () => {
  assertSigned("Refund: -€200", "change", -200, { currency: "EUR" });
  assertSigned("Refund: −£50", "change", -50, { currency: "GBP" });
  assertSigned("Refund: -200 EUR", "change", -200, { currency: "EUR" });
  assertSigned("Refund: -200€", "change", -200, { currency: "EUR" });
  assertSigned("Gain: +€200", "change", 200, { direction: "increase" });
});

// md2ui data_point_detector_minus_sign_tests: test_a_signed_magnitude_keeps_its_magnitude
test("a signed magnitude keeps its magnitude", () => {
  assertSigned("Loss: -$5K", "change", -5000, { currency: "USD" });
  assertSigned("Loss: -$1.2M", "change", -1200000);
});

// md2ui data_point_detector_minus_sign_tests: test_a_signed_grouped_number_is_a_change
test("a signed grouped number is a change", () => {
  assertSigned("Net: -1,234", "change", -1234, { type: "bare" });
  assertSigned("Net: -4,783.45", "change", -4783.45, { type: "bare" });
});

// md2ui data_point_detector_minus_sign_tests: test_a_signed_temperature_stays_a_temperature
test("a signed temperature stays a temperature", () => {
  assertSigned("Low: -5°C", "measurement", -5, { unit: "C" });
  assertSigned("Low: −5 °C", "measurement", -5, { unit: "C" });
});

// md2ui data_point_detector_minus_sign_tests: test_a_hyphen_after_a_word_or_digit_is_not_a_sign
test("a hyphen after a word or digit is not a sign", () => {
  expect(only("A-€5").matched).toBe("€5");
  expect(only("$10-$20").type).toBe("range");
});

// md2ui data_point_detector_minus_sign_tests: test_take_sign_declines_what_a_sign_does_not_change
test("takeSign declines what a sign does not change", () => {
  // A height is not signed, and a sign after a letter is a hyphen.
  const height: DetectedPoint = {
    type: "measurement",
    matched: "6 ft",
    value: { value: 6, measurement_type: "height" },
    start: 1,
    end: 5,
    is_approximate: false,
  };
  expect(takeSign(height, "-6 ft")).toBeNull();
  const euro: DetectedPoint = {
    type: "currency",
    matched: "€5",
    value: { amount: 5, currency: "EUR" },
    start: 2,
    end: 4,
    is_approximate: false,
  };
  expect(takeSign(euro, "A-€5")).toBeNull();
  const signed = takeSign({ ...euro, start: 1, end: 3 }, "-€5");
  expect(signed).not.toBeNull();
  expect(signed?.start).toBe(0);
  expect(signed?.matched).toBe("-€5");
});

// --- a score fraction ------------------------------------------------------------------

function score(text: string): DetectedPoint {
  const found = detectDataPoints(text).filter((r) => r.type === "score");
  expect(
    found.map((r) => r.matched),
    text,
  ).toHaveLength(1);
  return found[0] as DetectedPoint;
}

// md2ui data_point_detector_score_fraction_tests: test_a_decimal_maximum_is_read_whole
test("a decimal maximum is read whole", () => {
  const r = score("Backup: 0.8/1.5 TB");
  expect(r.matched).toBe("0.8/1.5");
  expect(field(r, "score")).toBe(0.8);
  expect(field(r, "max")).toBe(1.5);
});

// md2ui data_point_detector_score_fraction_tests: test_a_maximum_below_one_is_not_zero
test("a maximum below one is not zero", () => {
  expect(field(score("Load: 0.3/0.5"), "max")).toBe(0.5);
});

// md2ui data_point_detector_score_fraction_tests: test_whole_maximums_are_unchanged
test("whole maximums are unchanged", () => {
  expect(field(score("Disk: 61/128 GB"), "max")).toBe(128);
  expect(field(score("4.8/5.0 stars"), "max")).toBe(5);
});

// --- several lines on one axis (line_group) --------------------------------------------

const FUNDS =
  "- SPY: $718.66 (Apr) → $756.48 → $767.87 (Now)\n" +
  "- QQQ: $667.74 → $738.31 → $728.08\n" +
  "- DIA: $496.65 → $510.78 → $513.86\n";
const DECLARED = "Price (USD):\n- SPY: 718 → 756 → 767\n- DIA: 496 → 510 → 513\n";

const lineGroups = (text: string): GroupNode[] =>
  nodes(groupDocument(text)).filter((n) => n.line_group);

interface Series {
  readonly name: string;
  readonly points: readonly { readonly value: number }[];
}

// md2ui line_group_tests: test_a_list_of_chains_is_one_group
test("a list of chains is one group", () => {
  const groups = lineGroups(FUNDS);
  expect(groups).toHaveLength(1);
  const group = groups[0] as GroupNode;
  const data = group.line_data;
  const series = (data?.series ?? []) as unknown as Series[];
  expect(series.map((s) => s.name)).toEqual(["SPY", "QQQ", "DIA"]);
  expect(data?.labels, "a label names its position for all").toEqual(["Apr", null, "Now"]);
  expect(series[2]?.points.map((p) => p.value)).toEqual([496.65, 510.78, 513.86]);
  expect(
    nodes(group).some((n) => n.datapoint_display),
    "the rows' lines clear",
  ).toBe(false);
});

// md2ui line_group_tests: test_a_declared_unit_carries_down_the_run
test("a declared unit carries down the run", () => {
  const groups = lineGroups(DECLARED);
  expect(groups).toHaveLength(1);
  expect(groups[0]?.line_data?.series).toHaveLength(2);
  expect(groups[0]?.line_data?.display_unit).toBe("USD");
  expect(lineGroups(DECLARED.replace("Price (USD):", "Price:")), "bare numbers").toHaveLength(0);
});

// md2ui line_group_tests: test_what_stays_separate_lines
test("what stays separate lines", () => {
  const plain = FUNDS.replaceAll("- ", "");
  expect(lineGroups(plain.replaceAll("\n", "\n\n")), "plain lines, not list items").toHaveLength(0);
  const counts = FUNDS.replace(" → $510.78", "");
  expect(lineGroups(`${counts.split("\n").slice(1).join("\n")}- X: $1 → $2\n`)).toHaveLength(0);
  const clash = FUNDS.replace("$738.31", "$738.31 (May)").replace("$756.48", "$756.48 (Jun)");
  expect(lineGroups(clash), "two labels for one position").toHaveLength(0);
  const mixed = "- A: 10% → 20% → 30%\n- B: $1 → $2 → $3\n";
  expect(lineGroups(mixed), "two units").toHaveLength(0);
  expect(lineGroups("- SPY: $1 → $2 → $3\n"), "one line is a line").toHaveLength(0);
});

// md2ui line_group_tests: test_a_run_draws_whole_or_not_at_all (the grouper half)
test("a run draws whole or not at all", () => {
  const short = FUNDS.replace("$756.48 →", "$756.48 → $760.00 →");
  expect(lineGroups(short), "one line a point longer keeps every line apart").toHaveLength(0);
  const two = "- High (°C): 27 → 26 → 27\n- Wind (km/h): 15 → 6 → 6\n";
  expect(lineGroups(two), "two declared units are two axes").toHaveLength(0);
  const same = lineGroups("- High (°C): 27 → 26 → 27\n- Low (°C): 16 → 15 → 15\n");
  expect(same).toHaveLength(1);
  expect(same[0]?.line_data?.display_unit, "a unit each key declares").toBe("°C");
});

// md2ui line_group_tests: test_beside_bar_charts
test("lines beside bar charts", () => {
  const header = "SPY, QQQ:\n- SPY: $1 → $2 → $3\n- QQQ: $4 → $5 → $6\n";
  expect(lineGroups(header), "a comma line is no series header for lines").toHaveLength(1);
  expect(nodes(groupDocument(header)).some((n) => n.chart_group)).toBe(false);
  const mixed = "- A: $1 → $2 → $3\n- B: $4 → $5 → $6\n- CPU: 40%\n- RAM: 50%\n- Swap: 60%\n";
  const all = nodes(groupDocument(mixed));
  expect(all.filter((n) => n.line_group)).toHaveLength(1);
  expect(
    all.filter((n) => n.chart_group),
    "the bar rows stay a chart",
  ).toHaveLength(1);
});

// --- one line (datapoint_payload) ------------------------------------------------------

interface LinePoint {
  readonly value: number;
  readonly text: string;
  readonly tick: string | null;
}

const linePayloads = (text: string) =>
  nodes(groupDocument(text))
    .filter((n) => n.datapoint_display === "line_chart")
    .map((n) => n.datapoint_payload ?? {});

const points = (text: string): LinePoint[] | null => {
  const found = linePayloads(text);
  return found.length > 0 ? ((found[0] as { points: LinePoint[] }).points ?? null) : null;
};

// md2ui line_chart_tests: test_an_arrow_chain_of_one_unit_is_a_line
test("an arrow chain of one unit is a line", () => {
  const pts = points("Price: $710.14 → $713.94 → $720.65 → $777.24");
  expect(pts).not.toBeNull();
  expect(pts?.map((p) => p.value)).toEqual([710.14, 713.94, 720.65, 777.24]);
  expect(pts?.at(-1)?.text, "the value as written").toBe("$777.24");
});

// md2ui line_chart_tests: test_plain_numbers_and_magnitudes_share_one_kind
test("plain numbers and magnitudes share one kind", () => {
  expect(points("Users (count): 120 → 340 → 910")).not.toBeNull();
  expect(points("Users (count): 900 → 1.2K → 5K")).not.toBeNull();
  expect(points("Users: 5K → 7K → 9K"), "a magnitude stands alone").not.toBeNull();
});

// md2ui line_chart_tests: test_plain_numbers_need_a_declared_unit
test("plain numbers need a declared unit", () => {
  expect(points("Users: 120 → 340 → 910")).toBeNull();
  expect(points("Users: 900 → 1.2K → 5K")).toBeNull();
});

// md2ui line_chart_tests: test_a_unit_outside_the_inline_forms_is_declared
test("a unit outside the inline forms is declared", () => {
  expect(points("Weight: 82 kg → 80.5 kg → 79 kg")).toBeNull();
  expect(points("Weight (kg): 82 → 80.5 → 79")).not.toBeNull();
});

// md2ui line_chart_tests: test_ticks_are_words_or_a_date
test("ticks are words or a date", () => {
  const pts = points("SPY: $710.14 (Apr 13) → $713.94 → $720.65 (May) → $777.24 (Now)");
  expect(pts?.map((p) => p.tick)).toEqual(["Apr 13", null, "May", "Now"]);
});

// md2ui line_chart_tests: test_a_numeric_parenthesis_keeps_the_text
test("a numeric parenthesis keeps the text", () => {
  expect(points("Revenue: $412M (49%) → $430M → $450M")).toBeNull();
  expect(points("Price: $1 (1.2K) → $2 → $3")).toBeNull();
  expect(points("Price: $1 (+5) → $2 → $3")).toBeNull();
  expect(points("Price: $1 (5 kg) → $2 → $3")).toBeNull();
});

// md2ui line_chart_tests: test_a_label_with_a_digit_names_its_point
test("a label with a digit names its point", () => {
  const ticks = (text: string) => points(text)?.map((p) => p.tick);
  expect(ticks("Users (count): 900 (Q1) → 1.2K (Q2) → 3.4K (Q3)")).toEqual(["Q1", "Q2", "Q3"]);
  expect(ticks("Sales: $274.5B (FY2020) → $365.8B → $394.3B (FY2022)")).toEqual([
    "FY2020",
    null,
    "FY2022",
  ]);
  expect(ticks("Temp (°C): 26 (6 PM) → 25 → 21 (12 AM)")).toEqual(["6 PM", null, "12 AM"]);
  expect(ticks("Price: $1 (2025) → $2 → $3 (2027)")).toEqual(["2025", null, "2027"]);
});

// md2ui line_chart_tests: test_an_ascii_arrow_draws_no_line_and_check_says_so (the grouper half)
test("an ascii arrow draws no line", () => {
  expect(points("Price: $10 -> $12 -> $14")).toBeNull();
});

// md2ui line_chart_tests: test_mixed_units_keep_the_text
test("mixed units keep the text", () => {
  expect(points("Cost: $200 → 200 EUR → $210")).toBeNull();
  expect(points("Mix: 4% → $5 → 6%")).toBeNull();
});

// md2ui line_chart_tests: test_two_values_are_a_change_not_a_line
test("two values are a change, not a line", () => {
  expect(points("Price: $702 → $720")).toBeNull();
});

// md2ui line_chart_tests: test_an_ellipsis_or_words_keep_the_text
test("an ellipsis or words keep the text", () => {
  expect(points("Price: $702 → … → $720 → $730")).toBeNull();
  expect(points("State: registered → active → deprecated")).toBeNull();
  expect(points("Price: $702 → $715 → $720 and rising")).toBeNull();
});

// md2ui line_chart_tests: test_only_the_arrow_joins_a_chain
test("only the arrow joins a chain", () => {
  expect(points("Price: $702 -> $715 -> $720")).toBeNull();
  expect(points("Price: $702, $715, $720")).toBeNull();
});

// --- charts in one declared unit (ADR-204) -----------------------------------------------

interface ChartRow {
  readonly label: string;
  readonly values: readonly number[];
  readonly texts: readonly string[];
}

const charts = (text: string) =>
  nodes(groupDocument(text))
    .filter((n) => n.chart_group)
    .map((n) => n.chart_data as NonNullable<GroupNode["chart_data"]>);

const rowsOf = (chart: { rows?: unknown }) => chart.rows as ChartRow[];

const SPEND = "- Groceries: $220.06\n- Subscriptions: $29.97\n- Shopping: $297.26\n";

// md2ui chart_units_tests: test_a_run_in_one_currency_charts_as_written
test("a run in one currency charts as written", () => {
  const found = charts(SPEND);
  expect(found).toHaveLength(1);
  expect(found[0]?.unit).toBe("currency USD");
  expect(rowsOf(found[0] as object).map((r) => r.texts)).toEqual([
    ["$220.06"],
    ["$29.97"],
    ["$297.26"],
  ]);
});

// md2ui chart_units_tests: test_magnitudes_chart_as_written
test("magnitudes chart as written", () => {
  const found = charts("- A: 5K\n- B: 1.2K\n- C: 9K\n");
  expect(found).toHaveLength(1);
  expect(found[0]?.unit).toBe("magnitude");
});

// md2ui chart_units_tests: test_sizes_and_measurements_are_declared_not_written
test("sizes and measurements are declared, not written", () => {
  expect(charts("- A: 61 GB\n- B: 64 GB\n- C: 70 GB\n")).toHaveLength(0);
  expect(charts("- A: 12 kg\n- B: 14 kg\n- C: 9 kg\n")).toHaveLength(0);
  const found = charts("Storage (GB):\n- A: 61\n- B: 64\n- C: 70\n");
  expect(found).toHaveLength(1);
  expect(found[0]?.["display_unit"]).toBe("GB");
});

// md2ui chart_units_tests: test_a_unit_in_words_declares_and_one_too_long_is_named (the
// grouper half; `check` is md2ui's): a unit may be 32 characters (`value_format.MAX_UNIT`).
test("a unit in words declares; one over 32 characters, or on a line over six words, does not", () => {
  const rows = "- Apple: 52\n- Microsoft: 21\n- Nvidia: 310\n";
  const long = charts(`Average daily volume (millions of shares):\n${rows}`);
  expect(long.map((c) => c["display_unit"])).toEqual(["millions of shares"]);
  expect(charts(`Volume (millions of shares, rounded to the nearest whole):\n${rows}`)).toEqual([]);
  const wordy = "The average daily trading volume per company (millions of shares):";
  expect(charts(`${wordy}\n${rows}`)).toEqual([]);
});

// md2ui chart_units_tests: test_plain_numbers_and_magnitudes_are_one_kind_under_a_declared_unit
test("plain numbers and magnitudes are one kind under a declared unit", () => {
  expect(charts("- A: 900\n- B: 1.2K\n- C: 5K\n")).toHaveLength(0);
  const found = charts("Users (count):\n- A: 900\n- B: 1.2K\n- C: 5K\n");
  expect(found).toHaveLength(1);
  expect([found[0]?.unit, found[0]?.["display_unit"]]).toEqual(["", "count"]);
});

// md2ui chart_units_tests: test_check_is_quiet_on_the_rows_of_a_declared_chart (the grouper half)
test("a declared unit charts every row", () => {
  expect(charts("Followers (count):\n- Video: 12K\n- Photos: 4,800\n- Posts: 900K\n")).toHaveLength(
    1,
  );
});

// md2ui chart_units_tests: test_a_ring_takes_a_declared_unit
test("a ring takes a declared unit", () => {
  const rings = (text: string) =>
    nodes(groupDocument(text))
      .filter((n) => n.datapoint_display === "unit_ratio")
      .map((n) => n.datapoint_payload ?? {});
  const declared = rings("Disk (GB): 61/128\n");
  const inline = rings("Disk: 61/128 GB\n");
  expect(declared).toHaveLength(1);
  expect(inline).toHaveLength(1);
  const [d] = declared;
  expect([d?.value, d?.max, d?.unit]).toEqual([61, 128, "GB"]);
  expect(declared).toEqual(inline);
});

// md2ui chart_units_tests: test_percentages_keep_their_spelling
test("percentages keep their spelling", () => {
  const found = charts("- Mon: 2.10%\n- Tue: −1.55%\n- Wed: 40%\n");
  expect(found).toHaveLength(1);
  expect(rowsOf(found[0] as object).map((r) => r.texts[0])).toEqual(["2.10%", "−1.55%", "40%"]);
});

// md2ui chart_units_tests: test_plain_numbers_chart_only_under_a_declared_unit
test("plain numbers chart only under a declared unit", () => {
  expect(charts("- HTTP: 80\n- HTTPS: 443\n- SSH: 22\n")).toHaveLength(0);
});

// md2ui chart_units_tests: test_mixed_units_draw_no_chart
test("mixed units draw no chart", () => {
  expect(charts("- Food: $220\n- Rent: 900 EUR\n- Fun: $50\n")).toHaveLength(0);
});

// md2ui chart_units_tests: test_a_word_beside_a_value_keeps_the_row_out
test("a word beside a value keeps the row out", () => {
  const text = "- Mon: 90%\n- Tue: 85%\n- Wed: 60% (holiday)\n- Thu: 12%\n- Fri: 30%\n- Sat: 5%\n";
  const found = charts(text);
  expect(found).toHaveLength(1);
  expect(rowsOf(found[0] as object).map((r) => r.label)).toEqual(["Thu", "Fri", "Sat"]);
});

// md2ui chart_units_tests: test_a_plus_sign_keeps_a_value_in_its_unit
test("a plus sign keeps a value in its unit", () => {
  const found = charts("- Apr: +9.90%\n- May: +5.26%\n- Jun: -1.28%\n");
  expect(found).toHaveLength(1);
  expect(found[0]?.unit).toBe("%");
  const rows = rowsOf(found[0] as object);
  expect(rows.map((r) => r.values[0])).toEqual([9.9, 5.26, -1.28]);
  expect(rows.map((r) => r.texts[0])).toEqual(["+9.90%", "+5.26%", "-1.28%"]);
  const money = charts("- AAPL: +$0.30\n- MSFT: +$2.30\n- TSLA: -$2.80\n");
  expect(money).toHaveLength(1);
  expect(money[0]?.unit).toBe("currency USD");
  expect(rowsOf(money[0] as object).map((r) => r.values[0])).toEqual([0.3, 2.3, -2.8]);
});

// md2ui chart_units_tests: test_a_unit_is_declared_in_parentheses_without_digits
test("a unit is declared in parentheses without digits", () => {
  expect(declaredUnit(kit, "Temperature (°C)")).toBe("°C");
  expect(declaredUnit(kit, "High, Low (°C):")).toBe("°C");
  expect(declaredUnit(kit, "Heart rate (bpm)")).toBe("bpm");
  expect(declaredUnit(kit, "Results (2025)")).toBeNull();
  expect(declaredUnit(kit, "Temperature")).toBeNull();
});

// md2ui chart_units_tests: test_a_declared_unit_lets_bare_numbers_chart
test("a declared unit lets bare numbers chart", () => {
  const doc = "Temperature (°C):\n- Wed: 24\n- Thu: 23\n- Fri: 21\n";
  const found = charts(doc);
  expect(found).toHaveLength(1);
  expect([found[0]?.["display_unit"], found[0]?.unit]).toEqual(["°C", ""]);
  expect(rowsOf(found[0] as object).map((r) => r.texts[0])).toEqual(["24", "23", "21"]);
  expect(
    nodes(groupDocument(doc)).map((n) => n.content),
    "the header stays as written",
  ).toContain("Temperature (°C):");
});

// md2ui chart_units_tests: test_a_series_header_declares_the_unit_too
test("a series header declares the unit too", () => {
  const found = charts("High, Low (°C):\n- Wed: 24, 13\n- Thu: 23, 13\n");
  expect(found).toHaveLength(1);
  expect(found[0]?.series).toEqual(["High", "Low"]);
  expect(found[0]?.["display_unit"]).toBe("°C");
});

// md2ui chart_units_tests: test_without_a_declaration_bare_numbers_stay_a_list
test("without a declaration bare numbers stay a list", () => {
  expect(charts("Results (2025):\n- Wed: 24\n- Thu: 23\n- Fri: 21\n")).toHaveLength(0);
  expect(charts("- Wed: 24\n- Thu: 23\n- Fri: 21\n")).toHaveLength(0);
});

// md2ui chart_units_tests: test_a_line_key_declares_its_unit
test("a line key declares its unit", () => {
  const [payload] = linePayloads("High (°C): 24 (Wed) → 23 (Thu) → 21 (Fri)\n");
  expect(payload?.["display_unit"]).toBe("°C");
  const [priced] = linePayloads("Price ($): $710 → $713 → $720\n");
  expect(priced).toBeDefined();
  expect(priced, "values that carry a unit keep their own").not.toHaveProperty("display_unit");
});
