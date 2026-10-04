import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The push handler is plain JS in public/, outside the type checker and the bundler, so a renamed
 * icon would only show up as a broken notification on someone's phone. Every asset it names must
 * exist.
 */
describe("public/push-sw.js", () => {
  it("names only icons that exist", () => {
    const source = readFileSync(new URL("../../public/push-sw.js", import.meta.url), "utf8");
    const assets = [...source.matchAll(/"\/([\w.-]+\.png)"/g)].map((match) => match[1]!);
    expect(assets).toEqual(expect.arrayContaining(["icon-192.png", "icon-badge-96.png"]));
    for (const asset of assets) {
      expect(existsSync(new URL(`../../public/${asset}`, import.meta.url)), asset).toBe(true);
    }
  });
});
