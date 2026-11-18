// List surfaces and photo-sized image cards, ported from md2ui's
// `tests/list_quote_background_tests.py` and `tests/layout_image_card_tests.py`: `Merge rows:
// yes` on a list level makes a stacked run one card (the shell) with rows and the level's rule
// between them; a run of a level's items alone draws without the element card unless `List
// card: yes`; an image card's `aspect_ratio` sizes it after the arrangement is chosen, the
// surplus going where its author put room.
import { expect, test } from "vitest";
import { paintStyleFor } from "../src/scene/backgrounds.ts";
import type { SectionBox } from "../src/scene/boxes.ts";
import { parseTheme } from "../src/theme/parse.ts";
import { paintMarkdown } from "./scene-kit.ts";

const MERGED = `# Merged list
## Styling & Spacing
### Unordered Lists
Merge rows: yes
Background color: #FFFFFF
Corner radius: 20
Padding: 14
#### Horizontal Rule
Stroke color: #112233
Stroke width: 2
`;

const ROWS = "- **Apple** ... 343.47\n- **Microsoft** ... 528.95\n- **NVIDIA** ... 214.14\n";

const sections = (markdown: string, theme: string): readonly SectionBox[] =>
  paintMarkdown(markdown, theme).scene.sections;
const ofKind = (all: readonly SectionBox[], kind: string): SectionBox[] =>
  all.filter((b) => b.kind === kind);

test("Merge rows: one list card, rows touching, a rule between them", () => {
  const all = sections(ROWS, MERGED);
  const shells = ofKind(all, "unordered_list_shell");
  const rows = ofKind(all, "list_row");
  const rules = ofKind(all, "unordered_list_divider");
  expect([shells.length, rows.length, rules.length]).toEqual([1, 3, 2]);
  expect(ofKind(all, "unordered_list")).toEqual([]);
  const shell = shells[0] as SectionBox;
  const last = rows[2] as SectionBox;
  expect(rows[0]?.y).toBe(shell.y);
  expect(last.y + last.height).toBe(shell.y + shell.height);
  rules.forEach((rule, i) => {
    const upper = rows[i] as SectionBox;
    const lower = rows[i + 1] as SectionBox;
    expect(upper.y + upper.height).toBe(lower.y);
    expect(rule.height).toBe(2);
    expect(rule.y + 1).toBe(lower.y);
    expect(rule.x).toBe(shell.x + 14);
    expect(rule.width).toBe(shell.width - 28);
  });
});

test("a merged list's shell replaces the element card around its run", () => {
  const all = sections(ROWS, `${MERGED}### Elements\nBackground color: #FF0000\nPadding: 9\n`);
  expect(ofKind(all, "unordered_list_shell")).toHaveLength(1);
  expect(ofKind(all, "card")).toEqual([]);
});

test("a run of list items that grids keeps one card per tile", () => {
  const tiles = "- **Wi-Fi** - Free\n- **Pool** - Heated\n- **Gym** - Open 24h\n";
  const { scene } = paintMarkdown(tiles, MERGED);
  expect(ofKind(scene.sections, "unordered_list")).toHaveLength(3);
  expect(ofKind(scene.sections, "list_row")).toEqual([]);
});

test("a merged row paints nothing; the shell and the rule paint the level's", () => {
  const theme = parseTheme(MERGED);
  expect(paintStyleFor("list_row", 0, theme, null)).toBeUndefined();
  expect(paintStyleFor("unordered_list_shell", 0, theme, null)?.bg_colors).toEqual([0xffffffff]);
  expect(paintStyleFor("unordered_list_divider", 0, theme, null)?.bg_colors).toEqual([0xff112233]);
});

test("Stroke width: 0 under the list level draws no rule", () => {
  const all = sections(ROWS, MERGED.replace("Stroke width: 2", "Stroke width: 0"));
  expect(ofKind(all, "unordered_list_shell")).toHaveLength(1);
  expect(all.filter((b) => b.kind.endsWith("_divider"))).toEqual([]);
});

test("without Merge rows every item paints its own surface", () => {
  const kinds = sections(ROWS, MERGED.replace("Merge rows: yes\n", "")).map((b) => b.kind);
  expect(kinds.filter((k) => k === "unordered_list")).toHaveLength(3);
  expect(kinds.filter((k) => /_shell$|_divider$|^list_row$/.test(k))).toEqual([]);
});

const LIST_CARD = `# List card
## Styling & Spacing
### Elements
Background color: #FF0000
Padding: 9
### Unordered Lists
Padding: 6
`;

const cards = (markdown: string, extra = ""): number =>
  ofKind(sections(markdown, LIST_CARD + extra), "card").length;

