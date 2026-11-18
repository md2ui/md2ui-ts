// Data-point displays the corpus does not exercise, each with expected values measured on
// md2ui (scratch script outside both repositories), using the same
// stand-in measurer on both sides (a word is 7 px a character, an emoji 24 px, a marker
// its size plus 1.5): chips off (`date_text`), `Unit Ratios` show-total and show-key off,
// `Ratio Bars` text side left, `Key Value Bars` position above and show-key / show-value
// off, the ring, and a chart, each at 600 px.
import type { GroupingNode } from "@md2ui/contracts";
import { expect, test } from "vitest";
import { RegexKit } from "../src/group/py/re.ts";
import { generate } from "../src/layout/generate.ts";
import { layoutInput } from "../src/layout/input.ts";
import type { LayoutMeasurer } from "../src/layout/measurer.ts";
import type { LayoutNode } from "../src/layout/node.ts";
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

/** md2ui's tree-path ids (`0.1.2`), which its analyzer gives a hand-built tree. */
function withPaths(d: Dict, id = ""): GroupingNode {
  const children = (d.children ?? []).map((c, i) =>
    withPaths(c, id === "" ? `${i}` : `${id}.${i}`),
  );
  return { ...d, node_id: id, fingerprint_hash: null, children } as unknown as GroupingNode;
}

/** The fields the expected values were written with. */
function compact(n: LayoutNode): Record<string, unknown> {
  const out: Record<string, unknown> = { type: n.type, ratios: n.ratios };
  if (n.content_id !== null) out["content_id"] = n.content_id;
  if (n.render_properties !== null && Object.keys(n.render_properties).length > 0) {
    out["render_properties"] = n.render_properties;
  }
  const flags: Record<string, unknown> = {};
  if (n.is_card) flags["is_card"] = true;
  if (n.line_split) flags["line_split"] = true;
  if (n.spring) flags["spring"] = true;
  if (n.card_kind !== null) flags["card_kind"] = n.card_kind;
  if (n.background_kind !== null) flags["background_kind"] = n.background_kind;
  if (Object.keys(flags).length > 0) out["flags"] = flags;
  if (n.children.length > 0) out["children"] = n.children.map(compact);
  return out;
}

