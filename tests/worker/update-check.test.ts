import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import {
  isNewer,
  isUpdateCheckEnabled,
  runUpdateCheck,
  storedRelease,
} from "../../worker/update-check";

/**
 * The release check is the only outbound request this software makes on its own initiative, so its
 * off switch and its no-op conditions are worth pinning precisely.
 */

describe("isNewer", () => {
  it("compares numerically, not lexically", () => {
    // The case that makes a string comparison unusable: "1.10.0" < "1.9.0" as text, so an
    // installation on 1.9.0 would never hear about 1.10.0 — and would keep not hearing about
    // every release after it.
    expect(isNewer("1.10.0", "1.9.0")).toBe(true);
    expect(isNewer("1.9.0", "1.10.0")).toBe(false);
    expect(isNewer("2.0.0", "1.99.99")).toBe(true);
  });

  it("tolerates a leading v, because tags have one and package.json does not", () => {
    expect(isNewer("v1.4.0", "1.3.2")).toBe(true);
    expect(isNewer("V1.4.0", "1.3.2")).toBe(true);
  });

  it("is false for the same version", () => {
    expect(isNewer("1.3.2", "1.3.2")).toBe(false);
    expect(isNewer("v1.3.2", "1.3.2")).toBe(false);
  });

  it("is false for an older release, so a rollback is not nagged about", () => {
    expect(isNewer("1.3.1", "1.3.2")).toBe(false);
  });

  it("treats a shorter version as zero-padded", () => {
    expect(isNewer("1.4", "1.3.9")).toBe(true);
    expect(isNewer("1.3", "1.3.1")).toBe(false);
  });

  it("says no rather than guessing when a tag is not a version", () => {
    // Better to show nothing than to announce an update to "nightly".
    expect(isNewer("nightly", "1.3.2")).toBe(false);
    expect(isNewer("v1.4.0-rc1", "1.3.2")).toBe(false);
    expect(isNewer("", "1.3.2")).toBe(false);
  });
});

describe("isUpdateCheckEnabled", () => {
  it("is off only for the explicit value", () => {
    expect(isUpdateCheckEnabled("off")).toBe(false);
    expect(isUpdateCheckEnabled("on")).toBe(true);
    // Unset defaults to on. Someone upgrading from a version without this var should still be
    // told about releases; the switch exists to be chosen, not to be forgotten into.
    expect(isUpdateCheckEnabled(undefined)).toBe(true);
  });
});

describe("runUpdateCheck", () => {
  it("makes no request at all when disabled", async () => {
    // Asserted by giving it a real repo and a disabled flag: if it fetched, the test would need
    // the network. Returning null before touching fetch is the contract.
    const result = await runUpdateCheck(env.DB, { repo: "owner/repo", enabled: "off" });
    expect(result).toBeNull();
    expect(await storedRelease(env.DB)).toBeNull();
  });

  it("makes no request while the repo is still a placeholder", async () => {
    expect(await runUpdateCheck(env.DB, { repo: "CHANGEME/sayings", enabled: "on" })).toBeNull();
    expect(await runUpdateCheck(env.DB, { repo: undefined, enabled: "on" })).toBeNull();
    // Not a valid owner/name pair, so not worth a request.
    expect(await runUpdateCheck(env.DB, { repo: "not a repo", enabled: "on" })).toBeNull();
  });
});

describe("storedRelease", () => {
  it("returns null rather than throwing on a malformed row", async () => {
    // A bad row must not take out the Settings screen.
    await env.DB.prepare(`INSERT OR REPLACE INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)`)
      .bind("latest_release", "{not json", 1)
      .run();
    expect(await storedRelease(env.DB)).toBeNull();
  });

  it("round-trips a stored release", async () => {
    const release = {
      tag: "v1.4.0",
      published_at: "2026-09-01T00:00:00Z",
      notes: "Added things",
      url: "https://example.com/releases/v1.4.0",
    };
    await env.DB.prepare(`INSERT OR REPLACE INTO app_meta (key, value, updated_at) VALUES (?, ?, ?)`)
      .bind("latest_release", JSON.stringify(release), Date.now())
      .run();
    expect(await storedRelease(env.DB)).toEqual(release);
  });
});
