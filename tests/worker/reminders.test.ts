import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { recordResult, saveSubscription, toB64url, type PushConfig } from "../../worker/push";
import { kyivHour, runReminders } from "../../worker/reminders";
import { resetHousehold } from "./helpers";

/**
 * The 08:00 reminder, against a real database and a stand-in push service.
 *
 * The rules being pinned (docs/plans/push-reminders.md, decided 2026-10-04): 08:00 Kyiv time all
 * year; one notification per phone per day; only when something is due; only the owner's
 * payments; and an unposted payment reminded again the next morning.
 */

/** A phone's keys (RFC 8291's test user agent) — any valid P-256 point and 16-byte secret will do. */
const PHONE_KEYS = {
  p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  auth: "BTBZMqHH6r4Tts7J_aSIgg",
};
const LENA_PHONE = "https://web.push.apple.com/lena-phone";
const SERHII_PHONE = "https://web.push.apple.com/serhii-phone";

let config: PushConfig;

/** A push service that records who was messaged and answers with `status`. */
function pushService(status = 201) {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL) => {
    calls.push(String(input));
    return new Response(null, { status });
  }) as typeof fetch;
  return { calls, fetcher };
}

/** 2026-10-05 at the given Kyiv hour. Kyiv is UTC+3 until the clocks change on 25 October. */
const kyiv = (hour: number, day = 5) => new Date(Date.UTC(2026, 9, day, hour - 3, 7));

async function schedule(id: string, label: string, owner: string, nextOn: string) {
  await env.DB.prepare(
    `INSERT INTO recurring (id, household_id, label, template, cadence, day_of, next_on, active, created_by, rev, updated_at, deleted)
     VALUES (?, 'hh_default', ?, '{}', 'monthly', 1, ?, 1, ?, 1, 1, 0)`,
  )
    .bind(id, label, nextOn, owner)
    .run();
}

beforeEach(async () => {
  await resetHousehold();
  await env.DB.prepare(`DELETE FROM recurring`).run();
  await env.DB.prepare(
    `INSERT INTO members (id, household_id, email, display_name, created_at, rev, updated_at, deleted, locale)
     VALUES ('lena', 'hh_default', 'l@x', 'Lena', 1, 1, 1, 0, 'ru'), ('serhii', 'hh_default', 's@x', 'Serhii', 1, 1, 1, 0, 'uk')`,
  ).run();
  await saveSubscription(env.DB, "lena", { endpoint: LENA_PHONE, keys: PHONE_KEYS });
  await saveSubscription(env.DB, "serhii", { endpoint: SERHII_PHONE, keys: PHONE_KEYS });

  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  config = { publicKey: toB64url(raw), privateKey: jwk.d!, subject: "https://sayings.example" };
});

describe("the morning reminder", () => {
  it("waits until 08:00 Kyiv time", async () => {
    await schedule("r1", "Rent", "lena", "2026-10-05");
    const { calls, fetcher } = pushService();
    await runReminders(env.DB, config, kyiv(7), fetcher);
    expect(calls).toEqual([]);

    await runReminders(env.DB, config, kyiv(8), fetcher);
    expect(calls).toEqual([LENA_PHONE]);
  });

  it("messages only people with something due, about their own payments", async () => {
    await schedule("r1", "Rent", "lena", "2026-10-01");
    await schedule("r2", "His gym", "serhii", "2026-10-20");
    const { calls, fetcher } = pushService();

    const run = await runReminders(env.DB, config, kyiv(8), fetcher);
    expect(calls).toEqual([LENA_PHONE]);
    expect(run).toEqual({ sent: 1, failed: 0, removed: 0 });
  });

  it("sends once a day, and again the next morning while still unposted", async () => {
    await schedule("r1", "Rent", "lena", "2026-10-05");
    const { calls, fetcher } = pushService();

    await runReminders(env.DB, config, kyiv(8), fetcher);
    await runReminders(env.DB, config, kyiv(9), fetcher);
    await runReminders(env.DB, config, kyiv(22), fetcher);
    expect(calls).toHaveLength(1);

    await runReminders(env.DB, config, kyiv(8, 6), fetcher);
    expect(calls).toHaveLength(2);
  });

  it("still reminds when the 08:07 run was missed", async () => {
    await schedule("r1", "Rent", "lena", "2026-10-05");
    const { calls, fetcher } = pushService();
    await runReminders(env.DB, config, kyiv(11), fetcher);
    expect(calls).toEqual([LENA_PHONE]);
  });

  it("does not count a 'Send a test' as the morning's reminder", async () => {
    await schedule("r1", "Rent", "lena", "2026-10-05");
    // The test route records a success without the daily stamp.
    await recordResult(env.DB, LENA_PHONE, "sent");
    const { calls, fetcher } = pushService();
    await runReminders(env.DB, config, kyiv(8), fetcher);
    expect(calls).toEqual([LENA_PHONE]);
  });

  it("removes a phone the push service says is gone, without stopping the others", async () => {
    await schedule("r1", "Rent", "lena", "2026-10-05");
    await schedule("r2", "Gym", "serhii", "2026-10-05");
    const { fetcher } = pushService(410);

    const run = await runReminders(env.DB, config, kyiv(8), fetcher);
    expect(run.removed).toBe(2);
    const left = await env.DB.prepare(`SELECT COUNT(*) AS n FROM push_subscriptions`).first<{ n: number }>();
    expect(left!.n).toBe(0);
  });

  it("does nothing on an installation without push keys", async () => {
    await schedule("r1", "Rent", "lena", "2026-10-05");
    const { calls, fetcher } = pushService();
    expect(await runReminders(env.DB, null, kyiv(8), fetcher)).toEqual({ sent: 0, failed: 0, removed: 0 });
    expect(calls).toEqual([]);
  });
});

describe("Kyiv time", () => {
  it("follows the clock change, so 08:00 stays 08:00", () => {
    // Summer (UTC+3): 05:07 UTC is 08:07. Winter (UTC+2, from 25 October): 06:07 UTC is 08:07.
    expect(kyivHour(new Date(Date.UTC(2026, 9, 5, 5, 7)))).toBe(8);
    expect(kyivHour(new Date(Date.UTC(2026, 10, 5, 5, 7)))).toBe(7);
    expect(kyivHour(new Date(Date.UTC(2026, 10, 5, 6, 7)))).toBe(8);
  });
});
