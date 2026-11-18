// Where a tap lands (md2ui `render_actions.build_regions`, `_merge_marks`). A link card's
// region is the rectangle placement gave it: placement notes the slot a node is placed in
// and, for a wrapped card, the outer box its background fills, and the two merge here by
// node id into what the user sees. A heading anchor is the top of the same union.
import type { GroupingNode } from "@md2ui/contracts";
import { held } from "../actions/choices.ts";
import { inlineLinkUrls, parseInlineSpans, plainLinkLabel } from "../actions/inline-spans.ts";
import {
  type Action,
  actionFor,
  cardLabel,
  controlAction,
  makeAction,
  NOT_PROSE,
} from "../actions/targets.ts";
import { linkDestination } from "../group/link-content.ts";
import { copiedText, copyButtonRect } from "../measure/code-blocks.ts";
import { countRects, sliderRect, taskControlRect } from "../measure/drawing.ts";
import { LINE_SCALE, resolveHAlign, truthy } from "../measure/leaf-kit.ts";
import type { SizedNode } from "../measure/node-index.ts";
import type { Sizer } from "../measure/sizer.ts";
import { flaggedTextSpans } from "../measure/text-runs.ts";
import type { HitRegion, LayoutBox } from "./boxes.ts";
import { flagRuns, lineStart } from "./lines.ts";
import type { Mark } from "./place.ts";

/** md2ui `_merge_marks`: link-card regions and heading anchors, each the union of its marks. */
function mergeMarks(
  sizer: Sizer,
  marks: readonly Mark[],
  nodes: ReadonlyMap<string, GroupingNode>,
): { regions: HitRegion[]; anchors: Record<string, number> } {
  const spans = new Map<
    string,
    {
      kind: Mark["kind"];
      key: string;
      url: string | null;
      x0: number;
      y0: number;
      x1: number;
      y1: number;
    }
  >();
  for (const m of marks) {
    const id = `${m.kind}\u0000${m.key}`;
    const span = spans.get(id);
    if (span === undefined) {
      spans.set(id, {
        kind: m.kind,
        key: m.key,
        url: m.url,
        x0: m.x,
        y0: m.y,
        x1: m.x + m.width,
        y1: m.y + m.height,
      });
    } else {
      span.x0 = Math.min(span.x0, m.x);
      span.y0 = Math.min(span.y0, m.y);
      span.x1 = Math.max(span.x1, m.x + m.width);
      span.y1 = Math.max(span.y1, m.y + m.height);
    }
  }
  const regions: HitRegion[] = [];
  const anchors: Record<string, number> = {};
  const { kit } = sizer.leaves;
  for (const { kind, key, url, x0, y0, x1, y1 } of spans.values()) {
    if (kind === "anchor") {
      anchors[key] = y0;
      continue;
    }
    const nd = nodes.get(key);
    const label = nd === undefined ? "" : cardLabel(kit, nd);
    const action = actionFor(kit, url, label, key);
    if (action !== null) {
      regions.push({ x: x0, y: y0, width: x1 - x0, height: y1 - y0, action, card: true, step: 0 });
    }
  }
  return { regions, anchors };
}

/** md2ui `build_regions`: every clickable region of one placed scene, and its heading anchors. */
export function buildRegions(
  sizer: Sizer,
  boxes: readonly LayoutBox[],
  marks: readonly Mark[],
  nodes: ReadonlyMap<string, GroupingNode>,
): { regions: HitRegion[]; anchors: Record<string, number> } {
  const { regions, anchors } = mergeMarks(sizer, marks, nodes);
  return { regions: [...regions, ...buttonRegions(sizer, boxes, nodes)], anchors };
}

// md2ui `_DRAWN_INSTEAD`: hints that make a box draw something other than its node (a
// gutter marker, a separator, a table key, a datapoint display), so it is never a button.
const DRAWN_INSTEAD = Object.freeze([
  "list_marker",
  "separator",
  "table_key",
  "datapoint_bar",
  "ring_role",
  "chart",
  "line_chart",
]);

const HARD_BREAK = "\u2028";

const rect = (
  r: readonly [number, number, number, number],
  action: Action,
  step: HitRegion["step"] = 0,
): HitRegion => ({ x: r[0], y: r[1], width: r[2], height: r[3], action, card: false, step });

/** md2ui `_copy_region`: a code block's copy button, at the rectangle it is painted in. */
function copyRegion(sizer: Sizer, box: LayoutBox, nd: GroupingNode): HitRegion {
  const label = sizer.theme.code_blocks.copy_icon ?? "";
  const action = { ...makeAction("copy", nd.node_id, label), text: copiedText(nd.content ?? "") };
  return rect(copyButtonRect(box, sizer.theme), action);
}

/**
 * md2ui `_drawing_region`: a task control or slider region, from the geometry of its
 * paint, none for one written `~~`; a count's two (md2ui `count_regions`): one target, so both report its action,
 * and each steps it one way.
 */
