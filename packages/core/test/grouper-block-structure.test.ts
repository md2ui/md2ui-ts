// What conformance does not say on its own: Python semantics the Phase 1 port relies
// on, at edges the corpus does not reach. Expected values were read from md2ui's
// Python (textwrap.dedent, int, markdown_grouper._scan_bracket_constructs).
import { expect, test } from "vitest";
import { scanBracketConstructs } from "../src/group/constructs.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { dedent, toInt } from "../src/group/py/str.ts";

const kit = new RegexKit();

test("dedent removes only the common margin, and blanks white-space-only lines", () => {
  expect(dedent(kit, "  a\n    b\n  \n  c")).toBe("a\n  b\n\nc");
  expect(dedent(kit, "    x\n  \t\n    y\n")).toBe("x\n\ny\n");
  expect(dedent(kit, " a\n\n b")).toBe("a\n\nb");
});

test("dedent treats a tab and spaces as different margins", () => {
  expect(dedent(kit, "\ta\n  b")).toBe("\ta\n  b");
});

test("a construct's 4000-character bound counts code points, not UTF-16 units", () => {
  const construct = (n: number): string => `[${"😀".repeat(n)}](/x)`;
  expect(scanBracketConstructs(kit, construct(3994))).toHaveLength(1);
  expect(scanBracketConstructs(kit, construct(3995))).toHaveLength(0);
});

test("an ordered item's number is read the way Python's int reads any script's digits", () => {
  expect(toInt("12")).toBe(12);
  expect(toInt("\u0663\u0664")).toBe(34); // Arabic-Indic
  expect(toInt("\u{1d7d7}")).toBe(9); // mathematical bold 9
});
