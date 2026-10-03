import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { convertMinor } from "@shared/money";

/**
 * Money crosses currencies only through `convertMinor`.
 *
 * Every conversion used to be `amount_minor * rate`, which is right only when both currencies have
 * two decimals: a ¥1 000 coffee in a hryvnia household came out at ₴2.70. `convertMinor` scales by
 * each side's minor-unit digits. A raw product creeping back in would be silently right for the
 * currencies this household uses and wrong for everyone else's — so it is caught here, by shape.
 */

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

/**
 * An amount multiplied or divided by a rate: `amountMinor * rate`, `row.amount_minor * fx.rate`,
 * `minor / rate`. Rate arithmetic on its own (`1 / rate`, `fx_rate * old_base_rate`) is not money and
 * is left alone.
 */
const RAW = /\b\w*(?:[mM]inor|[aA]mount)\w*!?\)?\s*[*/]\s*\(?\s*[\w.!?]*(?:rate|Rate)\b/;

describe("currency conversion", () => {
  it("goes through convertMinor everywhere", () => {
    const roots = ["../../src/", "../../worker/"].map((dir) => new URL(dir, import.meta.url).pathname);
    const offenders: string[] = [];
    for (const path of roots.flatMap(files)) {
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, index) => {
          const code = line
            .replace(/\/\/.*$/, "")
            .replace(/\/\*.*?\*\//g, "")
            .replace(/^\s*\*.*$/, "");
          if (RAW.test(code)) offenders.push(`${path.split("/SAYings/")[1]}:${index + 1}  ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  // Hand-worked figures, not derived from the code under test.
  it("scales a zero-decimal currency up", () => {
    // ¥1 000 at ₴0.27 per yen is ₴270.00 — 27 000 kopiyky.
    expect(convertMinor(1_000, 0.27, "JPY", "UAH")).toBe(27_000);
  });

  it("scales a three-decimal currency down", () => {
    // 10.000 dinars at ₴13.5 per dinar is ₴135.00.
    expect(convertMinor(10_000, 13.5, "TND", "UAH")).toBe(13_500);
  });

  it("leaves two-decimal pairs exactly as before", () => {
    // €100.00 at ₴51.6423 is ₴5 164.23.
    expect(convertMinor(10_000, 51.6423, "EUR", "UAH")).toBe(516_423);
  });
});
