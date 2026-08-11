# Hosting SAYings yourself

You will end up with a Worker on your own Cloudflare account, a D1 database only you can read, an
R2 bucket holding nightly backups, and sign-in restricted to the email addresses you name. Running
cost is $0 on the free tiers for a household of two, or $5/month on Workers Paid if you plan to
import years of history in one go (see [Importing a lot of history](#importing-a-lot-of-history)).

Nothing here reports back to anyone. There is no account to create with us, because there is no us.

---

## 1. Deploy

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/yelbaiev/sayings)

The button clones this repository into your own GitHub or GitLab account, creates the D1 database
and R2 bucket, writes their ids into your copy's `wrangler.jsonc`, applies the database migrations,
and deploys. It also wires up Workers Builds, so from then on every push to your production branch
deploys automatically.

<details>
<summary>Or set it up by hand</summary>

```sh
git clone https://github.com/yelbaiev/sayings && cd sayings
npm install
npx wrangler login

npx wrangler d1 create sayings          # copy the database_id into wrangler.jsonc
npx wrangler r2 bucket create sayings-files
npm run deploy                          # migrates, builds, deploys
```

When `wrangler r2 bucket create` offers to add a binding called `sayings_files`, decline —
`wrangler.jsonc` already binds the bucket as `FILES`, which is what the code uses.
</details>

**Open the URL now.** You will get a setup screen, not the app. That is correct: there is no
authentication yet, and the app will not pretend otherwise.

## 2. Claim it

Open your Worker's URL. A fresh deployment shows one screen: **"Claim this installation"**. Enter
your name and create a passkey — FaceID, TouchID, or your device unlock. That makes you the owner.
There is no password and no email anywhere in this flow.

**Do this right after deploying.** Until claimed, anyone who knows the URL could claim it — the
window is the minutes between the deploy finishing and you opening the page, and what it exposes is
an empty database, but there is no reason to leave the door open. A deployment with members refuses
claiming permanently.

Invite your household from **Settings → Invite a person**: it creates a one-time link valid 48
hours. Send it over whatever messenger you already use; the person opens it, picks a name, creates
their own passkey. Links die on first use.

**Lost all devices?** Any remaining member can invite you back. If *every* passkey is gone, reset
the credentials and re-claim:

```sh
npx wrangler d1 execute DB --remote --command \
  "DELETE FROM credentials; DELETE FROM auth_sessions; DELETE FROM members"
```

Your transactions are untouched — members and logins are separate from the ledger. Re-claim, and
attribution initials for old entries will show the previous member colours until re-created.

### Optional hardening: Cloudflare Access

Passkeys are the front door; you can additionally put Cloudflare Access in front of the whole
Worker (Zero Trust → Access → add the application, `Emails` selector, set the AUD/team values in
`wrangler.jsonc` vars). The Worker accepts either a passkey session or an Access JWT. Worth it if
you want the app invisible to the internet entirely; unnecessary otherwise.

## 3. Check it

```sh
# Must be a refusal, not a 200. The API must never answer an unauthenticated request.
curl -i https://<your-worker>.workers.dev/api/health
```

Then open the app in a private window: Access should ask for a code, and after signing in the app
loads. Add it to your phone's home screen — on iOS this matters more than it looks, because Safari
evicts IndexedDB for sites that are not installed. Nothing is lost if it happens (the server is
authoritative) but you would pay for a full re-sync.

### Preview URLs are a second door

If you use preview URLs or non-production branches, note they run the same Worker code against the
**same production D1 and R2 bindings**, and they get their **own** Access application with its own
AUD tag. Two consequences:

- That policy is part of your security boundary, not a dev convenience. Restrict it.
- The Worker validates the production AUD only, so requests arriving through a preview URL fail JWT
  verification even after a successful sign-in. Fine for a dev surface; if you want previews to
  work end to end they need their own deployment and AUD.

## 4. Rates and the first backup

The nightly cron (00:30 UTC) refreshes FX rates, re-prices anything saved offline without a rate,
snapshots the household to R2, and checks for a new release. To avoid waiting a day:

```sh
# Backfill exchange rates. Needs an authenticated browser session, so run it from the app's
# Settings → Data, or curl it with your Access cookie.
curl -X POST https://<your-worker>.workers.dev/api/fx/backfill

# Force the first backup and confirm it landed.
curl -X POST https://<your-worker>.workers.dev/api/backups/run
curl https://<your-worker>.workers.dev/api/backups/latest
```

Settings shows the last successful backup date. Given why this project exists, that is arguably the
most important string in the app.

---

## Keeping your configuration out of a public fork

If you forked this repository, your fork is probably public too — and your `wrangler.jsonc` now holds
your Access team domain, your audience tag and your database id. None of those are credentials, but
together they tell anyone exactly where to point a convincing sign-in page.

```sh
git config core.hooksPath scripts/hooks
```

That installs a pre-push hook which refuses to push those values. Do it before your first push, not
after: a branch pushed once stays readable by commit hash even after the branch is deleted.

The arrangement it supports: keep your real config on a local branch, do development on `main`, and
merge `main` into that branch to deploy. Never the other direction.

## Updating

Your deployment is yours, and no version is supported or unsupported — nothing is switched off
behind you, ever. Update when a release looks worth having.

Settings tells you when a newer release exists. It checks GitHub once a night from your own Worker;
set `UPDATE_CHECK: "off"` in `wrangler.jsonc` if you would rather it did not.

```sh
git pull upstream main    # or merge the upstream release in GitHub's UI
npm install
npm run deploy
```

Or, if you deployed with the button: merge upstream into your production branch and Workers Builds
does the rest.

### Why this is safe from any version to any version

`npm run deploy` runs three things in this order, and the order is the whole point:

```
npm run db:backup   →  npm run db:migrate  →  build + deploy
```

1. **A snapshot first.** `db:backup` exports the entire database to a timestamped `.sql` file and
   uploads it to R2 before anything is altered. You do not have to remember to do this.
2. **Then migrations, in sequence.** D1 records every applied migration in a `d1_migrations` table
   and applies only the missing ones, in order. Jumping from v1 straight to v5 therefore runs
   `0002, 0003, 0004, 0005` one after another — the same path a deployment that upgraded every time
   would have taken. Migrations here are forward-only and additive by rule
   (`docs/decisions/0004-forward-only-migrations.md`), and CI proves on every commit that the whole
   sequence applies cleanly to an empty database.
3. **Then the code.** If you somehow deploy code without applying migrations, the Worker notices
   that the database is behind and returns a clear error naming the command to run, instead of
   failing on whichever query first touches a column that does not exist.

### If an update goes wrong

```sh
npm run db:restore -- backups/pre-deploy-<timestamp>.sql
```

`db:backup` leaves the dump in `backups/` on the machine that ran the deploy, and also uploads it to
`r2://<your-bucket>/backups/pre-deploy/`. If the deploy ran in CI, only the R2 copy survives — fetch
it from the dashboard or with `wrangler r2 object get`.

Restore accepts either a `.sql` dump from `db:backup` or one of the nightly JSON snapshots. Then
check out the previous tag and deploy it. The restore path is exercised in CI
(`tests/worker/backup.test.ts`) by wiping a database, restoring it, and confirming the reports
reproduce the original figures — an untested backup is not a backup.

## Importing a lot of history

D1's free tier allows 100,000 rows written per day, and each index counts as a written row. A
one-shot import of ~35,000 transactions across four indexes is roughly 175,000 writes — over the
cap. Either split the import across two days, or take Workers Paid ($5/month) for the day you do
it. For an app holding a household's finances, a daily hard cap is the wrong thing to be gambling
on; day-to-day use is nowhere near these numbers.

## Getting your data out

Settings → Data → **Export everything** downloads one JSON bundle plus a CSV per table, generated
entirely on your device from the local mirror. It works offline, and it works even if the Worker is
gone. That is deliberate: the exit is not a feature you have to ask anyone to enable.
