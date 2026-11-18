// An image or link destination read as plain text (md2ui: utils/image_params.py).
import { compile, type RegexKit } from "../group/py/re.ts";
import { split, strip } from "../group/py/str.ts";
import { LINK_DESTINATION } from "../group/split/link-syntax.ts";

/**
 * md2ui: `destination_url`. The url a destination names: its CommonMark title and
 * `<…>` brackets are spelling, not part of the address.
 */
export function destinationUrl(destination: string): string {
  const u = strip(destination);
  if (u.startsWith("<")) {
    const end = u.indexOf(">");
    return end > 0 ? strip(u.slice(1, end)) : "";
  }
  return u ? (split(u, undefined, 1)[0] ?? "") : "";
}

// md2ui: MD2UI_PREFIX. The namespace of author layout hints in an image URL's query.
const MD2UI_PREFIX = "md2ui.";
// py: re.compile(r"[?&][^?&]*")
const QUERY_SEG_RE = compile("[?&][^?&]*");
// py: re.compile(r"\s")
const WHITESPACE_RE = compile(String.raw`\s`);
// md2ui: _LINK_DESTINATION, the utils copy of render_text.LINK_DESTINATION.
// py: re.match(rf"!\[[^\]]*\]\(({_LINK_DESTINATION})\)", content)
const IMAGE_LITERAL_RE = compile(String.raw`!\[[^\]]*\]\((${LINK_DESTINATION})\)`);

// The platform's WHATWG TextDecoder (ADR-007). The core's ES-only lib does not declare it;
// every supported runtime has it.
declare const TextDecoder: new (
  label: "utf-8",
  options: { ignoreBOM: boolean },
) => { decode(bytes: Uint8Array): string };

/**
 * md2ui: `urllib.parse.unquote`. Each run of `%XX` escapes is read as UTF-8, a malformed
 * part becoming one U+FFFD per maximal invalid subsequence; a stray `%` stays literal.
 */
function unquote(s: string): string {
  return s.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
    const bytes = new Uint8Array(run.length / 3);
    for (let i = 0; i < bytes.length; i += 1)
      bytes[i] = Number.parseInt(run.slice(i * 3 + 1, i * 3 + 3), 16);
    // A leading byte order mark stays, as Python keeps it.
    return new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);
  });
}

/**
 * md2ui: `split_md2ui_params`. `[url without its md2ui.* params, params]`: each
 * `md2ui.` query segment is cut out with its separator, everything else kept byte
 * for byte; a value holding white space is dropped.
 */
export function splitMd2uiParams(kit: RegexKit, url: string): [string, Map<string, string>] {
  const none: [string, Map<string, string>] = [url, new Map()];
  if (!url.includes(MD2UI_PREFIX)) return none;
  if (url.slice(0, 5).toLowerCase() === "data:") return none;
  const hash = url.indexOf("#");
  const head = hash < 0 ? url : url.slice(0, hash);
  const fragment = hash < 0 ? "" : url.slice(hash);
  const qpos = head.indexOf("?");
  if (qpos < 0) return none;
  const base = head.slice(0, qpos);
  const params = new Map<string, string>();
  const kept: string[] = [];
  for (const m of kit.re(QUERY_SEG_RE).finditer(head.slice(qpos))) {
    const segment = m.text();
    const eq = segment.indexOf("=", 1);
    const key = eq < 0 ? segment.slice(1) : segment.slice(1, eq);
    if (!key.toLowerCase().startsWith(MD2UI_PREFIX)) {
      kept.push(segment);
      continue;
    }
    const name = key.slice(MD2UI_PREFIX.length).toLowerCase();
    const value = eq < 0 ? "" : unquote(segment.slice(eq + 1));
    if (name && value && !kit.re(WHITESPACE_RE).test(value)) params.set(name, value);
  }
  if (params.size === 0) return none;
  const [firstKept] = kept;
  if (firstKept !== undefined) kept[0] = `?${firstKept.slice(1)}`;
  return [base + kept.join("") + fragment, params];
}

/** md2ui: `split_md2ui_params(url)[1]`. The `md2ui.*` params of a url, prefix stripped. */
export function urlParams(kit: RegexKit, url: string): Map<string, string> {
  return splitMd2uiParams(kit, url)[1];
}

