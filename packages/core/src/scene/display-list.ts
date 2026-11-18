// The display list (C4) of one placed scene (md2ui `draw_document`, recorded once per
// width, ADR-402): the root's box, every section background, every box's paint, and the
// section strokes above it all; the click regions as targets, by the ordinals the wire
// names them by; the heading anchors. Beside it, the semantic outline the host builds
// its accessibility layer from, and the list as host state shows it (md2ui
// `with_node_states`): the same geometry, with some nodes' colours swapped.
import type {
  DisplayEntry,
  DisplayList,
  GroupingNode,
  HitTarget,
  HostState,
  OutlineItem,
  PageBackground,
  Paint,
  ResolvedTheme,
} from "@md2ui/contracts";
import { parseInlineSpans } from "../actions/inline-spans.ts";
import { actionTargets, type DocumentTarget } from "../actions/targets.ts";
import { copiedText } from "../measure/code-blocks.ts";
import { filled } from "../measure/layers.ts";
import { effectiveLeafNode, hint, type Props } from "../measure/leaf-kit.ts";
import type { NodeIndex, SizedNode } from "../measure/node-index.ts";
import type { Sizer } from "../measure/sizer.ts";
import { imageAlt } from "../utils/image-params.ts";
import type { BgStack, LayoutBox, Scene } from "./boxes.ts";
import { drawBox } from "./draw/content.ts";
import type { CodeHighlighter, Draw } from "./draw/context.ts";
import { css, pen, roundShape } from "./draw/pen.ts";
import { fixedPins } from "./draw/pins.ts";
import { drawSections } from "./draw/sections.ts";
import { paintSegmented, type SegmentedRun, segmentedRuns } from "./draw/segmented.ts";
import { groupingIndex } from "./scene.ts";

/** A segmented run's surface and dividers, and the stack its buttons sit on. */
interface RunPaint {
  readonly entries: readonly DisplayEntry[];
  readonly stack: BgStack;
}

/** One width's paint: the list, its outline, and the list under host state. */
export interface PaintedScene {
  readonly list: DisplayList;
  readonly outline: readonly OutlineItem[];
  /** The list as `states` show it, keyed by target ordinal: the same geometry, other colours. */
  withStates(states: ReadonlyMap<number, HostState>): DisplayList;
}

/** md2ui `draw_scene`'s viewport-fixed root background: colour, image, gradient, shadows. */
function pageBackground(theme: ResolvedTheme): PageBackground {
  const root = theme.root;
  const paints: Paint[] = [{ kind: "color", color: css(root.bg_color) }];
  if (filled(root.bg_image)) paints.push({ kind: "image", src: root.bg_image, fallbackSrc: null });
  const g = root.gradient;
  if (g !== null && g.colors.length >= 2) {
    const even = g.ratios.length !== g.colors.length;
    paints.push({
      kind: "linearGradient",
      start: g.start,
      end: g.end,
      stops: g.colors.map((c, i) => ({
        offset: even ? i / (g.colors.length - 1) : (g.ratios[i] as number),
        color: css(c),
      })),
    });
  }
  const shadows = root.shadows
    .filter((sh) => sh.color >>> 24 !== 0)
    .map((sh) => ({
      inner: sh.inner,
      offsetX: sh.offset_x,
      offsetY: sh.offset_y,
      color: css(sh.color),
      radius: sh.radius,
    }));
  return { paints, shadows };
}

/**
 * The node each target's state shows on. md2ui keys a link inside a text as the text's
 * id plus `#k`, which names no node, so it mutes only itself and shows no state: drawn
 * inside prose, it has no disabled paint (`render_actions`).
 */
function nodeStates(
  states: ReadonlyMap<number, HostState>,
  targets: readonly DocumentTarget[],
): Map<string, HostState> {
  const byNode = new Map<string, HostState>();
  for (const [ordinal, state] of states) {
    const target = targets[ordinal];
    if (target !== undefined && target.inline_link === null) byNode.set(target.node_id, state);
  }
  return byNode;
}

/** md2ui `with_node_states`: the sized nodes as the host shows them; colours only. */
function shownNodes(index: NodeIndex, states: ReadonlyMap<string, HostState>): NodeIndex {
  const shown = new Map(index);
  for (const [id, state] of states) {
    const nd = index.get(id);
    if (nd === undefined) continue;
    const payload = nd.drawing_element;
    if (state.kind === "pending") shown.set(id, { ...nd, link_disabled: true });
    else if (state.kind === "checked" && payload !== null) {
      shown.set(id, { ...nd, drawing_element: { ...payload, checked: state.checked } });
    } else if (state.kind === "value" && payload?.["kind"] === "slider") {
      shown.set(id, { ...nd, drawing_element: { ...payload, value: state.value } });
    }
  }
  return shown;
}

