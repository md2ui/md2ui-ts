// Which characters md2ui sends to the emoji face (md2ui tests/emoji_routing_tests.py
// and button_emoji_keys_tests.py `test_a_more_button_draws_its_icon`): the grouper's emoji
// pattern (`group/detect/vocabulary.ts`) and the measurer's runs (`measure/text-runs.ts`)
// are two copies of one list. md2ui pins both against Unicode's emoji-test.txt, which this
// repository does not carry; here the two copies are pinned to each other on every
// character the commit added, and on the cases md2ui names.
import type { TextEntry } from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { EMOJI_CHAR_PATTERN } from "../src/group/detect/vocabulary.ts";
import { groupDocument } from "../src/group/grouper.ts";
import { classifyLinkContent } from "../src/group/link-content.ts";
import type { GroupNode } from "../src/group/node.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { emojiRuns } from "../src/measure/text-runs.ts";
import { paintMarkdown } from "./scene-kit.ts";

const kit = new RegexKit();
const isEmoji = (text: string): boolean => kit.re(EMOJI_CHAR_PATTERN).fullmatch(text) !== null;
const oneEmojiRun = (text: string): boolean =>
  JSON.stringify(emojiRuns(text)) === JSON.stringify([[text, true]]);

// md2ui `_EMOJI_BY_DEFAULT` and `_EMOJI_WITH_SELECTOR`, as their characters.
const BY_DEFAULT = [
  0x1f004, 0x1f0cf, 0x1f18e, 0x1f191, 0x1f192, 0x1f193, 0x1f194, 0x1f195, 0x1f196, 0x1f197, 0x1f198,
  0x1f199, 0x1f19a, 0x1f201, 0x1f21a, 0x1f22f, 0x1f232, 0x1f233, 0x1f234, 0x1f235, 0x1f236, 0x1f238,
  0x1f239, 0x1f23a, 0x1f250, 0x1f251,
].map((cp) => String.fromCodePoint(cp));
const WITH_SELECTOR = [..."©®‼⁉™ℹⓂ⤴⤵〰〽㊗㊙", "🅰", "🅱", "🅾", "🅿", "🈂", "🈷"];
const ENGLAND = "\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}";

function leaves(node: GroupNode): GroupNode[] {
  return node.children.length === 0 ? [node] : node.children.flatMap(leaves);
}

describe("emoji routing", () => {
  it("an emoji-by-default symbol is an emoji to both, alone", () => {
    expect(BY_DEFAULT).toHaveLength(26);
    expect(BY_DEFAULT.filter((c) => !isEmoji(c))).toEqual([]);
    expect(BY_DEFAULT.filter((c) => !oneEmojiRun(c))).toEqual([]);
  });

  it("a text-default symbol is an emoji only with U+FE0F: © 2026 and Acme™ stay text", () => {
    expect(WITH_SELECTOR).toHaveLength(19);
    for (const c of WITH_SELECTOR) {
      expect(isEmoji(`${c}️`), c).toBe(true);
      expect(oneEmojiRun(`${c}️`), c).toBe(true);
      expect(kit.re(EMOJI_CHAR_PATTERN).search(c), c).toBeNull();
      expect(emojiRuns(c), c).toEqual([[c, false]]);
    }
    expect(emojiRuns("© 2026 Acme™ ℹ Notice").every(([, emoji]) => !emoji)).toBe(true);
    expect(emojiRuns("Acme ©️")).toEqual([
      ["Acme ", false],
      ["©️", true],
    ]);
  });

  it("a tag flag is one emoji: one badge on its own line", () => {
    expect(isEmoji(ENGLAND)).toBe(true);
    expect(oneEmojiRun(ENGLAND)).toBe(true);
    const found = leaves(groupDocument(`${ENGLAND}\n`)).map((n) => [
      n.type,
      n.content,
      n.emoji_kind,
    ]);
    expect(found).toEqual([["emoji", ENGLAND, "alone"]]);
  });
});

describe("a more button (… ⋯ ⋮)", () => {
  const textOf = (md: string): TextEntry[] =>
    paintMarkdown(md, "", 400).painted.list.entries.filter(
      (e): e is TextEntry => e.type === "text",
    );

  it("is an icon button whose mark draws in the emoji font first", () => {
    for (const mark of ["…", "⋯", "⋮"]) {
      expect(classifyLinkContent(kit, `[${mark}](/more)`).is_emoji, mark).toBe(true);
      const runs = textOf(`[${mark}](/more)`).flatMap((e) => e.runs);
      expect(runs.map((r) => r.text)).toEqual([mark]);
      expect(runs[0]?.font.families[0], mark).toBe("emoji");
    }
  });

  it("beside words, or in prose, the mark stays text", () => {
    expect(classifyLinkContent(kit, "[More …](/more)").is_emoji).toBe(false);
    const button = textOf("[More …](/more)").flatMap((e) => e.runs);
    expect(button.every((r) => r.font.families[0] !== "emoji")).toBe(true);
    const prose = textOf("Loading … please wait").flatMap((e) => e.runs);
    expect(prose.every((r) => r.font.families[0] !== "emoji")).toBe(true);
  });
});
