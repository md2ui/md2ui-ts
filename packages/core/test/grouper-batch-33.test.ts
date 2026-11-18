// In the grouper's kind tolerance, a line of buttons reads as one kind whatever its count, and
// a lone button against such a line costs nothing, so cards that differ only by how many
// buttons they end in share a run. Expected values are md2ui's own tests
// (markdown_kind_line_tolerance_tests); these run without fixtures.
import { expect, test } from "vitest";
import { groupDocument } from "../src/group/grouper.ts";
import { lineKindHash } from "../src/group/kinds.ts";
import type { GroupNode } from "../src/group/node.ts";

const runSizes = (section: GroupNode): number[] =>
  [...(section.repeated_children?.values() ?? [])].map((r) => r.length);
const section = (doc: string): GroupNode => groupDocument(doc).children[0] as GroupNode;

// md2ui: _link_cards. Three cards whose second line is a bare link, the middle one's varied.
function linkCards(middle: string): string {
  const cards = [
    ["Alpha", "[Docs](/docs)"],
    ["Beta", middle],
    ["Gamma", "[Docs](/docs)"],
  ].map(([title, line]) => `### ${title}\n${line}\nA short description of it\n`);
  return `## Cards\n\n${cards.join("\n")}`;
}

// md2ui: _song_cards. Three song cards ending in a Save button; the middle one's last line varied.
function songCards(middleLast: string): string {
  const save = "[💾 Save](agent:save)";
  const cards = [
    ["Starman", "David Bowie · 4:14", save],
    ["Under Pressure", "Queen · 4:08", middleLast],
    ["The Chain", "Fleetwood Mac · 4:29", save],
  ].map(([title, detail, last]) => `### ${title}\n_${detail}_\n\n${last}\n`);
  return `## Songs\n\n${cards.join("\n")}`;
}

// md2ui: the finding's probe (findings/button-count-across-unlike-tiles), also the corpus
// sample tests-button-count-tiles.md.
const OFFER_AND_INVITE = `## Reduce your card payment with MSI

Pay your purchases in interest-free months.

[See MSI options](agent:open?item=msi) *[Dismiss](agent:dismiss?id=msi)*

## Invite a friend

Earn $8,888 for each friend who joins.

[Invite a friend](agent:invite)
`;

// md2ui: test_button_count_never_splits_a_run
test("cards differing only by their button count share a run", () => {
  const doc = groupDocument(OFFER_AND_INVITE);
  expect(runSizes(doc)).toEqual([2]);
  expect(runSizes(section(linkCards("[Docs](/docs) [API](/api)")))).toEqual([3]);
});

// md2ui: test_button_lines_read_alike_whatever_their_count
test("a button line reads alike at any count, and a lone button with it", () => {
  const two = section(songCards("[▶ Play](agent:play) *[💾 Save](agent:save)*"));
  const three = section(
    songCards("[▶ Play](agent:play) *[💾 Save](agent:save)* **[Share](agent:share)**"),
  );
  const lastLine = (s: GroupNode): GroupNode => s.children[2]?.children.at(-1) as GroupNode;
  const [twoLine, threeLine] = [lastLine(two), lastLine(three)];
  expect([twoLine.line_split_group, threeLine.line_split_group]).toEqual([true, true]);
  expect(lineKindHash(twoLine, new Map())).toBe(lineKindHash(threeLine, new Map()));
  // A lone button of another variant among two-button cards costs nothing.
  expect(runSizes(two)).toEqual([3]);
  expect(runSizes(three)).toEqual([3]);
});

// md2ui: test_text_link_line_runs_with_button_lines. A line of Text links
// (`` [`Pill`](/x) ``) is a button line too: only the "buttons" kind makes it read as one
// with a line of plain buttons, whose link children hash apart from its own, so the three
// lines are one run.
test("a line of Text links runs with lines of plain buttons", () => {
  const doc = `## Buttons

[Primary](/link) [❤️ Primary](/link) [❤️](/link)

**[Secondary](/link)** **[❤️ Secondary](/link)** **[❤️](/link)**

[\`Pill\`](/link) [\`❤️ Pill\`](/link) [\`❤️\`](/link)
`;
  const buttons = section(doc);
  const lines = buttons.children.filter((c) => c.line_split_group);
  expect(lines, "fixture drift").toHaveLength(3);
  const [plain, , pills] = lines as [GroupNode, GroupNode, GroupNode];
  expect(lineKindHash(pills, new Map()), "a pill line is a button line").toBe(
    lineKindHash(plain, new Map()),
  );
  expect(runSizes(buttons)).toEqual([3]);
});

// md2ui: test_lone_link_keeps_its_kind_beside_a_chip. The save link sits in the picture's
// overlay beside a chip on one line, or above the chip on its own: one edit, one run.
test("an overlay's lone link still matches a chip-badged link line", () => {
  const stays = `## Stays

###
![
\`Guest favourite\` ... _[🤍](agent:save?id=1)_
+++++
](https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=800)
**Flat in the centre**
_6–8 Nov_

###
![
... _[🤍](agent:save?id=4)_
\`Guest favourite\`
+++++
](https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?w=800)
**Condo in Zazil Ha**
_23–25 Oct_
`;
  expect(runSizes(section(stays))).toEqual([2]);
});

// md2ui: test_missing_button_line_still_costs_an_edit. The count is free; the line is not.
test("a card without its button line still pays one edit", () => {
  const offers = (second: string): GroupNode =>
    groupDocument(
      `## Offer\n\nA short description of it.\n\n[Open](agent:open) *[Dismiss](agent:dismiss)*\n\n${second}`,
    );
  expect(runSizes(offers("## Notice\n\nA short description of it.\n"))).toEqual([2]);
  expect(runSizes(offers("## Notice\n\nA short description of it.\n\nAnd a footnote.\n"))).toEqual(
    [],
  );
});
