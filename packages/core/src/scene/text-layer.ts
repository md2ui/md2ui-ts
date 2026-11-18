// The words a host lays over the painted page, so that the browser selects, copies and
// finds them (ADR-402: selection and find-in-page are a host layer built from the same
// entries). One pass over a display list's text entries (C4), so a host never reads C4
// for its text again; C4 itself does not change.
//
// Each painted run goes to the outline item whose box it is painted in, so the item that
// names a heading or a paragraph for a screen reader also holds its words: no word is in
// the host's DOM twice. Between two runs it carries what a copy writes there, as the
// item's text writes it (a space, a hard break, a code line's indentation). A run painted in no text item (a button's label, a
// list marker, a chart's label) reads before the next item. A symbol a control paints (a
// task box's tick, a code block's copy icon) is no word, and is left out.
//
// A run's width and its font's extent are not given: the host measures them on the
// canvas it paints with, whose answers are the paint's own. The measurer the scene was
// laid out with may run in a Worker, whose answers can differ (Firefox, a code line,
// 5.9 px).
import type {
  DisplayEntry,
  DisplayList,
  FontSpec,
  OutlineItem,
  Rect,
  TextEntry,
  TextMeasurer,
} from "@md2ui/contracts";

/** One painted run of one line: what one `fillText` drew. */
export interface LineRun {
  readonly text: string;
  readonly font: FontSpec;
  /** Its left edge and baseline, in content space. */
  readonly x: number;
  readonly baseline: number;
  /** What a copy writes between the run before it and this one; `""` for the first. */
  readonly before: string;
}

/** The runs one place in the reading order holds. */
export interface TextGroup {
  readonly runs: readonly LineRun[];
  /** What a copy writes after them: a line break, or a space before the item they lead. */
  readonly end: string;
}

/** The painted words of one width's scene, by where they read in its outline. */
export interface SceneText {
  /** By outline index: the words a heading or text item paints. */
  readonly items: ReadonlyMap<number, TextGroup>;
  /**
   * By outline index: words no item holds, which read just before that item;
   * `outline.length` for those after the last.
   */
  readonly loose: ReadonlyMap<number, TextGroup>;
}

/**
 * How many text items past the current one a run's box is looked for in. Runs come in the
 * outline's own order (both follow the scene's boxes), so the box is the current item or
 * the next, unless items paint nothing (a text cut away entirely).
 */
const LOOKAHEAD = 8;

/** How far outside a box a run may start and still be painted in it (rounding). */
const SLACK = 1;

const inside = (r: Rect, x: number, y: number): boolean =>
  x >= r.x - SLACK && x <= r.x + r.width + SLACK && y >= r.y - SLACK && y <= r.y + r.height + SLACK;

/**
 * A run as painted, before what separates it from the run before is known, with its
 * advance as laid out, which tells where it leaves a gap.
 */
type Placed = Omit<LineRun, "before"> & { readonly width: number };

const given = ({ text, font, x, baseline }: Placed, before: string): LineRun => ({
  text,
  font,
  x,
  baseline,
  before,
});

/** What lies between two runs no item's text writes: a space where they leave a gap. */
function looseGap(prev: Placed, run: Placed): string {
  if (Math.abs(prev.baseline - run.baseline) > SLACK) return "\n";
  return run.x - (prev.x + prev.width) > SLACK ? " " : "";
}

/**
 * The runs of one item, each with the text `written` puts before it: the item's text is
 * read alongside the runs, and the white space it holds between two of them is what lies
 * between them. Where a run's words are not the next ones it holds (an emoji drawn for a
 * shortcode), a soft line break or a gap reads as a space.
 */
function separated(runs: readonly Placed[], written: string): LineRun[] {
  let at = 0;
  return runs.map((run, i) => {
    const found = written.indexOf(run.text, at);
    const skipped = found < 0 ? null : written.slice(at, found);
    if (skipped !== null && skipped.trim() === "") {
      at = found + run.text.length;
      return given(run, i === 0 ? "" : skipped);
    }
    const prev = runs[i - 1];
    const gap = prev === undefined ? "" : looseGap(prev, run);
    return given(run, gap === "\n" ? " " : gap);
  });
}

