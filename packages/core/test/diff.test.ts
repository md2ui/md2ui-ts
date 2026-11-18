// The display-list diff by node id: a re-sent or streamed document is matched
// against the one shown, node by node, for the host to animate. Identical nodes are
// matched by position first (`alignNodeIds`), since an edit above them shifts the
// occurrence their ids end in (ADR-104).
import type { DisplayList } from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { alignNodeIds, diffDisplayLists, holderIds } from "../src/scene/diff.ts";
import { paintMarkdown } from "./scene-kit.ts";

const THEME = `## Drawing elements
### Task controls
Type: checkbox
Size: 20
### Checked inner
Background color: #4F9C6B
### Unchecked inner
Background color: #FDFDFD
`;

const listOf = (markdown: string, width = 800): DisplayList =>
  paintMarkdown(markdown, THEME, width).painted.list;

/** Paragraphs too long to sit side by side: the document is one column. */
const SECTIONS = ["One", "Two", "Three"].map(
  (name) => `${name}: ${"a paragraph long enough to fill the width of the page, ".repeat(4)}`,
);
const DOC = SECTIONS.join("\n\n");

describe("diffDisplayLists", () => {
  it("finds nothing between a list and itself", () => {
    const list = listOf(DOC);
    expect(diffDisplayLists(list, list)).toEqual({
      added: [],
      removed: [],
      moved: [],
      restyled: [],
    });
  });

  it("finds nothing between two renders of one document", () => {
    expect(diffDisplayLists(listOf(DOC), listOf(DOC))).toEqual({
      added: [],
      removed: [],
      moved: [],
      restyled: [],
    });
  });

  it("removes a block's nodes and moves the ones below it, unrestyled", () => {
    const before = listOf(DOC);
    const after = listOf([SECTIONS[0], SECTIONS[2]].join("\n\n"));
    const diff = diffDisplayLists(before, after);
    expect(diff.added).toEqual([]);
    expect(diff.removed.length).toBeGreaterThan(0);
    expect(diff.restyled).toEqual([]);
    expect(diff.moved.length).toBeGreaterThan(0);
    for (const { from, to } of diff.moved) {
      expect(to.y).toBeLessThan(from.y);
      expect(to.x).toBeCloseTo(from.x);
      expect(to.height).toBeCloseTo(from.height);
    }
    // The block above the removal neither moved nor changed.
    const [top] = after.entries.filter((e) => e.nodeId !== "");
    expect(diff.moved.map((m) => m.nodeId)).not.toContain(top?.nodeId);
  });

  it("adds an inserted block's nodes, and the rest only move", () => {
    const before = listOf(DOC);
    const after = listOf(["Brand-new opening paragraph.", ...SECTIONS].join("\n\n"));
    const diff = diffDisplayLists(before, after);
    expect(diff.removed).toEqual([]);
    expect(diff.restyled).toEqual([]);
    expect(diff.added.length).toBeGreaterThan(0);
    const unchanged = new Set(before.entries.map((e) => e.nodeId).filter((id) => id !== ""));
    expect(diff.moved.map((m) => m.nodeId).sort()).toEqual([...unchanged].sort());
  });

  it("restyles what paints otherwise in place", () => {
    const before = listOf("Para one.\n\nPara two.");
    const after: DisplayList = {
      ...before,
      entries: before.entries.map((e, i) =>
        i === before.entries.findIndex((x) => x.type === "text") && e.type === "text"
          ? { ...e, runs: e.runs.map((r) => ({ ...r, color: "#ff0000ff" })) }
          : e,
      ),
    };
    const diff = diffDisplayLists(before, after);
    expect(diff.moved).toEqual([]);
    expect(diff.restyled).toHaveLength(1);
  });

  it("restyles a node that moved and changed, and keeps a pure move unrestyled", () => {
    const before = listOf("Short.\n\nAnother line of text.");
    const [first] = before.entries.filter((e) => e.type === "text");
    const id = first?.nodeId;
    const shifted = (e: DisplayList["entries"][number]): DisplayList["entries"][number] =>
      e.type === "text" && e.nodeId === id
        ? {
            ...e,
            y: e.y + 30,
            bounds: { ...e.bounds, y: e.bounds.y + 30 },
            ...(e.clip === undefined ? {} : { clip: { ...e.clip, y: e.clip.y + 30 } }),
          }
        : e;
    const moved: DisplayList = { ...before, entries: before.entries.map(shifted) };
    const pure = diffDisplayLists(before, moved);
    expect(pure.moved.map((m) => m.nodeId)).toEqual([id]);
    expect(pure.restyled).toEqual([]);
    const changed: DisplayList = {
      ...moved,
      entries: moved.entries.map((e) =>
        e.nodeId === id && e.type === "text"
          ? { ...e, runs: e.runs.map((r) => ({ ...r, text: `${r.text}!` })) }
          : e,
      ),
    };
    expect(diffDisplayLists(before, changed).restyled).toEqual([id]);
  });

  it("matches nodes only by id: entries with no node are in no category", () => {
    const list = listOf(DOC);
    const bare: DisplayList = { ...list, entries: list.entries.filter((e) => e.nodeId === "") };
    expect(diffDisplayLists(bare, { ...bare, entries: [] })).toEqual({
      added: [],
      removed: [],
      moved: [],
      restyled: [],
    });
  });
});

