# Changelog

## Version 1.0.4

- Added: filtering history to one account now shows that card's current balance beside its name.
  The figure is the card's real balance, not the total of the rows in view

## Version 1.0.3

- Changed: tapping the amount clears the placeholder `0` and waits, so the first digit typed is
  the first thing in the field rather than a replacement for a number that was never entered

## Version 1.0.2

- Added: keys answer the press. Each one flashes as it fires, and asks the phone for a short haptic
  tick where the platform allows one
- Changed: keys register on the way down rather than on the lift, so a fast run of digits does not
  lose the press that slid a few pixels off its key
- Fixed: long-pressing a key selected its glyph and raised the text-selection callout over the pad
- Changed: two quick presses on the same key are "00" rather than a request to zoom

## Version 1.0.1

- Changed: the amount field now shows what you type instead of what it adds up to. `120 + 45 + 90`
  stays on screen as `120 + 45 + 90`, and the result appears when you press `=` — the way a
  calculator behaves
- Fixed: the decimal key did nothing visible until a second fraction digit arrived. `45`, `45,`,
  `45,4` and `45,40` are now four different displays, so every press moves the figure
- Fixed: typing a new amount straight after `=` kept only the last digit — `=53` entered 53 as 3
- Added: `=` and `÷` on a hardware keyboard, matching the keys the pad already has
- Changed: the decimal key does nothing in currencies with no minor unit, instead of accepting a
  separator and then refusing every digit after it

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
