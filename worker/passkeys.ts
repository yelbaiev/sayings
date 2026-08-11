import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { HOUSEHOLD_ID } from "@shared/schema";
import { avatarColorFor, bumpRev, type MemberRecord } from "./db";

/**
 * Passkey authentication: claim, login, invite.
 *
 * The design decision this file embodies (approved 2026-08-08): a fresh deployment is *claimed* by
 * its first visitor registering a passkey, and everyone after joins through a one-time invite link
 * and registers their own. No email is sent or verified anywhere — which is the whole point,
 * because verifying an email needs a sending provider and Cloudflare does not have one. Access
 * stays as optional hardening in front; this is what makes Deploy-to-Cloudflare genuinely
 * one-click.
 *
 * Two rules carry the security:
 *
 *  - **Claiming requires an empty household.** A deployment with members refuses the ceremony
 *    outright, so the claim window is the minutes between deploying and opening the URL — and what
 *    an attacker could claim in that window is an empty database.
 *  - **Nothing stored is replayable.** Session and invite tokens are random 256-bit values whose
 *    SHA-256 lives in D1; a database read-out yields hashes, not logins. WebAuthn challenges are
 *    single-use rows deleted on verification.
 */

const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000; // ~6 months; a household app, not a bank terminal
const INVITE_TTL_MS = 48 * 60 * 60 * 1000;
const CHALLENGE_TTL_MS = 10 * 60 * 1000;

export const SESSION_COOKIE = "__Host-sayings_session";

/* ----------------------------------------------------------------------- small crypto */

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return base64url(bytes);
}

function base64url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replaceAll("-", "+").replaceAll("_", "/");
  const raw = atob(padded);
  // Explicitly ArrayBuffer-backed: simplewebauthn's types reject the SharedArrayBuffer-capable
  // default under TS 5.9's stricter typed-array generics.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return base64url(new Uint8Array(digest));
}

/** The RP ID is the hostname the app is served from — derived, never configured. */
export function rpFrom(request: Request): { rpID: string; origin: string } {
  const url = new URL(request.url);
  return { rpID: url.hostname, origin: url.origin };
}

/* ------------------------------------------------------------------------- challenges */

async function storeChallenge(
  db: D1Database,
  kind: "claim" | "login" | "invite" | "add-key",
  challenge: string,
  extra: { inviteHash?: string; memberId?: string } = {},
): Promise<string> {
  const id = randomToken();
  await db
    .prepare(
      `INSERT INTO auth_challenges (id, challenge, kind, invite_hash, member_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, challenge, kind, extra.inviteHash ?? null, extra.memberId ?? null, Date.now())
    .run();
  return id;
}

/** Fetch-and-delete: a challenge answers exactly once, right or wrong. */
async function takeChallenge(
  db: D1Database,
  id: string,
  kind: string,
): Promise<{ challenge: string; invite_hash: string | null; member_id: string | null } | null> {
  const row = await db
    .prepare(`SELECT challenge, kind, invite_hash, member_id, created_at FROM auth_challenges WHERE id = ?`)
    .bind(id)
    .first<{
      challenge: string;
      kind: string;
      invite_hash: string | null;
      member_id: string | null;
      created_at: number;
    }>();
  await db.prepare(`DELETE FROM auth_challenges WHERE id = ?`).bind(id).run();

  if (!row || row.kind !== kind) return null;
  if (Date.now() - row.created_at > CHALLENGE_TTL_MS) return null;
  return row;
}

/* --------------------------------------------------------------------------- sessions */

export async function createSession(db: D1Database, memberId: string): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO auth_sessions (token_hash, member_id, created_at, expires_at) VALUES (?, ?, ?, ?)`,
    )
    .bind(await sha256(token), memberId, now, now + SESSION_TTL_MS)
    .run();
  return token;
}

export async function memberForSession(
  db: D1Database,
  token: string,
): Promise<MemberRecord | null> {
  const row = await db
    .prepare(
      `SELECT m.id, m.household_id, m.email, m.display_name, m.locale, m.default_account_id, m.role
         FROM auth_sessions s JOIN members m ON m.id = s.member_id
        WHERE s.token_hash = ? AND s.expires_at > ? AND m.deleted = 0`,
    )
    .bind(await sha256(token), Date.now())
    .first<MemberRecord>();
  return row ?? null;
}

export async function destroySession(db: D1Database, token: string): Promise<void> {
  await db.prepare(`DELETE FROM auth_sessions WHERE token_hash = ?`).bind(await sha256(token)).run();
}

