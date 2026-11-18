// Does a host's bundler ship @md2ui/dom's Worker, and does the view use it? `@md2ui/dom`
// starts its own Worker by default (`new URL("./pipeline-worker.js", import.meta.url)`),
// and a Worker that cannot load is given up silently: the view renders on the main
// thread and nothing fails. Vite is exercised by the apps; this builds the same minimal
// host (host/main.js) with webpack and with Parcel, against the package as a host would
// install it (the packed tarball, its published `exports`), and loads each build in the
// real engines through Playwright. A build passes only when the page started a Worker
// from a file the bundler emitted, the Worker was still alive after the view rendered
// (a Worker the view gives up on is terminated), and no `md2ui-error` was reported.
//
// Run after the packages are built (`pnpm check` does): node src/check.ts
import { spawnSync } from "node:child_process";
import {
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { extname, join, resolve } from "node:path";
import { exit, stdout } from "node:process";
import { Parcel } from "@parcel/core";
import { type BrowserType, chromium, firefox, type Worker, webkit } from "playwright";
import webpack from "webpack";

const root = resolve(import.meta.dirname, "../../..");
const domDir = join(root, "packages/dom");
const require = createRequire(import.meta.url);

const PAGE = `<!doctype html><meta charset="utf-8"><body><script type="module" src="./main.js"></script>`;
const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".map": "application/json",
};

/** A host's `node_modules`: @md2ui/dom from the tarball `pnpm pack` makes, and its dependencies. */
function install(work: string): void {
  const pack = spawnSync("pnpm", ["pack", "--pack-destination", work], {
    cwd: domDir,
    stdio: ["ignore", "ignore", "inherit"],
  });
  const tarball = readdirSync(work).find((file) => file.endsWith(".tgz"));
  if (pack.status !== 0 || tarball === undefined) throw new Error("pnpm pack failed");
  const installed = join(work, "node_modules/@md2ui/dom");
  mkdirSync(installed, { recursive: true });
  spawnSync("tar", ["-xzf", join(work, tarball), "-C", installed, "--strip-components=1"], {
    stdio: "inherit",
  });
  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  for (const name of Object.keys(manifest.dependencies)) {
    const link = join(work, "node_modules", name);
    mkdirSync(join(link, ".."), { recursive: true });
    symlinkSync(join(domDir, "node_modules", name), link);
  }
}

async function buildWebpack(work: string, out: string): Promise<void> {
  const compiler = webpack({
    mode: "production",
    context: work,
    entry: "./main.js",
    output: { path: out, filename: "main.js", chunkFilename: "[name].js" },
  });
  await new Promise<void>((done, fail) => {
    compiler.run((error, stats) => {
      if (error) return fail(error);
      if (stats?.hasErrors()) return fail(new Error(stats.toString({ colors: false })));
      compiler.close(() => done());
    });
  });
  writeFileSync(join(out, "index.html"), PAGE);
}

async function buildParcel(work: string, out: string): Promise<void> {
  writeFileSync(join(work, "index.html"), PAGE);
  // Parcel reads a package's `exports` only when the host's package.json asks it to.
  writeFileSync(
    join(work, "package.json"),
    JSON.stringify({ "@parcel/resolver-default": { packageExports: true } }),
  );
  // Parcel takes the nearest lock file as its project root; the host's sits in `work`.
  writeFileSync(join(work, "package-lock.json"), "{}");
  const parcel = new Parcel({
    entries: join(work, "index.html"),
    defaultConfig: require.resolve("@parcel/config-default"),
    mode: "production",
    cacheDir: join(work, ".parcel-cache"),
    defaultTargetOptions: { distDir: out, publicUrl: "./", shouldOptimize: true },
    logLevel: "error",
  });
  await parcel.run();
}

const BUNDLERS = [
  { name: "webpack", build: buildWebpack },
  { name: "parcel", build: buildParcel },
] as const;

