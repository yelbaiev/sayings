import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  dueMessage,
  duePayments,
  encryptPayload,
  fromB64url,
  isPushEndpoint,
  recordResult,
  removeSubscription,
  saveSubscription,
  sendPush,
  subscriptionsFor,
  toB64url,
  vapidToken,
  type PushConfig,
} from "../../worker/push";
import { resetHousehold } from "./helpers";

/**
 * Web Push, against the standards and a real database.
 *
 * The encryption is the part that cannot be eyeballed: a single wrong byte and Apple's push service
 * rejects the message, or the phone silently drops it. So it is pinned to RFC 8291's own published
 * intermediate values (Appendix A), not to a round trip through the same code.
 */

const strip = (text: string) => text.replace(/\s+/g, "");

/** RFC 8291, Appendix A — copied from the RFC, whitespace removed. */
const RFC = {
  plaintext: "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24",
  asPublic: strip(`BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIg
    Dll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8`),
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: strip(`BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-
    JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4`),
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  header: strip(`DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
    mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8`),
  ciphertext: strip(`8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEs
    bI_0LpXMuGvnzQ`),
};

async function generateConfig(): Promise<PushConfig> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey;
  const raw = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  return { publicKey: toB64url(raw), privateKey: jwk.d!, subject: "https://sayings.example" };
}

const APPLE = "https://web.push.apple.com/QGfake-endpoint-token";

beforeEach(resetHousehold);

describe("RFC 8291 encryption", () => {
  it("reproduces the RFC's own test vector byte for byte", async () => {
    const body = await encryptPayload(fromB64url(RFC.plaintext), RFC.uaPublic, RFC.authSecret, {
      serverPrivateB64: RFC.asPrivate,
      serverPublicB64: RFC.asPublic,
      saltB64: RFC.salt,
    });
    const header = fromB64url(RFC.header);
    expect(toB64url(body.slice(0, header.length))).toBe(RFC.header);
    expect(toB64url(body.slice(header.length))).toBe(RFC.ciphertext);
  });

  it("uses a fresh key and salt for every message", async () => {
    const a = await encryptPayload(fromB64url(RFC.plaintext), RFC.uaPublic, RFC.authSecret);
    const b = await encryptPayload(fromB64url(RFC.plaintext), RFC.uaPublic, RFC.authSecret);
    expect(toB64url(a)).not.toBe(toB64url(b));
  });
});