export function sessionCookie(token: string, maxAgeSeconds = SESSION_TTL_MS / 1000): string {
  // __Host-: secure, no Domain, Path=/ — the strictest binding a cookie can have.
  return `${SESSION_COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(maxAgeSeconds)}`;
}

export function readSessionToken(request: Request): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, "\\$&")}=([^;]+)`));
  return match?.[1] ?? null;
}

/* ------------------------------------------------------------------------------ claim */

async function memberCount(db: D1Database): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS count FROM members WHERE deleted = 0`)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * Registration options for claiming a fresh deployment.
 *
 * Refused the moment a member exists: after that, the only doors are a session, an Access JWT, or
 * an invite from the owner. The race this leaves open is the gap between deploy and first visit —
 * minutes, on an unguessable hostname, for an empty database.
 */
export async function claimOptions(db: D1Database, request: Request) {
  if ((await memberCount(db)) > 0) throw new AuthFlowError("already claimed", 409);
  return registrationOptions(db, request, "claim", {});
}

export async function claimVerify(
  db: D1Database,
  request: Request,
  body: { challengeId: string; name: string; response: RegistrationResponseJSON },
): Promise<{ member: MemberRecord; sessionToken: string }> {
  if ((await memberCount(db)) > 0) throw new AuthFlowError("already claimed", 409);
  const parsed = await verifyRegistration(db, request, body.challengeId, "claim", body.response);
  const member = await createMember(db, body.name, "owner");
  await storeCredential(db, member.id, parsed, body.name);
  return { member, sessionToken: await createSession(db, member.id) };
}

/* ---------------------------------------------------------------------------- invites */