/**
 * md2ui `with_node_states`' `choice_shown`: a ticked or unticked button is a choice option
 * the host shows chosen or not, by node id.
 */
function shownChoices(
  index: NodeIndex,
  states: ReadonlyMap<string, HostState>,
): Map<string, boolean> {
  const shown = new Map<string, boolean>();
  for (const [id, state] of states) {
    if (state.kind === "checked" && index.get(id)?.type === "link") shown.set(id, state.checked);
  }
  return shown;
}

/** The click regions as C4 targets, each by the ordinal its key has in the document. */
function targetsOf(
  scene: Scene,
  targets: readonly DocumentTarget[],
  theme: ResolvedTheme,
): HitTarget[] {
  const byKey = new Map(targets.map((t) => [t.key, t]));
  const out: HitTarget[] = [];
  for (const { x, y, width, height, action, card, step } of scene.regions) {
    const rect = { x, y, width, height };
    if (action.kind === "copy") {
      out.push({ kind: "copy", nodeId: action.node_id, rect, text: action.text ?? "" });
      continue;
    }
    const target = byKey.get(action.node_id);
    if (target === undefined) continue;
    const { ordinal, node_id: nodeId } = target;
    const stepped = step === 0 ? {} : { step };
    if (action.kind === "slider") {
      const axis = theme.datapoints.sliders.axis;
      out.push({ kind: "slider", nodeId, rect, ordinal, axis, ...stepped });
    } else {
      out.push({ kind: action.kind, nodeId, rect, ordinal, card, ...stepped });
    }
  }
  return out;
}

// Leaves the outline does not read as text: they show no words, or are targets.
const NOT_TEXT: readonly string[] = Object.freeze([
  "image",
  "horizontal_rule",
  "content_break",
  "spacer",
  "bullet_point",
  "link",
  "drawing_element",
]);

/** The words a leaf shows, markup stripped. */
const shownText = (sizer: Sizer, content: string): string =>
  parseInlineSpans(sizer.leaves.kit, content)
    .map((s) => s.text)
    .join("")
    .replaceAll(" ", "\n");

/** Words spaced once. */
const spaced = (text: string): string => text.split(/\s+/).join(" ").trim();

/** md2ui `_clean_label`: a label's words, spaced once, with no trailing colon. */
const cleanLabel = (text: string): string => spaced(text).replace(/:+$/, "").trim();

/** md2ui `_heading_level`: the trailing number of a heading type, clamped to 1–6. */
const headingLevel = (type: string): 1 | 2 | 3 | 4 | 5 | 6 => {
  const m = /(\d+)$/.exec(type);
  return (m === null ? 1 : Math.max(1, Math.min(6, Number(m[1])))) as 1 | 2 | 3 | 4 | 5 | 6;
};

/** The outline item a placed box reads as, if any. */
function boxItem(sizer: Sizer, box: LayoutBox, nd: SizedNode | null): OutlineItem | null {
  const bounds = { x: box.x, y: box.y, width: box.width, height: box.height };
  const rp = box.render_properties;
  const key = hint(rp, "table_key") as Props | null;
  if (key !== null) return { role: "text", text: String(key["text"] ?? ""), bounds };
  const ring = hint(rp, "ring_text");
  if (ring !== null) return { role: "text", text: String(ring), bounds };
  if (nd === null || hint(rp, "list_marker") !== null || hint(rp, "separator") !== null)
    return null;
  if (nd.type === "image") {
    return { role: "image", text: imageAlt(sizer.leaves.kit, nd.content), bounds };
  }
  if (NOT_TEXT.includes(nd.type)) return null;
  if (nd.atx_level !== 0 || nd.type.startsWith("heading")) {
    const level =
      nd.atx_level !== 0 ? (nd.atx_level as 1 | 2 | 3 | 4 | 5 | 6) : headingLevel(nd.type);
    return { role: "heading", level, text: shownText(sizer, nd.content), bounds };
  }
  const shown = shownText(sizer, nd.type === "code_block" ? copiedText(nd.content) : nd.content);
  return shown.trim() === "" ? null : { role: "text", text: shown, bounds };
}

/**
 * The semantic outline in document order: each box's item, a node's targets after its
 * own item, and a link card's target before the first box inside it, as `action_targets`
 * orders them.
 */
