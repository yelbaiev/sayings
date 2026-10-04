import { execFileSync } from "node:child_process";
import { webcrypto } from "node:crypto";
import { configPath } from "./wrangler-config.mjs";

/**
 * Creates this installation's push keys and stores them as Worker secrets.
 *
 *   npm run push:keys -- --subject https://your-app.workers.dev
 *
 * The subject is the contact a push service (Apple's, for an iPhone) can use for this sender: the
 * app's own https address is enough, or a mailto: if you prefer.
 *
 * The private key goes straight from memory into `wrangler secret put` over stdin. It is never
 * printed and never written to a file, so it cannot end up in a terminal log, a shell history or a
 * commit. Running this again makes a new pair: every phone then re-subscribes on its next start,
 * because a subscription made with the old public key cannot receive messages signed with the new one.
 *
 * See worker/push.ts and docs/plans/push-reminders.md.
 */

const args = process.argv.slice(2);
const subjectAt = args.indexOf("--subject");
const subject = subjectAt >= 0 ? args[subjectAt + 1] : undefined;

if (!subject || !/^(https:\/\/|mailto:)/.test(subject)) {
  console.error("usage: npm run push:keys -- --subject https://your-app.workers.dev   (or mailto:you@…)");
  process.exit(1);
}

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");

const pair = await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
  "sign",
  "verify",
]);
const publicKey = b64url(new Uint8Array(await webcrypto.subtle.exportKey("raw", pair.publicKey)));
const privateKey = (await webcrypto.subtle.exportKey("jwk", pair.privateKey)).d;

const config = configPath();
const put = (name, value) =>
  execFileSync("npx", ["wrangler", "secret", "put", name, "-c", config], {
    input: value,
    stdio: ["pipe", "inherit", "inherit"],
  });

put("VAPID_SUBJECT", subject);
put("VAPID_PUBLIC_KEY", publicKey);
put("VAPID_PRIVATE_KEY", privateKey);

console.log("✓ push keys stored as Worker secrets (the private key was not displayed).");
console.log("  On each phone: Settings → Reminders → Send a test.");
