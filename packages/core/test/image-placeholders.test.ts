// Named image placeholders (md2ui ADR-406; md2ui's `tests/image_placeholder_tests.py`, its
// pipeline cases). An image that writes `?md2ui.placeholder=<name>` or `<name>:<text>` and has
// no picture (left out, loading or failed) paints the theme's placeholder of that name,
// declared under `## Images` → `### Placeholders`: a fill, an `Image:` over it, and centred on
// top the image's text or the placeholder's icon, inside the clip the picture would use. The
// reserved names `#### Loading`, `Broken` and `Missing` restyle md2ui's own for images that
// name none. Each name counts its own rotation cycle, per section, as chips do, and `Rotate
// placeholder colors` gates it. md2ui's `check` and theme-lint cases are server-side.
import type { DisplayEntry, GroupingNode, ImageEntry } from "@md2ui/contracts";
import { describe, expect, it } from "vitest";
import { groupMarkdown } from "../src/group/grouper.ts";
import { RegexKit } from "../src/group/py/re.ts";
import { parseTheme } from "../src/theme/parse.ts";
import { placeholderName } from "../src/theme/placeholders.ts";
import { imageParams, placeholderRef } from "../src/utils/image-params.ts";
import { paintMarkdown } from "./scene-kit.ts";

const THEME = `## Text Styles
### Lead
Font color: #222222
Font size: 20

## Images

### Placeholders

#### Avatar
Fill color:
- #E8F0FE
- #FDE7E9
- #E6F4EA
Text color:
- #1A56DB
- #C81E1E
Text style: Lead
Text size: 40%

#### Pattern
Fill color: #1F2937
Image: assets/pattern.svg
Icon: 🖼️
Icon size: 30%
`;

const DEFAULTS = `${THEME}
#### Missing
Fill color: #FFF4E5
Icon: 🖼️

#### Broken
Fill color: #FDE2E2
`;

const AVATAR = (name: string, src = "") =>
  `## Team\n\n![Sara Zane](${src}?md2ui.placeholder=${name}:SZ&md2ui.shape=circle&md2ui.max_width=120)\n`;

const entries = (md: string, theme = THEME): readonly DisplayEntry[] =>
  paintMarkdown(md, theme, 600).painted.list.entries;

describe("the theme", () => {
  it("declares each placeholder by its heading under ## Images → ### Placeholders", () => {
    const theme = parseTheme(
      "## Images\n\n### Placeholders\n\n#### Avatar Style\nFill color:\n- #E8F0FE\n" +
        "- #FDE7E9\nText color: #1A56DB\nText style: Lead\nText size: 40%\n\n" +
        "#### Media\nFill color: #F2F2F2\nIcon: 🖼️\nIcon size: 28\n",
    );
    const avatar = theme.image_placeholders["avatar-style"];
    expect(avatar?.fill_colors).toEqual([0xffe8f0fe, 0xfffde7e9]);
    expect(avatar?.text_colors).toEqual([0xff1a56db]);
    expect([avatar?.text_style, avatar?.text_size]).toEqual(["lead", [40, true]]);
    const media = theme.image_placeholders["media"];
    expect([media?.icon, media?.icon_size, media?.fill_colors]).toEqual([
      "🖼️",
      [28, false],
      [0xfff2f2f2],
    ]);
    expect(
      parseTheme("## Images\n\n#### Avatar\nFill color: #000000\n").image_placeholders,
    ).toEqual({});
  });

  it("declares `Image:`, and Loading / Broken / Missing as defaults, in any order", () => {
    // The default first, a named one after: a `### Defaults` block written above the
    // named ones must not swallow them.
    const theme = parseTheme(
      "## Images\n\n### Placeholders\n\n#### Missing\nFill color: #FFF4E5\n\n" +
        "#### Brand\nImage: assets/brand.png\n",
    );
    expect(theme.image_placeholders["brand"]?.bg_image).toBe("assets/brand.png");
    expect(Object.keys(theme.image_placeholders), "a reserved name is no named one").toEqual([
      "brand",
    ]);
    expect(Object.keys(theme.image_placeholder_defaults)).toEqual(["missing"]);
    expect(theme.image_placeholder_defaults["missing"]?.fill_colors).toEqual([0xfffff4e5]);
    expect(placeholderName("  Avatar Style! ")).toBe("avatar-style");
  });

  it("reads nothing outside ### Placeholders, a `### Defaults` block included", () => {
    const theme = parseTheme(
      "## Images\n\n### Defaults\n\n#### Broken\nFill color: #F2F2F2\n\n" +
        "#### Avatar\nFill color: #000000\n",
    );
    expect(theme.image_placeholders).toEqual({});
    expect(theme.image_placeholder_defaults).toEqual({});
  });
});

