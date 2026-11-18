// One stacks, all stack: the members of a repeated grid run share their fit choices
// (md2ui `generator_fit_votes.py`, ADR-301's fit votes). Inside a grid each member's
// answer to "does this pair fit on one row", "did this line wrap", "is this row short of
// room for its spacers" is a vote cast at its path inside the member; the grid settles
// the votes after building the members and builds them once more when they disagreed.
//
// Sibling lines wrap together too: a run of same-kind lines stacked one per row opens a
// poll of its own that carries only the wrap vote. A line inside a grid member votes in
// both runs and obeys both pins; pairs, `:::` rows and spacers stay with the grid run.
//
// md2ui finds a node's member by `node_id` prefix (`mid + "."`). Here a node belongs to a
// member when the member is the node itself or its ancestor, and its path is the
// child-index path from the member, both read from the tree when the poll opens: ids may
// be md2ui's paths or the grouper's content ids. On md2ui's path ids the two agree; the nodes the
// generator makes itself (separator and spacer cells) are in no member's subtree, and
// md2ui's prefix test finds no member for them either.
import type { GroupNode } from "../group/node.ts";
import type { LayoutNode } from "./node.ts";

/**
 * md2ui `_BAR_DISPLAYS`: a pair drawn as a display is not among the pairs the rules always
 * stack: a bar runs its own fit check, and a line chart's key and value never stack.
 */
const BAR_DISPLAYS: readonly string[] = Object.freeze([
  "kv_percent_bar",
  "unit_ratio",
  "line_chart",
]);

/** Where a node sits in a poll's run: the member's index and the path inside it. */
type Location = readonly [member: number, path: string];

/** md2ui `_always_stacks`: a `Key: value` pair the rules stack (no bar display). */
function alwaysStacks(node: GroupNode): boolean {
  if (node.type !== "key-value") return false;
  if (node.datapoint_display !== null && BAR_DISPLAYS.includes(node.datapoint_display)) {
    return false;
  }
  const kinds = new Set(node.children.map((c) => c.type));
  return kinds.has("key") && kinds.has("value");
}

/**
 * md2ui `FitPoll`: the fit votes of one grid run, or only the wrap votes of one run of
 * sibling lines (`linesOnly`), by member-relative path.
 */
export class FitPoll {
  /** Each real node of the run's members, with its member and path (md2ui `locate`'s answer). */
  private readonly where = new Map<GroupNode, Location>();
  /** `{path: {member: stacked}}` from fit checks. */
  readonly votes = new Map<string, Map<number, boolean>>();
  /** The members whose plain pair stands stacked at a path. */
  readonly seeds = new Map<string, Set<number>>();
  /** The pinned paths: `true` when a real fit failure pinned it, which binds a `:::` row. */
  readonly pinned = new Map<string, boolean>();
  /** `{(path, piece kinds): {member: the piece indices a new line starts at}}`. */
  readonly wraps = new Map<string, Map<number, ReadonlySet<number>>>();
  /** The union of a line's breaks, pinned where the members disagreed. */
  readonly wrapPins = new Map<string, ReadonlySet<number>>();
  /** This round's spacer rows: member, path, row, short of room. */
  readonly spacerRows: [number, string, LayoutNode, boolean][] = [];
  rebuilt = false;
  /** A run of sibling lines: it carries only the wrap vote. */
  readonly linesOnly: boolean;

  constructor(run: readonly GroupNode[], linesOnly: boolean) {
    this.linesOnly = linesOnly;
    run.forEach((member, i) => {
      const walk = (node: GroupNode, path: string): void => {
        this.where.set(node, [i, path]);
        if (!linesOnly && alwaysStacks(node)) {
          const seeds = this.seeds.get(path) ?? new Set<number>();
          seeds.add(i);
          this.seeds.set(path, seeds);
        }
        node.children.forEach((c, k) => {
          walk(c, `${path}.${k}`);
        });
      };
      walk(member, "");
    });
  }

  /** md2ui `locate`: `[member, path]` for a node of this run, else `null`. */
  locate(node: GroupNode): Location | null {
    return this.where.get(node) ?? null;
  }

  /** md2ui `cast`: a member that stacked once at a path stays stacked. */
  cast(member: number, path: string, stacked: boolean): void {
    const cast = this.votes.get(path) ?? new Map<number, boolean>();
    cast.set(member, (cast.get(member) ?? false) || stacked);
    this.votes.set(path, cast);
  }
}

