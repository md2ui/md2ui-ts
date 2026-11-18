// The generator's own cases, with expected values measured on md2ui
// (scratch script outside both repositories), using the same stand-in
// measurer on both sides (a word is 7 px a character, an emoji 24 px, a marker its size
// plus 1.5):
//  - URL params: md2ui `sanitize_url_props`, `render_properties_from_yaml(...)
//    .to_render_dict()` at narrow and wide, `render_metrics.image_floor`;
//  - the width clamp: md2ui `document_min_width` and `_content_width`;
//  - the theme's icon aside (`Emoji aside`), md2ui `tests/layout_icon_aside_tests.py`'s
//    theme cases, built at 1280 and 320 (no corpus theme sets the key, so these are its
//    only oracle), and its line-group case (a line keeps flowing).
import type { GroupingNode } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { GroupNode } from "../src/group/node.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { generate } from "../src/layout/generate.ts";
import { layoutInput } from "../src/layout/input.ts";
import { asideSplit } from "../src/layout/marker-wrap.ts";
import type { LayoutMeasurer } from "../src/layout/measurer.ts";
import type { LayoutNode } from "../src/layout/node.ts";
import {
  defaultImageRatio,
  heightSized,
  imageFloors,
  ratioAt,
  sanitizeUrlProps,
  urlRenderDict,
} from "../src/layout/url-hints.ts";
import { effectiveWidth } from "../src/layout/width.ts";
import { parseTheme } from "../src/theme/parse.ts";

type Dict = Record<string, unknown> & { children?: Dict[] };

/** The stand-in measurer the expected values were measured with. */
const MEASURER: LayoutMeasurer = {
  leafMinWidth: (node) => {
    if (node.type === "image") return null;
    if (node.type === "emoji") return 24;
    const words = node.content.split(/\s+/).filter((w) => w !== "");
    return Math.max(0, ...words.map((w) => w.length)) * 7;
  },
  leafLineWidth: (node) => (node.type === "image" ? null : node.content.length * 7),
  markerWidth: (props) => (props["size"] as number) + 1.5,
  blockWidth: () => {
    throw new Error("not asked here");
  },
  layoutHeight: () => {
    throw new Error("not asked here");
  },
};

const GLUED = { glued_content_group: true };
const leaf = (content: string, cat = "short"): Dict => ({
  type: "text",
  content,
  content_length_category: cat,
  text_length_category: cat,
});
const emoji = (kind = "alone"): Dict => ({ type: "emoji", content: "⭐", emoji_kind: kind });
const group = (children: Dict[], flags: Record<string, unknown> = {}): Dict => ({
  type: "group",
  content: "",
  children,
  ...flags,
});
const section = (level: number, ...children: Dict[]): Dict =>
  group(children, { heading_group: true, heading_level: level });

/** md2ui's tree-path ids (`0.1.2`), which its analyzer gives a hand-built tree. */
function withPaths(d: Dict, id = ""): GroupingNode {
  const children = (d.children ?? []).map((c, i) =>
    withPaths(c, id === "" ? `${i}` : `${id}.${i}`),
  );
  return { ...d, node_id: id, fingerprint_hash: null, children } as unknown as GroupingNode;
}

/** The fields the expected values were written with: type, ratios, content id, hints, a few flags, children. */
function compact(n: LayoutNode): unknown[] {
  const out: unknown[] = [n.type];
  if (n.ratios.length > 0) out.push(n.ratios);
  if (n.content_id !== null) out.push(n.content_id);
  if (n.render_properties !== null && Object.keys(n.render_properties).length > 0) {
    out.push(n.render_properties);
  }
  const extra: Record<string, unknown> = {};
  if (n.is_card) extra["is_card"] = true;
  if (n.section_level !== null) extra["section_level"] = n.section_level;
  if (n.background_kind !== null) extra["background_kind"] = n.background_kind;
  if (n.heading_id !== null) extra["heading_id"] = n.heading_id;
  if (Object.keys(extra).length > 0) out.push(extra);
  if (n.children.length > 0) out.push(n.children.map(compact));
  return out;
}