const CASES: Record<string, { theme: string; tree: Dict }> = {
  chips_off: {
    theme: "## Drawing elements\n### Dates\nEnabled: no\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "text",
              content: "Aug",
              content_length_category: "short",
              text_length_category: "short",
            },
            {
              type: "text",
              content: "12",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          datapoint_display: "date_chip",
          datapoint_payload: { text: "Aug 12", day: 12 },
          text_style_chain: ["bold"],
        },
      ],
    },
  },
  chips_on: {
    theme: "",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "text",
              content: "Aug",
              content_length_category: "short",
              text_length_category: "short",
            },
            {
              type: "text",
              content: "12",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          datapoint_display: "date_chip",
          datapoint_payload: { text: "Aug 12", day: 12 },
          text_style_chain: ["bold"],
        },
      ],
    },
  },
  unit_leaf_total_off: {
    theme: "## Drawing elements\n### Unit Ratios\nShow total: no\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "text",
          content: "25/100 progress",
          content_length_category: "short",
          text_length_category: "short",
          datapoint_display: "unit_ratio",
          datapoint_payload: { value: 25, max: 100, unit: "progress" },
        },
      ],
    },
  },
  unit_leaf_key_off: {
    theme: "## Drawing elements\n### Unit Ratios\nShow key: no\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "text",
          content: "25/100 progress",
          content_length_category: "short",
          text_length_category: "short",
          datapoint_display: "unit_ratio",
          datapoint_payload: { value: 25, max: 100, unit: "progress" },
        },
      ],
    },
  },
  unit_leaf_both_off: {
    theme: "## Drawing elements\n### Unit Ratios\nShow total: no\nShow key: no\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "text",
          content: "25/100 progress",
          content_length_category: "short",
          text_length_category: "short",
          datapoint_display: "unit_ratio",
          datapoint_payload: { value: 25, max: 100, unit: "progress" },
        },
      ],
    },
  },
  ratio_leaf: {
    theme: "",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "text",
          content: "4/8",
          content_length_category: "short",
          text_length_category: "short",
          datapoint_display: "ratio_bar",
          datapoint_payload: { value: 4.5, max: 8 },
        },
      ],
    },
  },
  ratio_leaf_total_off: {
    theme: "## Drawing elements\n### Unit Ratios\nShow total: no\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "text",
          content: "4/8",
          content_length_category: "short",
          text_length_category: "short",
          datapoint_display: "ratio_bar",
          datapoint_payload: { value: 4.5, max: 8 },
        },
      ],
    },
  },
  ratio_leaf_left: {
    theme: "## Drawing elements\n### Ratio Bars\nText side: left\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "text",
          content: "4/8",
          content_length_category: "short",
          text_length_category: "short",
          datapoint_display: "ratio_bar",
          datapoint_payload: { value: 4.5, max: 8 },
        },
      ],
    },
  },
  unit_leaf_left_key_off: {
    theme: "## Drawing elements\n### Ratio Bars\nText side: left\n### Unit Ratios\nShow key: no\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "text",
          content: "25/100 progress",
          content_length_category: "short",
          text_length_category: "short",
          datapoint_display: "unit_ratio",
          datapoint_payload: { value: 25, max: 100, unit: "progress" },
        },
      ],
    },
  },
  unit_group: {
    theme: "",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "text",
              content: "25/100",
              content_length_category: "short",
              text_length_category: "short",
            },
            {
              type: "text",
              content: "progress",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          datapoint_display: "unit_ratio",
          datapoint_payload: { value: 25, max: 100, unit: "progress" },
        },
      ],
    },
  },
  unit_group_total_off: {
    theme: "## Drawing elements\n### Unit Ratios\nShow total: no\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "text",
              content: "25/100",
              content_length_category: "short",
              text_length_category: "short",
            },
            {
              type: "text",
              content: "progress",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          datapoint_display: "unit_ratio",
          datapoint_payload: { value: 25, max: 100, unit: "progress" },
        },
      ],
    },
  },
  unit_group_key_off: {
    theme: "## Drawing elements\n### Unit Ratios\nShow key: no\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "text",
              content: "25/100",
              content_length_category: "short",
              text_length_category: "short",
            },
            {
              type: "text",
              content: "progress",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          datapoint_display: "unit_ratio",
          datapoint_payload: { value: 25, max: 100, unit: "progress" },
        },
      ],
    },
  },
  unit_group_both_off: {
    theme: "## Drawing elements\n### Unit Ratios\nShow total: no\nShow key: no\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "text",
              content: "25/100",
              content_length_category: "short",
              text_length_category: "short",
            },
            {
              type: "text",
              content: "progress",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          datapoint_display: "unit_ratio",
          datapoint_payload: { value: 25, max: 100, unit: "progress" },
        },
      ],
    },
  },
  unit_kv: {
    theme: "",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "key",
              content: "Minutes",
              content_length_category: "short",
              text_length_category: "short",
            },
            {
              type: "value",
              content: "7/8",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          datapoint_display: "unit_ratio",
          datapoint_payload: { value: 7, max: 8, unit: "Minutes", from_kv: true },
        },
      ],
    },
  },
  unit_kv_total_off: {
    theme: "## Drawing elements\n### Unit Ratios\nShow total: no\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "key",
              content: "Minutes",
              content_length_category: "short",
              text_length_category: "short",
            },
            {
              type: "value",
              content: "7/8",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          datapoint_display: "unit_ratio",
          datapoint_payload: { value: 7, max: 8, unit: "Minutes", from_kv: true },
        },
      ],
    },
  },
  unit_kv_key_off: {
    theme: "## Drawing elements\n### Unit Ratios\nShow key: no\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "key",
              content: "Minutes",
              content_length_category: "short",
              text_length_category: "short",
            },
            {
              type: "value",
              content: "7/8",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          datapoint_display: "unit_ratio",
          datapoint_payload: { value: 7, max: 8, unit: "Minutes", from_kv: true },
        },
      ],
    },
  },
  unit_kv_both_off: {
    theme: "## Drawing elements\n### Unit Ratios\nShow total: no\nShow key: no\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "key",
              content: "Minutes",
              content_length_category: "short",
              text_length_category: "short",
            },
            {
              type: "value",
              content: "7/8",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          datapoint_display: "unit_ratio",
          datapoint_payload: { value: 7, max: 8, unit: "Minutes", from_kv: true },
        },
      ],
    },
  },
  unit_kv_above_total_off: {
    theme:
      "## Drawing elements\n### Key Value Bars\nPosition: above\n### Unit Ratios\nShow total: no\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "key",
              content: "Minutes",
              content_length_category: "short",
              text_length_category: "short",
            },
            {
              type: "value",
              content: "7/8",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          datapoint_display: "unit_ratio",
          datapoint_payload: { value: 7, max: 8, unit: "Minutes", from_kv: true },
        },
      ],
    },
  },
  unit_kv_above: {
    theme: "## Drawing elements\n### Key Value Bars\nPosition: above\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "key",
              content: "Minutes",
              content_length_category: "short",
              text_length_category: "short",
            },
            {
              type: "value",
              content: "7/8",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          datapoint_display: "unit_ratio",
          datapoint_payload: { value: 7, max: 8, unit: "Minutes", from_kv: true },
        },
      ],
    },
  },
  percent: {
    theme: "",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "key",
              content: "Progress",
              content_length_category: "short",
              text_length_category: "short",
            },
            {
              type: "value",
              content: "50%",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          datapoint_display: "kv_percent_bar",
          datapoint_payload: { percent: 50, value: 50, max: 100 },
        },
      ],
    },
  },
  percent_above: {
    theme: "## Drawing elements\n### Key Value Bars\nPosition: above\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "key",
              content: "Progress",
              content_length_category: "short",
              text_length_category: "short",
            },
            {
              type: "value",
              content: "50%",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          datapoint_display: "kv_percent_bar",
          datapoint_payload: { percent: 50, value: 50, max: 100 },
        },
      ],
    },
  },
  percent_key_off: {
    theme: "## Drawing elements\n### Key Value Bars\nShow key: no\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "key",
              content: "Progress",
              content_length_category: "short",
              text_length_category: "short",
            },
            {
              type: "value",
              content: "50%",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          datapoint_display: "kv_percent_bar",
          datapoint_payload: { percent: 50, value: 50, max: 100 },
        },
      ],
    },
  },
  percent_value_off: {
    theme: "## Drawing elements\n### Key Value Bars\nShow value: no\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "key",
              content: "Progress",
              content_length_category: "short",
              text_length_category: "short",
            },
            {
              type: "value",
              content: "50%",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          datapoint_display: "kv_percent_bar",
          datapoint_payload: { percent: 50, value: 50, max: 100 },
        },
      ],
    },
  },
  percent_both_off: {
    theme: "## Drawing elements\n### Key Value Bars\nShow key: no\nShow value: no\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "key",
              content: "Progress",
              content_length_category: "short",
              text_length_category: "short",
            },
            {
              type: "value",
              content: "50%",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          datapoint_display: "kv_percent_bar",
          datapoint_payload: { percent: 50, value: 50, max: 100 },
        },
      ],
    },
  },
  ring_leaf: {
    theme: "## Drawing elements\n### Unit Ratios\nStyle: ring\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "text",
          content: "25/100 progress",
          content_length_category: "short",
          text_length_category: "short",
          datapoint_display: "unit_ratio",
          datapoint_payload: { value: 25, max: 100, unit: "progress" },
        },
      ],
    },
  },
  ring_group: {
    theme: "## Drawing elements\n### Unit Ratios\nStyle: ring\nShow total: no\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "text",
              content: "25/100",
              content_length_category: "short",
              text_length_category: "short",
            },
            {
              type: "text",
              content: "progress",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          datapoint_display: "unit_ratio",
          datapoint_payload: { value: 25, max: 100, unit: "progress" },
        },
      ],
    },
  },
  ring_group_key_off: {
    theme: "## Drawing elements\n### Unit Ratios\nStyle: ring\nShow key: no\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "text",
              content: "25/100",
              content_length_category: "short",
              text_length_category: "short",
            },
            {
              type: "text",
              content: "progress",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          datapoint_display: "unit_ratio",
          datapoint_payload: { value: 25, max: 100, unit: "progress" },
        },
      ],
    },
  },
  chart: {
    theme: "## Charts\nEnabled: yes\n",
    tree: {
      type: "group",
      content: "",
      children: [
        {
          type: "group",
          content: "",
          children: [
            {
              type: "text",
              content: "x",
              content_length_category: "short",
              text_length_category: "short",
            },
          ],
          chart_group: true,
          chart_data: { series: null, unit: "", rows: [{ label: "a", values: [1, 2] }] },
        },
      ],
    },
  },
};

