import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Every place that prices a transaction also says what it priced it in.
 *
 * `fx_base` was written by no client at all, so the server's column default ('UAH') stood in for
 * it whatever the household's base was — and a later base change skipped those rows as already
 * converted. A writer added later would reintroduce that silently; this makes it loud.
 *
 * The check is deliberately blunt: in client code, each `base_amount_minor:` written in an object
 * must be matched by an `fx_base` in the same file.
 */

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const root = new URL("../../src/", import.meta.url).pathname;

describe("fx_base", () => {
  it("is written wherever a transaction is priced", () => {
    const offenders = files(root).filter((path) => {
      const source = readFileSync(path, "utf8");
      const priced = source.match(/base_amount_minor:/g)?.length ?? 0;
      const based = source.match(/fx_base/g)?.length ?? 0;
      return priced > based;
    });
    expect(offenders).toEqual([]);
  });
});