/**
 * md2ui `open_poll`: start collecting the fit votes of the grid run `run`, or only the
 * wrap votes of the sibling lines `run` (`linesOnly`).
 */
export function openPoll(polls: FitPoll[], run: readonly GroupNode[], linesOnly = false): FitPoll {
  const poll = new FitPoll(run, linesOnly);
  polls.push(poll);
  return poll;
}

/**
 * md2ui `stacked_lines`: `run`'s lines, one per row, each built by `build`; built again
 * once, with the run's breaks pinned, when one line wrapped where a twin did not. A run
 * of spring rows then shares its column edges (`shareSpringColumns`).
 */
export function stackedLines(
  polls: FitPoll[],
  run: readonly GroupNode[],
  build: (line: GroupNode) => LayoutNode,
): LayoutNode[] {
  const poll = openPoll(polls, run, true);
  for (;;) {
    const built = run.map(build);
    if (!settle(polls, poll)) {
      shareSpringColumns(built);
      return built;
    }
  }
}

/**
 * md2ui `_spring_row`: the spring row `built` draws as its whole line, through any
 * wrapper of one child (a list item's); null when the line is anything else.
 */
function springRow(built: LayoutNode): LayoutNode | null {
  let node = built;
  while (node.type !== "row" && node.children.length === 1) node = node.children[0] as LayoutNode;
  return node.type === "row" && node.spring && node.ratios.length > 0 ? node : null;
}

/**
 * md2ui `_share_spring_columns`: when every line of a stacked run is
 * one spring row of the same region count, each region takes the run's widest ask, as a
 * table column does, so a chart or a chip sits at one x down the list. Sibling spring
 * rows that are not one stacked run keep their own asks.
 */
function shareSpringColumns(built: readonly LayoutNode[]): void {
  const rows: LayoutNode[] = [];
  for (const line of built) {
    const row = springRow(line);
    if (row === null) return;
    rows.push(row);
  }
  const count = rows[0]?.ratios.length;
  if (rows.length < 2 || rows.some((r) => r.ratios.length !== count)) return;
  const shared = (rows[0] as LayoutNode).ratios.map((_, k) =>
    Math.max(...rows.map((r) => r.ratios[k] as number)),
  );
  for (const row of rows) row.ratios = [...shared];
}

/**
 * md2ui `_holders`: the innermost open grid run that holds `node`, with its member and
 * path; a run of sibling lines casts no fit votes.
 */
function holder(polls: readonly FitPoll[], node: GroupNode): [FitPoll, number, string] | null {
  for (let p = polls.length - 1; p >= 0; p--) {
    const poll = polls[p] as FitPoll;
    const hit = poll.linesOnly ? null : poll.locate(node);
    if (hit !== null) return [poll, ...hit];
  }
  return null;
}

/**
 * md2ui `_cast`: `node`'s answer in the innermost open run that holds it; that run's
 * pin at its path (`true` when a real fit failure set it), or `null`.
 */
function castVote(polls: readonly FitPoll[], node: GroupNode, stacked: boolean): boolean | null {
  const held = holder(polls, node);
  if (held === null) return null;
  const [poll, member, path] = held;
  poll.cast(member, path, stacked);
  return poll.pinned.get(path) ?? null;
}

/**
 * md2ui `vote`: whether a key/value pair stacks: its own answer, unless its run pinned
 * it to `stack`.
 */
export function vote(polls: readonly FitPoll[], node: GroupNode, stacked: boolean): boolean {
  const pin = castVote(polls, node, stacked); // cast first: a stacked member's vote counts
  return stacked || pin !== null;
}

/**
 * md2ui `row_stacks`: whether a `:::` row flowed into `rows` must put one cell per line
 * because its run stacked; it votes `stack` when it wrapped its cells.
 */
export function rowStacks(
  polls: readonly FitPoll[],
  node: GroupNode,
  rows: readonly LayoutNode[],
): boolean {
  return castVote(polls, node, rows.length > 1) === true;
}

/**
 * md2ui `line_breaks`: the cells `node`'s line must break before because its runs
 * wrapped there; empty when it already breaks at all of them. `lines` are the pieces of
 * each line as flowed; casting them is its vote. Only lines of the same kinds of piece
 * are the same line. A line votes in every run of sibling lines that holds it and in its
 * innermost grid run, and breaks where any of them pinned; it votes that union in each,
 * so a card's lines carry their wrap to its twins.
 */
