import { Hono } from "hono";
import { AuthError, isAccessConfigured, verifyAccess, type AccessIdentity } from "./auth";
import { latestBackup, listBackups, runBackup } from "./backup";
import {
  ensureMember,
  householdCurrencies,
  needsCurrencySetup,
  setHouseholdCurrencies,
  type MemberRecord,
} from "./db";
import { backfillRange, ratesSince, reconcileEstimatedRates, runDailyFxUpdate } from "./fx";
import {
  deleteReceipt,
  isOwnReceiptKey,
  storeReceipt,
  typeForKey,
} from "./receipts";
import { checkSchema, schemaErrorMessage } from "./schema-guard";
import {
  AuthFlowError,
  claimOptions,
  claimVerify,
  createInvite,
  destroySession,
  inviteOptions,
  inviteVerify,
  loginOptions,
  loginVerify,
  memberForSession,
  readSessionToken,
  sessionCookie,
} from "./passkeys";
import { repriceToBase } from "./reprice";
import { SyncError, handleSync } from "./sync";
import { isNewer, isUpdateCheckEnabled, runUpdateCheck, storedRelease } from "./update-check";

type AppEnv = {
  Bindings: Env;
  Variables: { identity: AccessIdentity; member: MemberRecord };
};

const api = new Hono<AppEnv>().basePath("/api");

/**
 * The only unauthenticated route, and it must stay above the middleware below to be one.
 *
 * It exists so a freshly deployed installation can tell the difference between "broken" and "not
 * finished yet". Cloudflare Access cannot be configured by a deploy — not by the Deploy to
 * Cloudflare button, not by wrangler — so there is a window in which the Worker is live with no
 * authentication in front of it. The API refuses every other request in that state, which is
 * correct but reads as a broken app; this lets the client render the remaining setup steps.
 *
 * Reports booleans only. No configuration values, no version of anything internal, nothing that
 * would be worth knowing to an unauthenticated caller.
 */
/**
 * The installed version, and the newest one upstream if the nightly check has found it.
 *
 * Authenticated, unlike /api/health: this is for the Settings screen, and an unauthenticated caller
 * has no business learning which version an installation runs — that is the kind of detail that
 * makes targeting easy and helps nobody else.
 */
api.get("/version", async (c) => {
  const latest = await storedRelease(c.env.DB);
  return c.json({
    current: __APP_VERSION__,
    latest,
    updateAvailable: latest ? isNewer(latest.tag, __APP_VERSION__) : false,
    checkEnabled: isUpdateCheckEnabled(c.env.UPDATE_CHECK),
  });
});

api.get("/health", async (c) => {
  const schema = await checkSchema(c.env.DB, __EXPECTED_MIGRATION__);
  return c.json({
    ok: schema.ok,
    configured: isAccessConfigured({
      teamDomain: c.env.TEAM_DOMAIN,
      policyAud: c.env.POLICY_AUD,
    }),
    // Numbers, not names. Enough for the client to say what is wrong, nothing an unauthenticated
    // caller could use.
    schema: { applied: schema.applied, expected: schema.expected },
  });
});

/**
 * Refuses every authenticated route while the database is behind the code — see schema-guard.ts.
 * Ahead of authentication on purpose: the answer does not depend on who is asking, and someone
 * who cannot get past a broken schema should be told that rather than told to sign in again.
 */
api.use("*", async (c, next) => {
  const schema = await checkSchema(c.env.DB, __EXPECTED_MIGRATION__);
  if (!schema.ok) {
    return c.json({ error: schemaErrorMessage(schema) }, 503);
  }
  return next();
});

/*
 * Authentication endpoints sit in front of the auth wall by nature. Grouped and mounted before the
 * wall so nothing here can accidentally depend on a member existing.
 */
