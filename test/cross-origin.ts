// A second origin for the browser tests (vitest `globalSetup`): a picture host that sends
// no CORS headers, as `https://waymo.com/favicon.png` does, so a test can show what the
// view does with a picture `fetch` may not read, and a font host that sends them. Tests reach it through
// `inject("crossOrigin")`.
//
// - `/picture.png`, `/picture.svg`: a 6 × 3 picture;
// - `/missing.png`: a 404;
// - `/inter.woff2`: Inter Regular, with `Access-Control-Allow-Origin: *`, as jsDelivr
//   serves its fonts;
// - `/slow.png`: the picture, held back for `SLOW_MS` from a request that names no
//   origin (an `<img>`, not a `fetch`);
// - `/requests`: what was asked for, as JSON, with the one CORS header a test needs to
//   read it: each request's path and query, and whether it named an origin.
// Every answer is `no-store`, so no test reads another's from the HTTP cache.
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import { createRequire } from "node:module";
import type { AddressInfo } from "node:net";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  interface ProvidedContext {
    /** The second origin's base URL, e.g. `http://127.0.0.1:50123/`. */
    crossOrigin: string;
  }
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAYAAAADCAIAAAA/Y+msAAAAEUlEQVR4nGP4z8CAhtD52IUAEUQR788PiNkAAAAASUVORK5CYII=",
  "base64",
);
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="6" height="3"><rect width="6" height="3"/></svg>';
const SLOW_MS = 400;
const INTER = readFileSync(
  createRequire(new URL("../packages/dom/package.json", import.meta.url)).resolve(
    "@fontsource/inter/files/inter-latin-400-normal.woff2",
  ),
);

interface Asked {
  readonly url: string;
  readonly origin: boolean;
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const asked: Asked[] = [];
  const server = createServer((request: IncomingMessage, response) => {
    const url = request.url ?? "/";
    const path = new URL(url, "http://host").pathname;
    const send = (status: number, type: string, body: string | Buffer, headers = {}) => {
      response.writeHead(status, { "content-type": type, "cache-control": "no-store", ...headers });
      response.end(body);
    };
    if (path === "/requests") {
      send(200, "application/json", JSON.stringify(asked), { "access-control-allow-origin": "*" });
      return;
    }
    asked.push({ url, origin: request.headers.origin !== undefined });
    if (path === "/picture.png") send(200, "image/png", PNG);
    else if (path === "/picture.svg") send(200, "image/svg+xml", SVG);
    else if (path === "/inter.woff2") {
      send(200, "font/woff2", INTER, { "access-control-allow-origin": "*" });
    } else if (path === "/slow.png") {
      const delay = request.headers.origin === undefined ? SLOW_MS : 0;
      setTimeout(() => send(200, "image/png", PNG), delay);
    } else send(404, "text/plain", "not found");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  project.provide("crossOrigin", `http://127.0.0.1:${port}/`);
  return () =>
    new Promise((resolve) => {
      server.closeAllConnections();
      server.close(() => resolve());
    });
}