export async function createInvite(db: D1Database, createdBy: string): Promise<string> {
  const token = randomToken();
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO invites (token_hash, created_by, created_at, expires_at) VALUES (?, ?, ?, ?)`,
    )
    .bind(await sha256(token), createdBy, now, now + INVITE_TTL_MS)
    .run();
  return token;
}

async function validInviteHash(db: D1Database, token: string): Promise<string> {
  const hash = await sha256(token);
  const row = await db
    .prepare(`SELECT expires_at, used_at FROM invites WHERE token_hash = ?`)
    .bind(hash)
    .first<{ expires_at: number; used_at: number | null }>();
  if (!row || row.used_at !== null || row.expires_at < Date.now()) {
    throw new AuthFlowError("invite is invalid or expired", 403);
  }
  return hash;
}

export async function inviteOptions(db: D1Database, request: Request, inviteToken: string) {
  const inviteHash = await validInviteHash(db, inviteToken);
  return registrationOptions(db, request, "invite", { inviteHash });
}

export async function inviteVerify(
  db: D1Database,
  request: Request,
  body: {
    challengeId: string;
    inviteToken: string;
    name: string;
    response: RegistrationResponseJSON;
  },
): Promise<{ member: MemberRecord; sessionToken: string }> {
  const inviteHash = await validInviteHash(db, body.inviteToken);
  const parsed = await verifyRegistration(db, request, body.challengeId, "invite", body.response, inviteHash);
  // Marked used *before* the member lands: a failure between the two wastes an invite, which the
  // owner can reissue in a tap — the other order could let one link mint two members.
  await db
    .prepare(`UPDATE invites SET used_at = ? WHERE token_hash = ? AND used_at IS NULL`)
    .bind(Date.now(), inviteHash)
    .run();
  const member = await createMember(db, body.name, "member");
  await storeCredential(db, member.id, parsed, body.name);
  return { member, sessionToken: await createSession(db, member.id) };
}

/* ------------------------------------------------------------------------------ login */

export async function loginOptions(db: D1Database, request: Request) {
  const { rpID } = rpFrom(request);
  const options = await generateAuthenticationOptions({ rpID, userVerification: "preferred" });
  const challengeId = await storeChallenge(db, "login", options.challenge);
  return { challengeId, options };
}

export async function loginVerify(
  db: D1Database,
  request: Request,
  body: { challengeId: string; response: AuthenticationResponseJSON },
): Promise<{ member: MemberRecord; sessionToken: string }> {
  const stored = await takeChallenge(db, body.challengeId, "login");
  if (!stored) throw new AuthFlowError("challenge expired", 403);

  const credential = await db
    .prepare(
      `SELECT c.id, c.public_key, c.counter, c.transports, m.id AS member_id, m.household_id,
              m.email, m.display_name, m.locale, m.default_account_id, m.role
         FROM credentials c JOIN members m ON m.id = c.member_id
        WHERE c.id = ? AND m.deleted = 0`,
    )
    .bind(body.response.id)
    .first<{
      id: string;
      public_key: string;
      counter: number;
      transports: string | null;
      member_id: string;
      household_id: string;
      email: string;
      display_name: string;
      locale: string;
      default_account_id: string | null;
      role: string;
    }>();
  if (!credential) throw new AuthFlowError("unknown credential", 403);

  const { rpID, origin } = rpFrom(request);
  const result = await verifyAuthenticationResponse({
    response: body.response,
    expectedChallenge: stored.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: credential.id,
      publicKey: fromBase64url(credential.public_key),
      counter: credential.counter,
    },
  });
  if (!result.verified) throw new AuthFlowError("verification failed", 403);

  await db
    .prepare(`UPDATE credentials SET counter = ? WHERE id = ?`)
    .bind(result.authenticationInfo.newCounter, credential.id)
    .run();

  const member: MemberRecord = {
    id: credential.member_id,
    household_id: credential.household_id,
    email: credential.email,
    display_name: credential.display_name,
    locale: credential.locale,
    default_account_id: credential.default_account_id,
    role: credential.role,
  };
  return { member, sessionToken: await createSession(db, member.id) };
}

/* -------------------------------------------------------------------------- internals */

export class AuthFlowError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function registrationOptions(
  db: D1Database,
  request: Request,
  kind: "claim" | "invite",
  extra: { inviteHash?: string },
) {
  const { rpID } = rpFrom(request);
  const options = await generateRegistrationOptions({
    rpName: "SAYings",
    rpID,
    userName: kind === "claim" ? "owner" : "member",
    // Discoverable, so login is one tap with no username field anywhere.
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  });
  const challengeId = await storeChallenge(db, kind, options.challenge, extra);
  return { challengeId, options };
}

async function verifyRegistration(
  db: D1Database,
  request: Request,
  challengeId: string,
  kind: "claim" | "invite",
  response: RegistrationResponseJSON,
  expectedInviteHash?: string,
) {
  const stored = await takeChallenge(db, challengeId, kind);
  if (!stored) throw new AuthFlowError("challenge expired", 403);
  if (kind === "invite" && stored.invite_hash !== expectedInviteHash) {
    // The challenge was minted for a different invite; accepting it would let a spent or foreign
    // link piggyback on a fresh one's ceremony.
    throw new AuthFlowError("challenge does not match the invite", 403);
  }

  const { rpID, origin } = rpFrom(request);
  const result = await verifyRegistrationResponse({
    response,
    expectedChallenge: stored.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });
  if (!result.verified || !result.registrationInfo) {
    throw new AuthFlowError("verification failed", 403);
  }
  return result.registrationInfo;
}

async function storeCredential(
  db: D1Database,
  memberId: string,
  info: { credential: { id: string; publicKey: Uint8Array; counter: number; transports?: string[] } },
  label: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO credentials (id, member_id, public_key, counter, transports, label, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      info.credential.id,
      memberId,
      base64url(info.credential.publicKey),
      info.credential.counter,
      JSON.stringify(info.credential.transports ?? []),
      label.slice(0, 60),
      Date.now(),
    )
    .run();
}

/**
 * A passkey member has no verified email — there is deliberately no email anywhere in this flow —
 * so the unique `email` column gets a synthetic, clearly-synthetic placeholder. Everything that
 * displays a person uses `display_name`; if Access is later put in front, its real email simply
 * provisions a separate member row, which is correct: they are different identities.
 */
async function createMember(
  db: D1Database,
  name: string,
  role: "owner" | "member",
): Promise<MemberRecord> {
  const id = crypto.randomUUID();
  const member: MemberRecord = {
    id,
    household_id: HOUSEHOLD_ID,
    email: `passkey-${id.slice(0, 8)}@local.invalid`,
    display_name: name.trim().slice(0, 60) || (role === "owner" ? "Owner" : "Member"),
    locale: "en",
    role,
  };
  const now = Date.now();
  const rev = await bumpRev(db);
  await db
    .prepare(
      `INSERT INTO members
         (id, household_id, email, display_name, avatar_color, locale, role,
          created_at, rev, updated_at, updated_by, deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    )
    .bind(
      member.id,
      member.household_id,
      member.email,
      member.display_name,
      avatarColorFor(member.id),
      member.locale,
      member.role,
      now,
      rev,
      now,
      member.id,
    )
    .run();
  return member;
}