api.post("/auth/claim/options", async (c) => {
  try {
    return c.json(await claimOptions(c.env.DB, c.req.raw));
  } catch (error) {
    if (error instanceof AuthFlowError) return c.json({ error: error.message }, error.status as 409);
    throw error;
  }
});

api.post("/auth/claim/verify", async (c) => {
  try {
    const { member, sessionToken } = await claimVerify(c.env.DB, c.req.raw, await c.req.json());
    c.header("Set-Cookie", sessionCookie(sessionToken));
    return c.json({ id: member.id, display_name: member.display_name, role: member.role });
  } catch (error) {
    if (error instanceof AuthFlowError) return c.json({ error: error.message }, error.status as 403);
    throw error;
  }
});

api.post("/auth/login/options", async (c) => c.json(await loginOptions(c.env.DB, c.req.raw)));

api.post("/auth/login/verify", async (c) => {
  try {
    const { member, sessionToken } = await loginVerify(c.env.DB, c.req.raw, await c.req.json());
    c.header("Set-Cookie", sessionCookie(sessionToken));
    return c.json({ id: member.id, display_name: member.display_name, role: member.role });
  } catch (error) {
    if (error instanceof AuthFlowError) return c.json({ error: error.message }, error.status as 403);
    throw error;
  }
});

api.post("/auth/invite/options", async (c) => {
  try {
    const body = (await c.req.json()) as { inviteToken?: string };
    return c.json(await inviteOptions(c.env.DB, c.req.raw, body.inviteToken ?? ""));
  } catch (error) {
    if (error instanceof AuthFlowError) return c.json({ error: error.message }, error.status as 403);
    throw error;
  }
});

api.post("/auth/invite/verify", async (c) => {
  try {
    const { member, sessionToken } = await inviteVerify(c.env.DB, c.req.raw, await c.req.json());
    c.header("Set-Cookie", sessionCookie(sessionToken));
    return c.json({ id: member.id, display_name: member.display_name, role: member.role });
  } catch (error) {
    if (error instanceof AuthFlowError) return c.json({ error: error.message }, error.status as 403);
    throw error;
  }
});

api.post("/auth/logout", async (c) => {
  const token = readSessionToken(c.req.raw);
  if (token) await destroySession(c.env.DB, token);
  c.header("Set-Cookie", sessionCookie("", 0));
  return c.json({ ok: true });
});

/**
 * Every other /api route is authenticated — by a passkey session cookie, or by a Cloudflare Access
 * JWT for installations that keep Access in front as extra hardening. The session is checked first:
 * it is one indexed D1 read, where Access verification is a JWKS fetch (cached, but still the more
 * expensive path), and on a passkey-only deployment Access is not configured at all.
 */
api.use("*", async (c, next) => {
  const token = readSessionToken(c.req.raw);
  if (token) {
    const member = await memberForSession(c.env.DB, token);
    if (member) {
      c.set("member", member);
      return next();
    }
  }

  try {
    const identity = await verifyAccess(c.req.raw, {
      teamDomain: c.env.TEAM_DOMAIN,
      policyAud: c.env.POLICY_AUD,
    });
    c.set("identity", identity);
    c.set("member", await ensureMember(c.env.DB, identity));
  } catch (error) {
    if (error instanceof AuthError) {
      /*
       * The client needs to know which door to point the person at: an unclaimed deployment gets
       * the claim screen, a claimed one the passkey login. `authState` rides on the 401/403 body
       * so no second round trip is needed.
       */
      const members = await c.env.DB.prepare(
        `SELECT COUNT(*) AS count FROM members WHERE deleted = 0`,
      ).first<{ count: number }>();
      return c.json(
        { error: error.message, authState: (members?.count ?? 0) === 0 ? "unclaimed" : "login" },
        error.status,
      );
    }
    throw error;
  }
  return next();
});

