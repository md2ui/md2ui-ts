// A content image (md2ui `draw_image_box`): where the picture goes, which way it fits,
// and what stands in for it until the host has decoded it.
import type { Argb } from "@md2ui/contracts";
import { imageContentWidth, truthy } from "../../measure/leaf-kit.ts";
import { argb } from "../../theme/model.ts";
import { imageAlt, imageSource } from "../../utils/image-params.ts";
import type { LayoutBox } from "../boxes.ts";
import type { BoxDrawer } from "./context.ts";
import { standIn } from "./image-placeholder.ts";
import { type Box, cornerShape, css, ovalShape, rectShape } from "./pen.ts";
import { labelRuns } from "./text.ts";

// md2ui `layout_render.IMAGE_DECO_COLOR`: the placeholder's lines and label.
const IMAGE_DECO_COLOR: Argb = argb(255, 150, 150, 150);
// md2ui `render_placeholders.NO_PICTURE_COLOR`: the picture background, the quiet box
// an image with no picture paints.
const NO_PICTURE_COLOR: Argb = argb(255, 0xd0, 0xd0, 0xd0);

/**
 * The region the layout reserved for the image (md2ui `draw_image_box`'s `dst`): the
 * box's width capped by `max_width`, a circle's square, and the capped width placed by
 * the leaf's alignment.
 */
function imageRegion(box: LayoutBox, circle: boolean, align: string): Box {
  const available = imageContentWidth(box.render_properties, box.width);
  const side = Math.min(available, box.height);
  const width = circle ? side : available;
  const height = circle ? side : box.height;
  const slack = Math.max(0, box.width - width);
  const offset = align === "center" ? slack / 2 : align === "right" ? slack : 0;
  return {
    x: box.x + offset,
    y: box.y + Math.max(0, (box.height - height) / 2),
    width,
    height,
  };
}

/**
 * md2ui `draw_image_box` (as `draw_content_box` calls it): one image entry. An authored
 * `fit` wins; otherwise the host picks by what it decodes (an SVG is contained, a raster
 * covered). An image with no picture, `![alt]()`, is neither loading nor broken (md2ui
 * ADR-406): it is no image entry, only its shape filled in the picture background, so
 * the host fetches nothing for it and draws nothing else. With no picture to show, an
 * image paints the theme's placeholder it names, or the theme's default for its state.
 * A picture given no room draws nothing.
 */
export const drawImage: BoxDrawer = (d, box, p) => {
  const { theme, leaves } = d.sizer;
  const { fonts } = leaves;
  const rp = box.render_properties;
  const content = d.sized.get(box.content_id ?? "")?.content ?? "";
  const circle = rp?.["shape"] === "circle";
  const hinted = rp?.["fit"];
  const fit = hinted === "contain" || hinted === "cover" ? hinted : "auto";
  const align = String(rp?.["content_align"] || theme.root.align || "left");
  const dst = imageRegion(box, circle, align);
  // md2ui `draw_image_box`: a 0 x 0 picture has nothing to show, and nothing to fetch.
  if (dst.width <= 0 || dst.height <= 0) return;
  const radii = rp?.["corner_radii"] as readonly number[] | undefined;
  const shape = circle
    ? ovalShape(dst)
    : radii?.some(truthy)
      ? cornerShape(dst, radii as readonly [number, number, number, number])
      : rectShape(dst);
  const src = imageSource(leaves.kit, content);
  const node = d.nodes.get(box.content_id ?? "");
  // The theme's placeholder, in place of md2ui's own, when there is no picture (ADR-406).
  const theirs = (state: "loading" | "broken" | "missing") =>
    standIn(d, content, node, dst, state, NO_PICTURE_COLOR);
  if (!src) {
    const missing = theirs("missing");
    if (missing === null) p.fill(shape, { kind: "color", color: css(NO_PICTURE_COLOR) });
    else {
      for (const paint of missing.paints) p.fill(shape, paint);
      if (missing.label !== null) p.text(missing.label.y, missing.label.runs, shape);
    }
    return;
  }

  const alt = imageAlt(leaves.kit, content);
  let label = null;
  if (alt && dst.width > 40 && dst.height > 20) {
    const size = theme.labels.font_size;
    const measured = labelRuns(d, alt, 0, fonts.typeface, fonts.emoji, size, IMAGE_DECO_COLOR);
    const x = dst.x + (dst.width - measured.width) / 2;
    label = {
      y: dst.y + dst.height / 2 + size / 2,
      runs: measured.runs.map((r) => ({ ...r, x: r.x + x })),
    };
  }
  const loading = theirs("loading");
  const broken = theirs("broken");
  p.image(src, shape, fit, IMAGE_DECO_COLOR, label, loading || broken ? { loading, broken } : null);
};