/**
 * The words `list` paints, given to `outline`'s items; `text` is the measurer it was laid
 * out with.
 */
export function sceneText(
  list: DisplayList,
  outline: readonly OutlineItem[],
  text: TextMeasurer,
): SceneText {
  const boxes: { readonly index: number; readonly bounds: Rect; readonly text: string }[] = [];
  outline.forEach((item, index) => {
    if (item.role === "heading" || item.role === "text") {
      boxes.push({ index, bounds: item.bounds, text: item.text });
    }
  });
  const symbols = list.targets.flatMap((t) =>
    t.kind === "copy" || t.kind === "checkbox" ? [t.rect] : [],
  );
  const held = new Map<number, Placed[]>();
  const loose = new Map<number, Placed[]>();
  /** Runs already given, by baseline, left edge and text: a pin's overpaint repeats them. */
  const seen = new Set<string>();
  let current = 0;

  /** The text item whose box holds the point, from the current one on. */
  const holder = (x: number, y: number): number | null => {
    const last = Math.min(boxes.length, current + LOOKAHEAD);
    for (let j = current; j < last; j++) {
      if (inside((boxes[j] as (typeof boxes)[number]).bounds, x, y)) {
        current = j;
        return j;
      }
    }
    return null;
  };

  const runsOf = (entry: TextEntry): Placed[] =>
    entry.runs.flatMap((run) => {
      const { text: words, font, x } = run;
      const key = `${entry.y}|${x}|${words}`;
      if (seen.has(key)) return [];
      seen.add(key);
      const width = text.advance(words, font);
      // A symbol is centred in its control, and may be wider than it.
      const centre = x + width / 2;
      if (symbols.some((rect) => inside(rect, centre, entry.y))) return [];
      return [{ text: words, font, x, baseline: entry.y, width }];
    });

  const give = (to: Map<number, Placed[]>, index: number, runs: readonly Placed[]): void => {
    const into = to.get(index);
    if (into === undefined) to.set(index, [...runs]);
    else into.push(...runs);
  };

  const place = (entry: TextEntry, box: number | null): void => {
    const runs = runsOf(entry);
    if (runs.length === 0) return;
    if (box !== null) {
      give(held, (boxes[box] as (typeof boxes)[number]).index, runs);
      return;
    }
    // Before the current item, unless it already has its words: then before the next.
    const at = boxes[current];
    const next = at !== undefined && held.has(at.index) ? boxes[current + 1] : at;
    give(loose, next?.index ?? outline.length, runs);
  };

  const visit = (entry: DisplayEntry): void => {
    if (entry.type === "text") {
      const first = entry.runs[0];
      place(entry, first === undefined ? null : holder(first.x, entry.y));
    } else if (entry.type === "scroll") {
      // A scrolling code block's lines run past its box; the box is its item's.
      const box = holder(entry.bounds.x + entry.bounds.width / 2, entry.bounds.y + 1);
      for (const line of entry.entries) place(line, box);
    } else if (entry.type === "layer") {
      // A muted count's digits are in its layer.
      entry.entries.forEach(visit);
    }
  };
  list.entries.forEach(visit);

  const items = new Map<number, TextGroup>();
  for (const { index, text: written } of boxes) {
    const runs = held.get(index);
    if (runs !== undefined) items.set(index, { runs: separated(runs, written), end: "\n" });
  }
  const free = new Map<number, TextGroup>();
  for (const [index, runs] of loose) {
    const last = runs.at(-1) as Placed;
    const lead = items.get(index)?.runs[0];
    // A list marker on its item's first line reads as part of that line.
    const end = lead !== undefined && Math.abs(lead.baseline - last.baseline) <= SLACK ? " " : "\n";
    free.set(index, {
      runs: runs.map((run, i) => {
        const prev = runs[i - 1];
        return given(run, prev === undefined ? "" : looseGap(prev, run));
      }),
      end,
    });
  }
  return { items, loose: free };
}
