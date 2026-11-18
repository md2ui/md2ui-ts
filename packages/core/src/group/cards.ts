// Block-content link and image cards (md2ui: markdown_grouper._expand_cards_walk,
// _expand_cards_in, _build_card, _restore_unexpanded_sentinels). Phase 2.13 replaces
// each card sentinel with the subtree of its body, grouped as a little document of
// its own; the safety net puts back any sentinel the expander missed.
import { destinationUrl } from "../utils/image-params.ts";
import { buildBlockAst } from "./block-ast.ts";
import {
  pruneEmpty,
  restructureListBodies,
  stampListOrdinals,
  subgroupContent,
  subgroupContentClassifiedMulti,
} from "./block-passes.ts";
import { splitAllLists, splitBlankLines, splitBlockquote, splitNewlines } from "./block-splits.ts";
import type { CardSpec } from "./constructs.ts";
import { type IdMint, inheritGlue } from "./ids.ts";
import { GroupNode } from "./node.ts";
import { compile, type RegexKit } from "./py/re.ts";
import { strip, toInt } from "./py/str.ts";
import { subgroupTablesWalk } from "./tables.ts";

/** The document's card bodies, by sentinel id, and its id mint. */
export interface CardContext {
  readonly cards: readonly CardSpec[];
  readonly ids: IdMint;
}

// py: re.compile(r"⟦md2ui-card-(\d+)⟧")
const CARD_SENTINEL_RE = compile(String.raw`⟦md2ui-card-(\d+)⟧`);
// md2ui: _CARD_SENTINEL_MARK, a cheap "might contain one" test.
const CARD_SENTINEL_MARK = "⟦";

/** md2ui: `_expand_cards_walk`. Every card sentinel replaced by its body's subtree. */
export function expandCardsWalk(kit: RegexKit, ctx: CardContext, node: GroupNode): void {
  for (const child of [...node.children]) expandCardsWalk(kit, ctx, child);
  if (node.content.includes(CARD_SENTINEL_MARK)) expandCardsIn(kit, ctx, node);
}

/**
 * md2ui: `_expand_cards_in`. The sentinels in `node.content` expanded in place; text
 * around a sentinel is kept as TEXT siblings.
 */
function expandCardsIn(kit: RegexKit, ctx: CardContext, node: GroupNode): void {
  const pieces = kit.re(CARD_SENTINEL_RE).split(node.content);
  if (pieces.length === 1) return;
  const children: GroupNode[] = [];
  pieces.forEach((raw, i) => {
    const piece = raw ?? "";
    if (i % 2 === 0) {
      if (strip(piece)) children.push(new GroupNode(strip(piece), "text"));
      return;
    }
    const spec = ctx.cards[toInt(piece)];
    // An unknown id keeps the token visible, not silent. md2ui keeps only the id digits
    // and splits the line (finding: a literal card sentinel renders as its number); mirrored.
    children.push(spec === undefined ? new GroupNode(piece, "text") : buildCard(kit, ctx, spec));
  });
  inheritGlue(node, children, ctx.ids);
  if (node.type === "text") node.type = "group";
  node.content = "";
  node.children = [...children, ...node.children];
}

/**
 * md2ui: `_build_card`. One card's node, body and all: the body grouped as its own
 * little document and given Phase 1, 2 and 2.1's passes. An image card keeps its
 * URL as `card_bg_url`; a link card is a plain GROUP carrying `link_url`.
 */
function buildCard(kit: RegexKit, ctx: CardContext, spec: CardSpec): GroupNode {
  let card: GroupNode;
  if (spec.is_image) {
    card = new GroupNode("", "image_card");
    card.card_bg_url = destinationUrl(spec.url);
  } else {
    card = new GroupNode("", "group");
    card.link_url = spec.url;
  }
  const sub = buildBlockAst(kit, spec.inner, ctx.ids);
  if (sub.children.length > 0) {
    // The flag a `...` line leaves on the body's root is the card's: it holds the regions.
    card.children = sub.children;
    card.valign_group = sub.valign_group;
  } else if (sub.content) card.children = [new GroupNode(sub.content, "text")];

  subgroupContent(kit, ctx.ids, card, splitBlankLines, true, false);
  subgroupTablesWalk(kit, card);
  subgroupContent(kit, ctx.ids, card, splitNewlines, false, true);
  subgroupContentClassifiedMulti(kit, ctx.ids, card, [splitAllLists, splitBlockquote]);
  pruneEmpty(card);
  restructureListBodies(kit, ctx.ids, card);
  stampListOrdinals(kit, card);
  // A body may itself hold a card (a link card wrapping an image card).
  expandCardsWalk(kit, ctx, card);
  return card;
}

/** md2ui: `_restore_unexpanded_sentinels`. A surviving sentinel becomes its Markdown again. */
export function restoreUnexpandedSentinels(kit: RegexKit, ctx: CardContext, node: GroupNode): void {
  if (node.content.includes(CARD_SENTINEL_MARK)) {
    node.content = kit
      .re(CARD_SENTINEL_RE)
      .sub((m) => ctx.cards[toInt(m.text(1))]?.raw ?? m.text(), node.content);
  }
  for (const child of node.children) restoreUnexpandedSentinels(kit, ctx, child);
}