/** The owner mints one-time invite links from Settings. */
api.post("/invites", async (c) => {
  const member = c.get("member");
  if (member.role !== "owner") {
    return c.json({ error: "only the owner can invite" }, 403);
  }
  const token = await createInvite(c.env.DB, member.id);
  // The path only; the client composes the absolute URL from its own origin.
  return c.json({ token, path: `/join#${token}`, expiresInHours: 48 });
});

api.get("/me", async (c) => {
  const member = c.get("member");
  // The household's currency setting rides along with identity rather than having its own endpoint:
  // the client cannot render an amount before it knows what to roll up to, so a second round trip
  // would only add a state where money is displayable but not yet correct.
  const currencies = await householdCurrencies(c.env.DB);
  return c.json({
    id: member.id,
    email: member.email,
    display_name: member.display_name,
    locale: member.locale,
    default_account_id: member.default_account_id ?? null,
    role: member.role,
    household_id: member.household_id,
    base_currency: currencies.base,
    enabled_currencies: currencies.enabled,
    needs_currency_setup: await needsCurrencySetup(c.env.DB),
  });
});

/**
 * The currency setting. Not part of `/api/sync`, because `households` is configuration rather than
 * ledger data and deliberately stays out of the local mirror and out of an export of transactions.
 */
api.put("/household/currencies", async (c) => {
  const body = (await c.req.json()) as { base?: unknown; enabled?: unknown };
  try {
    return c.json(
      await setHouseholdCurrencies(c.env.DB, { base: body.base, enabled: body.enabled }),
    );
  } catch (error) {
    // The message names the offending code, never the body.
    return c.json({ error: (error as Error).message }, 400);
  }
});

/**
 * Changes the reporting currency and re-prices what is already recorded.
 *
 * Takes a backup on the first call, before touching anything. Not for tidiness: this rewrites a
 * denormalised column on every transaction a household has, on someone else's Cloudflare account,
 * with nobody but its owner able to put it back.
 *
 * Bounded per call and resumable, so the client repeats while `remaining` is above zero — the same
 * shape as the FX backfill, for the same reason.
 */
api.post("/household/base", async (c) => {
  const body = (await c.req.json()) as { base?: unknown; resume?: unknown };

  try {
    if (!body.resume) {
      await runBackup(c.env.DB, c.env.FILES, new Date().toISOString().slice(0, 10));
    }
    return c.json(await repriceToBase(c.env.DB, body.base));
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400);
  }
});

api.post("/sync", async (c) => {
  try {
    return c.json(await handleSync(c.env.DB, c.get("member"), await c.req.json()));
  } catch (error) {
    if (error instanceof SyncError) {
      // The message names the offending field, never the payload.
      return c.json({ error: error.message }, 400);
    }
    throw error;
  }
});

/* ------------------------------------------------------------------------------------ fx */

api.get("/fx", async (c) => {
  // Rates are public reference data, so they are pulled by date rather than through the
  // household revision stream.
  const since = c.req.query("since") ?? "1970-01-01";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    return c.json({ error: "since must be YYYY-MM-DD" }, 400);
  }
  return c.json({ rates: await ratesSince(c.env.DB, since) });
});

/**
 * One-shot historical backfill, needed before importing multi-currency history.
 *
 * Bounded per call so a five-year range cannot exceed the Worker's CPU limit; the client
 * repeats until `requested` comes back zero.
 */
api.post("/fx/backfill", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { from?: string; to?: string };
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (!body.from || !body.to || !iso.test(body.from) || !iso.test(body.to)) {
    return c.json({ error: "from and to must be YYYY-MM-DD" }, 400);
  }
  if (body.from > body.to) {
    return c.json({ error: "from must not be after to" }, 400);
  }
  return c.json(await backfillRange(c.env.DB, body.from, body.to));
});

/* -------------------------------------------------------------------------------- backup */

api.get("/backups/latest", async (c) => {
  const latest = await latestBackup(c.env.DB);
  return latest ? c.json(latest) : c.json({}, 404);
});

api.get("/backups", async (c) => c.json({ backups: await listBackups(c.env.DB) }));