function drawingRegions(sizer: Sizer, box: LayoutBox, nd: GroupingNode): HitRegion[] {
  const payload = nd.drawing_element;
  // None for a control written `~~` (disabled).
  if (payload === undefined || payload["disabled"]) return [];
  const { kit } = sizer.leaves;
  if (payload.kind === "slider") {
    if (!sizer.theme.datapoints.sliders.enabled) return [];
    const action = controlAction(kit, nd, payload, "slider");
    if (action === null) return [];
    if (!action.count) return [rect(sliderRect(box, sizer.theme), action)];
    const [minus, plus] = countRects(box, payload, sizer.theme);
    return [rect(minus, action, -1), rect(plus, action, 1)];
  }
  if (payload.kind !== "task_control" || !sizer.theme.datapoints.task_controls.enabled) return [];
  const action = controlAction(kit, nd, payload, "checkbox");
  return action === null ? [] : [rect(taskControlRect(box, sizer.theme), action)];
}

/**
 * md2ui `_inline_regions`: one region per link inside a text, per line it is drawn on,
 * from the lines `_text_leaf_lines` lays the text out in.
 */
function inlineRegions(sizer: Sizer, box: LayoutBox, nd: GroupingNode): HitRegion[] {
  const content = nd.content ?? "";
  const sized = box.content_id === null ? undefined : sizer.index.get(box.content_id);
  if (
    sized === undefined ||
    NOT_PROSE.includes(nd.type) ||
    (!content.includes("](") && !content.includes("<"))
  ) {
    return [];
  }
  const { leaves, theme } = sizer;
  const { kit } = leaves;
  const rp = box.render_properties;
  const leaf = leaves.leafText(sized, rp, "line");
  const linked = flaggedTextSpans(
    kit,
    leaf.content,
    leaf.sized.faces,
    leaf.sized.size,
    leaf.sized.emoji,
  );
  const lines = leaves.prepare(linked.map((s) => s.span)).lines(box.width);
  const urls = inlineLinkUrls(kit, leaf.content);
  const words = new Map<number, string[]>();
  for (const span of parseInlineSpans(kit, leaf.content)) {
    if (span.link === 0) continue;
    const parts = span.text.split(HARD_BREAK).flatMap((chunk) => chunk.split(" "));
    words.set(span.link, [...(words.get(span.link) ?? []), ...parts.filter((p) => p !== "")]);
  }
  const align = truthy(rp?.["date_role"]) ? "center" : resolveHAlign(rp, theme);
  const lineHeight = leaf.sized.size * LINE_SCALE;
  const regions: HitRegion[] = [];
  lines.forEach((line, lineIndex) => {
    const start = lineStart(box.x, box.width, line.width, align);
    for (const { id, x0, x1 } of flagRuns(line, start, (f) => linked[f.span]?.link ?? 0)) {
      const label = (words.get(id) ?? []).join(" ");
      const action = actionFor(kit, urls[id - 1] ?? null, label, `${nd.node_id}#${id}`);
      if (action !== null) {
        regions.push({
          x: x0,
          y: box.y + lineIndex * lineHeight,
          width: x1 - x0,
          height: lineHeight,
          action,
          card: false,
          step: 0,
        });
      }
    }
  });
  return regions;
}

/** md2ui `_link_pill_rect`: where a button's pill is painted, for its click to land on the ink. */
export function linkPillRect(
  sizer: Sizer,
  box: LayoutBox,
  sized: SizedNode,
): [number, number, number, number] {
  const pill = sizer.leaves.linkPill(sized);
  const align = resolveHAlign(box.render_properties, sizer.theme);
  const x =
    align === "center"
      ? box.x + (box.width - pill.width) / 2
      : align === "right"
        ? box.x + (box.width - pill.width)
        : box.x;
  return [x, box.y + (box.height - pill.height) / 2, pill.width, pill.height];
}

/**
 * md2ui `_button_regions`: one region per live button at the pill its drawer paints, per
 * task control or slider, per code block's copy button, and per link inside a text.
 */
function buttonRegions(
  sizer: Sizer,
  boxes: readonly LayoutBox[],
  nodes: ReadonlyMap<string, GroupingNode>,
): HitRegion[] {
  const regions: HitRegion[] = [];
  for (const box of boxes) {
    const nd = box.content_id ? nodes.get(box.content_id) : undefined;
    if (nd === undefined) continue;
    const rp = box.render_properties;
    if (DRAWN_INSTEAD.some((key) => rp?.[key] != null)) continue;
    if (nd.type === "code_block") {
      if (sizer.theme.code_blocks.copy_icon) regions.push(copyRegion(sizer, box, nd));
    } else if (nd.type === "drawing_element") {
      regions.push(...drawingRegions(sizer, box, nd));
    } else if (nd.type !== "link") {
      regions.push(...inlineRegions(sizer, box, nd));
    } else if (!nd.link_disabled) {
      const sized = sizer.index.get(nd.node_id);
      if (sized === undefined) continue;
      const { kit } = sizer.leaves;
      const action = held(
        actionFor(
          kit,
          linkDestination(kit, nd.content ?? ""),
          plainLinkLabel(kit, nd.link_label ?? "", nd.link_variant),
          nd.node_id,
        ),
        nd,
      );
      if (action !== null) regions.push(rect(linkPillRect(sizer, box, sized), action));
    }
  }
  return regions;
}