test("a run of list items alone has no card unless `List card: yes`", () => {
  const tight = "## Plans\n\n- Basic\n- Pro\n- Team\n";
  expect(cards(tight)).toBe(0);
  expect(cards(tight, "List card: yes\n")).toBe(1);
  expect(cards("## Plans\n\n- A - B\n- C - D\n- E - F\n")).toBe(0);
});

test("a lead-in glued to the list keeps the run's card", () => {
  expect(cards("## Lead\n\nIngredients:\n- Flour\n- Sugar\n")).toBe(1);
});

test("the items keep their arrangement; only the card goes", () => {
  const doc = "## Plans\n\n- A - B\n- C - D\n- E - F\n- G - H\n";
  const xs = (extra: string): number[] => [
    ...new Set(
      ofKind(sections(doc, LIST_CARD + extra), "unordered_list").map((b) => Math.round(b.x)),
    ),
  ];
  expect(xs("").length).toBe(xs("List card: yes\n").length);
});

const HERO = "https://example.invalid/hero.png";

/** The card's photo layer and the scene of an image card `body`, 400 wide. */
function sizedCard(params: string, body = "#### Monstera\n_$33_") {
  const { scene } = paintMarkdown(`![\n${body}\n](${HERO}${params})\n`, "", 400);
  const card = scene.sections.find((b) => b.bg_image_url) as SectionBox;
  return { card, tops: scene.boxes.filter((b) => b.y >= card.y).map((b) => b.y) };
}

test("an image card's aspect_ratio sizes it, max_height caps it", () => {
  const plain = sizedCard("").card;
  expect(plain.height).toBeLessThan(plain.width);
  const square = sizedCard("?md2ui.aspect_ratio=1:1").card;
  expect(Math.abs(square.height - square.width)).toBeLessThan(1);
  const capped = sizedCard("?md2ui.aspect_ratio=1:1&md2ui.max_height=200").card;
  expect(Math.abs(capped.height - 200)).toBeLessThan(1);
});

test("content taller than the ratio grows the card", () => {
  const long = `#### ${"A long title that wraps ".repeat(6)}\n_$33_`;
  const short = sizedCard("?md2ui.aspect_ratio=8:1", long).card;
  const content = sizedCard("", long).card;
  expect(Math.abs(short.height - content.height)).toBeLessThan(1);
});

test("spare room goes above the words; a first one-line row stays on top", () => {
  const { card, tops } = sizedCard(
    "?md2ui.aspect_ratio=1:1",
    "`New` ... [Save](agent:save)\n#### Monstera\n_$33_",
  );
  expect(Math.min(...tops) - card.y).toBeLessThan(40);
  expect(card.y + card.height - Math.max(...tops)).toBeLessThan(60);
});

test("spare room grows the card's `+++++`, where its author put room", () => {
  const { card, tops } = sizedCard(
    "?md2ui.aspect_ratio=1:1",
    "[Save](agent:save)\n+++++\n#### Monstera",
  );
  expect(Math.min(...tops) - card.y).toBeLessThan(40);
  expect(card.y + card.height - Math.max(...tops)).toBeLessThan(60);
});

test("a card's ratio never changes how many columns its run takes", () => {
  const columns = (params: string): number[] => {
    const doc = Array.from(
      { length: 6 },
      (_, i) =>
        `### \n![\n\`New\` ... *[🤍](agent:fav?id=${i})*\n+++++\n](${HERO}${params})\n` +
        `__Dish ${i}__ ... ___$14.50___\n_🕒 18 min_ - _🔥 Mild_\n---\n` +
        `**⭐ 4.9** ... [+ Add](agent:add?id=${i})`,
    ).join("\n\n");
    const { scene } = paintMarkdown(doc, "", 767);
    return [
      ...new Set(scene.sections.filter((b) => b.bg_image_url).map((b) => Math.round(b.x))),
    ].sort((a, b) => a - b);
  };
  expect(columns("?md2ui.aspect_ratio=5:4")).toEqual(columns(""));
});

test("the display list paints the shell once and each rule, and no row", () => {
  const { painted, scene } = paintMarkdown(ROWS, MERGED);
  const fills = painted.list.entries.filter((e) => e.type === "fill");
  const colored = (color: string) =>
    fills.filter((e) => e.paint.kind === "color" && e.paint.color === color);
  expect(colored("#112233ff")).toHaveLength(2);
  expect(colored("#ffffffff")).toHaveLength(1);
  const rule = ofKind(scene.sections, "unordered_list_divider")[0] as SectionBox;
  expect(colored("#112233ff")[0]?.shape).toMatchObject({ x: rule.x, y: rule.y, width: rule.width });
});
