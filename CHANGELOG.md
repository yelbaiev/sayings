# Changelog

## Version 1.2.0

- Added: expenses by category and income by category, as two reports rather than one list. A donut
  with the month's total in the middle, a strip of nine months to move between periods, and the
  ranked list that was already there
- Fixed: the month's category list mixed income in with spending and took every share against total
  expenses, so a salary appeared among the spending categories at "226% of expenses"
- Changed: the donut draws the six largest categories and folds the rest into one slice. Past the
  sixth the arcs are too thin to point at and too close in colour to tell apart; the list beneath is
  where the tail is read

## Version 1.1.5

- Fixed: holding anything in the app no longer starts a text selection or raises the copy callout
  over what is underneath. Long press means something in six places here, and the two were
  competing app-wide — on the chart's month names, on list rows, on headings. What you type stays
  selectable, and so does the version number in settings
- Changed: the cashflow figures now lead the card at full size, coloured by direction, with what
  came in and what went out beneath them. They were set in the same small grey as an axis label —
  the chart's whole answer, ranked below the legend

## Version 1.1.4

- Changed: the net-worth line is a smooth curve with a fading wash beneath it, and the scrub cursor
  glides between months instead of jumping. Readings stay snapped to real months — a monthly series
  holds no figure for the 12th of April, and putting an invented one under a finger would be the
  chart making numbers up
- Added: the change since the start of the range, beside the month being read

## Version 1.1.3

- Added: slide a finger along either chart and the figures follow it. The pointer is captured on
  the way down, so a finger that slides past the edge keeps reading instead of stopping there
- Added: the charts now show what they are reading — a crosshair and a marker on the net-worth
  curve, a highlighted month behind the cashflow columns. Before, only the text above moved
- Added: arrow keys walk the series, and Home and End jump to its ends
- Fixed: the cashflow figures appeared only while touched, so the plot jumped 16px away from the
  finger aiming at it. They are always shown, defaulting to the latest month

## Version 1.1.2

- Fixed: net worth counted only the accounts held in the household's base currency. Every euro and
  dollar account was computed, held, and then dropped from the total — a household keeping half its
  savings in euro saw half its money. Every currency is now converted at today's rate and included,
  and a currency with no rate is named on screen instead of being quietly counted as base
- Fixed: the per-account cashflow rows printed each card's own figures with the base currency's
  symbol, so a euro card's €500 of inflow read as ₴500

## Version 1.1.1

- Added: an income-against-expense chart on the cashflow tab — a column above the line for what came
  in each month and one below it for what went out, on a shared scale
- Fixed: the net-worth chart never blurred in privacy mode. The figure above it did, so the screen
  could be shown to someone with the number hidden and the shape of the household's savings drawn
  in full
- Fixed: the net-worth line was scaled from a floor of zero, which flattened it into a line along
  the top of an empty box, and stretched non-uniformly, which thickened its stroke with the
  container. It now scales to the data and keeps its own weight
- Added: the latest figure is back above the net-worth line, and touching any month reads that
  month out instead
- Added: both charts have a table behind a toggle, so no value is reachable only by touching

## Version 1.1.0

- Added: the keypad now serves every field that takes an amount — budget limits, opening balances,
  recurring amounts, quick tiles, split lines and the second leg of a cross-currency transfer. All
  six took money through a plain text box before, with no arithmetic and no grouping
- Added: hold ⌫ to clear the amount. Wiping a mistyped figure cost one press per digit
- Added: a running balance down the history, showing what the card held after each transaction.
  Only with one account chosen and nothing else narrowing the list — under a search the figures
  stay true but stop adding up between neighbouring rows, which reads as broken
- Added: "Repeat last" as a tile on the home screen. It has always worked as a long press on the
  add button, which nobody could find
- Removed: 23 unused interface strings in all three languages

## Version 1.0.6

- Added: every button, chip, tab and tappable row in the app now flashes when pressed, the way the
  keypad keys already did. `:active` only lasts as long as the finger is down, which on a quick tap
  is no feedback at all
- Removed: the haptic feedback. iOS gives a web page no route to one — no Vibration API in WebKit,
  and Core Haptics is native-only — and the hidden-switch workaround did nothing on the phone this
  is used from. It was tried, measured and taken out rather than left in doing nothing

## Version 1.0.5

- Changed: the iOS haptic fallback fires through a label rather than clicking the hidden switch
  directly — the path a real tap takes, and the one least likely to be dismissed as programmatic
- Changed: the Android vibration pulse is 15ms, since some phones round shorter ones away

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
