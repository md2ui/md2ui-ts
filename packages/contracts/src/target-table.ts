// The target table: what each action target reports, by ordinal (md2ui
// `render_actions.Action`, read from grouping alone), read by the host
// (`PreparedDocument.target`). Internal, not public: a host app never sees it.
//
// Naming: ADR-005 has internal contracts mirror md2ui's names, but this one is the host's
// requirement of the core, read by host code, so it keeps the host's shape. Its plain
// fields (`kind`, `label`, `href`, `commit`) are md2ui's names already; where it departs,
// md2ui's field is named on the member: `slug` is `action`, `slider` groups `value`,
// `value_max` and `value_decimals`, and `checked` is the authored state, where md2ui's
// `checked` is the state the click asks for (its opposite).

/** A slider's authored value and domain (md2ui `value`, `value_max`, `value_decimals`). */
export interface TargetSlider {
  readonly value: number;
  /** 0 to `max`. */
  readonly max: number;
  /** The precision the author wrote (`[65%]`: 0); null keeps every digit. */
  readonly decimals: number | null;
  /**
   * A count (`➖ [2/9] ➕`, md2ui ADR-405; md2ui `Action.count`): two buttons that step it by
   * one inside 0 to `max`, never a track.
   */
  readonly count: boolean;
}

/** What the target at one ordinal reports. A linked task box or slider is `agent`. */
export interface TargetPayload {
  readonly kind: "link" | "anchor" | "agent" | "checkbox" | "slider";
  /** The text the author gave it. */
  readonly label: string;
  /** A link or an `#anchor`: the destination as written. */
  readonly href?: string;
  /** An agent action: its slug (md2ui `action`). */
  readonly slug?: string;
  /**
   * A task box, plain or linked, or a choice option: the state the document shows. An
   * option is checked when it is the chosen one, written as the main button.
   */
  readonly checked?: boolean;
  /**
   * A choice option (an `agent:` button with `md2ui.choice=<name>`, md2ui ADR-405): the
   * group's name. The options sharing it are one group, of which a tap chooses one.
   */
  readonly choice?: string;
  /** A slider, plain or linked. */
  readonly slider?: TargetSlider;
  /** A button marked `md2ui.commit`: it carries the other controls' settled values. */
  readonly commit: boolean;
}

/**
 * Indexed by ordinal. A slot that reports nothing — a `~~…~~` disabled target, a bare
 * `agent:` — holds `undefined` and keeps its place, so later ordinals do not shift.
 */
export type TargetTable = readonly (TargetPayload | undefined)[];
