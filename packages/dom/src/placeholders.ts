// md2ui's two image placeholders (`render_placeholders`), one meaning each: the loading
// one says a picture has not arrived yet, the broken one says it never will. Both ship
// inside the package as SVG, so drawing one costs no fetch and no CORS; each is
// rasterised once per view, at md2ui's own SVG raster width, into an `ImageBitmap`, the
// cheapest `drawImage` source and one that is never re-rasterised per scale.

/**
 * md2ui's `data/vectors/image-placeholder.svg`, less an invisible path, at its PNG twin's
 * size: both placeholders are 1280 × 994, so a failed picture draws in the loading one's crop.
 */
export const LOADING_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="994" viewBox="0 0 180.119 139.794" preserveAspectRatio="none"><g transform="translate(-13.59 -66.639)"><path fill="#d0d0d0" d="M13.591 66.639H193.71v139.794H13.591z"/><path d="m118.507 133.514-34.249 34.249-15.968-15.968-41.938 41.937H178.726z" opacity=".675" fill="#fff"/><circle cx="58.217" cy="108.555" r="11.773" opacity=".675" fill="#fff"/></g></svg>';

/** md2ui's `data/images/image-broken-placeholder.png`, redrawn as a vector at its size. */
export const BROKEN_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="994" viewBox="0 0 1280 994"><path fill="#d0d0d0" d="M0 0h1280v994H0z"/><g fill="#f0f0f0"><circle cx="317.1" cy="297.9" r="83.65"/><path d="M90.7 903.2 388.75 605.15 502.25 718.65 745.6 475.3 815.95 545.65 458.4 903.2zM1280 151.6v196.5L949.2 678.9l224.3 224.3H724.9L634.1 994H437.6z"/></g></svg>';

/** md2ui rasterises an SVG at this width (`image_cache._SVG_RENDER_MAX`). */
const RASTER_WIDTH = 512;

/**
 * `svg` as a bitmap 512 px wide. Decoded on the page, never in a Worker, which has no
 * SVG decoder; the `<img>` decoder takes an SVG in every engine.
 */
export async function rasterise(svg: string): Promise<ImageBitmap> {
  const img = new Image();
  img.src = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  await img.decode();
  return createImageBitmap(img, {
    resizeWidth: RASTER_WIDTH,
    resizeHeight: Math.round((RASTER_WIDTH * img.naturalHeight) / img.naturalWidth),
    resizeQuality: "high",
  });
}