function outlineOf(
  sizer: Sizer,
  scene: Scene,
  grouping: GroupingNode,
  targets: readonly DocumentTarget[],
): OutlineItem[] {
  const parents = new Map<string, string>();
  /** A task box's or slider's label (the grouper's), by its node. */
  const controlLabels = new Map<string, string>();
  const visit = (n: GroupingNode): void => {
    const payload = n.drawing_element;
    if (payload?.kind === "task_control" || payload?.kind === "slider") {
      controlLabels.set(n.node_id, payload.label ?? "");
    }
    for (const child of n.children) {
      parents.set(child.node_id, n.node_id);
      visit(child);
    }
  };
  visit(grouping);
  const byNode = new Map<string, DocumentTarget[]>();
  for (const t of targets) byNode.set(t.node_id, [...(byNode.get(t.node_id) ?? []), t]);
  // A task box or slider is named by the words beside it (the grouper's `label`). The
  // sibling showing exactly those words is that label, read once, as the control's name;
  // a control that reports nothing has no control to carry it, so its label stays.
  const labels = new Map<string, Set<string>>();
  for (const t of targets) {
    const label = controlLabels.get(t.node_id) ?? "";
    const parent = parents.get(t.node_id);
    if (label === "" || t.action === null || parent === undefined) continue;
    labels.set(parent, (labels.get(parent) ?? new Set()).add(cleanLabel(shownText(sizer, label))));
  }
  const listed = new Set<string>();
  const out: OutlineItem[] = [];
  const listTargets = (id: string): void => {
    if (listed.has(id)) return;
    listed.add(id);
    for (const t of byNode.get(id) ?? []) {
      const name = spaced(shownText(sizer, t.action?.label ?? ""));
      out.push({ role: "target", ordinal: t.ordinal, name });
    }
  };
  const isLabel = (id: string, item: OutlineItem): boolean =>
    item.role === "text" && labels.get(parents.get(id) ?? "")?.has(cleanLabel(item.text)) === true;
  for (const box of scene.boxes) {
    const id = box.content_id;
    if (id !== null) {
      const chain: string[] = [];
      for (let up = parents.get(id); up !== undefined; up = parents.get(up)) chain.unshift(up);
      for (const up of chain) listTargets(up);
    }
    const nd = effectiveLeafNode(
      id === null ? null : (sizer.index.get(id) ?? null),
      box.render_properties,
    );
    const item = boxItem(sizer, box, nd);
    if (item !== null && !(id !== null && isLabel(id, item))) out.push(item);
    if (id !== null) {
      listTargets(id);
      if (nd?.type === "code_block" && sizer.theme.code_blocks.copy_icon) {
        out.push({ role: "copy", nodeId: id });
      }
    }
  }
  return out;
}

/**
 * The node each section box is the background of (ADR-104), so it moves with what it
 * holds across an update: the innermost node holding every box whose centre lies in it,
 * when every box that node holds lies in it. A box over no node's box (a divider, the
 * page), or over a run of siblings with no node of their own, names none, `""`.
 */
function sectionNodes(scene: Scene, grouping: GroupingNode): string[] {
  const parent = new Map<string, string>();
  const visit = (node: GroupingNode): void => {
    for (const child of node.children) {
      parent.set(child.node_id, node.node_id);
      visit(child);
    }
  };
  visit(grouping);
  // Each placed box's ancestors, innermost first, and how many boxes each node holds.
  const chains = new Map<LayoutBox, string[]>();
  const held = new Map<string, number>();
  for (const box of scene.boxes) {
    if (box.content_id === null || !parent.has(box.content_id)) continue;
    const chain: string[] = [];
    for (let at: string | undefined = box.content_id; at !== undefined; at = parent.get(at)) {
      chain.push(at);
      held.set(at, (held.get(at) ?? 0) + 1);
    }
    chains.set(box, chain);
  }
  return scene.sections.map((s) => {
    // The ancestors every box inside shares, innermost first.
    let common: string[] | null = null;
    let inside = 0;
    for (const [box, chain] of chains) {
      const x = box.x + box.width / 2 - s.x;
      const y = box.y + box.height / 2 - s.y;
      if (x < 0 || y < 0 || x > s.width || y > s.height) continue;
      const shared: string[] = common ?? chain;
      common = shared.slice(shared.findIndex((a) => chain.includes(a)));
      inside++;
    }
    const node = common?.[0] ?? "";
    return held.get(node) === inside ? node : "";
  });
}

