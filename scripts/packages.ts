// The package checks of ADR-006, for every buildable package — one that has a `build`
// script. `pnpm check` runs each mode as its own step, after the build:
//
//   node scripts/packages.ts shape   publint and @arethetypeswrong/cli on the packed tarball, no
//                                    patched dependency reached unpatched (scripts/patched.ts),
//                                    and nothing imported that npm would not install with it
//                                    (scripts/published.ts)
//   node scripts/packages.ts size    minified and gzipped size of each entry, against size-budgets.json
//   node scripts/packages.ts api     the API Extractor report, for each package that has one
//
// The tarball is what a host would install: `pnpm pack` applies `publishConfig`, so the
// checks see the published `exports`, not the workspace's source ones. The tools are
// called as libraries, so the dependency checker sees them used.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { argv, exit, stdout } from "node:process";
import { gzipSync } from "node:zlib";
import { checkPackage, createPackageFromTarballData } from "@arethetypeswrong/core";
import { Extractor, ExtractorConfig } from "@microsoft/api-extractor";
import { publint } from "publint";
import { formatMessage } from "publint/utils";
import { rolldown } from "rolldown";
import { patchedPackages, type RuntimeManifest, unpatchedReach } from "./patched.ts";
import { unpublishedReach } from "./published.ts";

interface Manifest extends RuntimeManifest {
  readonly scripts?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly publishConfig?: {
    readonly exports?: Readonly<Record<string, { readonly default?: string }>>;
  };
}

/** A published entry: its specifier (`@md2ui/dom/worker`) and its built file. */
interface Entry {
  readonly specifier: string;
  readonly file: string;
}

interface Buildable {
  readonly dir: string;
  readonly name: string;
  /** The host's own packages (a binding's framework): never part of what it ships. */
  readonly peers: readonly string[];
  /** Every entry the published `exports` map names, each with its own budget. */
  readonly entries: readonly Entry[];
}

/** Bytes, minified and gzipped, that a package's entry may not exceed. */
interface Budget {
  readonly minified: number;
  readonly gzip: number;
}

const root = resolve(import.meta.dirname, "..");

/** ESM only (ADR-006): CommonJS and node10 resolution are out of scope by design. */
const IGNORED_RESOLUTIONS: ReadonlySet<string> = new Set(["node10", "node16-cjs"]);

function buildable(): Buildable[] {
  const packages = join(root, "packages");
  // Folders only: a file the OS leaves there (Finder's .DS_Store) is not a package.
  return readdirSync(packages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(packages, entry.name))
    .sort()
    .flatMap((dir) => {
      const manifest: Manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      const peers = Object.keys(manifest.peerDependencies ?? {});
      const entries = Object.entries(manifest.publishConfig?.exports ?? {}).flatMap(
        ([subpath, target]) =>
          target.default === undefined
            ? []
            : [{ specifier: manifest.name + subpath.slice(1), file: join(dir, target.default) }],
      );
      return manifest.scripts?.["build"] === undefined
        ? []
        : [{ dir, name: manifest.name, peers, entries }];
    });
}

