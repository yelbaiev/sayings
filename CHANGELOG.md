# Changelog

## Version 1.4.7

- Added: Settings → Reminders. Turn on "Due payments" and the SAYings icon shows how many of your regular payments are due. iPhone asks once for permission to show notifications, which the count needs; it updates each time you open the app. Each phone is switched on separately

## Version 1.4.6

- Added: long-press shortcuts on the app icon — Add expense, Add income, History. They show on Android and in desktop Chrome or Edge; iPhone doesn't offer them for home-screen web apps yet, and they'll appear there if Apple adds support
- Added: links that open the app straight into a new entry — `/?add=expense`, `/?add=income`, `/?add=transfer`

## Version 1.4.5

- Fixed: a rollover budget counted the oldest three years of history instead of the most recent three, so the carried-over amount could be badly off — even the wrong sign
- Fixed: merging categories left recurring payments and budgets on the old, archived category; they now move too (if both had a budget for the same period, the target's is kept)
- Changed: Export now downloads one zip instead of up to nine files — phones kept only the first of them
- Fixed: exported CSV files showed Cyrillic names and notes as gibberish in Excel
- Fixed: the hint under an account's currency was in English only
- Fixed: amounts in yen were shown with ".00", and Tunisian dinar lost its third decimal

## Version 1.4.4

- Fixed: a household member could make themselves the owner, or remove the owner, by sending a changed member record through sync. Each member can now change only their own name, language and default account
- Fixed: opening one invite link twice at the same moment could create two members; an invite now creates exactly one

## Version 1.4.3

- Fixed: a nightly backup restored onto a fresh database left nobody able to sign in, reset the main currency to hryvnia, read every exchange rate as hryvnia-based, and stopped phones receiving new changes. Backups now carry passkeys (public keys only), the main currency and currency list, full exchange rates, the app's settings and the sync counter
- Fixed: after a restore, phones kept their cached data instead of the restored state; every restored row now syncs down again
- Fixed: `npm run db:restore` used the blank template config instead of this installation's, so restoring to the live database could not run
- Changed: a restore signs everyone out (sessions and pending invites are cleared, not revived), and restoring an older backup prints what it couldn't bring back

## Version 1.4.2

- Fixed: amounts in currencies without decimals (Japanese yen, Korean won, Icelandic króna, Vietnamese dong) were converted 100× too small, and Tunisian dinar 10× too large, in totals, reports and budgets
- Fixed: existing entries in those currencies are corrected automatically on update, and the corrected figures sync to every phone
- Fixed: the second-currency figure beside totals had the same problem for those currencies

## Version 1.4.1

- Fixed: changing the main currency on a long history could price later entries at a rate years out of date, and they were never corrected; every rate is now converted before any entry is re-priced
- Fixed: budgets weren't converted when the main currency changed, so a ₴20 000 limit became €20 000; they now convert at the latest rate
- Fixed: a main-currency change could stop making progress when the new currency had no published rate on many past dates
- Changed: while a main-currency change runs, it says "Converting exchange rates…" before it starts counting entries

## Version 1.4.0

- Fixed: when an entry saved offline got its real exchange rate overnight, the corrected figure stayed on the server and never reached the phones — and the next edit on a phone put the estimate back
- Fixed: every new entry was recorded as priced in hryvnia whatever the main currency was, so a later change of main currency could skip converting it
- Fixed: the overnight rate correction could pick a rate quoted in another currency while a main-currency change was still in progress

## Version 1.3.9

- Fixed: a phone catching up on more than 2,000 changes in one table (a new phone, a reset, a big import) received the first 2,000 and silently never got the rest
- Fixed: a page of changes could stop partway through rows saved together — the Saldo import wrote 611 at once — and skip the remainder
- Fixed: two phones syncing at the same moment could leave a change below the point the other had already caught up to, so it never arrived there

## Version 1.3.8

- Fixed: a transfer could be saved with the same account on both sides by changing "From" after picking "To", and that entry then stopped the phone from syncing at all
- Fixed: splitting the other person's transaction credited every line to whoever split it; splits also ignored a rate you had corrected by hand
- Fixed: "Make recurring" didn't record who the new schedule belongs to
- Fixed: repeat-last kept the original's author and its old exchange rate; it's now your entry at today's rate
- Fixed: Duplicate kept the original day's exchange rate and joined the copy to the original's split
- Fixed: with one card chosen in History, the balance column ran in a different order from the rows on a busy day, so it didn't subtract down; it also showed an incoming transfer's balance in the wrong currency
- Fixed: "Change category" on a selection offers only categories of the selected rows' kind and leaves transfers alone, so income can no longer end up under an expense category
- Fixed: a recurring payment is always in its account's currency — it used to default to hryvnia, so a 400 subscription on a dollar card took $400 off it
- Changed: recurring payments take a "Next payment" date instead of a day of the month, so a new one isn't asked for a month late, a yearly one can be set to its real month, and moving the day applies from the next payment
- Fixed: double-tapping "Add now" on a recurring payment posted it twice

## Version 1.3.7

- Fixed: in Reports → By member, tapping a person opened every transaction they had ever entered, transfers included. It now lists exactly what their row counts: the report's period, without transfers

## Version 1.3.6

- Changed: the Reports table shows the newest month or year first, so the period you're asking about is on screen without scrolling sideways
- Changed: the totals row in the Reports table sits at the top, right under the header
- Fixed: the Reports table header scrolled away with the page; the header, the totals row and the category column now stay in place while you scroll
- Added: transaction rows on Home and in a report's tap-through list show the date — History still groups by day headings instead
- Fixed: the initial of whoever entered a transaction now sits on the row's right edge, under the amount
- Changed: each recurring payment is shown only to the person who set it up, in Regular payments and in the "due" prompt on Home. Existing schedules go to whoever last posted or skipped them
- Added: "All expenses" and "All income" in History's category filter
- Fixed: the Member filter in History and the per-member report's list matched whoever last edited a transaction instead of who entered it

## Version 1.3.5

- Fixed: a TypeScript build cache file was committed by mistake in 1.3.4; it is removed and now ignored

## Version 1.3.4

- Changed: the last traces of the old sayFinance name in code, config examples and docs now say SAYings. Nothing you see in the app changes, and your data stays where it is (the on-device store keeps its original name on purpose)

## Version 1.3.3

- Added: swipe a row in Regular payments to delete the schedule, with an undo in the toast. Deleting
  was only possible from inside the editor, behind a hold at the bottom of a form you had no other
  reason to open — so pausing looked like the only way to stop a subscription

## Version 1.3.2

- Fixed: the toast at the bottom of the screen was a white pill on the dark theme — an inverted
  Material snackbar, brighter than anything else on the screen and reading as a system alert. It now
  sits on the same raised surface as the date picker and the keypad

## Version 1.3.1

- Added: a second currency in Settings. Every total is then repeated in it — `463 967 ₴ ≈ 10 310 €`
  — on the home screen, net worth, the month's result and the category donut
- The second currency changes nothing but what is drawn: no transaction is re-priced and nothing is
  stored differently, unlike the reporting currency above it. It is per device, like the theme, and
  a currency with no rate held shows nothing rather than a figure converted at 1:1

## Version 1.3.0

- Added: a calendar of the app's own for picking a date on a desktop. The hidden native input gave
  whatever the browser felt like — a light popup over a dark app, a different layout per browser,
  and in Safari often nothing at all, because the picker hangs off the icon we had hidden. A phone
  keeps the native wheel, which is better than anything worth building
- Changed: dropdowns wear the app's field instead of the operating system's. Sharing a border and a
  height was never enough while the browser still drew its own control on top, complete with macOS
  stepper chevrons in a font nothing else here uses
- Added: the calendar walks with the arrow keys, refuses days in the future, and names each day by
  its full date rather than the number on its face

## Version 1.2.2

- Removed: the last 11 unused interface strings, describing an onboarding wizard and an import
  column-mapper that were specified and never built. Every string in all three languages is now
  one the app actually shows

## Version 1.2.1

- Added: a six-month sparkline in each category row. "+18%" is one comparison against one month;
  the line says whether that is a spike or the fourth month of a climb
- Changed: large standalone figures no longer use equal-width digits, which made them read loose.
  Lists, tables and the keypad keep them, because that is where numbers line up in a column
- Changed: the category rows drop the word "change" beside the percentage — the line next to it
  already says which way, and the three together pushed the row into truncating

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
