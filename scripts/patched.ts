// A package pnpm patches (`patchedDependencies` in pnpm-workspace.yaml) is patched only
// inside this workspace: a host that installs a published package from npm gets the
// registry's copy, unpatched. So what ships must carry the patched code itself, bundled
// at build time (ADR-006), and never reach a patched package as an import or as a
// runtime dependency. `scripts/packages.ts shape` applies this to every packed tarball.

/** A package's manifest, as far as a host's install reads it. */
export interface RuntimeManifest {
  readonly name: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
}

/** The names of the packages `patchedDependencies` patches (a key is `name` or `name@version`). */
export function patchedPackages(workspaceYaml: string): string[] {
  const section = /^patchedDependencies:\s*\n((?:[ \t]+\S.*\n?)*)/m.exec(workspaceYaml)?.[1];
  if (section === undefined) return [];
  return [...section.matchAll(/^\s*["']?(@?[^@\s"':]+)(?:@[^"':\s]+)?["']?\s*:/gm)].flatMap((m) =>
    m[1] === undefined ? [] : [m[1]],
  );
}

/** What a host's install fetches with a package: its dependencies, peers and optional ones. */
export const runtime = (manifest: RuntimeManifest): string[] =>
  Object.keys({
    ...manifest.dependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
  });

/** Code a host runs or type-checks; a source map's embedded sources are neither. */
const CODE = /\.(?:[cm]?js|d\.[cm]?ts)$/;

/** Every module specifier a file imports, re-exports or requires. */
const SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\s*\(\s*)["']([^"']+)["']/g;

/** Each specifier a shipped code or declaration file imports, with the file's path. */
export function shippedImports(
  files: ReadonlyMap<string, string>,
): { readonly path: string; readonly specifier: string }[] {
  return [...files].flatMap(([path, text]) =>
    CODE.test(path)
      ? [...text.matchAll(SPECIFIER)].flatMap(([, specifier]) =>
          specifier === undefined ? [] : [{ path, specifier }],
        )
      : [],
  );
}

/**
 * Why a packed package would hand a host a patched package unpatched, one line each:
 * a shipped file that imports it, or a runtime dependency that is it, directly or
 * through workspace packages (which a host installs as they are published). Empty
 * when the package ships only patched code.
 */
export function unpatchedReach(
  manifest: RuntimeManifest,
  files: ReadonlyMap<string, string>,
  workspace: ReadonlyMap<string, RuntimeManifest>,
  patched: readonly string[],
): string[] {
  const named = (specifier: string): string | undefined =>
    patched.find((name) => specifier === name || specifier.startsWith(`${name}/`));
  const problems = shippedImports(files).flatMap(({ path, specifier }) =>
    named(specifier) === undefined ? [] : [`${path} imports ${specifier}, unpatched on npm`],
  );
  const seen = new Set<string>([manifest.name]);
  const pending: { readonly name: string; readonly via: readonly string[] }[] = runtime(
    manifest,
  ).map((name) => ({ name, via: [] }));
  for (let next = pending.shift(); next !== undefined; next = pending.shift()) {
    const { name, via } = next;
    if (seen.has(name)) continue;
    seen.add(name);
    if (named(name) !== undefined) {
      const chain = via.length === 0 ? "" : ` through ${via.join(" -> ")}`;
      problems.push(`depends on ${name}${chain}, unpatched on npm`);
      continue;
    }
    const inner = workspace.get(name);
    if (inner !== undefined) {
      pending.push(...runtime(inner).map((dep) => ({ name: dep, via: [...via, name] })));
    }
  }
  return problems;
}
