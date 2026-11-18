// Python's float arithmetic where it differs from JavaScript's (ADR-002): the layout
// generator compares costs and widths exactly, so a last-bit difference can flip an
// arrangement.

/**
 * `round(x)` with no digits: the nearest integer, a tie going to the even one
 * (`round(2.5)` is 2, where `Math.round` gives 3).
 */
export function pyRound(x: number): number {
  const floor = Math.floor(x);
  const diff = x - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * `sum(values)` over floats: since Python 3.12, compensated (Neumaier), so it can
 * differ in the last bit from adding left to right.
 */
export function pySum(values: Iterable<number>): number {
  let hi = 0;
  let lo = 0;
  for (const x of values) {
    const t = hi + x;
    if (Math.abs(hi) >= Math.abs(x)) lo += hi - t + x;
    else lo += x - t + hi;
    hi = t;
  }
  return lo !== 0 && Number.isFinite(lo) ? hi + lo : hi;
}

/** `max(a, b)`: `b` only when it is greater, so a NaN `b` never wins. */
export function pyMax(a: number, b: number): number {
  return b > a ? b : a;
}

/** `min(a, b)`: `b` only when it is less, so a NaN `b` never wins. */
export function pyMin(a: number, b: number): number {
  return b < a ? b : a;
}
