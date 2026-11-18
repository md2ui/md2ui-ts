// The rule `pnpm packages shape` applies to every packed tarball (scripts/published.ts): a
// published package installs from npm alone, so it imports only packages it names as
// runtime dependencies, and depends on no workspace package that is not published. Both
// ways: what the rule catches, and what it lets through.
import { describe, expect, test } from "vitest";
import { unpublishedReach } from "../scripts/published.ts";

const WORKSPACE = new Set(["@md2ui/core", "@md2ui/contracts", "@md2ui/dom", "@md2ui/react"]);
const PUBLISHED = new Set(["@md2ui/dom", "@md2ui/react"]);

describe("unpublishedReach", () => {
  test("fails a dependency on a workspace package that is not published", () => {
    const manifest = { name: "@md2ui/dom", dependencies: { "@md2ui/core": "0.0.0" } };
    const files = new Map([["dist/a.js", 'import { parse } from "@md2ui/core";']]);
    expect(unpublishedReach(manifest, files, WORKSPACE, PUBLISHED)).toEqual([
      "depends on @md2ui/core, which is not published",
    ]);
  });

  test("fails a dependency nothing shipped imports, which a host would install for nothing", () => {
    const manifest = { name: "@md2ui/dom", dependencies: { comlink: "4.4.2", shiki: "4.5.0" } };
    const files = new Map([["dist/a.js", 'import { wrap } from "comlink";']]);
    expect(unpublishedReach(manifest, files, WORKSPACE, PUBLISHED)).toEqual([
      "depends on shiki, which nothing it ships imports",
    ]);
  });

  test("fails shipped code or types that import a package it does not depend on", () => {
    const manifest = { name: "@md2ui/dom", dependencies: { comlink: "4.4.2" } };
    const files = new Map([
      ["dist/a.js", 'import { parse } from "@md2ui/core";\nimport { wrap } from "comlink";'],
      ["dist/b.js", 'const m = await import("shiki/langs");'],
      ["dist/c.d.ts", 'export type { Frame } from "@md2ui/contracts";'],
      ["dist/d.d.ts", 'type T = import("flatbush").default;'],
    ]);
    expect(unpublishedReach(manifest, files, WORKSPACE, PUBLISHED)).toEqual([
      "dist/a.js imports @md2ui/core, not one of its dependencies",
      "dist/b.js imports shiki/langs, not one of its dependencies",
      "dist/c.d.ts imports @md2ui/contracts, not one of its dependencies",
      "dist/d.d.ts imports flatbush, not one of its dependencies",
    ]);
  });

  test("fails an import of a devDependency: npm does not install it for a host", () => {
    const manifest = {
      name: "@md2ui/dom",
      devDependencies: { "@md2ui/core": "workspace:*" },
    };
    const files = new Map([["dist/a.js", 'import "@md2ui/core";']]);
    expect(unpublishedReach(manifest, files, WORKSPACE, PUBLISHED)).toEqual([
      "dist/a.js imports @md2ui/core, not one of its dependencies",
    ]);
  });

  test("passes a package that inlined its internal packages", () => {
    const manifest = {
      name: "@md2ui/dom",
      dependencies: { comlink: "4.4.2", shiki: "4.5.0" },
      devDependencies: { "@md2ui/core": "workspace:*" },
    };
    const files = new Map([
      [
        "dist/index.js",
        [
          'import { wrap } from "comlink";',
          'import { createHighlighterCore } from "shiki/core";',
          'import { session } from "./session-abc.js";',
          'const worker = new URL("./pipeline-worker.js", import.meta.url);',
        ].join("\n"),
      ],
      ["dist/worker.d.ts", 'export type { Md2uiAction } from "./index.js";'],
      // A map's embedded sources keep the imports the bundle resolved; nothing runs them.
      ["dist/index.js.map", '{"sourcesContent":["import { parse } from \\"@md2ui/core\\";"]}'],
    ]);
    expect(unpublishedReach(manifest, files, WORKSPACE, PUBLISHED)).toEqual([]);
  });

  test("passes a published workspace dependency, a peer, and a self-reference", () => {
    const manifest = {
      name: "@md2ui/react",
      dependencies: { "@md2ui/dom": "0.0.0" },
      peerDependencies: { react: "^19" },
    };
    const files = new Map([
      [
        "dist/index.js",
        [
          'import { defineMd2uiView } from "@md2ui/dom";',
          'import { createElement } from "react";',
          'import { jsx } from "react/jsx-runtime";',
          'export * from "@md2ui/react";',
        ].join("\n"),
      ],
    ]);
    expect(unpublishedReach(manifest, files, WORKSPACE, PUBLISHED)).toEqual([]);
  });
});
