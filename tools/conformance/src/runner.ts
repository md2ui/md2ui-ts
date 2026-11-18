// Runs the checks and reports: the md2ui commit the fixtures came from, then every
// failing or diverged unit with its differences, then one summary row per check and
// the measurer divergences by class. The exit code is non-zero only when a ported
// check fails; a divergence is reported, not failed (ADR-403).
import { type Family, families, type Outcome, type Status, type Unit } from "./checks.ts";
import type { Difference, DifferenceClass } from "./diff.ts";
import { SetupError } from "./errors.ts";
import { readManifest } from "./manifest.ts";
import type { Stages } from "./stages.ts";

export interface Options {
  readonly fixtures: string;
  /** Check names, or a check family before its `:` (`grouper-phase`, `layout`). */
  readonly only: readonly string[];
  /** Fixture names (`tests__tests-key-value`) or md2ui paths of documents or themes. */
  readonly docs: readonly string[];
}

/** Differences printed per class and failing unit; the rest are counted. */
const SHOWN = 20;
const CLASSES: readonly DifferenceClass[] = ["tree", "flag", "id", "value"];

export async function runConformance(
  options: Options,
  stages: Stages,
  write: (text: string) => void,
): Promise<number> {
  const started = performance.now();
  const manifest = readManifest(options.fixtures);
  write(
    `md2ui ${manifest.commit}${manifest.dirty ? " (dirty)" : ""} · fixtures of ${manifest.date}\n`,
  );
  const all = families({
    fixtures: options.fixtures,
    manifest,
    stages,
  });
  const wanted = selectChecks(all, options.only);
  const units = selectUnits(all, options.docs);

  const counts = new Map<string, Record<Status, number>>();
  for (const family of all) {
    for (const check of family.checks.filter(wanted)) {
      counts.set(check, { pass: 0, fail: 0, diverged: 0, "not ported": 0 });
    }
  }
  const divergences = new Map<string, Set<string>>();
  try {
    for (const family of all) {
      if (!family.checks.some(wanted)) continue;
      for (const unit of family.units.filter(units)) {
        for (const outcome of await unit.evaluate(wanted)) {
          const row = counts.get(outcome.check);
          if (row !== undefined) row[outcome.status] += 1;
          if (outcome.status === "fail" || outcome.status === "diverged") write(describe(outcome));
          for (const divergence of outcome.divergences ?? []) {
            const where = `${outcome.check} · ${outcome.unit}`;
            const docs = divergences.get(divergence.class) ?? new Set<string>();
            divergences.set(divergence.class, docs.add(where));
          }
        }
      }
    }
  } finally {
    await stages.close?.();
  }
  const failures = [...counts.values()].reduce((sum, row) => sum + row.fail, 0);
  write(summary(counts));
  for (const [cls, where] of [...divergences].sort()) {
    write(`\nmeasurer divergence "${cls}" (ADR-403), ${where.size}:\n`);
    for (const w of where) write(`  ${w}\n`);
  }
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  write(
    failures === 0
      ? `\nconformance: OK (${seconds}s)\n`
      : `\nconformance: FAILED, ${failures} failing (${seconds}s)\n`,
  );
  return failures === 0 ? 0 : 1;
}

function selectChecks(all: readonly Family[], only: readonly string[]): (check: string) => boolean {
  const matches = (check: string, filter: string): boolean =>
    check === filter || check.startsWith(`${filter}:`);
  const known = all.flatMap((family) => family.checks);
  for (const filter of only) {
    if (!known.some((check) => matches(check, filter))) {
      throw new SetupError(
        `--only ${filter} matches no check; the checks are: ${known.join(", ")}`,
      );
    }
  }
  return (check) => only.length === 0 || only.some((filter) => matches(check, filter));
}

function selectUnits(all: readonly Family[], docs: readonly string[]): (unit: Unit) => boolean {
  const known = all.flatMap((family) => family.units);
  for (const doc of docs) {
    if (!known.some((unit) => unit.names.includes(doc))) {
      throw new SetupError(`--doc ${doc} matches no document or theme of the fixtures`);
    }
  }
  return (unit) => docs.length === 0 || docs.some((doc) => unit.names.includes(doc));
}

function describe(outcome: Outcome): string {
  const classes = [...new Set((outcome.divergences ?? []).map((d) => d.class))].join(", ");
  const head =
    outcome.status === "diverged"
      ? `\nDIVERGED (${classes}) ${outcome.check} · ${outcome.unit}`
      : `\nFAIL ${outcome.check} · ${outcome.unit}`;
  if (outcome.error !== undefined) return `${head}: ${outcome.error}\n`;
  const unexplained = (outcome.divergences ?? []).filter((d) => d.class === "unclassified");
  const byClass = CLASSES.map(
    (cls) => [cls, outcome.differences.filter((d) => d.class === cls)] as const,
  ).filter(([, found]) => found.length > 0);
  const tally = byClass.map(([cls, found]) => `${cls} ${found.length}`).join(", ");
  const lines = [`${head}: ${outcome.differences.length} difference(s) (${tally})`];
  for (const [cls, found] of byClass) {
    lines.push(`  ${cls}`);
    for (const d of found.slice(0, SHOWN)) lines.push(`    ${line(d)}`);
    if (found.length > SHOWN) lines.push(`    ... and ${found.length - SHOWN} more`);
  }
  const invariant = outcome.unexplained ?? [];
  if (invariant.length > 0) {
    lines.push(`  not explained by the measurer divergences: ${invariant.length}`);
    for (const d of invariant.slice(0, SHOWN)) lines.push(`    ${line(d)}`);
    if (invariant.length > SHOWN) lines.push(`    ... and ${invariant.length - SHOWN} more`);
  }
  if (unexplained.length > 0) {
    lines.push(`  unclassified measurer answers: ${unexplained.length}`);
    for (const d of unexplained.slice(0, SHOWN)) lines.push(`    ${d.text}`);
    if (unexplained.length > SHOWN) lines.push(`    ... and ${unexplained.length - SHOWN} more`);
  }
  return `${lines.join("\n")}\n`;
}

function line(d: Difference): string {
  const where = d.field === "" ? d.path : `${d.path} · ${d.field}`;
  return `${where}: expected ${d.expected}, actual ${d.actual}`;
}

function summary(counts: ReadonlyMap<string, Record<Status, number>>): string {
  const width = Math.max(5, ...[...counts.keys()].map((check) => check.length));
  const columns: readonly Status[] = ["pass", "fail", "diverged", "not ported"];
  const row = (check: string, cells: readonly string[]): string =>
    `${check.padEnd(width)}${cells.map((cell, i) => cell.padStart((columns[i] ?? "").length + 2)).join("")}\n`;
  const total: Record<Status, number> = { pass: 0, fail: 0, diverged: 0, "not ported": 0 };
  let text = `\n${row("check", columns)}`;
  for (const [check, c] of counts) {
    text += row(
      check,
      columns.map((status) => `${c[status]}`),
    );
    for (const status of columns) total[status] += c[status];
  }
  return (
    text +
    row(
      "total",
      columns.map((status) => `${total[status]}`),
    )
  );
}
