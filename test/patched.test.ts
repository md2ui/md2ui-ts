// The rule `pnpm packages shape` applies to every packed tarball (scripts/patched.ts): a
// published package never reaches a package pnpm patches, since npm gives a host the
// unpatched copy. Both ways: what the rule catches, and what it lets through.
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, test } from "vitest";
import { patchedPackages, type RuntimeManifest, unpatchedReach } from "../scripts/patched.ts";

const root = resolve(import.meta.dirname, "..");
const PATCHED = ["@chenglou/pretext"];

const workspace = new Map<string, RuntimeManifest>([
  ["@md2ui/text", { name: "@md2ui/text", dependencies: { "@chenglou/pretext": "0.0.9" } }],
  ["@md2ui/bundled", { name: "@md2ui/bundled", dependencies: { comlink: "4.4.2" } }],
  ["@md2ui/host", { name: "@md2ui/host", dependencies: { "@md2ui/text": "0.0.0" } }],
]);

const noFiles = new Map<string, string>();

describe("patchedPackages", () => {
  test("reads the workspace's own patchedDependencies", () => {
    const yaml = readFileSync(join(root, "pnpm-workspace.yaml"), "utf8");
    expect(patchedPackages(yaml)).toContain("@chenglou/pretext");
  });

  test("takes keys with or without a version, quoted or not", () => {
    const yaml = [
      "packages:",
      "  - packages/*",
      "",
      "patchedDependencies:",
      "  '@scope/a@1.2.3': patches/a.patch",
      '  "b@0.1.0": patches/b.patch',
      "  c: patches/c.patch",
      "",
      "onlyBuiltDependencies:",
      "  - d",
    ].join("\n");
    expect(patchedPackages(yaml)).toEqual(["@scope/a", "b", "c"]);
  });

  test("is empty without patchedDependencies", () => {
    expect(patchedPackages("packages:\n  - packages/*\n")).toEqual([]);
  });
});

describe("unpatchedReach", () => {
  test("fails a package that depends on a patched package", () => {
    const manifest = { name: "@md2ui/text", dependencies: { "@chenglou/pretext": "0.0.9" } };
    expect(unpatchedReach(manifest, noFiles, workspace, PATCHED)).toEqual([
      "depends on @chenglou/pretext, unpatched on npm",
    ]);
  });

  test("fails a package that reaches one through workspace packages", () => {
    const manifest = { name: "@md2ui/binding", dependencies: { "@md2ui/host": "0.0.0" } };
    expect(unpatchedReach(manifest, noFiles, workspace, PATCHED)).toEqual([
      "depends on @chenglou/pretext through @md2ui/host -> @md2ui/text, unpatched on npm",
    ]);
  });

  test("fails a peer dependency on one", () => {
    const manifest = { name: "x", peerDependencies: { "@chenglou/pretext": "*" } };
    expect(unpatchedReach(manifest, noFiles, workspace, PATCHED)).toHaveLength(1);
  });

  test("fails shipped code or types that import one, or a subpath of one", () => {
    const files = new Map([
      ["dist/a.js", 'import { layout } from "@chenglou/pretext";'],
      ["dist/b.js", 'const m = await import("@chenglou/pretext/rich-inline");'],
      ["dist/c.d.ts", 'export type { PreparedText } from "@chenglou/pretext";'],
    ]);
    expect(unpatchedReach({ name: "x" }, files, workspace, PATCHED)).toEqual([
      "dist/a.js imports @chenglou/pretext, unpatched on npm",
      "dist/b.js imports @chenglou/pretext/rich-inline, unpatched on npm",
      "dist/c.d.ts imports @chenglou/pretext, unpatched on npm",
    ]);
  });

  test("passes a package that bundled it: devDependency, no import, a source map", () => {
    const manifest = {
      name: "@md2ui/bundled",
      dependencies: { comlink: "4.4.2" },
      devDependencies: { "@chenglou/pretext": "0.0.9" },
    };
    const files = new Map([
      ["dist/index.js", "const fontContexts = new Map();\nexport { fontContexts };"],
      // A map's embedded sources keep the import the bundle resolved; nothing runs them.
      [
        "dist/index.js.map",
        '{"sourcesContent":["import { layout } from \\"@chenglou/pretext\\";"]}',
      ],
    ]);
    expect(unpatchedReach(manifest, files, workspace, PATCHED)).toEqual([]);
  });

  test("passes a package whose workspace dependencies bundled it", () => {
    const manifest = { name: "@md2ui/binding", dependencies: { "@md2ui/bundled": "0.0.0" } };
    expect(unpatchedReach(manifest, noFiles, workspace, PATCHED)).toEqual([]);
  });

  test("does not mistake a package whose name only starts the same", () => {
    const manifest = { name: "x", dependencies: { "@chenglou/pretext-extra": "1.0.0" } };
    const files = new Map([["dist/a.js", 'import "@chenglou/pretext-extra";']]);
    expect(unpatchedReach(manifest, files, workspace, PATCHED)).toEqual([]);
  });
});