/** Serves `dir` on a free port; the Worker is fetched from it as a host's would be. */
async function serve(dir: string): Promise<{ url: string; close: () => void }> {
  const server = createServer((request, response) => {
    const asked = new URL(request.url ?? "/", "http://x").pathname;
    const path = join(dir, asked === "/" ? "index.html" : asked);
    if (!path.startsWith(dir) || !existsSync(path)) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    createReadStream(path).pipe(response);
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => {
      server.close();
      server.closeAllConnections();
    },
  };
}

/** What is wrong with the page `bundler` built, as seen by `type`; empty when nothing is. */
async function load(type: BrowserType, url: string): Promise<string[]> {
  const browser = await type.launch();
  try {
    const page = await browser.newPage();
    const workers: Worker[] = [];
    const closed = new Set<Worker>();
    const missing: string[] = [];
    page.on("worker", (worker) => {
      workers.push(worker);
      worker.on("close", () => closed.add(worker));
    });
    page.on("response", (response) => {
      if (response.status() >= 400) missing.push(`${response.status()} ${response.url()}`);
    });
    const log: string[] = [];
    page.on("console", (message) => log.push(`console ${message.type()}: ${message.text()}`));
    page.on("pageerror", (error) => log.push(`page error: ${error.message}`));
    await page.goto(url);
    const shown = await page
      .waitForFunction(
        () =>
          [
            ...(document.querySelector("md2ui-view")?.shadowRoot?.querySelectorAll(".layer *") ??
              []),
          ]
            .map((e) => e.textContent)
            .includes("Rendered through a bundled Worker."),
        undefined,
        { timeout: 20_000 },
      )
      .then(
        () => true,
        () => false,
      );
    if (!shown)
      return ["the view did not render", ...missing, ...log, ...workers.map((w) => w.url())];
    const problems = missing.map((m) => `request failed: ${m}`);
    if (workers.length !== 1) problems.push(`${workers.length} Workers started, expected 1`);
    for (const worker of workers) {
      if (!worker.url().startsWith(url))
        problems.push(`Worker not from the bundle: ${worker.url()}`);
      if (closed.has(worker)) problems.push(`the view gave up the Worker ${worker.url()}`);
    }
    const errors = await page.evaluate(() => (window as unknown as { errors: unknown[] }).errors);
    for (const error of errors) problems.push(`md2ui-error ${JSON.stringify(error)}`);
    const inked = await page.evaluate(() => {
      const canvas = document.querySelector("md2ui-view")?.shadowRoot?.querySelector("canvas");
      const context = canvas?.getContext("2d");
      const pixels = context?.getImageData(0, 0, canvas?.width ?? 0, canvas?.height ?? 0).data;
      return pixels?.some((value, i) => i % 4 === 3 && value !== 0) ?? false;
    });
    if (!inked) problems.push("the canvas is blank");
    return problems;
  } finally {
    await browser.close();
  }
}

async function main(): Promise<number> {
  const work = realpathSync(mkdtempSync(join(tmpdir(), "md2ui-bundlers-")));
  let failed = false;
  try {
    install(work);
    cpSync(join(import.meta.dirname, "../host/main.js"), join(work, "main.js"));
    for (const { name, build } of BUNDLERS) {
      const out = join(work, `dist-${name}`);
      const started = performance.now();
      try {
        await build(work, out);
      } catch (error) {
        stdout.write(`${name}: build FAILED\n${String(error)}\n`);
        failed = true;
        continue;
      }
      const built = ((performance.now() - started) / 1000).toFixed(1);
      const server = await serve(out);
      try {
        for (const type of [chromium, firefox, webkit]) {
          const problems = await load(type, server.url);
          failed ||= problems.length > 0;
          const detail =
            problems.length === 0 ? "worker answered" : `FAILED\n  ${problems.join("\n  ")}`;
          stdout.write(`${name} (built ${built}s) ${type.name()}: ${detail}\n`);
        }
      } finally {
        server.close();
      }
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return failed ? 1 : 0;
}

exit(await main());
