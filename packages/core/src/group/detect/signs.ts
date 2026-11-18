// A sign written right before a value belongs to it (md2ui: pipeline/detector_signs.py).
//
// `-€200`, `-$5K`, `-1,234` and `-5°C` are found by patterns that know nothing of a
// sign, so the sign is given back once, for every pattern, instead of a sign class in
// each of them. What the sign makes of a value is a decision about meaning: a signed
// amount or count is a change, a signed temperature is still a level.

import { charBefore, isalnum } from "../py/str.ts";
import { asDict, type DataPointType, type DataPointValue, type DetectedPoint } from "./types.ts";
import { MINUS } from "./vocabulary.ts";

/**
 * md2ui: `_signed_value`. What a sign makes of a value, or null when it changes
 * nothing: a currency or a number becomes a change (what the `change up|down` pins
 * colour), a temperature keeps its type and takes the sign.
 */
function signedValue(
  type: DataPointType,
  value: DataPointValue,
  sign: string,
): [DataPointType, DataPointValue] | null {
  const negative = MINUS.includes(sign);
  const direction = negative ? "decrease" : "increase";
  const dict = asDict(value);
  if (type === "currency" && dict !== null) {
    const amount = Number(dict["amount"]);
    return [
      "change",
      {
        value: negative ? -amount : amount,
        currency: dict["currency"] ?? null,
        direction,
        type: "currency",
      },
    ];
  }
  if (type === "number") {
    const amount = Number(dict === null ? value : dict["value"]);
    return ["change", { value: negative ? -amount : amount, direction, type: "bare" }];
  }
  if (
    type === "measurement" &&
    dict !== null &&
    dict["measurement_type"] === "temperature" &&
    !("alt_value" in dict)
  ) {
    const level = Number(dict["value"]);
    return [type, { ...dict, value: negative ? -level : level }];
  }
  return null;
}

/** md2ui: `take_sign`. `point` with the sign written right before it, or null. */
export function takeSign(point: DetectedPoint, text: string): DetectedPoint | null {
  const { start } = point;
  const sign = start > 0 ? text.charAt(start - 1) : "";
  if (sign !== "+" && !(sign !== "" && MINUS.includes(sign))) return null;
  const before = charBefore(text, start - 1);
  if (isalnum(before) || before === "_") return null;
  const signed = signedValue(point.type, point.value, sign);
  if (signed === null) return null;
  return {
    ...point,
    type: signed[0],
    value: signed[1],
    matched: sign + point.matched,
    start: start - 1,
  };
}
