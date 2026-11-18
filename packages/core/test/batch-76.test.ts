// md2ui rules these tests pin, beside the `:::` row sizing (`batch-76-rows.test.ts`) and the
// key-value pictures (`grouper-batch-53`): a one-line link label with a spaced ` ... ` spring
// is a row card, a global Display / Lead / Muted block draws its own face, a run of heading
// sections is polled at its own level, and image cards vote in the run poll and count their
// `### Image Cards` padding. Expected values are md2ui's own tests (content_card_tests,
// text_style_tier_tests, layout_icon_aside_tests, layout_image_card_tests), run here on the
// fake measurer.
import { expect, test } from "vitest";
import { groupDocument } from "../src/group/grouper.ts";
import { GroupNode } from "../src/group/node.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { unitPaddingX } from "../src/layout/node-units.ts";
import { fontSet } from "../src/measure/font-set.ts";
import { effectiveTextFonts } from "../src/measure/text-fonts.ts";
import { parseTheme } from "../src/theme/parse.ts";
import { urlLayoutParams, withLayoutParams } from "../src/utils/image-params.ts";
import { paintMarkdown } from "./scene-kit.ts";

const kit = new RegexKit();

function nodes(root: GroupNode): GroupNode[] {
  return [root, ...root.children.flatMap(nodes)];
}

const ofType = (root: GroupNode, type: string): GroupNode[] =>
  nodes(root).filter((n) => n.type === type);

const leaves = (n: GroupNode): GroupNode[] =>
  n.children.length === 0 ? [n] : n.children.flatMap(leaves);

const rowLinks = (root: GroupNode): (string | null)[] =>
  ofType(root, "group")
    .filter((n) => n.link_url)
    .map((n) => n.link_url);

// --- a one-line label with a spring (grouper_types._BracketConstruct.is_group_link) ------

// md2ui: test_a_list_item_of_a_spring_label_is_a_row_link
test("a list item of a spring label is a row link", () => {
  const root = groupDocument(
    "- [👥 - Invite a friend ... **❯**](/invite)\n- [**Pro plan** : _Best for teams_ ... **❯**](/pro)\n",
  );
  const items = ofType(root, "list_item");
  expect(items.map((i) => i.link_url)).toEqual(["/invite", "/pro"]);
  expect(ofType(root, "link")).toEqual([]);
  expect(leaves(items[0] as GroupNode).map((n) => [n.type, n.content])).toEqual([
    ["emoji", "👥"],
    ["segment", "Invite a friend"],
    ["emoji", "❯"],
  ]);
});

// md2ui: test_a_spring_label_alone_on_its_line_is_a_row_link
test("a spring label alone on its line is a row link", () => {
  const root = groupDocument("[📷 - Instagram ... **❯**](/ig)\n");
  expect(rowLinks(root)).toEqual(["/ig"]);
  expect(ofType(root, "link")).toEqual([]);
});

// md2ui: test_a_one_line_label_without_a_spring_stays_a_pill
test("a one-line label without a spring stays a pill", () => {
  for (const text of [
    "- [Amazon - Echo Show 11](/a)",
    "[Area: Westside ✕](/b)",
    "[🛒 6 \\| $800.72](/c)",
    "[mph : 100](/d)",
    "[Plan | Pro](/e)",
    "[a \\... b](/f)",
  ]) {
    const root = groupDocument(`${text}\n`);
    expect(ofType(root, "link").length, text).toBeGreaterThan(0);
    expect(rowLinks(root), text).toEqual([]);
  }
  for (const text of ["Read [a ... b](/g) now.", "[Save](/s) [Share ... now](/h)"]) {
    expect(rowLinks(groupDocument(`${text}\n`)), text).toEqual([]);
  }
});

// --- a global tier's own face (render_text_scopes._own_face) -----------------------------

// md2ui: test_a_global_tier_draws_its_own_family_and_weight
test("a global tier block draws its own family and weight", () => {
  const theme = parseTheme(
    "## Text Styles\nText\n- Font Name: Inter 18pt\n- Font weight: 400\n" +
      "Lead\n- Font Name: EB Garamond\n- Font weight: 400\n" +
      "Display\n- Font Name: Inter 18pt\n- Font weight: 600\n" +
      "Muted\n- Font weight: 700\n",
  );
  const fonts = fontSet(theme, (path) => path ?? "emoji");
  const face = (tier: string) => {
    const ctx = { table_role: null, heading_ctx: 0, text_style: tier, text_style_chain: [] };
    const { typeface } = effectiveTextFonts("text", 0, fonts, theme, ctx).faces;
    return [typeface.family, typeface.weight];
  };
  expect(face("lead")).toEqual(["EB Garamond", 400]);
  expect(face("display")).toEqual(["Inter 18pt", 600]);
  // Bold is a face the body already has: it draws in the body's bold, as before.
  expect(face("muted")).toEqual(["Inter 18pt", 700]);
});

// --- a run of heading sections polls its own level (layout_generator) --------------------