const URL_CASES = [
  {
    params: { shape: "circle", max_width: "120", max_width_wide: "240", aspect_ratio: "16:9" },
    props: { shape: "circle", max_width: 120, max_width_wide: 240, aspect_ratio: "16:9" },
    narrow: { aspect_ratio: "16:9", max_width: 120, shape: "circle" },
    wide: { aspect_ratio: "16:9", max_width: 240, shape: "circle" },
    floor: null,
  },
  {
    params: { min_width: "200", max_width: "150", fit: "cover", bleed: "Yes" },
    props: { min_width: 200, max_width: 150, fit: "cover", bleed: true },
    narrow: { max_width: 150, min_width: 200, fit: "cover", bleed: true },
    wide: { max_width: 150, min_width: 200, fit: "cover", bleed: true },
    floor: 150.0,
  },
  {
    params: {
      corner_radius: "0",
      content_align: "center",
      content_align_wide: "default",
      aspect_ratio_wide: "4:3",
    },
    props: {
      corner_radius: 0,
      content_align: "center",
      content_align_wide: "default",
      aspect_ratio_wide: "4:3",
    },
    narrow: { corner_radius: 0, content_align: "center" },
    wide: { aspect_ratio: "4:3", corner_radius: 0 },
    floor: null,
  },
  {
    params: {
      max_width: "0",
      aspect_ratio: "0:3",
      shape: "square",
      bogus: "1",
      fit: "default",
      bleed: "maybe",
      min_width: "+1_0",
    },
    props: { min_width: 10 },
    narrow: { min_width: 10 },
    wide: { min_width: 10 },
    floor: 10.0,
  },
  {
    params: { corner_radius: "-1", max_width: "abc", min_width_wide: "default", min_width: "50" },
    props: { min_width_wide: "default", min_width: 50 },
    narrow: { min_width: 50 },
    wide: {},
    floor: 50.0,
  },
];

const CLAMP_CASES = [
  { words: ["short words"], theme: "", asked: 200.0, floor: 35.0, width: 320.0 },
  { words: ["short words"], theme: "", asked: 2000.0, floor: 35.0, width: 1280.0 },
  {
    words: ["short"],
    theme: "## Background styles and Spacing\n### Root\nMax width: 900\n",
    asked: 2000.0,
    floor: 35.0,
    width: 900.0,
  },
  {
    words: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    theme: "",
    asked: 400.0,
    floor: 560.0,
    width: 560.0,
  },
  {
    words: ["x"],
    theme: "## Background styles and Spacing\n### Root\nMax width: 100\n",
    asked: 1000.0,
    floor: 7.0,
    width: 320.0,
  },
];

