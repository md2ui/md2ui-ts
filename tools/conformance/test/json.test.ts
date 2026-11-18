import { describe, expect, test } from "vitest";
import { parseJson } from "../src/json.ts";

describe("parseJson", () => {
  test("keeps a 19-digit integer exact as a bigint", () => {
    expect(parseJson("8150907237997192671")).toBe(8150907237997192671n);
    expect(parseJson('{"fingerprint_hash": -8150907237997192671}')).toEqual({
      fingerprint_hash: -8150907237997192671n,
    });
  });

  test("reads safe integers and floats as numbers", () => {
    expect(parseJson("[7, 1.5, 20.0, -3]")).toEqual([7, 1.5, 20, -3]);
    expect(typeof parseJson("20.0")).toBe("number");
  });
});
