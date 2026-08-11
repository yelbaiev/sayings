import { describe, expect, it } from "vitest";
import { AuthError, isAccessConfigured, verifyAccess, type AccessConfig } from "../../worker/auth";

/**
 * These cover the fail-closed paths, which are the ones that matter: a misconfigured
 * audience, a missing token, or a forged token must never yield a trusted identity.
 * Verifying a genuine signature is jose's job, and is exercised against a live Access
 * session in the Phase 0 manual check.
 */

const configured: AccessConfig = {
  teamDomain: "https://example.cloudflareaccess.com",
  policyAud: "aud-tag",
};

const request = (headers: Record<string, string> = {}) =>
  new Request("https://sayfinance.example/api/me", { headers });

describe("verifyAccess", () => {
  it("fails closed with a 500 when the audience is unset", async () => {
    await expect(
      verifyAccess(request(), { ...configured, policyAud: "" }),
    ).rejects.toMatchObject({ name: "AuthError", status: 500 });
  });

  it("fails closed when the config still holds the CHANGEME placeholder", async () => {
    await expect(
      verifyAccess(request(), { ...configured, policyAud: "CHANGEME" }),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it("rejects a request carrying no Access JWT", async () => {
    await expect(verifyAccess(request(), configured)).rejects.toMatchObject({
      name: "AuthError",
      status: 403,
    });
  });

  it("rejects a forged token rather than trusting the header's presence", async () => {
    // Syntactically valid, but not signed by Access.
    const forged = [
      btoa(JSON.stringify({ alg: "RS256", typ: "JWT" })),
      btoa(JSON.stringify({ email: "attacker@example.com", aud: "aud-tag" })),
      "not-a-real-signature",
    ].join(".");

    // Points at a closed local port so key retrieval fails immediately, keeping the test
    // offline and fast. Either way the only acceptable outcome is rejection — a forged token
    // must never resolve to an identity, whatever the JWKS endpoint does.
    await expect(
      verifyAccess(request({ "cf-access-jwt-assertion": forged }), {
        ...configured,
        teamDomain: "http://127.0.0.1:1",
      }),
    ).rejects.toMatchObject({ name: "AuthError", status: 403 });
  });
});

describe("isAccessConfigured", () => {
  /*
   * Drives the setup screen. It has to agree exactly with verifyAccess's own fail-closed check —
   * if it ever said "configured" where verifyAccess says "not configured", a fresh deployment
   * would show the real app and then refuse every request, which is the confusing state the
   * screen exists to prevent.
   */
  it("is true only when both values are real", () => {
    expect(isAccessConfigured(configured)).toBe(true);
  });

  it("is false for unset, empty, or placeholder values", () => {
    expect(isAccessConfigured({ ...configured, policyAud: "" })).toBe(false);
    expect(isAccessConfigured({ ...configured, teamDomain: "" })).toBe(false);
    expect(isAccessConfigured({ ...configured, policyAud: "CHANGEME" })).toBe(false);
    expect(isAccessConfigured({ ...configured, teamDomain: "CHANGEME" })).toBe(false);
    expect(isAccessConfigured({})).toBe(false);
  });

  it("agrees with verifyAccess on every unconfigured case", async () => {
    const unconfigured: Partial<AccessConfig>[] = [
      { ...configured, policyAud: "" },
      { ...configured, teamDomain: "" },
      { ...configured, policyAud: "CHANGEME" },
      { ...configured, teamDomain: "CHANGEME" },
    ];
    for (const config of unconfigured) {
      expect(isAccessConfigured(config)).toBe(false);
      // The same input must make verifyAccess refuse with the configuration error, not proceed
      // to look for a token.
      await expect(
        verifyAccess(request(), config as AccessConfig),
      ).rejects.toMatchObject({ name: "AuthError", status: 500 });
    }
  });
});