describe("an image", () => {
  const kit = new RegexKit();
  it("names a placeholder, and text after a colon; never a layout param", () => {
    expect(placeholderRef(kit, "![S](?md2ui.placeholder=avatar:SZ)")).toEqual({
      name: "avatar",
      text: "SZ",
    });
    expect(placeholderRef(kit, "![S](x.jpg?md2ui.placeholder=Media)")).toEqual({
      name: "media",
      text: "",
    });
    expect(placeholderRef(kit, "![S](?md2ui.placeholder=Avatar_Style:👤)")).toEqual({
      name: "avatar-style",
      text: "👤",
    });
    expect(placeholderRef(kit, "![S](x.jpg?md2ui.shape=circle)")).toBeNull();
    const params = imageParams(kit, "![S](?md2ui.placeholder=avatar:SZ&md2ui.shape=circle)");
    expect([...params]).toEqual([["shape", "circle"]]);
  });

  it("left out paints its named placeholder's fill and text inside its circle", () => {
    const list = entries(AVATAR("avatar"));
    const fills = list.filter((e) => e.type === "fill");
    const fill = fills.find((e) => e.paint.kind === "color" && e.paint.color === "#e8f0feff");
    expect(fill?.shape.kind).toBe("oval");
    const text = list.find((e) => e.type === "text" && e.runs.some((r) => r.text.includes("SZ")));
    expect(text?.type === "text" && text.clip?.kind).toBe("oval");
    if (text?.type !== "text" || fill === undefined) return;
    // Centred in the circle, in the avatar's first text colour.
    const run = text.runs[0];
    expect(run?.color).toBe("#1a56dbff");
    expect(run?.font.size).toBeCloseTo((fill.shape.width * 40) / 100);
  });

  it("with an undeclared name keeps the quiet box", () => {
    const fills = entries(AVATAR("nobody")).filter((e) => e.type === "fill");
    expect(fills.some((e) => e.paint.kind === "color" && e.paint.color === "#d0d0d0ff")).toBe(true);
    expect(
      entries(AVATAR("nobody")).some(
        (e) => e.type === "text" && e.runs.some((r) => r.text === "SZ"),
      ),
    ).toBe(false);
  });

  it("loading or failed carries its placeholder to paint in its picture's place", () => {
    const image = entries(AVATAR("avatar", "https://example.com/sara.jpg")).find(
      (e): e is ImageEntry => e.type === "image",
    );
    expect(image?.src).toBe("https://example.com/sara.jpg");
    const { loading, broken } = image?.standIn ?? { loading: null, broken: null };
    expect(loading).toEqual(broken);
    expect(loading?.paints).toEqual([{ kind: "color", color: "#e8f0feff" }]);
    expect(loading?.label?.runs.map((r) => r.text).join("")).toBe("SZ");
  });

  it("draws a placeholder's image over its fill, and its icon with no text", () => {
    const list = entries("## Brand\n\n![Acme](?md2ui.placeholder=pattern)\n");
    const paints = list.flatMap((e) => (e.type === "fill" ? [e.paint] : []));
    const fill = paints.findIndex((p) => p.kind === "color" && p.color === "#1f2937ff");
    const image = paints.findIndex((p) => p.kind === "image" && p.src === "assets/pattern.svg");
    expect(fill).toBeGreaterThanOrEqual(0);
    expect(image).toBeGreaterThan(fill);
    expect(list.some((e) => e.type === "text" && e.runs.some((r) => r.text.includes("🖼")))).toBe(
      true,
    );
  });

  it("naming none takes the theme's default for its state; a name outranks it", () => {
    const missing = entries("## Shop\n\n![Product photo]()\n", DEFAULTS);
    expect(
      missing.some(
        (e) => e.type === "fill" && e.paint.kind === "color" && e.paint.color === "#fff4e5ff",
      ),
    ).toBe(true);
    const failing = entries("## Shop\n\n![Product photo](https://example.com/p.jpg)\n", DEFAULTS);
    const image = failing.find((e): e is ImageEntry => e.type === "image");
    expect(image?.standIn?.loading).toBeNull();
    expect(image?.standIn?.broken?.paints).toEqual([{ kind: "color", color: "#fde2e2ff" }]);
    const named = entries(AVATAR("avatar"), DEFAULTS);
    expect(
      named.some(
        (e) => e.type === "fill" && e.paint.kind === "color" && e.paint.color === "#e8f0feff",
      ),
    ).toBe(true);
    // With no defaults, an image naming none carries nothing: the host's own placeholders.
    const plain = entries("## Shop\n\n![Product photo](https://example.com/p.jpg)\n");
    expect(plain.find((e): e is ImageEntry => e.type === "image")?.standIn).toBeUndefined();
  });
});

