// A muted key's paint, as display-list entries through the whole
// pipeline (fake measurer): md2ui's tests/text_style_tier_tests.py
// `test_a_muted_key_keeps_the_key_style_and_takes_the_muted_ink`, read off the runs the
// painter draws instead of a patched `draw_styled_text_box`.
import type { TextEntry, TextRun } from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { paintMarkdown } from "./scene-kit.ts";

const runOf = (md: string, theme: string, text: string): TextRun | undefined =>
  paintMarkdown(md, theme, 500)
    .painted.list.entries.filter((e): e is TextEntry => e.type === "text")
    .flatMap((e) => e.runs)
    .find((r) => r.text === text);

// A pair is a display's since ADR-205: these hold ratio bars.
const MD = "Customers: 7/8\n\n_Balance_: 7/8\n";
const BODY = `## Text Styles
Text
- Font size: 15
- Font color: #8A8F98
`;
const THEME = `${BODY}
Key
- Font size: 22
- Font weight: 700
- Font color: #0A0A0A
`;

describe("a muted key (md2ui 9aa09890, 71733b04)", () => {
  it("keeps the key's size and weight and takes only the Muted colour", () => {
    const key = runOf(MD, THEME, "Customers");
    const muted = runOf(MD, THEME, "Balance");
    expect(key?.font.size).toBe(22);
    expect(muted?.font).toEqual(key?.font);
    expect(key?.color).toBe("#0a0a0aff");
    // With no Muted block the colour is the tier's default.
    expect(muted?.color).toBe("#9a9a9aff");
  });

  it("takes a declared Muted block's colour and nothing else", () => {
    const theme = `${THEME}\nMuted\n- Font size: 11\n- Font color: #C0392B\n`;
    const muted = runOf(MD, theme, "Balance");
    expect(muted?.font).toEqual(runOf(MD, theme, "Customers")?.font);
    expect(muted?.color).toBe("#c0392bff");
  });

  it("is body text with no Key block, still the same size, inked muted", () => {
    const theme = `${BODY}\nMuted\n- Font color: #C0392B\n`;
    expect(runOf(MD, theme, "Customers")?.font.size).toBe(15);
    const muted = runOf(MD, theme, "Balance");
    expect(muted?.font.size).toBe(15);
    expect(muted?.color).toBe("#c0392bff");
  });
});