const EXPECTED: Record<string, unknown> = {
  chips_off: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "-",
        ratios: [],
        render_properties: { date_text: "Aug 12", text_style_chain: ["bold"] },
      },
    ],
  },
  chips_on: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "row",
        ratios: [1.0],
        children: [
          {
            type: "col",
            ratios: [1.0, 1.0],
            content_id: "0",
            flags: { is_card: true, card_kind: "date_chip" },
            children: [
              { type: "-", ratios: [], content_id: "0.0", render_properties: { date_role: "key" } },
              { type: "-", ratios: [], content_id: "0.1", render_properties: { date_role: "day" } },
            ],
          },
        ],
      },
    ],
  },
  unit_leaf_total_off: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "col",
        ratios: [1.0],
        children: [
          {
            type: "row",
            ratios: [512.0, 80.0],
            flags: { line_split: true },
            children: [
              {
                type: "-",
                ratios: [],
                render_properties: {
                  datapoint_bar: { value: 25, max: 100, unit: "progress", kind: "unit" },
                },
              },
              {
                type: "-",
                ratios: [],
                content_id: "0",
                render_properties: { text_override: "25 progress" },
              },
            ],
          },
        ],
      },
    ],
  },
  unit_leaf_key_off: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "col",
        ratios: [1.0],
        children: [
          {
            type: "row",
            ratios: [547.0, 45.0],
            flags: { line_split: true },
            children: [
              {
                type: "-",
                ratios: [],
                render_properties: {
                  datapoint_bar: { value: 25, max: 100, unit: "progress", kind: "unit" },
                },
              },
              {
                type: "-",
                ratios: [],
                content_id: "0",
                render_properties: { text_override: "25/100" },
              },
            ],
          },
        ],
      },
    ],
  },
  unit_leaf_both_off: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "col",
        ratios: [1.0],
        children: [
          {
            type: "row",
            ratios: [575.0, 17.0],
            flags: { line_split: true },
            children: [
              {
                type: "-",
                ratios: [],
                render_properties: {
                  datapoint_bar: { value: 25, max: 100, unit: "progress", kind: "unit" },
                },
              },
              {
                type: "-",
                ratios: [],
                content_id: "0",
                render_properties: { text_override: "25" },
              },
            ],
          },
        ],
      },
    ],
  },
  ratio_leaf: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "col",
        ratios: [1.0],
        children: [
          {
            type: "row",
            ratios: [568.0, 24.0],
            flags: { line_split: true },
            children: [
              {
                type: "-",
                ratios: [],
                render_properties: { datapoint_bar: { value: 4.5, max: 8, kind: "ratio" } },
              },
              { type: "-", ratios: [], content_id: "0" },
            ],
          },
        ],
      },
    ],
  },
  ratio_leaf_total_off: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "col",
        ratios: [1.0],
        children: [
          {
            type: "row",
            ratios: [568.0, 24.0],
            flags: { line_split: true },
            children: [
              {
                type: "-",
                ratios: [],
                render_properties: { datapoint_bar: { value: 4.5, max: 8, kind: "ratio" } },
              },
              {
                type: "-",
                ratios: [],
                content_id: "0",
                render_properties: { text_override: "4.5" },
              },
            ],
          },
        ],
      },
    ],
  },
  ratio_leaf_left: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "col",
        ratios: [1.0],
        children: [
          {
            type: "row",
            ratios: [24.0, 568.0],
            flags: { line_split: true },
            children: [
              { type: "-", ratios: [], content_id: "0" },
              {
                type: "-",
                ratios: [],
                render_properties: { datapoint_bar: { value: 4.5, max: 8, kind: "ratio" } },
              },
            ],
          },
        ],
      },
    ],
  },
  unit_leaf_left_key_off: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "col",
        ratios: [1.0],
        children: [
          {
            type: "row",
            ratios: [45.0, 547.0],
            flags: { line_split: true },
            children: [
              {
                type: "-",
                ratios: [],
                content_id: "0",
                render_properties: { text_override: "25/100" },
              },
              {
                type: "-",
                ratios: [],
                render_properties: {
                  datapoint_bar: { value: 25, max: 100, unit: "progress", kind: "unit" },
                },
              },
            ],
          },
        ],
      },
    ],
  },
  unit_group: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "row",
        ratios: [480.0, 45.0, 59.0],
        flags: { line_split: true },
        children: [
          {
            type: "-",
            ratios: [],
            render_properties: {
              datapoint_bar: { value: 25, max: 100, unit: "progress", kind: "unit" },
            },
          },
          { type: "-", ratios: [], content_id: "0.0" },
          { type: "-", ratios: [], content_id: "0.1" },
        ],
      },
    ],
  },
  unit_group_total_off: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "row",
        ratios: [508.0, 17.0, 59.0],
        flags: { line_split: true },
        children: [
          {
            type: "-",
            ratios: [],
            render_properties: {
              datapoint_bar: { value: 25, max: 100, unit: "progress", kind: "unit" },
            },
          },
          { type: "-", ratios: [], content_id: "0.0", render_properties: { text_override: "25" } },
          { type: "-", ratios: [], content_id: "0.1" },
        ],
      },
    ],
  },
  unit_group_key_off: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "row",
        ratios: [547.0, 45.0],
        flags: { line_split: true },
        children: [
          {
            type: "-",
            ratios: [],
            render_properties: {
              datapoint_bar: { value: 25, max: 100, unit: "progress", kind: "unit" },
            },
          },
          {
            type: "-",
            ratios: [],
            content_id: "0.0",
            render_properties: { text_override: "25/100" },
          },
        ],
      },
    ],
  },
  unit_group_both_off: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "row",
        ratios: [575.0, 17.0],
        flags: { line_split: true },
        children: [
          {
            type: "-",
            ratios: [],
            render_properties: {
              datapoint_bar: { value: 25, max: 100, unit: "progress", kind: "unit" },
            },
          },
          { type: "-", ratios: [], content_id: "0.0", render_properties: { text_override: "25" } },
        ],
      },
    ],
  },
  unit_kv: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "col",
        ratios: [1.0, 1.0],
        children: [
          {
            type: "row",
            ratios: [1.0, 1.0],
            flags: { line_split: true },
            children: [
              { type: "-", ratios: [], content_id: "0.0" },
              {
                type: "-",
                ratios: [],
                content_id: "0.1",
                render_properties: { content_align: "right" },
              },
            ],
          },
          {
            type: "-",
            ratios: [],
            render_properties: {
              datapoint_bar: { value: 7, max: 8, unit: "Minutes", from_kv: true, kind: "kv_unit" },
            },
          },
        ],
      },
    ],
  },
  unit_kv_total_off: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "col",
        ratios: [1.0, 1.0],
        children: [
          {
            type: "row",
            ratios: [1.0, 1.0],
            flags: { line_split: true },
            children: [
              { type: "-", ratios: [], content_id: "0.0" },
              {
                type: "-",
                ratios: [],
                content_id: "0.1",
                render_properties: { text_override: "7", content_align: "right" },
              },
            ],
          },
          {
            type: "-",
            ratios: [],
            render_properties: {
              datapoint_bar: { value: 7, max: 8, unit: "Minutes", from_kv: true, kind: "kv_unit" },
            },
          },
        ],
      },
    ],
  },
  unit_kv_key_off: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "col",
        ratios: [1.0, 1.0],
        children: [
          { type: "-", ratios: [], content_id: "0.1", flags: { line_split: true } },
          {
            type: "-",
            ratios: [],
            render_properties: {
              datapoint_bar: { value: 7, max: 8, unit: "Minutes", from_kv: true, kind: "kv_unit" },
            },
          },
        ],
      },
    ],
  },
  unit_kv_both_off: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "col",
        ratios: [1.0, 1.0],
        children: [
          {
            type: "-",
            ratios: [],
            content_id: "0.1",
            render_properties: { text_override: "7" },
            flags: { line_split: true },
          },
          {
            type: "-",
            ratios: [],
            render_properties: {
              datapoint_bar: { value: 7, max: 8, unit: "Minutes", from_kv: true, kind: "kv_unit" },
            },
          },
        ],
      },
    ],
  },
  unit_kv_above_total_off: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "col",
        ratios: [1.0, 1.0],
        children: [
          {
            type: "-",
            ratios: [],
            render_properties: {
              datapoint_bar: { value: 7, max: 8, unit: "Minutes", from_kv: true, kind: "kv_unit" },
            },
          },
          {
            type: "row",
            ratios: [1.0, 1.0],
            flags: { line_split: true },
            children: [
              { type: "-", ratios: [], content_id: "0.0" },
              {
                type: "-",
                ratios: [],
                content_id: "0.1",
                render_properties: { text_override: "7", content_align: "right" },
              },
            ],
          },
        ],
      },
    ],
  },
  unit_kv_above: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "col",
        ratios: [1.0, 1.0],
        children: [
          {
            type: "-",
            ratios: [],
            render_properties: {
              datapoint_bar: { value: 7, max: 8, unit: "Minutes", from_kv: true, kind: "kv_unit" },
            },
          },
          {
            type: "row",
            ratios: [1.0, 1.0],
            flags: { line_split: true },
            children: [
              { type: "-", ratios: [], content_id: "0.0" },
              {
                type: "-",
                ratios: [],
                content_id: "0.1",
                render_properties: { content_align: "right" },
              },
            ],
          },
        ],
      },
    ],
  },
  percent: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "col",
        ratios: [1.0, 1.0],
        children: [
          {
            type: "row",
            ratios: [1.0, 1.0],
            flags: { line_split: true },
            children: [
              { type: "-", ratios: [], content_id: "0.0" },
              {
                type: "-",
                ratios: [],
                content_id: "0.1",
                render_properties: { content_align: "right" },
              },
            ],
          },
          {
            type: "-",
            ratios: [],
            render_properties: {
              datapoint_bar: { percent: 50, value: 50, max: 100, kind: "percent" },
            },
          },
        ],
      },
    ],
  },
  percent_above: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "col",
        ratios: [1.0, 1.0],
        children: [
          {
            type: "-",
            ratios: [],
            render_properties: {
              datapoint_bar: { percent: 50, value: 50, max: 100, kind: "percent" },
            },
          },
          {
            type: "row",
            ratios: [1.0, 1.0],
            flags: { line_split: true },
            children: [
              { type: "-", ratios: [], content_id: "0.0" },
              {
                type: "-",
                ratios: [],
                content_id: "0.1",
                render_properties: { content_align: "right" },
              },
            ],
          },
        ],
      },
    ],
  },
  percent_key_off: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "col",
        ratios: [1.0, 1.0],
        children: [
          { type: "-", ratios: [], content_id: "0.1", flags: { line_split: true } },
          {
            type: "-",
            ratios: [],
            render_properties: {
              datapoint_bar: { percent: 50, value: 50, max: 100, kind: "percent" },
            },
          },
        ],
      },
    ],
  },
  percent_value_off: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "col",
        ratios: [1.0, 1.0],
        children: [
          { type: "-", ratios: [], content_id: "0.0", flags: { line_split: true } },
          {
            type: "-",
            ratios: [],
            render_properties: {
              datapoint_bar: { percent: 50, value: 50, max: 100, kind: "percent" },
            },
          },
        ],
      },
    ],
  },
  percent_both_off: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "col",
        ratios: [1.0],
        children: [
          {
            type: "-",
            ratios: [],
            render_properties: {
              datapoint_bar: { percent: 50, value: 50, max: 100, kind: "percent" },
            },
          },
        ],
      },
    ],
  },
  ring_leaf: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "col",
        ratios: [1.0],
        children: [
          {
            type: "row",
            ratios: [1.0],
            children: [
              {
                type: "col",
                ratios: [1.0, 1.0],
                content_id: "0",
                render_properties: { ring: { value: 25.0, max: 100.0 } },
                flags: { is_card: true, card_kind: "ring" },
                children: [
                  {
                    type: "-",
                    ratios: [],
                    render_properties: { ring_role: "value", ring_text: "25/100" },
                  },
                  {
                    type: "-",
                    ratios: [],
                    render_properties: { ring_role: "unit", ring_text: "progress" },
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  ring_group: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "row",
        ratios: [1.0],
        children: [
          {
            type: "col",
            ratios: [1.0, 1.0],
            content_id: "0",
            render_properties: { ring: { value: 25.0, max: 100.0 } },
            flags: { is_card: true, card_kind: "ring" },
            children: [
              { type: "-", ratios: [], render_properties: { ring_role: "value", ring_text: "25" } },
              {
                type: "-",
                ratios: [],
                render_properties: { ring_role: "unit", ring_text: "progress" },
              },
            ],
          },
        ],
      },
    ],
  },
  ring_group_key_off: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "row",
        ratios: [1.0],
        children: [
          {
            type: "col",
            ratios: [1.0],
            content_id: "0",
            render_properties: { ring: { value: 25.0, max: 100.0 } },
            flags: { is_card: true, card_kind: "ring" },
            children: [
              {
                type: "-",
                ratios: [],
                render_properties: { ring_role: "value", ring_text: "25/100" },
              },
            ],
          },
        ],
      },
    ],
  },
  chart: {
    type: "layout",
    ratios: [600, 0.0],
    children: [
      {
        type: "-",
        ratios: [],
        content_id: "0",
        render_properties: {
          chart: { series: null, unit: "", rows: [{ label: "a", values: [1, 2] }] },
        },
      },
    ],
  },
};

for (const [name, { theme, tree }] of Object.entries(CASES)) {
  test(`display: ${name}`, () => {
    const built = generate(
      layoutInput(new RegexKit(), withPaths(tree)),
      600,
      parseTheme(theme),
      MEASURER,
    );
    expect(JSON.parse(JSON.stringify(compact(built)))).toEqual(EXPECTED[name]);
  });
}
