import { expect, test } from "vitest";
import { applicable, ruleApplicable } from "../src/group/split/criteria.ts";

// Expected answers were read from md2ui's SplitCriteria.applicable.
const names = (text: string) => [...applicable(text)].sort();

test("a dash line is a key-value candidate like any other", () => {
  expect(names("The lamp is fantastic - bright and sleek.")).toEqual(["KEY_VALUE"]);
  expect(names("Meet on Feb 28, 2020 - Room 5")).toEqual(["KEY_VALUE"]);
});

test("a comma list is structured", () => {
  expect(names("apples, pears, plums")).toEqual(["KEY_VALUE"]);
});

// md2ui grouper_split_criteria_tests: test_applicable_answers_key_value_by_its_rules
test("KEY_VALUE is answered by its rules", () => {
  expect(names("**Key:** value")).toEqual(["KEY_VALUE"]);
  expect(names("**Key:** value, with commas.")).toEqual(["KEY_VALUE"]);
  expect(names("Note: it crashed - really.")).toEqual(["KEY_VALUE"]);
});

test("ELEMENT is only answered when the caller asks", () => {
  expect([...ruleApplicable(null)]).toEqual([]);
  expect([...ruleApplicable(false)]).toEqual(["ELEMENT"]);
  expect([...ruleApplicable(true)]).toEqual([]);
});

test("a comma sentence is prose: no KEY_VALUE", () => {
  expect(names("I bought apples, pears, and plums.")).toEqual([]);
});