/** Manual backup, so the restore path can be exercised without waiting for the cron. */
api.post("/backups/run", async (c) => {
  const result = await runBackup(c.env.DB, c.env.FILES, new Date().toISOString().slice(0, 10));
  return c.json(result);
});

/**
 * Stores a receipt photo and returns its key, which the client then saves on the transaction.
 *
 * The type is inferred from the bytes rather than trusted from the request — see worker/receipts.ts
 * for why that matters when the response comes from the app's own origin.
 */
api.post("/receipts", async (c) => {
  const body = await c.req.arrayBuffer();
  const result = await storeReceipt(c.env.FILES, body);
  if ("error" in result) return c.json({ error: result.error }, result.status);
  return c.json(result);
});

/**
 * Serves a receipt.
 *
 * Three headers doing real work: the content type comes from the key rather than from anything a
 * caller said, `nosniff` stops a browser overriding it, and `inline` with no filename keeps it from
 * becoming a download. The cache is private and long — the object is immutable, its key contains a
 * uuid, and it is nobody else's business.
 */
api.get("/receipts/:key{.+}", async (c) => {
  const key = c.req.param("key");
  if (!isOwnReceiptKey(key)) return c.json({ error: "unknown receipt" }, 400);

  const object = await c.env.FILES.get(key);
  if (!object) return c.json({ error: "not found" }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": typeForKey(key),
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});

/** Removes a receipt, for when one is replaced or detached. */
api.delete("/receipts/:key{.+}", async (c) => {
  const removed = await deleteReceipt(c.env.FILES, c.req.param("key"));
  return c.json({ removed });
});

/** Downloads a snapshot. Authenticated like everything else. */
api.get("/backups/download", async (c) => {
  const key = c.req.query("key");
  // Constrain the key to the backup prefix: an unchecked key would let any object in the
  // bucket be read through this endpoint.
  if (!key || !/^backups\/(daily|monthly)\/\d{4}-\d{2}-\d{2}\.json$/.test(key)) {
    return c.json({ error: "unknown backup key" }, 400);
  }

  const object = await c.env.FILES.get(key);
  if (!object) return c.json({ error: "not found" }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${key.split("/").pop()}"`,
    },
  });
});

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      return api.fetch(request, env, ctx);
    }
    // Everything else is the SPA. `not_found_handling: single-page-application` in
    // wrangler.jsonc makes unknown paths resolve to index.html for client-side routing.
    return env.ASSETS.fetch(request);
  },

  /**
   * Nightly at 00:30 UTC: refresh rates, re-price anything saved offline without one, then
   * snapshot to R2.
   *
   * Order matters — the backup should capture corrected figures, not the estimates.
   */
  async scheduled(_controller, env, _ctx) {
    const today = new Date().toISOString().slice(0, 10);

    try {
      const stored = await runDailyFxUpdate(env.DB, today);
      const reconciled = await reconcileEstimatedRates(env.DB);
      console.log(`FX: stored ${stored} rates, reconciled ${reconciled} transactions`);
    } catch (error) {
      // A failed rate update must not cost the household its nightly backup.
      console.error("FX update failed:", (error as Error).message);
    }

    try {
      const result = await runBackup(env.DB, env.FILES, today);
      console.log(`Backup: ${result.key} (${result.rows} rows, ${result.bytes} bytes)`);
    } catch (error) {
      console.error("Backup failed:", (error as Error).message);
    }

    // Last, and in its own try: an unreachable GitHub must never cost the household a backup.
    try {
      const release = await runUpdateCheck(env.DB, {
        repo: env.UPSTREAM_REPO,
        enabled: env.UPDATE_CHECK,
      });
      if (release) console.log(`Update check: latest is ${release.tag}`);
    } catch (error) {
      console.error("Update check failed:", (error as Error).message);
    }
  },
} satisfies ExportedHandler<Env>;