export function lineBreaks(
  polls: readonly FitPoll[],
  node: GroupNode,
  cells: readonly GroupNode[],
  lines: readonly (readonly GroupNode[])[],
): Set<GroupNode> {
  const index = new Map<GroupNode, number>();
  cells.forEach((c, k) => {
    index.set(c, k);
  });
  const breaks = new Set<number>();
  for (const line of lines.slice(1)) {
    const first = line[0];
    const k = first === undefined ? undefined : index.get(first);
    if (k !== undefined) breaks.add(k);
  }
  const kinds = cells.map((c) => c.type);
  const held: [FitPoll, number, string][] = [];
  for (let p = polls.length - 1; p >= 0; p--) {
    const poll = polls[p] as FitPoll;
    const hit = poll.locate(node);
    if (hit === null) continue;
    held.push([poll, hit[0], JSON.stringify([hit[1], kinds])]);
    if (!poll.linesOnly) break;
  }
  const pin = new Set<number>();
  for (const [poll, , key] of held) for (const k of poll.wrapPins.get(key) ?? []) pin.add(k);
  for (const [poll, member, key] of held) {
    const wraps = poll.wraps.get(key) ?? new Map<number, ReadonlySet<number>>();
    wraps.set(member, new Set([...breaks, ...pin]));
    poll.wraps.set(key, wraps);
  }
  if ([...pin].every((k) => breaks.has(k))) return new Set();
  const out = new Set<GroupNode>();
  for (const k of pin) {
    const cell = cells[k];
    if (cell !== undefined) out.add(cell);
  }
  return out;
}

/**
 * md2ui `spacer_row`: enter `row`, which holds `node`'s spacers, in its run; `short`
 * when the row has no room for them, which makes the whole run's give way.
 */
export function spacerRow(
  polls: readonly FitPoll[],
  node: GroupNode,
  row: LayoutNode,
  short: boolean,
): void {
  const held = holder(polls, node);
  if (held !== null) held[0].spacerRows.push([held[1], held[2], row, short]);
}

/** md2ui `_pin_spacers`: pin each path's spacer rows together, where two members hold one. */
function pinSpacers(poll: FitPoll): void {
  const paths = new Map<string, [number, LayoutNode, boolean][]>();
  for (const [member, path, row, short] of poll.spacerRows) {
    const found = paths.get(path) ?? [];
    found.push([member, row, short]);
    paths.set(path, found);
  }
  for (const found of paths.values()) {
    if (new Set(found.map(([m]) => m)).size < 2) continue;
    const pin = found.some(([, , s]) => s) ? "give_way" : "keep";
    for (const [, row] of found) {
      row.render_properties = { ...row.render_properties, spacers: pin };
    }
  }
}

/**
 * md2ui `cell_per_line`: `widthOf` for a row that stacks: every cell asks for the whole
 * line, so each takes a line of its own; the gaps between them keep their width.
 */
export function cellPerLine(
  widthOf: (c: GroupNode) => number,
  available: number,
): (c: GroupNode) => number {
  return (c) => (c.separator_kind ? widthOf(c) : available);
}

/**
 * md2ui `settle`: close `poll`'s round. `true` when its members disagreed and must be
 * built again with `stack` pinned where any of them stacked; `false`, and the poll is
 * closed, once the run stands.
 */
export function settle(polls: FitPoll[], poll: FitPoll): boolean {
  if (!poll.rebuilt) {
    for (const [path, cast] of poll.votes) {
      const seeds = poll.seeds.get(path) ?? new Set<number>();
      const values = [...cast.values()];
      const failed = values.some((v) => v);
      if ((failed || seeds.size > 0) && !values.every((v) => v)) {
        if (new Set([...cast.keys(), ...seeds]).size >= 2) poll.pinned.set(path, failed);
      }
    }
    for (const [key, wraps] of poll.wraps) {
      const union = new Set<number>();
      for (const w of wraps.values()) for (const k of w) union.add(k);
      const differs = [...wraps.values()].some(
        (w) => w.size !== union.size || [...union].some((k) => !w.has(k)),
      );
      if (wraps.size >= 2 && differs) poll.wrapPins.set(key, union);
    }
    if (poll.pinned.size > 0 || poll.wrapPins.size > 0) {
      poll.rebuilt = true;
      poll.spacerRows.length = 0;
      return true;
    }
  }
  pinSpacers(poll);
  polls.splice(polls.indexOf(poll), 1);
  return false;
}