/**
 * One white card per product, its stepper's count `count`, as the Burger Shop writes
 * it: the minus struck (`~~…~~`, nothing to remove) at 0, unless `struck` says otherwise.
 */
const card = (name: string, count: number, struck = count === 0, price = "$9.50"): string => {
  const id = name.toLowerCase().replaceAll(" ", "-");
  const minus = `__[➖](agent:cart-remove?id=${id})__`;
  return (
    `### \n__${name}__ ... ___${price}___\n\n___[View details](agent:product?id=${id})___ ... ` +
    `${struck ? `~~${minus}~~` : minus} - **${count}** - __[➕](agent:cart-add?id=${id})__`
  );
};

const CARD_THEME = `## Styling & Spacing
### Root
Background color: #F2FCD9
Padding: 20
Spacing: 28
### Heading 3
Background color: #FFFFFF
Corner radius: 22
Padding: 14
`;

/** A catalog of cards with these counts, under an optional section above it. */
const catalog = (
  counts: readonly number[],
  names = counts.map((_, i) => `Burger ${i}`),
  above = "",
) => `${above}## Burgers\n\n${counts.map((n, i) => card(names[i] ?? "", n)).join("\n\n")}\n\n***\n`;

const cards = (markdown: string): DisplayList =>
  paintMarkdown(markdown, CARD_THEME, 900).painted.list;

const ABOVE = `## Offers\n\n${"Today only: two burgers for the price of one, at every shop. ".repeat(3)}\n\n`;

/** The ids of the text entries that paint `text`, in paint order. */
const textIds = (list: DisplayList, text: string): string[] =>
  list.entries.flatMap((e) =>
    e.type === "text" && e.runs.map((r) => r.text).join("") === text ? [e.nodeId] : [],
  );