describe("rotation", () => {
  const walk = (n: GroupingNode): GroupingNode[] => [n, ...(n.children ?? []).flatMap(walk)];
  it("counts each placeholder name's own cycle, so list rows rotate", () => {
    const rows = ["Ana", "Ben", "Cy"]
      .map((n) => `- ![${n}](?md2ui.placeholder=avatar:${n[0]}&md2ui.shape=circle) - **${n}**\n`)
      .join("");
    const tree = groupMarkdown(
      `## Contacts\n\n${rows}\n![Acme](?md2ui.placeholder=brand:AC)\n`,
      new RegexKit(),
    );
    const images = walk(tree).filter((n) => n.type === "image");
    const avatars = images.filter((n) => n.content.includes("avatar"));
    expect(avatars.map((n) => n.rotation_index ?? 0)).toEqual([0, 1, 2]);
    const brand = images.find((n) => n.content.includes("brand"));
    expect(brand?.rotation_index ?? 0, "brand counts apart").toBe(0);
  });

  it("paints the avatars of list rows in their own slot's colours", () => {
    const rows = ["Ana", "Ben"]
      .map(
        (n) =>
          `- ![${n}](?md2ui.placeholder=avatar:${n[0]}&md2ui.shape=circle&md2ui.max_width=48) - **${n}**\n`,
      )
      .join("");
    const colors = entries(`## Contacts\n\n${rows}`).flatMap((e) =>
      e.type === "fill" && e.paint.kind === "color" && e.shape.kind === "oval"
        ? [e.paint.color]
        : [],
    );
    expect(colors).toEqual(["#e8f0feff", "#fde7e9ff"]);
  });

  it("is gated by `Rotate placeholder colors`, and the blanket form; the section switch does not reach it", () => {
    // md2ui findings/placeholder-text-rotation-cannot-turn-off.
    const rows = ["Ana", "Ben"]
      .map(
        (n) =>
          `- ![${n}](?md2ui.placeholder=avatar:${n[0]}&md2ui.shape=circle&md2ui.max_width=48) - **${n}**\n`,
      )
      .join("");
    const painted = (gate: string) => {
      const list = entries(
        `## Contacts\n\n${rows}`,
        `## Sections\n### Heading 2\n${gate}\n${THEME}`,
      );
      const fills = list.flatMap((e) =>
        e.type === "fill" && e.paint.kind === "color" && e.shape.kind === "oval"
          ? [e.paint.color]
          : [],
      );
      const texts = list.flatMap((e) =>
        e.type === "text" && e.clip?.kind === "oval" ? [e.runs[0]?.color] : [],
      );
      return { fills, texts };
    };
    const rotating = { fills: ["#e8f0feff", "#fde7e9ff"], texts: ["#1a56dbff", "#c81e1eff"] };
    const pinned = { fills: ["#e8f0feff", "#e8f0feff"], texts: ["#1a56dbff", "#1a56dbff"] };
    expect(painted("")).toEqual(rotating);
    expect(painted("Rotate placeholder colors: no")).toEqual(pinned);
    expect(painted("Rotate colors: no"), "the blanket form covers it").toEqual(pinned);
    expect(painted("Rotate background colors: no"), "the section switch does not").toEqual(
      rotating,
    );
    expect(painted("Rotate text colors: no"), "nor the text switch").toEqual(rotating);
  });
});
