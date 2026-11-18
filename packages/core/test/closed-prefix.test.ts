// What a streaming view lays out (C6 `streaming`): the Markdown up to its last blank line
// outside a code fence. The block after it is still arriving and is held back.
import { expect, test } from "vitest";
import { closedPrefix, RegexKit } from "../src/index.ts";

const cut = (text: string): string => closedPrefix(new RegexKit(), text).prefix;

test("the open block after the last blank line is held back", () => {
  expect(cut("# Title\n\nFirst paragraph.\n\nSecond, still arr")).toBe(
    "# Title\n\nFirst paragraph.\n",
  );
  expect(cut("A paragraph that has not ended")).toBe("");
  expect(cut("A paragraph that has ended.\n\n")).toBe("A paragraph that has ended.\n");
  expect(cut("Spaces count as blank.\n  \t\nNext")).toBe("Spaces count as blank.\n");
});

test("a blank line inside a closed fence does not cut; one after it does", () => {
  const fenced = "Intro.\n\n```sh\na\n\nb\n```\n";
  expect(cut(`${fenced}Tail`)).toBe("Intro.\n");
  expect(cut(`${fenced}\nTail`)).toBe(fenced);
});

test("an unclosed fence holds back everything from its opening line", () => {
  expect(cut("Intro.\n\n```py\nx = 1\n\ny = 2\n")).toBe("Intro.\n");
  // A closing fence shorter than the opening one does not close it, as in the grouper.
  expect(cut("Intro.\n\n````\ncode\n```\n\nmore\n")).toBe("Intro.\n");
  expect(cut("Intro.\n\n~~~\ncode\n~~~\n\nmore")).toBe("Intro.\n\n~~~\ncode\n~~~\n");
});

/** Every prefix of `text`, scanned as a view streams it: each from the last one's resume. */
function streamed(text: string, step: number): { prefix: string; whole: string }[] {
  const kit = new RegexKit();
  const out: { prefix: string; whole: string }[] = [];
  let resume = 0;
  for (let end = step; end < text.length + step; end += step) {
    const shown = text.slice(0, Math.min(end, text.length));
    const closed = closedPrefix(kit, shown, resume);
    resume = closed.resume;
    out.push({ prefix: closed.prefix, whole: closedPrefix(new RegexKit(), shown).prefix });
  }
  return out;
}

test("a stream scanned from each delta's resume cuts where a whole scan does", () => {
  const text = [
    "# Title\n\nFirst paragraph.\n  \t\nSecond.\r\n\r\nThird\u2028still third.\n\n",
    "```py\nx = 1\n\ny = 2\n```\n\n- item\n\n    indented\n\n~~~~\n~~~\n\n~~~~\n\nTail\r",
    "\n\r\nEnd.\f\fLast",
  ].join("");
  for (const step of [1, 2, 3, 7]) {
    for (const { prefix, whole } of streamed(text, step)) expect(prefix).toBe(whole);
  }
});

test("a blank last line still being written is not resumed from", () => {
  const kit = new RegexKit();
  // The spaces may become text: the next delta is scanned from where this one was.
  const open = closedPrefix(kit, "One.\n\nTwo.\n  ");
  expect(open.prefix).toBe("One.\n\nTwo.\n");
  expect(open.resume).toBe(0);
  expect(closedPrefix(kit, "One.\n\nTwo.\n  and more", open.resume).prefix).toBe("One.\n");
  // Ended by its line break, the blank line is a cut the stream can start from.
  const ended = closedPrefix(kit, "One.\n\nTwo.\n  \n");
  expect(ended.resume).toBe("One.\n\nTwo.\n".length);
});
