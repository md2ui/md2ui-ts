// The layer and package rules of ADR-003 and ADR-005, enforced by `pnpm check`.
//
// Every rule is matched twice: on the resolved path (`packages/core/...`) and on the
// bare package name (`@md2ui/core`), because an import of a package the importer does
// not declare does not resolve under pnpm and is reported by its specifier.
//
// Each rule name is what `pnpm check` prints when the rule fires; keep them readable.

/** A workspace package, by resolved path or by package name. */
const pkg = (dir, name) => `^(packages/${dir}/|@md2ui/${name}($|/))`;

const CONTRACTS = pkg("contracts", "contracts");
const CORE = pkg("core", "core");
const TEXT = pkg("text-pretext", "text-pretext");
const PAINTER = pkg("painter-canvas", "painter-canvas");
const HOST = pkg("dom", "dom");
const BINDINGS = "^(packages/(react|vue)/|@md2ui/(react|vue)($|/))";
const WIRE = pkg("wire", "wire");
const TOOLS = "^(tools/|@md2ui/conformance($|/))";
const APPS = "^(apps/|@md2ui/playground($|/))";

/** Every workspace package, so a rule can say "any package but these". */
const ANY_WORKSPACE = "^(packages/|tools/|apps/|@md2ui/)";

/** UI frameworks. Only the bindings (and the playground) may import one. */
const FRAMEWORKS =
  "^(react|react-dom|vue|@vue/[^/]+|preact|svelte|solid-js|lit|@angular/[^/]+)($|/)|node_modules/(react|react-dom|vue|@vue|preact|svelte|solid-js|lit|@angular)/";

/** A layer may import itself and the listed layers, and no other workspace package. */
function layer(name, from, allowed, comment) {
  return {
    name,
    comment,
    severity: "error",
    from: { path: from },
    to: { path: ANY_WORKSPACE, pathNot: [from, ...allowed] },
  };
}

/** An inline layer of the grouper may not import a layer that comes after it. */
function inlineLayer(name, from, later) {
  const group = "^packages/core/src/group/";
  return {
    name,
    comment:
      "The grouper's inline layers import one way: marks -> separators -> elements -> values.",
    severity: "error",
    from: { path: `${group}${from}\\.ts$` },
    to: { path: `${group}(${later.join("|")})\\.ts$` },
  };
}

module.exports = {
  forbidden: [
    // --- ADR-003 layers ---------------------------------------------------------
    layer(
      "layer-contracts-import-nothing",
      CONTRACTS,
      [],
      "Contracts are types and schemas only; they depend on nothing (ADR-003).",
    ),
    layer(
      "layer-core-depends-only-on-contracts",
      CORE,
      [CONTRACTS],
      "Core is Markdown + theme -> display list; it depends on contracts only (ADR-003).",
    ),
    layer(
      "layer-text-depends-only-on-contracts",
      TEXT,
      [CONTRACTS],
      "A measurer implements a contract; it depends on contracts only (ADR-003).",
    ),
    layer(
      "layer-painter-depends-on-contracts-and-text",
      PAINTER,
      [CONTRACTS, TEXT],
      "The painter paints a display list; it depends on contracts and, for setCanvasFont only, the text layer (ADR-003).",
    ),
    layer(
      "layer-host-depends-on-core-text-painter",
      HOST,
      [CONTRACTS, CORE, TEXT, PAINTER],
      "The host connects core, text and painter to a page; nothing above it (ADR-003).",
    ),
    layer(
      "layer-bindings-depend-on-host",
      BINDINGS,
      [CONTRACTS, HOST],
      "A binding wraps <md2ui-view>; it reaches nothing below the host (ADR-003).",
    ),
    layer(
      "layer-wire-depends-only-on-contracts",
      WIRE,
      [CONTRACTS],
      "The wire client is optional and stands alone on contracts (ADR-003).",
    ),
    {
      name: "no-package-depends-on-tools-or-apps",
      comment: "tools/ and apps/ are dev-only and never a dependency of a package (ADR-005).",
      severity: "error",
      from: { path: "^packages/" },
      to: { path: [TOOLS, APPS] },
    },
    {
      name: "framework-only-in-bindings",
      comment: "No UI framework outside packages/react, packages/vue and the playground (ADR-003).",
      severity: "error",
      from: { path: "^(packages|tools)/", pathNot: "^packages/(react|vue)/" },
      to: { path: FRAMEWORKS },
    },
    {
      name: "no-node-builtins-in-packages",
      comment: "Packages run in browsers and workers; Node built-ins belong to tools/ only.",
      severity: "error",
      from: { path: "^packages/[^/]+/src/" },
      to: { dependencyTypes: ["core"] },
    },

    // --- Repository boundaries -----------------------------------------------------
    {
      name: "no-import-out-of-repository",
      comment:
        "Nothing imports from outside this repository (AGENTS.md: never read ../). Paths to fixtures are passed as arguments.",
      severity: "error",
      from: {},
      to: { path: "^\\.\\./" },
    },
    {
      name: "no-relative-import-across-packages",
      comment:
        "A package reaches another by its name (@md2ui/x), never by a relative path into its folder.",
      severity: "error",
      from: { path: "^(packages|tools|apps)/([^/]+)/" },
      to: {
        path: "^(packages|tools|apps)/([^/]+)/",
        pathNot: ["^$1/$2/"],
        dependencyTypes: ["local"],
      },
    },
    {
      name: "not-to-unresolvable",
      comment: "An import that does not resolve is a missing dependency or a typo.",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
    // --- md2ui's inline layers: marks -> separators -> elements -> values ----------
    // Each layer may import the ones before it and never one after it (md2ui
    // AGENTS.md: grouper_inline_marks owns the vocabulary the three cuts share).
    inlineLayer("inline-marks-import-no-cut", "inline-marks", [
      "separator-splits",
      "element-splits",
      "value-splits",
    ]),
    inlineLayer("separator-splits-import-no-later-cut", "separator-splits", [
      "element-splits",
      "value-splits",
    ]),
    inlineLayer("element-splits-import-no-value-cut", "element-splits", ["value-splits"]),
    {
      name: "no-circular",
      comment: "Dependencies point one way (md2ui ADR-000).",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(node_modules|dist|coverage)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    combinedDependencies: false,
    preserveSymlinks: false,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "types", "default"],
      extensions: [".ts", ".js", ".json"],
    },
    reporterOptions: { text: { highlightFocused: true } },
  },
};
