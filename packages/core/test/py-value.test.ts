// `int()` and `Decimal()` strip Python's white space from a number's text, not
// JavaScript's `trim()` set: `int()` all of `str.isspace` but the separators
// U+001C-U+001F, `Decimal()` all of it, and neither U+FEFF, U+200B or U+180E.
import { expect, test } from "vitest";
import { decimal, decimalTimes, pyInt, ValueError } from "../src/group/py/value.ts";

/**
 * Per code point: `int(c + "12")`, `int("-7" + c)`, `float(Decimal(c + "1.5"))`,
 * `float(Decimal("1.5" + c))`, `float(Decimal(c + "2.5" + c) * 3)`; null where Python
 * raises. Every white-space code point, then U+FEFF, U+200B and U+180E. From Python
 * 3.14.4:
 *
 *   python3 -c 'import sys, json; from decimal import Decimal
 *   cs = sorted([c for c in range(sys.maxunicode + 1) if chr(c).isspace()] + [0xfeff, 0x200b, 0x180e])
 *   def run(f, s):
 *       try: return f(s)
 *       except Exception: return None
 *   print(json.dumps([[hex(c), run(int, chr(c) + "12"), run(int, "-7" + chr(c)),
 *       run(lambda s: float(Decimal(s)), chr(c) + "1.5"), run(lambda s: float(Decimal(s)), "1.5" + chr(c)),
 *       run(lambda s: float(Decimal(s) * 3), chr(c) + "2.5" + chr(c))] for c in cs]))'
 */
const PYTHON: [
  string,
  number | null,
  number | null,
  number | null,
  number | null,
  number | null,
][] = [
  ["0x9", 12, -7, 1.5, 1.5, 7.5],
  ["0xa", 12, -7, 1.5, 1.5, 7.5],
  ["0xb", 12, -7, 1.5, 1.5, 7.5],
  ["0xc", 12, -7, 1.5, 1.5, 7.5],
  ["0xd", 12, -7, 1.5, 1.5, 7.5],
  ["0x1c", null, null, 1.5, 1.5, 7.5],
  ["0x1d", null, null, 1.5, 1.5, 7.5],
  ["0x1e", null, null, 1.5, 1.5, 7.5],
  ["0x1f", null, null, 1.5, 1.5, 7.5],
  ["0x20", 12, -7, 1.5, 1.5, 7.5],
  ["0x85", 12, -7, 1.5, 1.5, 7.5],
  ["0xa0", 12, -7, 1.5, 1.5, 7.5],
  ["0x1680", 12, -7, 1.5, 1.5, 7.5],
  ["0x180e", null, null, null, null, null],
  ["0x2000", 12, -7, 1.5, 1.5, 7.5],
  ["0x2001", 12, -7, 1.5, 1.5, 7.5],
  ["0x2002", 12, -7, 1.5, 1.5, 7.5],
  ["0x2003", 12, -7, 1.5, 1.5, 7.5],
  ["0x2004", 12, -7, 1.5, 1.5, 7.5],
  ["0x2005", 12, -7, 1.5, 1.5, 7.5],
  ["0x2006", 12, -7, 1.5, 1.5, 7.5],
  ["0x2007", 12, -7, 1.5, 1.5, 7.5],
  ["0x2008", 12, -7, 1.5, 1.5, 7.5],
  ["0x2009", 12, -7, 1.5, 1.5, 7.5],
  ["0x200a", 12, -7, 1.5, 1.5, 7.5],
  ["0x200b", null, null, null, null, null],
  ["0x2028", 12, -7, 1.5, 1.5, 7.5],
  ["0x2029", 12, -7, 1.5, 1.5, 7.5],
  ["0x202f", 12, -7, 1.5, 1.5, 7.5],
  ["0x205f", 12, -7, 1.5, 1.5, 7.5],
  ["0x3000", 12, -7, 1.5, 1.5, 7.5],
  ["0xfeff", null, null, null, null, null],
];

/** `read(text)`, or null where it raises Python's `ValueError`. */
function orNull(read: () => number): number | null {
  try {
    return read();
  } catch (error) {
    if (error instanceof ValueError) return null;
    throw error;
  }
}

test("int() and Decimal() strip what Python strips around a number", () => {
  for (const [hex, intBefore, intAfter, decimalBefore, decimalAfter, times] of PYTHON) {
    const c = String.fromCodePoint(Number(hex));
    expect(
      orNull(() => pyInt(`${c}12`)),
      `int(${hex} 12)`,
    ).toBe(intBefore);
    expect(
      orNull(() => pyInt(`-7${c}`)),
      `int(-7 ${hex})`,
    ).toBe(intAfter);
    expect(
      orNull(() => decimal(`${c}1.5`)),
      `Decimal(${hex} 1.5)`,
    ).toBe(decimalBefore);
    expect(
      orNull(() => decimal(`1.5${c}`)),
      `Decimal(1.5 ${hex})`,
    ).toBe(decimalAfter);
    expect(
      orNull(() => decimalTimes(`${c}2.5${c}`, 3n)),
      `Decimal(${hex} 2.5 ${hex}) * 3`,
    ).toBe(times);
  }
});
