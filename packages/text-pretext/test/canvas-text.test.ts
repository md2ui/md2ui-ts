import type { FontSpec } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { authoredText, canvasText } from "../src/canvas-font.ts";

const VS15 = "\uFE0E";
const VS16 = "\uFE0F";
const ZWJ = "\u200D";

const font = (...families: string[]): FontSpec => ({
  families,
  size: 16,
  weight: 400,
  italic: false,
});
const named = font("OpenMoji", "Inter");
const generic = font("emoji", "Inter");

test("in a named face, VS16 is handed to the canvas as VS15", () => {
  expect(canvasText(`\u26A0${VS16}`, named)).toBe(`\u26A0${VS15}`);
  expect(canvasText(`ok \u2764${VS16} and \u2600${VS16}`, named)).toBe(
    `ok \u2764${VS15} and \u2600${VS15}`,
  );
});

test("the generic emoji family keeps VS16: colour is asked for there", () => {
  const text = `\u26A0${VS16}`;
  expect(canvasText(text, generic)).toBe(text);
});

test("VS15 and text with no selector pass unchanged", () => {
  expect(canvasText(`\u26A0${VS15}`, named)).toBe(`\u26A0${VS15}`);
  expect(canvasText("\u26A0 \u{1F680} plain", named)).toBe("\u26A0 \u{1F680} plain");
});

test("a ZWJ sequence keeps its joiner; only its VS16 is respelled", () => {
  const flag = `\u{1F3F3}${VS16}${ZWJ}\u{1F308}`;
  expect(canvasText(flag, named)).toBe(`\u{1F3F3}${VS15}${ZWJ}\u{1F308}`);
  const coder = `\u{1F468}${ZWJ}\u{1F4BB}`;
  expect(canvasText(coder, named)).toBe(coder);
});

test("no offset moves, and the authored spelling comes back", () => {
  const text = `a \u26A0${VS16} b \u{1F3F3}${VS16}${ZWJ}\u{1F308} c`;
  const sent = canvasText(text, named);
  expect(sent).toHaveLength(text.length);
  expect([...sent]).toHaveLength([...text].length);
  expect(authoredText(sent)).toBe(text);
  expect(authoredText(sent.slice(2, 4))).toBe(text.slice(2, 4));
});
