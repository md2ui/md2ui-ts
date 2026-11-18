// What the core gives a host beside the display list (C4), per width: the semantic
// outline its accessibility layer is built from, and the transient host state a list
// can be shown with, read by the host (`RenderedDocument`). Internal, not public: a host
// app never sees it. The shapes are the ones the host reads; the core produces them.
import type { Rect } from "./c4-display-list.ts";

/**
 * One item of the accessibility outline, in document order. Bounds are in C4's content
 * space. A target is listed where it occurs, by ordinal; its rect is C4's. A control is
 * one item, named by its label: the text that labels it is not listed again.
 */
export type OutlineItem =
  | {
      readonly role: "heading";
      readonly level: 1 | 2 | 3 | 4 | 5 | 6;
      readonly text: string;
      readonly bounds: Rect;
    }
  | {
      readonly role: "text" | "image";
      /** For an image, its alt text. */
      readonly text: string;
      readonly bounds: Rect;
    }
  | {
      readonly role: "target";
      readonly ordinal: number;
      /** The words the target is named by, markup stripped (its label as shown). */
      readonly name: string;
    }
  | { readonly role: "copy"; readonly nodeId: string };

/**
 * The transient state a host shows on one target until the next document (ADR-003): an
 * agent action waiting, a task box ticked ahead of the agent, a slider moved. Colours
 * and a thumb's place only: no box moves, so the per-width work stands. A host keys it
 * by the target's ordinal, so a link inside a sentence is addressed alone.
 */
export type HostState =
  | { readonly kind: "pending" }
  | { readonly kind: "checked"; readonly checked: boolean }
  | { readonly kind: "value"; readonly value: number };
