import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

/**
 * Cloudflare Access sits in front of this Worker and injects a signed JWT on every
 * authenticated request. The presence of the header is NOT evidence of anything — a client
 * can set an arbitrary header — so the signature, issuer and audience must all be verified.
 */

export interface AccessIdentity {
  email: string;
  /** Access user UUID (`sub`). Stable per identity; useful for audit trails. */
  subject: string;
}

/**
 * Deliberately its own interface rather than the generated `Env`. `wrangler types` turns
 * wrangler.jsonc vars into *literal* types (`POLICY_AUD: "CHANGEME"`), which would make every
 * comparison here narrow against a placeholder that never exists in production.
 */
export interface AccessConfig {
  teamDomain: string;
  policyAud: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: 403 | 500,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * JWKS fetches are cached by `jose` per key-set instance, so the instance is memoised per
 * team domain rather than rebuilt on every request. Key rotation is handled by `jose`, which
 * re-fetches when it sees an unknown `kid`.
 */
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string) {
  let jwks = jwksCache.get(teamDomain);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));
    jwksCache.set(teamDomain, jwks);
  }
  return jwks;
}

function isConfigured(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("CHANGEME");
}

/**
 * Whether Access is wired up at all.
 *
 * Exported for the one public route, `/api/health`, which reports this as a boolean so a fresh
 * deployment can show setup instructions instead of an inscrutable error. It deliberately returns
 * a yes/no and never the values — those are not secrets, but a setup screen has no use for them
 * and an endpoint that echoes configuration is a habit worth not starting.
 */
export function isAccessConfigured(config: Partial<AccessConfig>): boolean {
  return isConfigured(config.policyAud) && isConfigured(config.teamDomain);
}

/**
 * Verifies the Access JWT on a request and returns the caller's identity.
 * Throws {@link AuthError} on any failure — never returns a partially trusted result.
 */
export async function verifyAccess(
  request: Request,
  config: AccessConfig,
): Promise<AccessIdentity> {
  // A misconfigured audience would make verification vacuous, so fail closed and loudly.
  if (!isConfigured(config.policyAud) || !isConfigured(config.teamDomain)) {
    throw new AuthError("Access is not configured: set TEAM_DOMAIN and POLICY_AUD", 500);
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) {
    throw new AuthError("Missing Cloudflare Access JWT", 403);
  }

  let payload: JWTPayload;
  try {
    ({ payload } = await jwtVerify(token, getJwks(config.teamDomain), {
      issuer: config.teamDomain,
      audience: config.policyAud,
    }));
  } catch (error) {
    // Log the reason, never the token.
    console.error("Access JWT verification failed:", (error as Error).message);
    throw new AuthError("Invalid Cloudflare Access JWT", 403);
  }

  const email = typeof payload.email === "string" ? payload.email.toLowerCase() : "";
  if (!email) {
    // Service tokens authenticate without an email claim. This app has no machine callers,
    // so treat that as a rejection rather than inventing an identity for it.
    throw new AuthError("Access JWT carries no email claim", 403);
  }

  return { email, subject: payload.sub ?? "" };
}