describe("VAPID", () => {
  it("signs a token the public key verifies, addressed to the push service", async () => {
    const config = await generateConfig();
    const now = Date.UTC(2026, 9, 4, 8);
    const token = await vapidToken(APPLE, config, now);
    const [header, claims, signature] = token.split(".") as [string, string, string];

    const decoded = JSON.parse(new TextDecoder().decode(fromB64url(claims)));
    expect(decoded.aud).toBe("https://web.push.apple.com");
    expect(decoded.sub).toBe("https://sayings.example");
    expect(decoded.exp).toBe(now / 1000 + 12 * 3600);

    const key = await crypto.subtle.importKey(
      "raw",
      fromB64url(config.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      fromB64url(signature),
      new TextEncoder().encode(`${header}.${claims}`),
    );
    expect(valid).toBe(true);
  });
});

describe("endpoints", () => {
  it("accepts only the real push services, over https", () => {
    expect(isPushEndpoint(APPLE)).toBe(true);
    expect(isPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).toBe(true);
    expect(isPushEndpoint("http://web.push.apple.com/x")).toBe(false);
    expect(isPushEndpoint("https://evil.example/x")).toBe(false);
    expect(isPushEndpoint("https://web.push.apple.com.evil.example/x")).toBe(false);
    expect(isPushEndpoint("not a url")).toBe(false);
  });
});

async function seedMembers() {
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO members (id, household_id, email, display_name, created_at, rev, updated_at, deleted, locale)
       VALUES ('lena', 'hh_default', 'l@x', 'Lena', 1, 1, 1, 0, 'ru'), ('serhii', 'hh_default', 's@x', 'Serhii', 1, 1, 1, 0, 'uk')`,
    ),
  ]);
}

const sub = (endpoint = APPLE) => ({
  endpoint,
  keys: { p256dh: RFC.uaPublic, auth: RFC.authSecret },
});

describe("subscriptions", () => {
  it("stores a phone against its member, and only that member can remove it", async () => {
    await seedMembers();
    await saveSubscription(env.DB, "lena", sub());
    await removeSubscription(env.DB, "serhii", APPLE);
    expect(await subscriptionsFor(env.DB, "lena")).toHaveLength(1);

    await removeSubscription(env.DB, "lena", APPLE);
    expect(await subscriptionsFor(env.DB, "lena")).toHaveLength(0);
  });

  it("moves a phone to whoever subscribes it next", async () => {
    await seedMembers();
    await saveSubscription(env.DB, "lena", sub());
    await saveSubscription(env.DB, "serhii", sub());
    expect(await subscriptionsFor(env.DB, "lena")).toHaveLength(0);
    expect(await subscriptionsFor(env.DB, "serhii")).toHaveLength(1);
  });
});

describe("sending", () => {
  it("posts an encrypted, signed message and reads the push service's answer", async () => {
    const config = await generateConfig();
    const requests: Request[] = [];
    const answer = (status: number) => (async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return new Response(null, { status });
    }) as typeof fetch;
    const message = { title: "2 payments due", body: "Rent · iCloud", count: 2, url: "/recurring" };
    const subscription = { endpoint: APPLE, p256dh: RFC.uaPublic, auth: RFC.authSecret };

    expect(await sendPush(subscription, message, config, answer(201))).toBe("sent");
    const request = requests[0]!;
    expect(request.headers.get("Content-Encoding")).toBe("aes128gcm");
    expect(request.headers.get("Authorization")).toMatch(new RegExp(`^vapid t=[^,]+, k=${config.publicKey}$`));
    // The body is ciphertext: the title must not be readable in it.
    const body = new TextDecoder().decode(await request.arrayBuffer());
    expect(body).not.toContain("payments due");

    expect(await sendPush(subscription, message, config, answer(410))).toBe("gone");
    expect(await sendPush(subscription, message, config, answer(500))).toBe("failed");
  });

  it("deletes a subscription the push service says is gone, and counts other failures", async () => {
    await seedMembers();
    await saveSubscription(env.DB, "lena", sub());
    await recordResult(env.DB, APPLE, "failed");
    const row = await env.DB.prepare(`SELECT failures FROM push_subscriptions`).first<{ failures: number }>();
    expect(row!.failures).toBe(1);

    await recordResult(env.DB, APPLE, "gone");
    expect(await subscriptionsFor(env.DB, "lena")).toHaveLength(0);
  });
});

describe("what is due", () => {
  it("lists only the member's own active payments due by today", async () => {
    await seedMembers();
    const row = (id: string, label: string, owner: string | null, nextOn: string, active = 1) =>
      env.DB.prepare(
        `INSERT INTO recurring (id, household_id, label, template, cadence, day_of, next_on, active, created_by, rev, updated_at, deleted)
         VALUES (?, 'hh_default', ?, '{}', 'monthly', 1, ?, ?, ?, 1, 1, 0)`,
      ).bind(id, label, nextOn, active, owner);
    await env.DB.batch([
      row("r1", "Rent", "lena", "2026-10-01"),
      row("r2", "iCloud", "lena", "2026-10-04"),
      row("r3", "Tomorrow", "lena", "2026-10-05"),
      row("r4", "Paused", "lena", "2026-10-01", 0),
      row("r5", "His gym", "serhii", "2026-10-01"),
    ]);

    expect(await duePayments(env.DB, "lena", "2026-10-04")).toEqual(["Rent", "iCloud"]);
    expect(await duePayments(env.DB, "serhii", "2026-10-04")).toEqual(["His gym"]);
  });
});

describe("the notification text", () => {
  it("counts and names the payments in the member's language", () => {
    expect(dueMessage("en", ["Rent", "iCloud"])).toMatchObject({ title: "2 payments due", body: "Rent · iCloud", count: 2 });
    expect(dueMessage("en", ["Rent"]).title).toBe("1 payment due");
    expect(dueMessage("ru", ["a"]).title).toBe("1 платёж к оплате");
    expect(dueMessage("ru", ["a", "b"]).title).toBe("2 платежа к оплате");
    expect(dueMessage("ru", ["a", "b", "c", "d", "e"]).title).toBe("5 платежей к оплате");
    expect(dueMessage("uk", ["a", "b"]).title).toBe("2 платежі до сплати");
    expect(dueMessage("uk", ["a", "b", "c", "d", "e"]).title).toBe("5 платежів до сплати");
  });
});

describe("secrecy", () => {
  it("never logs from the push module — endpoints are capability URLs", async () => {
    const source = await import("../../worker/push.ts?raw");
    expect(source.default).not.toMatch(/console\./);
  });
});
