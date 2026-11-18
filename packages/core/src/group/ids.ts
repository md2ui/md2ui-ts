// The document's id counters, and how a split's pieces inherit them (md2ui:
// pipeline/grouper_ids.py).
//
// Two ids thread through a document: `glued_content_id`, the run of siblings written
// as one unbroken stretch of source, and `source_line_id`, one physical line. Minting
// is the grouper's one piece of mutable state, so it lives on an object a grouper
// owns and hands to every phase that mints.
import type { GroupNode } from "./node.ts";

/** md2ui: `IdMint`, the id counters of ONE document. */
export class IdMint {
  private glued = 0;
  private sourceLine = 0;

  /** md2ui: `next_glued`. A fresh, document-unique glued-content segment id. */
  nextGlued(): number {
    const gid = this.glued;
    this.glued += 1;
    return gid;
  }

  /** md2ui: `next_source_line`. A fresh, document-unique physical-line id. */
  nextSourceLine(): number {
    const sid = this.sourceLine;
    this.sourceLine += 1;
    return sid;
  }
}

/**
 * md2ui: `_inherit_glue`. A split's id-less pieces take the parent's line id and glued
 * segment id; a parent with no segment that split into 2+ pieces mints one for them
 * (never for a heading, which must not become a glued card).
 */
export function inheritGlue(parent: GroupNode, children: readonly GroupNode[], ids: IdMint): void {
  // md2ui: _inherit_source_line_id. An intra-line split never crosses a line.
  if (parent.source_line_id !== null) {
    for (const c of children) c.source_line_id ??= parent.source_line_id;
  }
  let gid = parent.glued_content_id;
  if (gid === null) {
    if (children.length < 2 || parent.type.startsWith("heading")) return;
    gid = ids.nextGlued();
  }
  for (const c of children) c.glued_content_id ??= gid;
}
