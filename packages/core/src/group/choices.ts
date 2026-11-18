// Which buttons are a choice's options, and which runs of them are segmented (md2ui:
// pipeline/grouper_choices.py, ADR-405).
//
// An `agent:` button whose destination carries `md2ui.choice=<name>` is an option of the
// choice of that name. A run of options the author divided with ` | ` (`separator_chars`)
// and gave one name is drawn as one segmented control: the grouper stamps `segmented_run`
// on that run's group once, on the finished tree, and the scene reads the flag (md2ui
// ADR-100) rather than re-reading the run's pieces.
import { destinationUrl, splitMd2uiParams } from "../utils/image-params.ts";
import { linkDestination } from "./link-content.ts";
import type { GroupNode } from "./node.ts";
import type { RegexKit } from "./py/re.ts";

/** md2ui: `CHOICE_HINT`. The `md2ui.` param that makes an `agent:` button an option of a named group. */
export const CHOICE_HINT = "choice";

/** md2ui: `choice_of`. The choice a button's raw `[label](agent:…)` content is an option of. */
function choiceOf(kit: RegexKit, content: string): string | null {
  const url = linkDestination(kit, content) ?? "";
  const [u, hints] = splitMd2uiParams(kit, destinationUrl(url));
  return u.slice(0, 6).toLowerCase() === "agent:" ? hints.get(CHOICE_HINT) || null : null;
}

/**
 * md2ui: `is_segmented_run` (Phase 6.246). A group of two or more buttons, divided only by
 * ` | `, all options of one choice.
 */
export function isSegmentedRun(kit: RegexKit, node: GroupNode): boolean {
  const kids = node.children;
  if (kids.length < 2 || node.separator_chars.length === 0) return false;
  if (node.separator_chars.some((c) => c !== "|")) return false;
  if (kids.some((k) => k.type !== "link")) return false;
  const names = new Set(kids.map((k) => choiceOf(kit, k.content)));
  return names.size === 1 && !names.has(null);
}
