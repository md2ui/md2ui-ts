// Python's `int()` and `Decimal()` on the text a pattern matched (ADR-002).
//
// Both accept every Unicode decimal digit (`int("٣")` is 3), and md2ui's `\d` matches
// them, so a match can hold them. A `Decimal` crosses into the AST as `float(Decimal)`,
// so a JavaScript number is its stored form; `Number` of the decimal text rounds the
// same way `float(Decimal(text))` does. Each strips Python's white space, not
// JavaScript's `trim()` set (`str.ts`).

import { asciiDigits, numberStrip, strip } from "./str.ts";

/** Python's `ValueError`: what a detector parser raises for "this match is not a value". */
export class ValueError extends Error {}

/** `int(text)` for decimal digits. */
export function pyInt(text: string): number {
  const digits = asciiDigits(numberStrip(text));
  if (!/^[+-]?[0-9]+$/.test(digits)) throw new ValueError(`invalid literal for int(): ${text}`);
  return Number(digits);
}

/** `float(Decimal(text))`. */
export function decimal(text: string): number {
  const digits = asciiDigits(strip(text));
  if (!/^[+-]?(?:[0-9]+\.?[0-9]*|\.[0-9]+)$/.test(digits)) {
    throw new ValueError(`invalid decimal literal: ${text}`);
  }
  return Number(digits);
}

/** `float(Decimal(text) * factor)`, the product exact before it rounds to a float. */
export function decimalTimes(text: string, factor: bigint): number {
  const [whole = "", fraction = ""] = asciiDigits(strip(text)).split(".");
  if (!/^[0-9]+$/.test(whole + fraction)) throw new ValueError(`invalid decimal literal: ${text}`);
  const product = (BigInt(whole + fraction) * factor).toString().padStart(fraction.length + 1, "0");
  const point = product.length - fraction.length;
  return Number(`${product.slice(0, point)}.${product.slice(point)}`.replace(/\.$/, ""));
}
