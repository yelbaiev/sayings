import { HOUSEHOLD_ID } from "@shared/schema";
import { z } from "zod";

/**
 * Web Push, on Workers, with nothing but WebCrypto.
 *
 * Two standards do the work:
 * - **RFC 8291** — the message is encrypted to the phone (`aes128gcm`), so the push service in the
 *   middle (Apple's, for an iPhone) carries it without being able to read it.
 * - **RFC 8292 (VAPID)** — each request is signed with this installation's key, which is how the
 *   push service knows the sender is the one the phone subscribed to.
 *
 * The Node `web-push` library does both but leans on Node's crypto module; WebCrypto has every
 * primitive needed (ECDH, HKDF, AES-GCM, ECDSA P-256), so this is a few dozen lines rather than a
 * dependency. The encryption is pinned byte for byte to RFC 8291's own test vector in
 * tests/worker/push.test.ts.
 *
 * Endpoints are capability URLs — anyone holding one can message that phone — so they are treated
 * as secrets: stored, never logged.
 *
 * See docs/plans/push-reminders.md.
 */

/* ------------------------------------------------------------------------------ config */

/**
 * The three Worker secrets reminders need. All optional: an installation without them runs as
 * before, and the reminders switch says push is not set up. `npm run push:keys` creates them.
 */
export interface PushEnv {
  /** P-256 public key, base64url, 65 bytes uncompressed. Given to phones when they subscribe. */
  VAPID_PUBLIC_KEY?: string;
  /** The matching private scalar, base64url, 32 bytes. Signs every push. */
  VAPID_PRIVATE_KEY?: string;
  /** A contact for the push service: this installation's https URL (or a mailto:). */
  VAPID_SUBJECT?: string;
}

export interface PushConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

export function pushConfig(env: PushEnv): PushConfig | null {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env;
  if (!publicKey || !privateKey || !subject) return null;
  return { publicKey, privateKey, subject };
}

/* ------------------------------------------------------------------------------ base64url */

export function toB64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** A P-256 private key from its raw scalar and public point, as WebCrypto wants it. */
function privateJwk(privateB64: string, publicB64: string): JsonWebKey {
  const point = fromB64url(publicB64);
  return {
    kty: "EC",
    crv: "P-256",
    d: privateB64,
    x: toB64url(point.slice(1, 33)),
    y: toB64url(point.slice(33, 65)),
    ext: true,
  };
}

/* ------------------------------------------------------------------------------ RFC 8291 */

async function hkdf(
  salt: Uint8Array<ArrayBuffer>,
  ikm: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  length: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, length * 8);
  return new Uint8Array(bits);
}

const encoder = new TextEncoder();
/** UTF-8 bytes, typed for WebCrypto (which wants a plain ArrayBuffer behind the view). */
const utf8 = (text: string): Uint8Array<ArrayBuffer> => new Uint8Array(encoder.encode(text));

/**
 * Encrypts one push message for one phone (RFC 8291, single `aes128gcm` record).
 *
 * `fixed` exists for the test vector only: production uses a fresh ephemeral key and salt per
 * message, which is what makes two identical reminders indistinguishable on the wire.
 */
