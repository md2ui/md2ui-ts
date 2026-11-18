// `## Motion`, md2ui-ts's own block (motion keys are TS-first): it
// reads with the parser's conventions, and md2ui has no measurement to match. The
// easing's syntax is the browser's to judge (`dom/test/live.browser.test.ts`).
import { expect, test } from "vitest";
import { parseTheme } from "../src/index.ts";

const motion = (text: string) => parseTheme(`## Motion\n${text}`).motion;

test("with no ## Motion, a tween is 220 ms on cubic-bezier(0.2, 0, 0, 1)", () => {
  expect(parseTheme("").motion).toEqual({ duration: 220, easing: "cubic-bezier(0.2, 0, 0, 1)" });
});

test("Duration and Easing read in any case; the easing is kept as written", () => {
  expect(motion("duration: 300\nEASING:  Ease-Out \n")).toEqual({
    duration: 300,
    easing: "Ease-Out",
  });
  expect(parseTheme("## MOTION\nDuration: 120.5\n").motion.duration).toBe(120.5);
});

test("Duration: 0 turns motion off", () => {
  expect(motion("Duration: 0").duration).toBe(0);
});

test("a Duration that is not a finite, non-negative number of ms keeps the value before it", () => {
  for (const bad of ["-1", "inf", "nan", "220ms", "0.2s", "fast", ""]) {
    expect(motion(`Duration: 400\nDuration: ${bad}`).duration).toBe(400);
  }
  expect(motion("Duration: -5").duration).toBe(220);
});

test("an empty Easing keeps the value before it; unknown keys and bullets are ignored", () => {
  const m = motion("Easing: linear\nEasing:\nDelay: 50\n- Duration: 9\nDuration\n");
  expect(m).toEqual({ duration: 220, easing: "linear" });
  expect(m).not.toHaveProperty("delay");
});

test("## Motion changes nothing else, and other blocks never set it", () => {
  const { motion: _base, ...rest } = parseTheme("## Root\nPadding: 4\n");
  const { motion: set, ...restWith } = parseTheme(
    "## Motion\nDuration: 90\n## Root\nPadding: 4\nDuration: 5\nEasing: linear\n",
  );
  expect(restWith).toEqual(rest);
  expect(set).toEqual({ duration: 90, easing: "cubic-bezier(0.2, 0, 0, 1)" });
});