/** The tarball a host would install, as `pnpm pack` makes it (publishConfig applied). */
function pack(pkg: Buildable): Uint8Array | undefined {
  const out = mkdtempSync(join(tmpdir(), "md2ui-pack-"));
  try {
    const result = spawnSync("pnpm", ["pack", "--pack-destination", out], {
      cwd: pkg.dir,
      stdio: ["ignore", "ignore", "inherit"],
    });
    const tarball = readdirSync(out).find((file) => file.endsWith(".tgz"));
    if (result.status !== 0 || tarball === undefined) return undefined;
    return new Uint8Array(readFileSync(join(out, tarball)));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

/**
 * What the shape step checks a tarball against: the packages pnpm patches and every
 * workspace package's manifest, for `unpatchedReach`; the published (buildable) ones,
 * for `unpublishedReach`.
 */
interface Workspace {
  readonly names: readonly string[];
  readonly workspace: ReadonlyMap<string, RuntimeManifest>;
  readonly published: ReadonlySet<string>;
}

function workspaceOf(packages: readonly Buildable[]): Workspace {
  const dir = join(root, "packages");
  const manifests = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(
      (entry): Manifest => JSON.parse(readFileSync(join(dir, entry.name, "package.json"), "utf8")),
    );
  return {
    names: patchedPackages(readFileSync(join(root, "pnpm-workspace.yaml"), "utf8")),
    workspace: new Map(manifests.map((manifest) => [manifest.name, manifest])),
    published: new Set(packages.map((pkg) => pkg.name)),
  };
}

async function shape(pkg: Buildable, { names, workspace, published }: Workspace): Promise<boolean> {
  const tarball = pack(pkg);
  if (tarball === undefined) {
    stdout.write(`${pkg.name}: pnpm pack failed\n`);
    return false;
  }
  const lint = await publint({ pack: { tarball: tarball.slice().buffer }, strict: true });
  for (const message of lint.messages) {
    stdout.write(`${pkg.name}: publint ${message.type}: ${formatMessage(message, lint.pkg)}\n`);
  }
  const packed = createPackageFromTarballData(tarball);
  const prefix = `/node_modules/${packed.packageName}/`;
  const files = new Map(
    packed.listFiles().map((path) => [path.slice(prefix.length), packed.readFile(path)]),
  );
  const manifest: Manifest = JSON.parse(files.get("package.json") ?? "{}");
  const unpatched = unpatchedReach(manifest, files, workspace, names);
  for (const problem of unpatched) stdout.write(`${pkg.name}: ${problem}\n`);
  const unpublished = unpublishedReach(manifest, files, new Set(workspace.keys()), published);
  for (const problem of unpublished) stdout.write(`${pkg.name}: ${problem}\n`);
  const types = await checkPackage(packed);
  const problems = types.types
    ? types.problems.filter(
        (problem) =>
          !("resolutionKind" in problem && IGNORED_RESOLUTIONS.has(problem.resolutionKind)),
      )
    : [];
  if (!types.types) stdout.write(`${pkg.name}: attw: the package ships no types\n`);
  for (const problem of problems) {
    stdout.write(`${pkg.name}: attw ${problem.kind}: ${JSON.stringify(problem)}\n`);
  }
  const ok =
    lint.messages.length === 0 &&
    types.types !== false &&
    problems.length === 0 &&
    unpatched.length === 0 &&
    unpublished.length === 0;
  stdout.write(
    `${pkg.name}: publint, attw, patched and published dependencies ${ok ? "clean" : "FAILED"}\n`,
  );
  return ok;
}

async function size(
  pkg: Buildable,
  entry: Entry,
  budgets: Readonly<Record<string, Budget>>,
  others: readonly string[],
): Promise<boolean> {
  const budget = budgets[entry.specifier];
  if (budget === undefined) {
    stdout.write(`${entry.specifier}: no budget in size-budgets.json\n`);
    return false;
  }
  // What a host's bundler would ship for the entry, minified, with everything inlined
  // but two kinds of package: the peers, which the host has already, and the other
  // buildable packages, which have budgets of their own (a binding over @md2ui/dom), so
  // every byte is counted once. Only the entry and what it imports statically count; a
  // chunk loaded on demand (a Shiki grammar) is fetched only by a document that
  // needs it.
  const outside = [...pkg.peers, ...others];
  const external = (id: string): boolean =>
    outside.some((name) => id === name || id.startsWith(`${name}/`));
  const bundle = await rolldown({
    input: entry.file,
    platform: "browser",
    logLevel: "silent",
    external,
  });
  const { output } = await bundle.generate({ format: "esm", minify: true });
  await bundle.close();
  const chunks = new Map(
    output.flatMap((chunk) => (chunk.type === "chunk" ? [[chunk.fileName, chunk] as const] : [])),
  );
  const shipped = new Set<string>();
  const pending = [...chunks.values()].filter((chunk) => chunk.isEntry).map((c) => c.fileName);
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (shipped.has(file)) continue;
    shipped.add(file);
    pending.push(...(chunks.get(file)?.imports ?? []));
  }
  const code = [...shipped].map((file) => chunks.get(file)?.code ?? "").join("");
  const minified = Buffer.byteLength(code);
  const gzip = gzipSync(code, { level: 9 }).byteLength;
  const ok = minified <= budget.minified && gzip <= budget.gzip;
  stdout.write(
    `${entry.specifier}: ${minified} B minified (budget ${budget.minified}), ` +
      `${gzip} B gzipped (budget ${budget.gzip})${ok ? "" : " — OVER BUDGET"}\n`,
  );
  return ok;
}

/** One report per configuration: `api-extractor.json` for the main entry, `api-extractor.<entry>.json` for a subpath. */
function api(pkg: Buildable): boolean {
  const configs = readdirSync(pkg.dir)
    .filter((file) => /^api-extractor(\.[\w-]+)?\.json$/.test(file))
    .sort();
  return configs
    .map((file) => {
      // Not a local build: a report that differs from the committed one fails the run,
      // and the new report is left in the package's dist/api/ to review and copy.
      const config = ExtractorConfig.loadFileAndPrepare(join(pkg.dir, file));
      const result = Extractor.invoke(config, { localBuild: false });
      stdout.write(
        `${pkg.name} (${file}): API report ${result.succeeded ? "matches" : "FAILED"}\n`,
      );
      return result.succeeded;
    })
    .every(Boolean);
}

async function main(mode: string | undefined): Promise<number> {
  const packages = buildable();
  const results: boolean[] = [];
  if (mode === "shape") {
    const workspace = workspaceOf(packages);
    for (const pkg of packages) results.push(await shape(pkg, workspace));
  } else if (mode === "size") {
    const budgets: Record<string, Budget> = JSON.parse(
      readFileSync(join(root, "size-budgets.json"), "utf8"),
    );
    const names = packages.map((p) => p.name);
    for (const pkg of packages) {
      const others = names.filter((name) => name !== pkg.name);
      for (const entry of pkg.entries) results.push(await size(pkg, entry, budgets, others));
    }
  } else if (mode === "api") {
    for (const pkg of packages) results.push(api(pkg));
  } else {
    stdout.write("usage: node scripts/packages.ts shape|size|api\n");
    return 2;
  }
  return results.every(Boolean) ? 0 : 1;
}

exit(await main(argv[2]));
