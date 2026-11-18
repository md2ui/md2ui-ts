// `pnpm check` — the gate (ADR-004). It runs every step even after one fails, so a
// single run names every broken rule, then prints one summary line per step and
// exits non-zero if any step failed.
//
// Two steps run only when their input is named, and are otherwise reported as skipped,
// visibly, so a green gate never hides that they were not run:
// - conformance, when MD2UI_FIXTURES names a fixtures directory (it holds every input
//   the stages take);
// - wire protocol, when MD2UI_PROTOCOL names md2ui's protocol/ folder (contract C5).
//
// Buildable packages (those with a `build` script) are built, then checked as ADR-006
// requires: package shape, size budget and API report (scripts/packages.ts). Then the
// packed @md2ui/dom is bundled by webpack and by Parcel and run in three engines, to see
// its Worker shipped and used (tools/bundlers).
import { spawnSync } from "node:child_process";
import { env, exit, stdout } from "node:process";

interface Step {
  readonly name: string;
  readonly command: readonly string[];
}

interface Outcome {
  readonly name: string;
  readonly status: "pass" | "FAIL" | "skipped";
  readonly seconds: number;
  readonly note: string;
}

const bin = (tool: string): string => `node_modules/.bin/${tool}`;

interface Inputs {
  readonly fixtures: string | undefined;
  readonly protocol: string | undefined;
}

const packageCheck = (mode: string): readonly string[] => ["pnpm", "--silent", "packages", mode];

function steps({ fixtures, protocol }: Inputs): readonly Step[] {
  const always: Step[] = [
    { name: "types", command: [bin("tsc"), "-b"] },
    { name: "lint", command: [bin("biome"), "check", "."] },
    {
      name: "dependency rules",
      command: [bin("depcruise"), "--config", ".dependency-cruiser.cjs", "."],
    },
    { name: "unused code", command: [bin("knip")] },
    {
      name: "tests (node + chromium)",
      command: [bin("vitest"), "run", "--project", "node", "--project", "browser (chromium)"],
    },
    { name: "build", command: ["pnpm", "-r", "--filter", "./packages/*", "run", "build"] },
    { name: "package shape", command: packageCheck("shape") },
    { name: "size budgets", command: packageCheck("size") },
    { name: "api reports", command: packageCheck("api") },
    {
      name: "bundlers",
      command: ["pnpm", "--silent", "--filter", "@md2ui/bundlers", "run", "check"],
    },
  ];
  if (protocol !== undefined) {
    // The variable reaches the tests through the inherited environment.
    always.push({
      name: "wire protocol",
      command: [bin("vitest"), "run", "--project", "protocol"],
    });
  }
  if (fixtures !== undefined) {
    always.push({
      name: "conformance",
      command: ["pnpm", "--silent", "conformance", "--fixtures", fixtures],
    });
  }
  return always;
}

function run(step: Step): Outcome {
  stdout.write(`\n=== ${step.name}: ${step.command.join(" ")}\n`);
  const started = performance.now();
  const [command, ...args] = step.command;
  const result = spawnSync(command ?? "", args, { stdio: "inherit" });
  const seconds = (performance.now() - started) / 1000;
  const ok = result.status === 0 && result.error === undefined;
  const note = result.error ? String(result.error) : `exit ${result.status ?? result.signal}`;
  return { name: step.name, status: ok ? "pass" : "FAIL", seconds, note: ok ? "" : note };
}

function main(): number {
  const fixtures = env["MD2UI_FIXTURES"] || undefined;
  const protocol = env["MD2UI_PROTOCOL"] || undefined;
  const started = performance.now();
  const outcomes = steps({ fixtures, protocol }).map(run);
  if (protocol === undefined) {
    outcomes.push({
      name: "wire protocol",
      status: "skipped",
      seconds: 0,
      note: "MD2UI_PROTOCOL is not set",
    });
  }
  if (fixtures === undefined) {
    outcomes.push({
      name: "conformance",
      status: "skipped",
      seconds: 0,
      note: "MD2UI_FIXTURES is not set",
    });
  }
  const total = (performance.now() - started) / 1000;

  stdout.write("\n=== pnpm check summary\n");
  for (const o of outcomes) {
    const time = o.status === "skipped" ? "" : `${o.seconds.toFixed(1)}s`;
    stdout.write(`  ${o.status.padEnd(8)} ${o.name.padEnd(24)} ${time.padStart(6)}  ${o.note}\n`);
  }
  const failed = outcomes.filter((o) => o.status === "FAIL");
  if (protocol === undefined) {
    stdout.write("\n  wire protocol skipped: set MD2UI_PROTOCOL=<md2ui protocol/ dir> to run it\n");
  }
  if (fixtures === undefined) {
    stdout.write("\n  conformance skipped: set MD2UI_FIXTURES=<fixtures dir> to run it\n");
  }
  stdout.write(
    failed.length === 0
      ? `\npnpm check: OK (${total.toFixed(1)}s)\n`
      : `\npnpm check: FAILED — ${failed.map((o) => o.name).join(", ")} (${total.toFixed(1)}s)\n`,
  );
  return failed.length === 0 ? 0 : 1;
}

exit(main());
