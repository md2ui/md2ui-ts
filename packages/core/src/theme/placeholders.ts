// `## Images` → `### Placeholders` (md2ui `theme_placeholders`, ADR-406): a named
// placeholder stands in for a picture that is not there (left out, loading, failed) with a
// fill, an `Image:` cover-fitted over it, and centred on top the image's text or the
// placeholder's icon. Three names are reserved, in any order among the others:
// `#### Loading`, `#### Broken` and `#### Missing` restyle md2ui's own placeholders, by
// state, for the images that name none.
import type { Argb, ImagePlaceholder, PlaceholderSize, ResolvedTheme } from "@md2ui/contracts";
import { partition, strip } from "../group/py/str.ts";
import type { Draft } from "./model.ts";

const HEX = /^#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?$/;
const SIZE = /^(\d+(?:\.\d+)?)\s*(%|px)?$/;
const STATES: readonly string[] = Object.freeze(["loading", "broken", "missing"]);

/** md2ui `placeholder_name`: the name an image writes for the placeholder headed `title`. */
export function placeholderName(title: string): string {
  return strip(title)
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
}

/** md2ui `_color`: `#RRGGBB` or `#RRGGBBAA` as ARGB. */
function color(text: string): Argb | null {
  const t = strip(text);
  if (!HEX.test(t)) return null;
  const alpha = t.length === 9 ? Number.parseInt(t.slice(7, 9), 16) : 0xff;
  return alpha * 0x1000000 + Number.parseInt(t.slice(1, 7), 16);
}

function size(text: string): Draft<PlaceholderSize> | null {
  const m = SIZE.exec(strip(text));
  return m === null ? null : [Number(m[1]), m[2] === "%"];
}

/** md2ui `ImagePlaceholder()`: the defaults of one placeholder. */
export function newPlaceholder(): Draft<ImagePlaceholder> {
  return {
    fill_colors: [],
    text_colors: [],
    text_style: "text",
    text_size: [40, true],
    icon: "",
    icon_size: [50, true],
    bg_image: "",
  };
}

/** md2ui `PlaceholderParser.line`: one `## Images` line at a time. */
export function imagesSection(theme: Draft<ResolvedTheme>): (line: string) => void {
  let block = "";
  let current: Draft<ImagePlaceholder> | null = null;
  let list: Argb[] | null = null;
  return (line) => {
    if (line.startsWith("### ")) {
      block = strip(line.slice(4)).toLowerCase();
      current = list = null;
      return;
    }
    if (block !== "placeholders") return;
    if (line.startsWith("#### ")) {
      const name = placeholderName(line.slice(5));
      const into = STATES.includes(name)
        ? theme.image_placeholder_defaults
        : theme.image_placeholders;
      if (!Object.hasOwn(into, name)) into[name] = newPlaceholder();
      current = into[name] as Draft<ImagePlaceholder>;
      list = null;
      return;
    }
    if (current === null) return;
    if (line.startsWith("- ")) {
      const c = color(line.slice(2));
      if (c !== null && list !== null) list.push(c);
      return;
    }
    const [k, , v] = partition(line, ":");
    const key = strip(k).toLowerCase();
    const value = strip(v);
    list = null;
    if (["fill color", "fill colors", "text color", "text colors"].includes(key)) {
      const target = key.startsWith("fill") ? current.fill_colors : current.text_colors;
      target.length = 0;
      const c = color(value);
      if (c !== null) target.push(c);
      else if (!value) list = target;
    } else if (key === "text style" && value) current.text_style = value.toLowerCase();
    else if (key === "icon") current.icon = value;
    else if (key === "image" && value) current.bg_image = value;
    else if (key === "text size" || key === "icon size") {
      const s = size(value);
      if (s !== null) current[key === "text size" ? "text_size" : "icon_size"] = s;
    }
  };
}
