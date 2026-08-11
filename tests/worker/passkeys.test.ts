import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  claimOptions,
  createInvite,
  createSession,
  destroySession,
  inviteOptions,
  memberForSession,
  readSessionToken,
  sessionCookie,
} from "../../worker/passkeys";
import { resetHousehold, testMember } from "./helpers";

/**
 * The passkey layer's gates and bookkeeping, against real D1.
 *
 * The WebAuthn ceremony itself is not exercised here — a genuine attestation needs a browser
 * authenticator, and @simplewebauthn's own suite covers the cryptography. What this file pins is
 * everything *around* the ceremony, which is where this design's security actually lives: who may
 * start a claim, what an invite token is worth after use, and what a stolen database row can and
 * cannot do.
 */

const request = (cookie?: string) =>
  new Request("https://app.example.workers.dev/api/auth/x", {
    method: "POST",
    ...(cookie ? { headers: { cookie } } : {}),
  });

async function seedMember(): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO members (id, household_id, email, display_name, avatar_color, locale, role,
                          created_at, rev, updated_at, updated_by, deleted)
     VALUES (?, 'hh_default', ?, 'Test', '#3E63DD', 'en', 'owner', 1, 1, 1, ?, 0)`,
  )
    .bind(testMember.id, testMember.email, testMember.id)
    .run();
}

beforeEach(async () => {
  // resetHousehold clears the auth tables too, in FK-safe order.
  await resetHousehold();
});

describe("claiming", () => {
  it("offers the ceremony only while the household is empty", async () => {
    /*
     * The rule the whole model rests on. The claim window is the minutes between deploying and
     * opening the URL, and what it exposes is an empty database; one member later, this door is
     * bricked up for the lifetime of the installation.
     */
    const offered = await claimOptions(env.DB, request());
    expect(offered.options.challenge.length).toBeGreaterThan(10);
    expect(offered.challengeId.length).toBeGreaterThan(10);

    await seedMember();
    await expect(claimOptions(env.DB, request())).rejects.toMatchObject({ status: 409 });
  });

  it("requires discoverable credentials, so login needs no username", async () => {
    const { options } = await claimOptions(env.DB, request());
    expect(options.authenticatorSelection?.residentKey).toBe("required");
    // The RP is the hostname it was asked from — derived, never configured.
    expect(options.rp.id).toBe("app.example.workers.dev");
  });
});

describe("invites", () => {
  it("stores only a hash — the link itself never touches the database", async () => {
    await seedMember();
    const token = await createInvite(env.DB, testMember.id);

    const row = await env.DB.prepare(`SELECT token_hash FROM invites`).first<{
      token_hash: string;
    }>();
    expect(row!.token_hash).not.toBe(token);
    expect(row!.token_hash).not.toContain(token);
  });

  it("opens a ceremony for a live invite and refuses a spent or foreign one", async () => {
    await seedMember();
    const token = await createInvite(env.DB, testMember.id);

    const offered = await inviteOptions(env.DB, request(), token);
    expect(offered.options.challenge.length).toBeGreaterThan(10);

    // Spent:
    await env.DB.prepare(`UPDATE invites SET used_at = 1`).run();
    await expect(inviteOptions(env.DB, request(), token)).rejects.toMatchObject({ status: 403 });
    // Never issued:
    await expect(inviteOptions(env.DB, request(), "made-up")).rejects.toMatchObject({
      status: 403,
    });
  });

  it("expires", async () => {
    await seedMember();
    const token = await createInvite(env.DB, testMember.id);
    await env.DB.prepare(`UPDATE invites SET expires_at = 1`).run();
    await expect(inviteOptions(env.DB, request(), token)).rejects.toMatchObject({ status: 403 });
  });
});

describe("sessions", () => {
  it("round-trips a member and dies on logout", async () => {
    await seedMember();
    const token = await createSession(env.DB, testMember.id);

    const member = await memberForSession(env.DB, token);
    expect(member?.id).toBe(testMember.id);
    expect(member?.role).toBe("owner");

    await destroySession(env.DB, token);
    expect(await memberForSession(env.DB, token)).toBeNull();
  });

  it("stores only a hash, so a database read-out is not a login", async () => {
    await seedMember();
    const token = await createSession(env.DB, testMember.id);
    const row = await env.DB.prepare(`SELECT token_hash FROM auth_sessions`).first<{
      token_hash: string;
    }>();
    expect(row!.token_hash).not.toBe(token);
    // And the hash itself does not authenticate:
    expect(await memberForSession(env.DB, row!.token_hash)).toBeNull();
  });

  it("refuses an expired session", async () => {
    await seedMember();
    const token = await createSession(env.DB, testMember.id);
    await env.DB.prepare(`UPDATE auth_sessions SET expires_at = 1`).run();
    expect(await memberForSession(env.DB, token)).toBeNull();
  });

  it("reads its cookie back from a request, and only its own", async () => {
    const cookie = sessionCookie("tok123").split(";")[0]!;
    expect(readSessionToken(request(`other=1; ${cookie}; more=2`))).toBe("tok123");
    expect(readSessionToken(request("other=1"))).toBeNull();
    // __Host- prefix: the strictest binding a cookie can have — no Domain, Secure, Path=/.
    expect(sessionCookie("t")).toContain("__Host-");
    expect(sessionCookie("t")).toContain("Secure");
    expect(sessionCookie("t")).toContain("HttpOnly");
  });
});