/** md2ui: `url_layout_params`. The layout `md2ui.*` params of a bare url, prefix stripped. */
export function urlLayoutParams(kit: RegexKit, url: string): Map<string, string> {
  const params = urlParams(kit, url);
  params.delete("placeholder");
  return params;
}

/**
 * md2ui: `urllib.parse.quote(value, safe=":,@.")`: every UTF-8 byte outside the letters,
 * the digits, `_.-~` and `:,@` as `%XX`.
 */
const quoteParam = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]|%3A|%2C|%40/g, (c) =>
    c.length === 1 ? `%${(c.codePointAt(0) as number).toString(16).toUpperCase()}` : unquote(c),
  );

/**
 * md2ui: `with_layout_params`. `url` carrying `params` as its layout `md2ui.*` params, in
 * place of its own; its paint params and everything else are kept. How a run's polled
 * params reach each member's own picture.
 */
export function withLayoutParams(
  kit: RegexKit,
  url: string,
  params: ReadonlyMap<string, string>,
): string {
  if (url.slice(0, 5).toLowerCase() === "data:") return url;
  const [clean, own] = splitMd2uiParams(kit, url);
  const keep = new Map([...own].filter(([k]) => k === "placeholder"));
  for (const [k, v] of params) keep.set(k, v);
  if (keep.size === 0) return clean;
  const hash = clean.indexOf("#");
  const head = hash < 0 ? clean : clean.slice(0, hash);
  const fragment = hash < 0 ? "" : clean.slice(hash);
  const query = [...keep].map(([k, v]) => `${MD2UI_PREFIX}${k}=${quoteParam(v)}`).join("&");
  return `${head}${head.includes("?") ? "&" : "?"}${query}${fragment}`;
}

/** The `md2ui.*` params of an `![alt](url)` literal, prefix stripped, paint-only ones included. */
function allImageParams(kit: RegexKit, content: string): Map<string, string> {
  const m = kit.re(IMAGE_LITERAL_RE).match(content);
  const raw = m === null ? null : destinationUrl(m.text(1));
  return raw ? splitMd2uiParams(kit, raw)[1] : new Map();
}

/**
 * md2ui: `image_params`. The layout `md2ui.*` params of an `![alt](url)` literal, prefix
 * stripped. `placeholder` is paint-only (md2ui `PAINT_PARAMS`): not layout vocabulary, and
 * not part of a picture's kind, so a run of pictures stays one run whichever each names.
 */
export function imageParams(kit: RegexKit, content: string): Map<string, string> {
  const params = allImageParams(kit, content);
  params.delete("placeholder");
  return params;
}

/**
 * md2ui: `placeholder_ref`. The placeholder an image names with `md2ui.placeholder=<name>`
 * or `<name>:<text>`, the name as `### Placeholders` headings are named; null for none.
 */
export function placeholderRef(
  kit: RegexKit,
  content: string,
): { readonly name: string; readonly text: string } | null {
  const value = allImageParams(kit, content).get("placeholder") ?? "";
  const colon = value.indexOf(":");
  const name = (colon < 0 ? value : value.slice(0, colon))
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-+|-+$/g, "");
  return name ? { name, text: colon < 0 ? "" : value.slice(colon + 1) } : null;
}

/**
 * md2ui: `image_url`, as `ImageCache` fetches it: the destination of an `![alt](url)`
 * literal with its `md2ui.*` params stripped; null when the content is not one. An
 * image with no picture, `![alt]()`, has an empty one (md2ui ADR-406).
 */
export function imageSource(kit: RegexKit, content: string): string | null {
  const m = kit.re(IMAGE_LITERAL_RE).match(content);
  return m === null ? null : splitMd2uiParams(kit, destinationUrl(m.text(1)))[0];
}

// py: re.match(r"!\[([^\]]*)\]", content)
const IMAGE_ALT_RE = compile(String.raw`!\[([^\]]*)\]`);

/** md2ui: `image_alt`. The alt text of an `![alt](url)` literal; `"image"` when there is none. */
export function imageAlt(kit: RegexKit, content: string): string {
  return kit.re(IMAGE_ALT_RE).match(content)?.text(1) ?? "image";
}