export async function encryptPayload(
  plaintext: Uint8Array,
  phonePublicB64: string,
  phoneAuthB64: string,
  fixed?: { serverPrivateB64: string; serverPublicB64: string; saltB64: string },
): Promise<Uint8Array<ArrayBuffer>> {
  const uaPublic = fromB64url(phonePublicB64);
  const authSecret = fromB64url(phoneAuthB64);

  let asPrivate: CryptoKey;
  let asPublic: Uint8Array<ArrayBuffer>;
  if (fixed) {
    asPrivate = await crypto.subtle.importKey(
      "jwk",
      privateJwk(fixed.serverPrivateB64, fixed.serverPublicB64),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
    asPublic = fromB64url(fixed.serverPublicB64);
  } else {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    asPrivate = pair.privateKey;
    asPublic = new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer);
  }
  const salt = fixed ? fromB64url(fixed.saltB64) : crypto.getRandomValues(new Uint8Array(16));

  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  // `public` is the standard name and what the runtime reads; workerd's generated types call the
  // field `$public`, hence the cast.
  const ecdhParams = { name: "ECDH", public: uaKey } as unknown as SubtleCryptoDeriveKeyAlgorithm;
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(ecdhParams, asPrivate, 256));

  const keyInfo = concat(utf8("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);
  const cek = await hkdf(salt, ikm, utf8("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, utf8("Content-Encoding: nonce\0"), 12);

  // One record, so the padding delimiter is 0x02 ("last record") with no padding after it.
  const padded = concat(plaintext, new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, padded),
  );

  // Header: salt (16) · record size (4, big-endian) · key id length (1) · key id (the server's
  // ephemeral public key, 65).
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return concat(salt, recordSize, new Uint8Array([asPublic.length]), asPublic, ciphertext);
}

/* ------------------------------------------------------------------------------ RFC 8292 */

/** A VAPID token for one push service, valid for 12 hours (the spec allows up to 24). */
export async function vapidToken(endpoint: string, config: PushConfig, now = Date.now()): Promise<string> {
  const header = toB64url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = toB64url(
    encoder.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 60 * 60,
        sub: config.subject,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "jwk",
    privateJwk(config.privateKey, config.publicKey),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  // WebCrypto's ECDSA signature is already the raw r‖s form a JWS needs.
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    utf8(`${header}.${claims}`),
  );
  return `${header}.${claims}.${toB64url(new Uint8Array(signature))}`;
}

/* ------------------------------------------------------------------------------ sending */

/**
 * The push services phones actually use. The server POSTs to whatever endpoint a phone registers,
 * so an endpoint is accepted only on these hosts — otherwise any member could point the Worker at
 * an arbitrary URL.
 */
const PUSH_HOSTS = [
  /^web\.push\.apple\.com$/,
  /(^|\.)push\.apple\.com$/,
  /^fcm\.googleapis\.com$/,
  /^updates\.push\.services\.mozilla\.com$/,
  /(^|\.)notify\.windows\.com$/,
];

export function isPushEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && PUSH_HOSTS.some((host) => host.test(url.hostname));
  } catch {
    return false;
  }
}

export interface PushMessage {
  title: string;
  body: string;
  /** What the icon badge should show. */
  count: number;
  /** Where a tap on the notification opens. */
  url: string;
}

export interface Subscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type SendResult = "sent" | "gone" | "failed";

export async function sendPush(
  subscription: Subscription,
  message: PushMessage,
  config: PushConfig,
  fetcher: typeof fetch = fetch,
): Promise<SendResult> {
  const body = await encryptPayload(
    encoder.encode(JSON.stringify(message)),
    subscription.p256dh,
    subscription.auth,
  );
  const response = await fetcher(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${await vapidToken(subscription.endpoint, config)}, k=${config.publicKey}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      // A day: a reminder about today's payments is worthless tomorrow.
      TTL: "86400",
      Urgency: "normal",
    },
    body,
  });
  if (response.ok) return "sent";
  // 404 and 410 are the push service saying the subscription no longer exists.
  if (response.status === 404 || response.status === 410) return "gone";
  return "failed";
}

/* ------------------------------------------------------------------------------ storage */

export const subscribeSchema = z.object({
  endpoint: z.string().url().max(1024),
  keys: z.object({
    p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/),
    auth: z.string().regex(/^[A-Za-z0-9_-]{16,32}$/),
  }),
});