const ASIDE_EXPECTED: Readonly<Record<string, Record<string, unknown>>> = {
  level_asides: {
    "1280": [
      "layout",
      [1280.0, 0.0],
      [
        [
          "row",
          [24.0, 1248.0],
          { section_level: 2, is_card: true },
          [
            ["-", "0.0", { aside_fixed: true }],
            [
              "col",
              [1.0, 1.0],
              [
                ["-", "0.1"],
                ["-", "0.2"],
              ],
            ],
          ],
        ],
      ],
    ],
    "320": [
      "layout",
      [320.0, 0.0],
      [
        [
          "row",
          [24.0, 288.0],
          { section_level: 2, is_card: true },
          [
            ["-", "0.0", { aside_fixed: true }],
            [
              "col",
              [1.0, 1.0],
              [
                ["-", "0.1"],
                ["-", "0.2"],
              ],
            ],
          ],
        ],
      ],
    ],
  },
  unset: {
    "1280": [
      "layout",
      [1280.0, 0.0],
      [
        [
          "col",
          [1.0, 1.0, 1.0],
          { section_level: 2, is_card: true },
          [
            ["-", "0.0"],
            ["-", "0.1"],
            ["-", "0.2"],
          ],
        ],
      ],
    ],
    "320": [
      "layout",
      [320.0, 0.0],
      [
        [
          "col",
          [1.0, 1.0, 1.0],
          { section_level: 2, is_card: true },
          [
            ["-", "0.0"],
            ["-", "0.1"],
            ["-", "0.2"],
          ],
        ],
      ],
    ],
  },
  stops_at_heading: {
    "1280": [
      "layout",
      [1280.0, 0.0],
      [
        [
          "col",
          [1.0, 1.0],
          { section_level: 2 },
          [
            [
              "row",
              [24.0, 1248.0],
              { is_card: true },
              [
                ["-", "0.0", { aside_fixed: true }],
                ["-", "0.1"],
              ],
            ],
            [
              "col",
              [1.0, 1.0],
              { section_level: 3, is_card: true },
              [
                ["-", "1.0.0"],
                ["-", "1.0.1"],
              ],
            ],
          ],
        ],
      ],
    ],
    "320": [
      "layout",
      [320.0, 0.0],
      [
        [
          "col",
          [1.0, 1.0],
          { section_level: 2 },
          [
            [
              "row",
              [24.0, 288.0],
              { is_card: true },
              [
                ["-", "0.0", { aside_fixed: true }],
                ["-", "0.1"],
              ],
            ],
            [
              "col",
              [1.0, 1.0],
              { section_level: 3, is_card: true },
              [
                ["-", "1.0.0"],
                ["-", "1.0.1"],
              ],
            ],
          ],
        ],
      ],
    ],
  },
  elements: {
    "1280": [
      "layout",
      [1280.0, 0.0],
      [
        [
          "row",
          [24.0, 1248.0],
          { is_card: true },
          [
            ["-", "0", { aside_fixed: true }],
            [
              "col",
              [1.0, 1.0],
              [
                ["-", "1"],
                ["-", "2"],
              ],
            ],
          ],
        ],
      ],
    ],
    "320": [
      "layout",
      [320.0, 0.0],
      [
        [
          "row",
          [24.0, 288.0],
          { is_card: true },
          [
            ["-", "0", { aside_fixed: true }],
            [
              "col",
              [1.0, 1.0],
              [
                ["-", "1"],
                ["-", "2"],
              ],
            ],
          ],
        ],
      ],
    ],
  },
  h2_not_level0: {
    "1280": [
      "layout",
      [1280.0, 0.0],
      [
        [
          "col",
          [1.0, 1.0, 1.0],
          { is_card: true },
          [
            ["-", "0"],
            ["-", "1"],
            ["-", "2"],
          ],
        ],
      ],
    ],
    "320": [
      "layout",
      [320.0, 0.0],
      [
        [
          "col",
          [1.0, 1.0, 1.0],
          { is_card: true },
          [
            ["-", "0"],
            ["-", "1"],
            ["-", "2"],
          ],
        ],
      ],
    ],
  },
  trailing: {
    "1280": [
      "layout",
      [1280.0, 0.0],
      [
        [
          "row",
          [1248.0, 24.0],
          { is_card: true },
          [
            ["-", "0"],
            ["-", "1", { aside_fixed: true }],
          ],
        ],
      ],
    ],
    "320": [
      "layout",
      [320.0, 0.0],
      [
        [
          "row",
          [288.0, 24.0],
          { is_card: true },
          [
            ["-", "0"],
            ["-", "1", { aside_fixed: true }],
          ],
        ],
      ],
    ],
  },
  middle: {
    "1280": [
      "layout",
      [1280.0, 0.0],
      [
        [
          "col",
          [1.0, 1.0, 1.0],
          { is_card: true },
          [
            ["-", "0"],
            ["-", "1"],
            ["-", "2"],
          ],
        ],
      ],
    ],
    "320": [
      "layout",
      [320.0, 0.0],
      [
        [
          "col",
          [1.0, 1.0, 1.0],
          { is_card: true },
          [
            ["-", "0"],
            ["-", "1"],
            ["-", "2"],
          ],
        ],
      ],
    ],
  },
  not_alone: {
    "1280": [
      "layout",
      [1280.0, 0.0],
      [
        [
          "col",
          [1.0, 1.0],
          { is_card: true },
          [
            ["-", "0"],
            ["-", "1"],
          ],
        ],
      ],
    ],
    "320": [
      "layout",
      [320.0, 0.0],
      [
        [
          "col",
          [1.0, 1.0],
          { is_card: true },
          [
            ["-", "0"],
            ["-", "1"],
          ],
        ],
      ],
    ],
  },
  too_narrow: {
    "1280": [
      "layout",
      [1280.0, 0.0],
      [
        [
          "row",
          [24.0, 1248.0],
          { is_card: true },
          [
            ["-", "0", { aside_fixed: true }],
            ["-", "1"],
          ],
        ],
      ],
    ],
    "320": [
      "layout",
      [320.0, 0.0],
      [
        [
          "col",
          [1.0, 1.0],
          { is_card: true },
          [
            ["-", "0"],
            ["-", "1"],
          ],
        ],
      ],
    ],
  },
};

