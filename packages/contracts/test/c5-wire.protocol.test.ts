// C5's version check: the vendored schemas must be byte-identical to md2ui's, and both
// must speak the protocol version this package types. md2ui's protocol/ folder is named
// by MD2UI_PROTOCOL; `pnpm check` runs this only when it is set.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";
import { expect, test } from "vitest";
import type { WireProtocolVersion } from "../src/index.ts";

const VERSION: WireProtocolVersion = 1;
const vendored = join(import.meta.dirname, "..", "schema", "wire");

function protocolDir(): string {
  const dir = env["MD2UI_PROTOCOL"];
  if (dir === undefined || dir === "") {
    throw new Error("set MD2UI_PROTOCOL to md2ui's protocol/ folder");
  }
  return dir;
}

const schemaFiles = (dir: string): string[] =>
  readdirSync(dir)
    .filter((name) => name.endsWith(".schema.json"))
    .sort();

test("the vendored schemas are md2ui's, byte for byte", () => {
  const upstream = join(protocolDir(), "schema");
  expect(schemaFiles(vendored)).toEqual(schemaFiles(upstream));
  for (const name of schemaFiles(upstream)) {
    const ours = readFileSync(join(vendored, name), "utf8");
    const theirs = readFileSync(join(upstream, name), "utf8");
    expect(ours, `${name} differs from md2ui's copy: re-vendor it and review C5`).toBe(theirs);
  }
});

test(`md2ui's spec and schemas are protocol v${VERSION}`, () => {
  const readme = readFileSync(join(protocolDir(), "README.md"), "utf8");
  expect(readme.split("\n", 1)[0]).toBe(`# The md2ui wire protocol, v${VERSION}`);
  for (const name of schemaFiles(vendored)) {
    const schema: { title: string } = JSON.parse(readFileSync(join(vendored, name), "utf8"));
    expect(schema.title.endsWith(`, v${VERSION}`), name).toBe(true);
  }
});