describe("alignNodeIds", () => {
  it("leaves a list whose ids already match as it is", () => {
    const list = cards(catalog([0, 0, 0]));
    expect(alignNodeIds(list, cards(catalog([0, 0, 0])))).toBe(list);
  });

  it("a stepper's 1 that becomes 0 cross-fades in place: every other 0 stays", () => {
    const before = cards(catalog([1, 0, 0, 0, 0, 0]));
    const after = cards(catalog([0, 0, 0, 0, 0, 0]));
    // By id alone, each 0 takes its neighbour's id: all five slide one card up.
    expect(diffDisplayLists(before, after).moved).toHaveLength(5);
    const diff = diffDisplayLists(alignNodeIds(before, after), after);
    expect(diff.moved).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    // The 1 is paired with the 0 that replaced it, and the minus with the struck minus:
    // each cross-fades where it is.
    expect(diff.restyled).toContain(textIds(after, "0")[0]);
    expect(diff.restyled).toHaveLength(2);
  });

  it("a stepper's 0 that becomes 1 changes alone, though another 0 now has its id", () => {
    const before = cards(catalog([0, 0, 0, 0]));
    const after = cards(catalog([1, 0, 0, 0]));
    const [first] = textIds(before, "0");
    // By occurrence, the first card's 0 would slide into the second card's.
    expect(textIds(after, "0")).toContain(first);
    const diff = diffDisplayLists(alignNodeIds(before, after), after);
    expect(diff.moved).toEqual([]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    // The first card's 0 cross-fades into its 1; the 0 its id now names stays.
    expect(diff.restyled).toContain(textIds(after, "1")[0]);
    expect(diff.restyled).not.toContain(first);
  });

  it("moves each 0 with its card when a section above arrives with the change", () => {
    const before = cards(catalog([1, 0, 0, 0]));
    const after = cards(catalog([0, 0, 0, 0], undefined, ABOVE));
    const diff = diffDisplayLists(alignNodeIds(before, after), after);
    const by = new Map(diff.moved.map((m) => [m.nodeId, m.to.y - m.from.y]));
    const titles = ["Burger 1", "Burger 2", "Burger 3"].map((t) =>
      by.get(textIds(after, t)[0] ?? ""),
    );
    // Each 0 slides as far as its card's title: down the height of the new section.
    const zeros = textIds(after, "0")
      .slice(1)
      .map((id) => by.get(id));
    expect(zeros).toHaveLength(3);
    zeros.forEach((dy, i) => {
      expect(dy).toBeCloseTo(titles[i] ?? Number.NaN, 5);
    });
    // The changed count rides its own card, cross-fading as it goes.
    const first = textIds(after, "0")[0] ?? "";
    expect(by.get(first)).toBeCloseTo(by.get(textIds(after, "Burger 0")[0] ?? "") ?? Number.NaN, 5);
    expect(diff.restyled).toContain(first);
  });

  it("keeps a 0 with its card when the button before it changes", () => {
    // The second card's minus is struck as the first card's count turns 0: the 0 is
    // matched after the node before it that both lists hold once, its card's button.
    const plain = (counts: number[], second: boolean) =>
      `## Burgers\n\n${counts.map((n, i) => card(`Burger ${i}`, n, i === 1 ? second : n === 0)).join("\n\n")}\n`;
    const before = cards(plain([1, 0, 0, 0], false));
    const after = cards(plain([0, 0, 0, 0], true));
    const diff = diffDisplayLists(alignNodeIds(before, after), after);
    expect(diff.moved.filter((m) => textIds(after, "0").includes(m.nodeId))).toEqual([]);
    expect(diff.restyled).toContain(textIds(after, "0")[0]);
  });

  it("drops one of identical cards whole, the last; the others move as whole cards", () => {
    const names = Array.from({ length: 6 }, () => "Classic");
    const six = catalog([0, 0, 0, 0, 0, 0], names);
    const five = catalog([0, 0, 0, 0, 0], names.slice(1));
    // One row, which reflows: the cards left move into their new slots, each card's
    // nodes with the card, and only the last card's fade out.
    const before = cards(six);
    const after = cards(five);
    // Card k keeps card k's ids: no title or price matched into a neighbour's card.
    expect(alignNodeIds(before, after)).toBe(before);
    const diff = diffDisplayLists(before, after);
    expect(diff.added).toEqual([]);
    // Its six nodes and its box.
    expect(diff.removed).toHaveLength(7);
    for (const id of diff.removed) expect(id).toMatch(/-5$/u);
    for (const { nodeId } of diff.moved) expect(nodeId).not.toMatch(/-5$/u);
  });

  it("pairs a run too long to align by occurrence, as the ids do", () => {
    const fill = (nodeId: string, y: number): DisplayList["entries"][number] => {
      const bounds = { x: 0, y, width: 10, height: 10 };
      return {
        type: "fill",
        nodeId,
        bounds,
        shape: { kind: "rect", ...bounds },
        paint: { kind: "color", color: "#000000ff" },
      };
    };
    const list = cards(catalog([0]));
    const run = (n: number): DisplayList => ({
      ...list,
      entries: Array.from({ length: n }, (_, i) => fill(`00000000000000aa-${i}`, i * 20)),
    });
    const before = run(1001);
    expect(alignNodeIds(before, run(1000))).toBe(before);
  });
});

/** The node of the card box (its white fill) that holds the text `title`. */
const boxOf = (list: DisplayList, title: string): string => {
  const ink = list.entries.find(
    (e) => e.type === "text" && e.runs.map((r) => r.text).join("") === title,
  )?.bounds;
  if (ink === undefined) throw new Error(`no ${title}`);
  const x = ink.x + ink.width / 2;
  const y = ink.y + ink.height / 2;
  const box = list.entries.find(
    (e) =>
      e.type === "fill" &&
      e.paint.kind === "color" &&
      e.paint.color === "#ffffffff" &&
      x >= e.bounds.x &&
      x <= e.bounds.x + e.bounds.width &&
      y >= e.bounds.y &&
      y <= e.bounds.y + e.bounds.height,
  );
  if (box === undefined) throw new Error(`no box for ${title}`);
  return box.nodeId;
};

describe("alignNodeIds: a card's box", () => {
  it("carries its card's node, which holds what the card shows", () => {
    const list = cards(catalog([0, 1]));
    const box = boxOf(list, "Burger 1");
    expect(box).not.toBe("");
    expect(box).not.toBe(boxOf(list, "Burger 0"));
    expect(holderIds(list)).toContain(box);
  });

  it("slides with its card when the section above goes", () => {
    const before = cards(catalog([0, 0, 0], undefined, ABOVE));
    const after = cards(catalog([0, 0, 0]));
    const diff = diffDisplayLists(alignNodeIds(before, after), after);
    const by = new Map(diff.moved.map((m) => [m.nodeId, m.to.y - m.from.y]));
    for (const name of ["Burger 0", "Burger 1", "Burger 2"]) {
      const dy = by.get(textIds(after, name)[0] ?? "");
      expect(dy).toBeLessThan(-40);
      expect(by.get(boxOf(after, name))).toBeCloseTo(dy ?? Number.NaN, 5);
    }
    expect(diff.restyled).toEqual([]);
  });

  it("keeps its box and slides a changed price with it, cross-fading", () => {
    const priced = (above: string, price: string) =>
      `${above}## Burgers\n\n${[0, 1, 2].map((i) => card(`Burger ${i}`, 0, true, i === 1 ? price : "$9.50")).join("\n\n")}\n`;
    const before = cards(priced(ABOVE, "$9.50"));
    const after = cards(priced("", "$11.25"));
    const diff = diffDisplayLists(alignNodeIds(before, after), after);
    const by = new Map(diff.moved.map((m) => [m.nodeId, m.to.y - m.from.y]));
    const dy = by.get(textIds(after, "Burger 1")[0] ?? "") ?? Number.NaN;
    expect(dy).toBeLessThan(-40);
    const price = textIds(after, "$11.25")[0] ?? "";
    expect(by.get(price)).toBeCloseTo(dy, 5);
    expect(diff.restyled).toContain(price);
    // The card's box has a new id (what it holds changed) and is still its own.
    expect(by.get(boxOf(after, "Burger 1"))).toBeCloseTo(dy, 5);
    expect(diff.added).toEqual([]);
  });

  it("fades a card replaced by another card at its place, box and all", () => {
    const pictured = (name: string) =>
      card(name, 0).replace(
        "### \n",
        `### \n![${name}](https://example.com/${name.length}.png)\n\n`,
      );
    const shop = (middle: string) =>
      `## Burgers\n\n${["Classic Smash", middle, "Truffle Melt"].map(pictured).join("\n\n")}\n`;
    const before = cards(shop("Hot Honey"));
    const after = cards(shop("Garden Deluxe Supreme"));
    const diff = diffDisplayLists(alignNodeIds(before, after), after);
    const gone = boxOf(before, "Hot Honey");
    const come = boxOf(after, "Garden Deluxe Supreme");
    expect(diff.removed).toContain(gone);
    expect(diff.added).toContain(come);
    // Nothing of the new card is matched to the old one, its price and buttons included.
    const box = after.entries.find((e) => e.nodeId === come)?.bounds;
    if (box === undefined) throw new Error("no box");
    const inCard = new Set(
      after.entries
        .filter((e) => {
          const x = e.bounds.x + e.bounds.width / 2;
          const y = e.bounds.y + e.bounds.height / 2;
          return x > box.x && x < box.x + box.width && y > box.y && y < box.y + box.height;
        })
        .map((e) => e.nodeId),
    );
    expect(inCard.size).toBeGreaterThan(4);
    for (const id of inCard) expect(diff.added).toContain(id);
    // The cards beside it keep their boxes.
    expect(diff.removed).not.toContain(boxOf(before, "Classic Smash"));
    expect(diff.removed).not.toContain(boxOf(before, "Truffle Melt"));
  });

  it("pairs each of two identical cards with its own old self when one changes", () => {
    const names = ["Classic", "Classic", "Classic"];
    for (const changed of [0, 1, 2]) {
      const counts = [0, 0, 0].map((_, i) => (i === changed ? 1 : 0));
      const before = cards(catalog([0, 0, 0], names));
      const after = cards(catalog(counts, names));
      const from = alignNodeIds(before, after);
      const diff = diffDisplayLists(from, after);
      // Nothing moves and nothing comes or goes: one count and one minus cross-fade.
      expect(diff.moved).toEqual([]);
      expect(diff.added).toEqual([]);
      expect(diff.removed).toEqual([]);
      expect(diff.restyled).toHaveLength(2);
      // Each box is where it was: the same rects, in the same order, under its new id.
      const fills = (l: DisplayList) =>
        l.entries.filter((e) => e.type === "fill").map((e) => [e.nodeId, e.bounds]);
      expect(fills(from)).toEqual(fills(after));
    }
  });
});

describe("alignNodeIds: a muted control", () => {
  const SLIDERS = "## Drawing elements\n\n### Sliders\nEnabled: yes\n";
  const muted = (labels: readonly string[]) =>
    // Prose between them, so each stands on its own row at its own size.
    paintMarkdown(labels.map((l) => `${l}: ~~[30%]~~`).join("\n\nAnd then.\n\n"), SLIDERS, 600)
      .painted.list;

  it("renames the entries of its layer with it, so a kept one only moves", () => {
    const before = muted(["Bass", "Treble"]);
    const after = muted(["Gain", "Bass", "Treble"]);
    expect(before.entries.filter((e) => e.type === "layer")).toHaveLength(2);
    const aligned = alignNodeIds(before, after);
    for (const e of aligned.entries) {
      if (e.type === "layer") for (const inner of e.entries) expect(inner.nodeId).toBe(e.nodeId);
    }
    const diff = diffDisplayLists(aligned, after);
    const layers = new Set(after.entries.flatMap((e) => (e.type === "layer" ? [e.nodeId] : [])));
    // Gain's slider is new; Bass's and Treble's slide down, painted as they were.
    expect(diff.added.filter((id) => layers.has(id))).toHaveLength(1);
    expect(diff.restyled.filter((id) => layers.has(id))).toEqual([]);
    expect(diff.moved.filter((m) => layers.has(m.nodeId))).toHaveLength(2);
  });
});