const ASIDE_H2 = "## Background styles and Spacing\n### Heading 2\nEmoji aside: yes\n";
const ELEMENTS = "## Background styles and Spacing\n### Elements\nEmoji aside: yes\n";

const ASIDE_DOCS: Readonly<Record<string, readonly [Dict, string]>> = {
  level_asides: [section(2, group([emoji(), leaf("Title"), leaf("Body")], GLUED)), ASIDE_H2],
  unset: [
    section(2, group([emoji(), leaf("Title"), leaf("Body")], GLUED)),
    "## Background styles and Spacing\n",
  ],
  stops_at_heading: [
    section(
      2,
      group([emoji(), leaf("Own body")], GLUED),
      section(3, group([emoji(), leaf("Nested body")], GLUED)),
    ),
    ASIDE_H2,
  ],
  elements: [group([emoji(), leaf("Title"), leaf("Body")], GLUED), ELEMENTS],
  h2_not_level0: [group([emoji(), leaf("Title"), leaf("Body")], GLUED), ASIDE_H2],
  trailing: [group([leaf("Text before the emoji"), emoji()], GLUED), ELEMENTS],
  middle: [group([leaf("Before"), emoji(), leaf("After")], GLUED), ELEMENTS],
  not_alone: [group([emoji("text"), leaf("Peeled emoji stays inline")], GLUED), ELEMENTS],
  too_narrow: [
    group([emoji(), leaf("Averyveryverylongunbreakablewordthatdoesnotfit", "one_word")], GLUED),
    ELEMENTS,
  ],
};

test("URL params are validated and resolved at narrow and wide as md2ui does", () => {
  const kit = new RegexKit();
  for (const c of URL_CASES) {
    const props = sanitizeUrlProps(kit, new Map(Object.entries(c.params)));
    expect(Object.fromEntries(props), JSON.stringify(c.params)).toEqual(c.props);
    expect(urlRenderDict(props, false)).toEqual(c.narrow);
    expect(urlRenderDict(props, true)).toEqual(c.wide);
    const image = new GroupNode("![a](p.png)", "image");
    expect(imageFloors(new Map([[image, props]])).get(image) ?? null).toBe(c.floor);
  }
});

