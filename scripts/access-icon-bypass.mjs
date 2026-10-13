#!/usr/bin/env node
/*
 * Lets the home-screen icon through Cloudflare Access.
 *
 * Behind Access, every request without a sign-in cookie is redirected to the login page — including
 * the one iOS makes for the icon when the app is added to the home screen, and again whenever it
 * refreshes that icon. An installed web app keeps its cookies apart from Safari's, so that request
 * often has none, gets HTML instead of a PNG, and iOS swaps in a screenshot or a letter.
 *
 * This creates a second, narrower Access application on the same hostname covering only the icon
 * files and the manifest, with a Bypass policy. Access matches the most specific path, so these
 * files become public and everything else stays exactly as protected as before. They are artwork;
 * nothing in them is household data.
 *
 * Usage:
 *   CLOUDFLARE_API_TOKEN=… node scripts/access-icon-bypass.mjs <hostname> [account-id]
 *
 * The token needs "Access: Apps and Policies — Edit". Safe to run twice: an existing application of
 * the same name is updated rather than duplicated.
 */

const NAME = "SAYings — public icons";
const PATHS = [
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "icon.svg",
  "icon-square.svg",
  "manifest.webmanifest",
];

const [hostname, accountArg] = process.argv.slice(2);
const token = process.env.CLOUDFLARE_API_TOKEN;
if (!hostname || !token) {
  console.error("usage: CLOUDFLARE_API_TOKEN=… node scripts/access-icon-bypass.mjs <hostname> [account-id]");
  process.exit(1);
}

async function cf(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...init,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
  });
  const body = await response.json();
  if (!body.success) throw new Error(`${path}: ${JSON.stringify(body.errors)}`);
  return body.result;
}

const accountId = accountArg ?? (await cf("/accounts"))[0]?.id;
if (!accountId) throw new Error("no account visible to this token");

const app = {
  name: NAME,
  type: "self_hosted",
  self_hosted_domains: PATHS.map((path) => `${hostname}/${path}`),
  session_duration: "24h",
  policies: [{ name: "Public icons", decision: "bypass", include: [{ everyone: {} }], precedence: 1 }],
};

const existing = (await cf(`/accounts/${accountId}/access/apps`)).find((a) => a.name === NAME);
const result = existing
  ? await cf(`/accounts/${accountId}/access/apps/${existing.id}`, { method: "PUT", body: JSON.stringify(app) })
  : await cf(`/accounts/${accountId}/access/apps`, { method: "POST", body: JSON.stringify(app) });

console.log(`${existing ? "Updated" : "Created"} "${result.name}" (${result.id}) for:`);
for (const domain of result.self_hosted_domains ?? []) console.log(`  ${domain}`);

// Check: the icon must now come back as an image, and the API must still refuse.
const icon = await fetch(`https://${hostname}/apple-touch-icon.png`, { redirect: "manual" });
const api = await fetch(`https://${hostname}/api/health`, { redirect: "manual" });
console.log(`icon: ${icon.status} ${icon.headers.get("content-type")}`);
console.log(`api:  ${api.status} (must not be 200)`);
