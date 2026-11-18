// `pnpm conformance --fixtures <dir> [--only <check>]… [--doc <doc>]…`
//
// Exit codes: 0 when no ported check fails, 1 when one does, 2 when the runner was
// called wrongly or the fixtures cannot be read.
import { parseArgs } from "node:util";
import { SetupError } from "./errors.ts";
import { runConformance } from "./runner.ts";
import type { Stages } from "./stages.ts";

const USAGE = "usage: conformance --fixtures <dir> [--only <check>]... [--doc <document>]...\n";

export async function main(
  args: readonly string[],
  stages: Stages,
  write: (text: string) => void,
): Promise<number> {
  let values: ReturnType<typeof parse>["values"];
  try {
    values = parse(args).values;
  } catch (error) {
    write(`conformance: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  if (values.fixtures === undefined) {
    write(`conformance: --fixtures <dir> is required\n${USAGE}`);
    return 2;
  }
  try {
    return await runConformance(
      {
        fixtures: values.fixtures,
        only: values.only ?? [],
        docs: values.doc ?? [],
      },
      stages,
      write,
    );
  } catch (error) {
    if (!(error instanceof SetupError || isFileError(error))) throw error;
    write(`conformance: ${error.message}\n`);
    return 2;
  }
}

function parse(args: readonly string[]) {
  return parseArgs({
    args: [...args],
    strict: true,
    allowPositionals: false,
    options: {
      fixtures: { type: "string" },
      only: { type: "string", multiple: true },
      doc: { type: "string", multiple: true },
    },
  });
}

/** A fixture or source file that is missing or unreadable. */
function isFileError(error: unknown): error is Error {
  return error instanceof Error && "code" in error && typeof error.code === "string";
}