// md2ui `tests/image_ratio_ranges_tests.py`: an authored ratio holds from its
// width up, the default is written the same way, and the URL accepts only well-formed
// range lists.
test("an image ratio holds from its width up; the first has no width", () => {
  const spec = "3:4,1:1@600,16:9@960";
  const want: [number, number][] = [
    [0, 3 / 4],
    [599, 3 / 4],
    [600, 1],
    [959, 1],
    [960, 16 / 9],
    [2000, 16 / 9],
  ];
  for (const [width, ratio] of want) expect(ratioAt(spec, width), String(width)).toBe(ratio);
  expect(ratioAt("1:1@600,3:4", 700)).toBeNull();
});

test("no authored ratio: 3:2, 16:9 from 768px, 2.35:1 from 1024px", () => {
  const want: [number, number][] = [
    [0, 1.5],
    [767, 1.5],
    [768, 16 / 9],
    [1023, 16 / 9],
    [1024, 2.35],
  ];
  for (const [width, ratio] of want) expect(defaultImageRatio(width), String(width)).toBe(ratio);
});

// md2ui: `sanitize_url_props` on `aspect_ratio` and `aspect_ratio_wide`
// (accepted as written, or dropped), and `render_metrics.ratio_at` at RATIO_WIDTHS (`null`
// where `ratio_ranges` does not parse). The parser is looser than the URL check: only a
// validated value ever reaches it, so a value md2ui parses but rejects never draws.
const RATIO_WIDTHS = [0, 599, 600, 960, 1024, 2000];
const RATIO_CASES: [spec: string, accepted: boolean, at: number[] | null][] = [
  ["3:4", true, [0.75, 0.75, 0.75, 0.75, 0.75, 0.75]],
  [
    "3:4,1:1@600,16:9@960",
    true,
    [0.75, 0.75, 1.0, 1.7777777777777777, 1.7777777777777777, 1.7777777777777777],
  ],
  [
    "3:4,16:9@960,1:1@600",
    true,
    [0.75, 0.75, 1.0, 1.7777777777777777, 1.7777777777777777, 1.7777777777777777],
  ],
  ["1:1,2:1@0", true, [2.0, 2.0, 2.0, 2.0, 2.0, 2.0]],
  ["3:4,1:1@600.5", false, [0.75, 0.75, 0.75, 1.0, 1.0, 1.0]],
  ["3:4,1:1@abc", false, null],
  ["3:4,1:1", false, null],
  ["3:4,1:0@600", false, null],
  ["1:1@600", false, null],
  ["0:1", false, [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]],
  ["1:0", false, null],
  ["3:4,", false, null],
  ["", false, null],
  ["16:9@960,3:4", false, null],
  ["1.5:1,2.35:1@1024", true, [1.5, 1.5, 1.5, 1.5, 2.35, 2.35]],
  ["00:1", false, [0.0, 0.0, 0.0, 0.0, 0.0, 0.0]],
  ["1:00.0", false, null],
  ["3:4,,1:1@600", false, null],
  ["3:4 ,1:1@600", false, [0.75, 0.75, 1.0, 1.0, 1.0, 1.0]],
  ["3:4,1:1@600@700", false, null],
  ["3:4,1:1@-5", false, [0.75, 0.75, 0.75, 0.75, 0.75, 0.75]],
  ["10:0.5", true, [20.0, 20.0, 20.0, 20.0, 20.0, 20.0]],
  [" 3:4", false, [0.75, 0.75, 0.75, 0.75, 0.75, 0.75]],
  ["3:4,1:1@1e3", false, [0.75, 0.75, 0.75, 0.75, 1.0, 1.0]],
];

test("ratio ranges parse and validate as md2ui's do", () => {
  const kit = new RegexKit();
  for (const [spec, accepted, at] of RATIO_CASES) {
    const props = sanitizeUrlProps(
      kit,
      new Map([
        ["aspect_ratio", spec],
        ["aspect_ratio_wide", spec],
      ]),
    );
    const want = accepted ? { aspect_ratio: spec, aspect_ratio_wide: spec } : {};
    expect(Object.fromEntries(props), spec).toEqual(want);
    const got = at === null ? ratioAt(spec, 0) : RATIO_WIDTHS.map((w) => ratioAt(spec, w));
    expect(got, spec).toEqual(at);
  }
});

