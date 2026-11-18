import { describe, expect, test } from "vitest";
import { PY_SPACE_RANGES } from "../src/group/py/re.ts";
import {
  firstInt,
  isspace,
  partition,
  pyFloat,
  split,
  splitlines,
  strip,
  toInt,
} from "../src/group/py/str.ts";

describe("Python white space", () => {
  test("strip, split and isspace agree on every code point of the one set", () => {
    for (const [lo, hi] of PY_SPACE_RANGES) {
      for (let code = lo; code <= hi; code += 1) {
        const c = String.fromCodePoint(code);
        expect(isspace(c), code.toString(16)).toBe(true);
        expect(strip(`${c}a${c}`), code.toString(16)).toBe("a");
        expect(split(`a${c}b`), code.toString(16)).toEqual(["a", "b"]);
      }
    }
  });

  test("U+FEFF, U+200B and U+180E are not white space", () => {
    for (const c of ["﻿", "​", "᠎"]) {
      expect(isspace(c)).toBe(false);
      expect(strip(`${c}a`)).toBe(`${c}a`);
    }
  });
});

describe("float()", () => {
  test("reads Python's literals", () => {
    expect(pyFloat("1_000.5")).toBe(1000.5);
    expect(pyFloat(" -.5e1 ")).toBe(-5);
    expect(pyFloat("٣.١")).toBe(3.1);
    expect(pyFloat("-Infinity")).toBe(Number.NEGATIVE_INFINITY);
    expect(pyFloat("nan")).toBeNaN();
    expect(pyFloat(true)).toBe(1);
  });

  test("returns null where Python raises", () => {
    for (const bad of ["", ".", "e5", ".e5", "1e", "1__0", "_1", "1_", "0x10", "infx"]) {
      expect(pyFloat(bad), bad).toBeNull();
    }
  });

  test("float strips white space but not the separators U+001C-U+001F that strip() does", () => {
    for (const c of ["\x1c", "\x1d", "\x1e", "\x1f"]) {
      expect(pyFloat(`1${c}`), `1+${c.charCodeAt(0)}`).toBeNull();
      expect(pyFloat(`${c}1`), `${c.charCodeAt(0)}+1`).toBeNull();
    }
    expect(pyFloat("1\x1b")).toBeNull();
    expect(pyFloat("\t\n\v\f\r 1\x85　")).toBe(1);
  });
});

describe("digits, partition, splitlines", () => {
  test("every script's digits read as 0-9", () => {
    expect(toInt("٠١٢٣")).toBe(123);
    expect(firstInt("ab ٤٢ cd 7")).toBe(42);
    expect(firstInt("none")).toBeUndefined();
  });

  test("partition", () => {
    expect(partition("a:b:c", ":")).toEqual(["a", true, "b:c"]);
    expect(partition("abc", ":")).toEqual(["abc", false, ""]);
  });

  test("splitlines breaks at Python's boundaries and drops one trailing empty line", () => {
    expect(splitlines("a\r\nb\x1cc d\n")).toEqual(["a", "b", "c", "d"]);
    expect(splitlines("")).toEqual([]);
  });
});
