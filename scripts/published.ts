// A published package is installed from npm on its own, so everything its shipped code
// and declarations import must be a package npm gives the host with it: one it names as
// a runtime dependency or peer, and never a workspace package that is not published,
// which npm does not have. The internal packages are inlined by the published package
// that uses them (ADR-006), whose dependencies then include theirs: knip cannot see those
// used (its source imports only the internal package), so this rule also fails a runtime
// dependency nothing shipped imports. `scripts/packages.ts shape` applies this to every
// packed tarball.
import { type RuntimeManifest, runtime, shippedImports } from "./patched.ts";

/** The package a bare specifier names (`@scope/name/sub` -> `@scope/name`); none for a path or URL. */
function packageOf(specifier: string): string | undefined {
  if (specifier.startsWith(".") || specifier.startsWith("/") || specifier.includes(":")) {
    return undefined;
  }
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : parts[0];
}

/**
 * Why a packed package would not install or run from npm alone, one line each: a shipped
 * file that imports a package it does not name as a runtime dependency (its own name, a
 * self-reference, is fine), a runtime dependency on a workspace package that is not
 * published, or one that nothing shipped imports. Empty when npm gives a host exactly
 * what the package imports.
 */
export function unpublishedReach(
  manifest: RuntimeManifest,
  files: ReadonlyMap<string, string>,
  workspace: ReadonlySet<string>,
  published: ReadonlySet<string>,
): string[] {
  const listed = new Set(runtime(manifest));
  const imported = new Set<string>();
  const unlisted = shippedImports(files).flatMap(({ path, specifier }) => {
    const name = packageOf(specifier);
    if (name === undefined || name === manifest.name) return [];
    imported.add(name);
    return listed.has(name) ? [] : [`${path} imports ${specifier}, not one of its dependencies`];
  });
  const internal = [...listed].flatMap((name) =>
    workspace.has(name) && !published.has(name)
      ? [`depends on ${name}, which is not published`]
      : [],
  );
  const unused = [...listed].flatMap((name) =>
    imported.has(name) ? [] : [`depends on ${name}, which nothing it ships imports`],
  );
  return [...unlisted, ...internal, ...unused];
}
