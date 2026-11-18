// "Nothing runs on import" (ADR-003, ADR-004): every entry of every workspace package
// is imported in Node, where there is no `window` or `document`. The import must not
// throw, and it must leave `globalThis` as it found it: the same own keys, each
// holding the same value. Entries are discovered from pnpm-workspace.yaml and each
// package's `exports` map, so a new package is covered without editing this file.
//
// A package's peers (a binding's framework) are the host's: what they do on import is
// theirs, so each is imported before the snapshot. Vue, for one, writes its own globals.
import { globSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Entry {
  readonly label: string;
  readonly file: string;
  /** The package's peer dependencies, imported (from the package) before the snapshot. */
  readonly peers: readonly string[];
}

function workspaceGlobs(): string[] {
  const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
  return [...yaml.matchAll(/^\s*-\s*["']?([^"'\s#]+)["']?\s*$/gm)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );
}

function exportTargets(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value !== null && typeof value === "object") {
    return Object.values(value).flatMap(exportTargets);
  }
  return [];
}

function discoverEntries(): Entry[] {
  return workspaceGlobs()
    .flatMap((pattern) => globSync(`${pattern}/package.json`, { cwd: root }))
    .sort()
    .flatMap((manifest) => {
      const pkg = JSON.parse(readFileSync(join(root, manifest), "utf8")) as {
        name?: string;
        exports?: unknown;
        peerDependencies?: Record<string, string>;
      };
      const dir = dirname(manifest);
      const targets = [...new Set(exportTargets(pkg.exports))].filter((t) => !t.endsWith(".json"));
      const peers = Object.keys(pkg.peerDependencies ?? {});
      return targets.map((target) => ({
        label: `${pkg.name ?? dir} → ${target}`,
        file: join(root, dir, target),
        peers,
      }));
    });
}

/**
 * Each own key of `globalThis` with what it holds: the value of a data property, the
 * getter and setter of an accessor. Getters are never called. Reading a descriptor
 * can still initialise one of Node's lazy globals (`fetch` creates an `undici`
 * symbol on first touch), so a test takes one throwaway snapshot first.
 */
function snapshotGlobals(): Map<PropertyKey, readonly unknown[]> {
  return new Map(
    Reflect.ownKeys(globalThis).map((key) => {
      const d = Object.getOwnPropertyDescriptor(globalThis, key);
      return [key, d === undefined ? [] : "value" in d ? [d.value] : [d.get, d.set]] as const;
    }),
  );
}

// Importing an entry is not a performance budget: under a loaded gate it can take longer
// than Vitest's 5 s default, so it gets a generous timeout instead.
const IMPORT_TIMEOUT_MS = 60_000;

const entries = discoverEntries();

test("entries are discovered from the workspace", () => {
  expect(entries.map((e) => e.label)).toContain("@md2ui/core → ./src/index.ts");
  expect(entries.length).toBeGreaterThanOrEqual(10);
});

test.each(entries)(
  "importing $label runs nothing",
  async ({ file, peers }) => {
    expect("window" in globalThis).toBe(false);
    expect("document" in globalThis).toBe(false);
    const from = createRequire(file);
    for (const peer of peers) await import(pathToFileURL(from.resolve(peer)).href);

    // Nothing else may run between the two snapshots: even `expect` writes a global.
    snapshotGlobals(); // settles Node's lazy globals; see snapshotGlobals
    const before = snapshotGlobals();
    const failure = await import(pathToFileURL(file).href).then(
      () => undefined,
      (error: unknown) => error,
    );
    const after = snapshotGlobals();

    expect(failure).toBeUndefined();

    expect([...after.keys()].map(String)).toEqual([...before.keys()].map(String));
    const changed = [...before].filter(([key, held]) => {
      const now = after.get(key) ?? [];
      return held.length !== now.length || held.some((v, i) => !Object.is(v, now[i]));
    });
    expect(changed.map(([key]) => String(key))).toEqual([]);
  },
  IMPORT_TIMEOUT_MS,
);