/**
 * md2ui `draw_document` for `scene`, placed from `grouping` by `document`'s sizer. A
 * code block is coloured by `highlight`, or in its text colour without one.
 */
export function paintScene(
  document: Sizer,
  scene: Scene,
  grouping: GroupingNode,
  highlight: CodeHighlighter | null,
): PaintedScene {
  const { theme, leaves } = document;
  const nodes = groupingIndex(grouping);
  // A run is segmented by the theme and the width alone; what it shows chosen is state.
  const runs = segmentedRuns(document, scene.boxes, nodes);
  // md2ui `paint_segmented`: each run's surface and dividers, above the section
  // backgrounds and under every box, recorded under the run's own node, and the stack it
  // makes, which its buttons are painted against (`segment_stack`).
  const runChunk = (d: Draw, run: SegmentedRun): RunPaint => {
    const entries: DisplayEntry[] = [];
    const stack = paintSegmented(d, run, pen(entries, run.id, leaves.text));
    return { entries, stack };
  };
  const segmentsOf = (painted: readonly RunPaint[]): Map<string, BgStack> =>
    new Map(
      runs.flatMap((run, i) => run.buttons.map((id) => [id, (painted[i] as RunPaint).stack])),
    );
  const unsegmented: Draw = {
    sizer: document,
    sized: document.index,
    nodes,
    pins: fixedPins(grouping, theme, leaves.kit),
    highlight,
    choices: new Map(),
    segments: new Map(),
  };
  const runPaints = runs.map((run) => runChunk(unsegmented, run));
  const base: Draw = { ...unsegmented, segments: segmentsOf(runPaints) };

  const under: DisplayEntry[] = [];
  const root = theme.root;
  if (root.box && scene.width > 0 && scene.height > 0) {
    const box = { x: 0, y: 0, width: scene.width, height: scene.height };
    pen(under, "", leaves.text).fill(roundShape(box, root.box_radius), {
      kind: "color",
      color: css(root.box_fill_color),
    });
  }
  const over: DisplayEntry[] = [];
  const ids = sectionNodes(scene, grouping);
  drawSections(
    base,
    scene.sections,
    (i) => pen(under, ids[i] ?? "", leaves.text),
    (i) => pen(over, ids[i] ?? "", leaves.text),
  );

  const chunk = (d: Draw, box: LayoutBox): DisplayEntry[] => {
    const out: DisplayEntry[] = [];
    drawBox(d, box, pen(out, box.content_id ?? "", leaves.text));
    return out;
  };
  const chunks = scene.boxes.map((box) => chunk(base, box));
  const documentTargets = actionTargets(grouping, leaves.kit);
  const shared = {
    version: 1,
    width: scene.width,
    height: scene.height,
    padding: {
      top: root.padding.top,
      right: root.padding.right,
      bottom: root.padding.bottom,
      left: root.padding.left,
    },
    centered: root.centered,
    background: pageBackground(theme),
    targets: targetsOf(scene, documentTargets, theme),
    anchors: Object.entries(scene.anchors).map(([id, y]) => ({ id, y })),
  } as const;
  const listOf = (
    surfaces: readonly RunPaint[],
    boxes: readonly DisplayEntry[][],
  ): DisplayList => ({
    ...shared,
    entries: [...under, ...surfaces.flatMap((s) => s.entries), ...boxes.flat(), ...over],
  });

  return {
    list: listOf(runPaints, chunks),
    outline: outlineOf(document, scene, grouping, documentTargets),
    withStates(states) {
      const byNode = nodeStates(states, documentTargets);
      if (byNode.size === 0) return listOf(runPaints, chunks);
      const stated: Draw = {
        ...unsegmented,
        sized: shownNodes(document.index, byNode),
        choices: shownChoices(document.index, byNode),
      };
      // A run is painted again when a state lands on any of its buttons: a tap moves its
      // divider, and a pending first option changes its surface, so every button of it is
      // painted again on the stack that surface makes.
      const repainted = new Set(byNode.keys());
      const shownRuns = runs.map((run, i) => {
        if (!run.buttons.some((id) => byNode.has(id))) return runPaints[i] as RunPaint;
        for (const id of run.buttons) repainted.add(id);
        return runChunk(stated, run);
      });
      const shown: Draw = { ...stated, segments: segmentsOf(shownRuns) };
      return listOf(
        shownRuns,
        scene.boxes.map((box, i) =>
          box.content_id !== null && repainted.has(box.content_id)
            ? chunk(shown, box)
            : (chunks[i] as DisplayEntry[]),
        ),
      );
    },
  };
}