// md2ui `image_url_params_tests`, section 5: a `max_height` is kept only with one
// ratio of its own and no width param, per variant; `height_sized` makes it a width cap.
test("max_height: kept with one ratio, dropped beside a width or without one ratio", () => {
  const kit = new RegexKit();
  const sane = (params: Record<string, string>) =>
    sanitizeUrlProps(kit, new Map(Object.entries(params)));
  const kept = sane({ max_height: "36", aspect_ratio: "7:1", max_height_wide: "48" });
  expect(Object.fromEntries(kept)).toEqual({
    max_height: 36,
    aspect_ratio: "7:1",
    max_height_wide: 48,
  });
  expect(urlRenderDict(kept, true)["max_height"]).toBe(48);
  for (const width of ["max_width", "min_width"]) {
    const props = sane({ max_height: "36", [width]: "40", aspect_ratio: "1:1" });
    expect(props.has("max_height")).toBe(false);
    expect(props.get(width)).toBe(40);
  }
  const wideWidth = sane({ max_height: "36", aspect_ratio: "7:1", max_width_wide: "100" });
  expect(urlRenderDict(wideWidth, false)["max_height"]).toBe(36);
  expect(urlRenderDict(wideWidth, true)["max_height"]).toBeUndefined();
  for (const params of [{ max_height: "36" }, { max_height: "36", aspect_ratio: "7:1,1:1@600" }]) {
    expect(sane(params).has("max_height")).toBe(false);
  }
  expect(heightSized({ max_height: 36, aspect_ratio: "1:1" }, "7:1")).toEqual({
    aspect_ratio: "7:1",
    max_width: 252,
  });
  expect(heightSized({ aspect_ratio: "1:1" }, "7:1")).toEqual({ aspect_ratio: "1:1" });
});

test("the width clamp: the content floor wins, then the theme's Max width, never under 320", () => {
  for (const c of CLAMP_CASES) {
    const input = layoutInput(new RegexKit(), withPaths(group(c.words.map((w) => leaf(w)))));
    expect(effectiveWidth(input, parseTheme(c.theme), MEASURER, c.asked), JSON.stringify(c)).toBe(
      c.width,
    );
  }
});

test("a fixed aside keeps its own width and carves the gap out first", () => {
  expect(asideSplit(53.5, 1280, 24)).toEqual([[53.5, 1202.5], 53.5, 1202.5]);
  expect(asideSplit(400, 100, 24)).toEqual([[76, 1], 76, 0]);
});

test("a theme level's Emoji aside builds the icon gutter as md2ui does", () => {
  for (const [name, [doc, themeText]] of Object.entries(ASIDE_DOCS)) {
    const theme = parseTheme(themeText);
    for (const width of [1280, 320]) {
      const input = layoutInput(new RegexKit(), withPaths(doc));
      const built = compact(generate(input, width, theme, MEASURER));
      expect(built, `${name} @ ${width}`).toEqual(ASIDE_EXPECTED[name]?.[String(width)]);
    }
  }
});

test("a line group is never an icon aside: it keeps flowing, as md2ui does", () => {
  const doc = group([emoji(), leaf("This contains emoji before and after"), emoji()], {
    line_split_group: true,
  });
  const theme = parseTheme("## Background styles and Spacing\n### Elements\nEmoji aside: yes\n");
  for (const width of [1280, 320]) {
    const built = compact(
      generate(layoutInput(new RegexKit(), withPaths(doc)), width, theme, MEASURER),
    );
    expect(built, String(width)).toEqual([
      "layout",
      [width, 0],
      [
        [
          "row",
          [7, 252, 7],
          [
            ["-", "0"],
            ["-", "1"],
            ["-", "2"],
          ],
        ],
      ],
    ]);
  }
});