/** Stores a phone's subscription for the calling member. A phone that changes hands moves with it. */
export async function saveSubscription(
  db: D1Database,
  memberId: string,
  input: z.infer<typeof subscribeSchema>,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO push_subscriptions (endpoint, member_id, p256dh, auth, created_at, failures)
       VALUES (?, ?, ?, ?, ?, 0)
       ON CONFLICT(endpoint) DO UPDATE SET
         member_id = excluded.member_id, p256dh = excluded.p256dh, auth = excluded.auth, failures = 0`,
    )
    .bind(input.endpoint, memberId, input.keys.p256dh, input.keys.auth, Date.now())
    .run();
}

/** Removes a subscription — only the caller's own. */
export async function removeSubscription(db: D1Database, memberId: string, endpoint: string): Promise<void> {
  await db
    .prepare(`DELETE FROM push_subscriptions WHERE endpoint = ? AND member_id = ?`)
    .bind(endpoint, memberId)
    .run();
}

export async function subscriptionsFor(db: D1Database, memberId: string): Promise<Subscription[]> {
  const { results } = await db
    .prepare(`SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE member_id = ?`)
    .bind(memberId)
    .all<Subscription>();
  return results;
}

/** Records how a send went: a gone subscription is deleted, a failure counted, a success stamped. */
export async function recordResult(db: D1Database, endpoint: string, result: SendResult): Promise<void> {
  const statement =
    result === "gone"
      ? db.prepare(`DELETE FROM push_subscriptions WHERE endpoint = ?`).bind(endpoint)
      : result === "failed"
        ? db.prepare(`UPDATE push_subscriptions SET failures = failures + 1 WHERE endpoint = ?`).bind(endpoint)
        : db
            .prepare(`UPDATE push_subscriptions SET last_sent_at = ?, failures = 0 WHERE endpoint = ?`)
            .bind(Date.now(), endpoint);
  await statement.run();
}

/* ------------------------------------------------------------------------------ content */

/** Today's date where the household lives. The reminder's "today" is Kyiv's, not UTC's. */
export function kyivDate(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Kyiv" }).format(now);
}

/**
 * The member's due payments: active, not deleted, due by today, and theirs — the same rule as the
 * app's useDueRecurring/isMine (`created_by`, falling back to `updated_by`; a row with neither is
 * everyone's).
 */
export async function duePayments(db: D1Database, memberId: string, today: string): Promise<string[]> {
  const { results } = await db
    .prepare(
      `SELECT label FROM recurring
        WHERE household_id = ? AND deleted = 0 AND active = 1 AND next_on <= ?
          AND (COALESCE(created_by, updated_by) = ? OR COALESCE(created_by, updated_by) IS NULL)
        ORDER BY next_on, label`,
    )
    .bind(HOUSEHOLD_ID, today, memberId)
    .all<{ label: string }>();
  return results.map((row) => row.label);
}

type Locale = "en" | "ru" | "uk";

function plural(locale: Locale, count: number, forms: { one: string; few: string; many: string }): string {
  const category = new Intl.PluralRules(locale).select(count);
  return category === "one" ? forms.one : category === "few" ? forms.few : forms.many;
}

/**
 * The notification, in the member's language: "2 payments due" and the names (decided
 * 2026-10-04: names on the lock screen).
 */
export function dueMessage(locale: string, labels: string[]): PushMessage {
  const lang: Locale = locale === "ru" || locale === "uk" ? locale : "en";
  const count = labels.length;
  const title =
    lang === "ru"
      ? `${count} ${plural("ru", count, { one: "платёж", few: "платежа", many: "платежей" })} к оплате`
      : lang === "uk"
        ? `${count} ${plural("uk", count, { one: "платіж", few: "платежі", many: "платежів" })} до сплати`
        : `${count} ${count === 1 ? "payment" : "payments"} due`;
  return { title, body: labels.join(" · "), count, url: "/recurring" };
}

/** What "Send a test" sends when nothing is due, so the test still shows something real. */
export function testMessage(locale: string): PushMessage {
  const lang: Locale = locale === "ru" || locale === "uk" ? locale : "en";
  const title = { en: "Reminders are on", ru: "Напоминания включены", uk: "Нагадування увімкнено" }[lang];
  const body = {
    en: "This phone can receive SAYings notifications.",
    ru: "Этот телефон получает уведомления SAYings.",
    uk: "Цей телефон отримує сповіщення SAYings.",
  }[lang];
  return { title, body, count: 0, url: "/recurring" };
}
