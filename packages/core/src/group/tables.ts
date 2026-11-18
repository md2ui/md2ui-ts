// GFM tables, cut out of a node's text into header and row nodes (md2ui:
// markdown_grouper._subgroup_tables_walk and its helpers).
import { rowCells } from "./escapes.ts";
import { GroupNode } from "./node.ts";
import { compile, type RegexKit } from "./py/re.ts";
import { strip } from "./py/str.ts";

// md2ui: MarkdownGrouper.TABLE_BLOCK_RE
// py: re.compile(
// py:     r"(^\|.+\|\s*\n\|[\s:|-]+\|\s*\n(?:\|.+\|\s*\n?)+)",
// py:     re.MULTILINE,
// py: )
const TABLE_BLOCK_RE = compile(String.raw`(^\|.+\|\s*\n\|[\s:|-]+\|\s*\n(?:\|.+\|\s*\n?)+)`, {
  m: true,
});
// md2ui: MarkdownGrouper.TABLE_SEP_RE
// py: re.compile(r"^\|[\s:|-]+\|$")
const TABLE_SEP_RE = compile(String.raw`^\|[\s:|-]+\|$`);

/**
 * md2ui: `_parse_col_aligns`. Per-column alignment from the delimiter row; null is
 * GFM's "no alignment specified", which inherits the theme's.
 */
function parseColAligns(kit: RegexKit, sepLine: string): GroupNode["table_align"][] {
  return rowCells(kit, sepLine).map((cell) => {
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    if (left && right) return "center";
    if (left) return "left";
    if (right) return "right";
    return null;
  });
}

/** md2ui: `_parse_table`. A raw table block as header and row nodes of cells. */
function parseTable(kit: RegexKit, block: string): GroupNode[] {
  const lines = strip(block)
    .split("\n")
    .filter((line) => strip(line) !== "");
  const rows: GroupNode[] = [];
  // The header takes the column alignment too, so the delimiter row is read first.
  const sep = lines.find((ln) => kit.re(TABLE_SEP_RE).match(strip(ln)) !== null);
  const aligns = sep === undefined ? [] : parseColAligns(kit, sep);

  lines.forEach((line, idx) => {
    if (kit.re(TABLE_SEP_RE).match(strip(line)) !== null) return;
    const header = idx === 0;
    const row = new GroupNode("", header ? "table_header" : "table_row");
    // md2ui `_parse_row_cells`: an escaped `\\|` is not a delimiter.
    rowCells(kit, line).forEach((text, col) => {
      const cell = new GroupNode(text, "table_cell");
      cell.table_role = header ? "header" : "body";
      // A short delimiter row leaves the extra columns unaligned.
      cell.table_align = aligns[col] ?? null;
      row.children.push(cell);
    });
    rows.push(row);
  });
  return rows;
}

/** md2ui: `_subgroup_tables_walk`. Depth-first: tables in content become structured nodes. */
export function subgroupTablesWalk(kit: RegexKit, node: GroupNode): void {
  for (const child of [...node.children]) subgroupTablesWalk(kit, child);
  if (!node.content) return;

  const parts = kit.re(TABLE_BLOCK_RE).split(node.content);
  if (parts.length === 1) return; // no tables found

  const children: GroupNode[] = [];
  parts.forEach((part, i) => {
    const text = strip(part ?? "");
    if (!text) return;
    // Odd indices are the captured table blocks.
    if (i % 2 === 1) children.push(...parseTable(kit, text));
    else children.push(new GroupNode(text, "text"));
  });

  const only = children[0];
  if (children.length === 1 && only !== undefined && node.children.length === 0) {
    // Single result, no existing children: absorb into node.
    node.type = only.type;
    node.content = only.content;
    node.children = only.children;
  } else {
    node.children = [...children, ...node.children];
    node.content = "";
  }
}
