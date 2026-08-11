# Changelog

## Version 1.0.0

First public release. Household finance for two people, running entirely on your own Cloudflare
account — no service behind it, no account to create, no telemetry.

- Added: accounts in their own currencies, with transactions, categories, budgets and recurring
  entries. Money is stored in integer minor units at each currency's real ISO 4217 precision
- Added: 43 reporting currencies, rated from the National Bank of Ukraine and the European Central
  Bank and cross-rated through their shared pivot when neither quotes a pair directly. Every
  transaction keeps the rate it was priced at, on its own date, and that rate is editable — a hand
  corrected rate is frozen and never overwritten
- Added: offline-first by design — the whole dataset is mirrored into IndexedDB on every device and
  every report is computed locally, so the app works with no network and syncs when there is one
- Added: reports over any period, per category and per household member, plus a one-tap full export
  in JSON and CSV that needs no server
- Added: receipt photos, and a nightly database backup to your own R2 bucket with a tested restore
  path — 30 daily and 12 monthly snapshots
- Added: authentication through Cloudflare Access, with passkeys and a one-time link for inviting a
  partner. The app refuses to serve itself until an Access policy exists
- Added: English, Ukrainian and Russian throughout, including the built-in category names, which
  follow the interface language while renamed and hand-made categories stay as you wrote them
- Added: installable as a PWA, with pull-to-sync, privacy mode for blurring amounts on screen, an
  intro tour, and an importer for bringing in existing history

Pre-1.0 development history is archived in
[docs/CHANGELOG-prerelease.md](docs/CHANGELOG-prerelease.md).