// md2ui: test_a_run_of_heading_sections_polls_its_own_level (its theme, without fonts)
test("a run of heading sections polls the level its cards are built at", () => {
  const theme =
    "## Styling & Spacing\n### Root\nPadding: 23\nSpacing: 24\n" +
    "### Elements\nRow spacing: 16\nCol spacing: 0\nGroup spacing: 20\n" +
    "### Heading 3\nBackground color: #FAFAFA\nCorner radius: 16\nPadding: 16\n" +
    "Spacing: 24\nEmoji aside: yes\nVertical align: center\n" +
    "## Text Styles\nText\n- Font size: 16\nLead\n- Font size: 20\n";
  const cards = [
    ["↙️", "Tiny", "file format but mighty"],
    ["🖽", "Motion Tokens", "bind properties to real data"],
    ["⬚", "Interactive", "for delightful experiences"],
    ["❴", "Dev ready", "and easy to implement"],
  ];
  const doc = cards.map(([e, t, c]) => `### \n${e}\n__${t}__\n${c}`).join("\n\n");
  const mixed: number[] = [];
  for (let width = 700; width < 1300; width += 20) {
    const { scene, grouping } = paintMarkdown(doc, theme, width);
    const emojiIds = new Set(
      nodes(grouping as unknown as GroupNode)
        .filter((n) => n.type === "emoji")
        .map((n) => n.node_id),
    );
    const emoji = scene.boxes.filter((b) => b.content_id !== null && emojiIds.has(b.content_id));
    const texts = scene.boxes.filter((b) => !emoji.includes(b));
    const owners = scene.sections.filter((c) => c.width < width / 2);
    const beside = emoji.map((e) => {
      const card = owners.find((c) => c.x <= e.x && e.x < c.x + c.width);
      if (card === undefined) return false;
      return texts.some(
        (t) =>
          card.x <= t.x &&
          t.x < card.x + card.width &&
          t.x > e.x + e.width - 1 &&
          Math.abs(t.y - e.y) < e.height,
      );
    });
    if (new Set(beside).size > 1) mixed.push(width);
  }
  expect(mixed).toEqual([]);
});

// --- image cards in the run poll (layout_generator._unify_run_render) --------------------

const HERO = "https://example.invalid/hero.png";

// md2ui: test_the_first_cards_ratio_sets_the_run
test("the first image card's ratio sets the whole run", () => {
  const cards = [0, 1, 2]
    .map(
      (i) =>
        `### \n![\n... ***[🤍](agent:save?id=${i})***\n](${HERO}${i === 0 ? "?md2ui.aspect_ratio=3:4" : ""})\n` +
        `**Item ${i}** ... $95`,
    )
    .join("\n\n");
  const { scene } = paintMarkdown(cards, "", 1024);
  const ratios = scene.sections.filter((b) => b.bg_image_url).map((b) => b.height / b.width);
  expect(ratios).toHaveLength(3);
  for (const r of ratios) expect(Math.abs(r - 4 / 3)).toBeLessThan(0.02);
});

// md2ui: image_params.with_layout_params, its answers measured on md2ui.
test("a polled card url carries the run's layout params in place of its own", () => {
  expect(
    withLayoutParams(
      kit,
      "https://x.test/a.png?w=1&md2ui.placeholder=avatar&md2ui.aspect_ratio=1:1#f",
      new Map([
        ["aspect_ratio", "3:4"],
        ["shape", "circle"],
      ]),
    ),
  ).toBe(
    "https://x.test/a.png?w=1&md2ui.placeholder=avatar&md2ui.aspect_ratio=3:4&md2ui.shape=circle#f",
  );
  expect(withLayoutParams(kit, HERO, new Map([["aspect_ratio", "3:4,1:1@600"]]))).toBe(
    `${HERO}?md2ui.aspect_ratio=3:4,1:1@600`,
  );
  expect(withLayoutParams(kit, `${HERO}?md2ui.aspect_ratio=1:1`, new Map())).toBe(HERO);
  expect(withLayoutParams(kit, "data:image/png;base64,AAA", new Map([["a", "1"]]))).toBe(
    "data:image/png;base64,AAA",
  );
  expect(withLayoutParams(kit, HERO, new Map([["k", "a b/c!é*'("]]))).toBe(
    `${HERO}?md2ui.k=a%20b%2Fc%21%C3%A9%2A%27%28`,
  );
  expect(urlLayoutParams(kit, `${HERO}?md2ui.placeholder=x&md2ui.Aspect_Ratio=1:1`)).toEqual(
    new Map([["aspect_ratio", "1:1"]]),
  );
});

// md2ui: test_a_photo_cards_overlay_holds_its_pills (its cause: generator_units._unit_padding_x)
test("a photo card's minimum width counts its ### Image Cards padding", () => {
  const theme = parseTheme(
    "## Styling & Spacing\n### Elements\nPadding: 4\n### Image Cards\nPadding: 20\n",
  );
  const card = new GroupNode("", "group");
  card.glued_content_group = true;
  expect(unitPaddingX(card, theme)).toBe(8);
  card.card_bg_url = HERO;
  expect(unitPaddingX(card, theme)).toBe(40);
});
