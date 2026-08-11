# Pre-release development history

Everything below predates the first public release. Version numbers here are development
numbering and do not correspond to any published release — the project restarted at 1.0.0 when it
went public. Kept because the reasoning behind a decision is often only recorded in the entry that
announced it.

For released versions, see [CHANGELOG.md](../CHANGELOG.md).

## Version 1.11.1

- Changed: the intro tour caught up with the app — categories hold still instead of "reordering themselves", currencies are "any, with your base" instead of a fixed three, and a new panel explains inviting a partner by a one-time link. All three languages

## Version 1.11.0

- Added: the built-in categories follow the interface language — switch to English or Ukrainian and the picker, history and reports switch with it. Renamed and hand-made categories stay exactly as you wrote them
- Added: privacy mode — the eye in the header blurs balances, amounts and notes for screen recording, and puts them back with a second tap
- Changed: adding via long-press repeat, a quick tile or the recurring prompt no longer pops a bubble over the tab bar — the new row appearing in the list is the confirmation

## Version 1.10.9

- Fixed: scrolling the reports table sideways no longer shows month headers and their borders bleeding through the pinned corner cell

## Version 1.10.8

- Added: pull down from the top of any screen to sync now. The arrow winds up as you pull, spins while syncing, and slides away when the data is current — no more tab-hopping to force a refresh

## Version 1.10.7

- Removed: the Components gallery (/design) and its link in Settings. It was scaffolding for the design-system migration, which is finished

## Version 1.10.6

- Changed: categories in the picker keep a fixed order — the seeded one — instead of reshuffling by usage. Every category is on the sheet anyway, so a tile that stays put beats a tile that is sometimes first
- Fixed: adding a transaction while the history is filtered to one account reliably preselects that account again. The filter now lives only in the URL, so the visible list and the preselected account can no longer disagree

## Version 1.10.5

- Fixed: a transaction stays attributed to whoever recorded it. Editing someone else's entry — fixing a typo, changing a category — no longer repaints it as yours, in the list initials and in the per-member report alike. Existing rows keep their best available guess (the last editor)
- Changed: the undo toast is retired. Deletion already demands a deliberate hold, and a saved transaction is reversible by nature; the sheet closing and the row appearing are the confirmation. Quick tiles and recurring keep a short message — there a tap has no other visible result

## Version 1.10.4

- Changed: the top hairline is gone from every sheet, not only the full-screen one — the scrim, rounded corners and grabber already mark where a sheet begins

## Version 1.10.3

- Fixed: the bright hairline across the top of the full-screen transaction form is gone — it was the drawer's top border sitting under the status bar with nothing left to separate

## Version 1.10.2

- Fixed: the sheet's bottom controls — the save bar, the keypad — sat flush against the screen edge, and the phone's rounded corners clipped their ends. Every sheet now respects the bottom safe area

## Version 1.10.1

- Added: the sign-in screens. A fresh deployment shows "Claim this installation" — name plus a passkey, and you are the owner. Settings gains "Invite a person" (one-time 48-hour link, shared over any messenger) and "Sign out on this device"; invited people open the link, pick a name and create their own passkey
- Changed: the Zero Trust setup walkthrough is gone from the app — Access is optional hardening now, documented as such. SELF-HOSTING covers claiming, inviting, and the one-line reset if every device is lost

## Version 1.10.0

- Added: the server half of passkey sign-in. A fresh deployment can be claimed by its first visitor registering a passkey (FaceID/TouchID); further people join through one-time invite links from the owner; sessions are httpOnly cookies. No email is sent or verified anywhere, and Cloudflare Access becomes optional hardening rather than a requirement — the step that made Deploy-to-Cloudflare a manual walkthrough
- Note: existing installations are untouched — claiming refuses any household that already has members, and Access keeps working exactly as before. The sign-in screens land in the next release

## Version 1.9.6

- Fixed: the transaction form now genuinely opens edge-to-edge. The drawer's stock styling capped it at 80% of the screen with a top margin, and the full-screen classes were losing to it — visible as the page peeking above the sheet

## Version 1.9.5

- Fixed: focusing a text field inside a sheet — the quick-tile name, the transaction note — threw the whole sheet to the top of the screen and left a void beneath. The drawer now stays put and the browser scrolls the focused field into view instead
- Fixed: the decimal comma appears the moment it is typed, spliced in after the digits — it used to stay invisible until a fraction digit arrived, so the key looked dead
- Fixed: the history no longer jerks when the filters hide on scroll — they fade in place instead of collapsing their height, so the list never moves under a finger
- Changed: the transaction form always opens full screen, so nothing on it ever needs scrolling — the keypad, the category row and the note are all reachable at once

## Version 1.9.4

- Changed: the design-system migration is complete. The legacy stylesheets (2,500 lines at their peak) are gone; everything runs on the shadcn theme, with one small component file for the keypad grid, the reports matrix and the collapsing filters — the three constructs that are genuinely better as CSS
- Changed: the app chrome — tab bar, sidebar, top bar, sync pill — and the remaining internals (amounts, icon chips, avatars, toast, progress, swipe actions) are on theme utilities
- Changed: the /design gallery now shows the shadcn-era system: surfaces, semantic colours, button and hold-button states, chips, amounts, fields, progress including over-budget
- Note: one deliberate deviation from stock shadcn — the toast stays custom instead of Sonner; this app shows one toast with one undo, and stacking machinery buys nothing

## Version 1.9.3

- Changed: every sheet and dialog now runs on the shadcn primitives — vaul drawer on the phone, Radix dialog on desktop — behind the same wrapper. Drag-to-dismiss physics, the focus trap and the scroll lock come from the primitives; ~120 lines of hand-rolled gesture code retire, along with the sheet's legacy styles
- Note: if anything regresses around the keyboard inside the entry sheet, roll back with `npx wrangler rollback` — and report it, the fallback plan keeps the custom sheet for entry only

## Version 1.9.2

- Changed: deleting — a transaction, a quick tile, a budget, a schedule — now requires holding the button while it visibly fills (~1s). A tap does nothing except show the hint, so an accidental deletion cannot happen; the undo toast stays as the second safety net. Keyboard users get an explicit press-twice confirm instead

## Version 1.9.1

- Changed: the EUR badge beside the amount field is gone — the € symbol inside the amount already says it, and the amount field takes the full width back

## Version 1.9.0

- Fixed: editing a transaction overlapped "Сохранить" with "Сделать регулярной" on the action bar. Actions on the saved row — make recurring, delete — now live together at the end of the form; the bar keeps only what belongs to the entry being typed: photo, split, save

## Version 1.8.9

- Fixed: with a sheet open — the entry form, or a drill-down on Reports — the page underneath kept scrolling on iOS, which also read as "scrolling past the end into dark emptiness" behind the scrim. The scroll lock now pins the page the way iOS honours, and nested sheets balance correctly
- Fixed: the history lost its row separators after the redesign, and rows came up a pixel short of the virtualiser's estimate — the mid-scroll corrections were the visible jerks. Separators are back and the estimates match the real heights

## Version 1.8.8

- Changed: the transaction entry screen is on the shadcn design — amount block, form rows, category and account pickers, split editor, rate editor, receipt controls, intro tour and install banner
- Fixed: filling a split line with "the rest" divided by 100 regardless of currency — the third specimen of this bug family, in a yen split it would have written a hundredth of the remainder
- Changed: not a single raw button remains; the ratchet is now pinned at zero. Inline styles down to 15, all genuinely dynamic

## Version 1.8.7

- Changed: History, Accounts, Categories and CSV import are on the shadcn design — transaction rows, day headings, filters, the reorder arrows, icon/colour pickers and the import mapper
- Fixed: editing an account showed its opening balance divided by 100 regardless of currency — a yen account would have displayed a hundredth of its balance. The invariant that hunts this pattern had a blind spot for `_minor` suffixes, now closed
- Changed: ratchets tightened — raw button markup 14 → 7, inline styles 49 → 28

## Version 1.8.6

- Changed: Home, quick tiles, Reports, Budgets and Recurring are on the shadcn design — summary cards, account strip, month steppers, budget cards and the schedules list all in the new look. The reports matrix keeps its dedicated table styling
- Changed: raw button markup on these screens replaced with the Button primitive (ratchet 31 → 14); inline styles halved (100 → 49)

## Version 1.8.5

- Changed: Settings, first-run currency setup, the base-change sheet and the Access setup screen are fully on the shadcn design — the first complete screens of the sweep
- Changed: the currency chooser grid and setup-screen styles moved from the legacy stylesheet to utilities; the legacy file shrinks as screens convert

## Version 1.8.4

- Fixed: releases 1.8.1–1.8.3 looked as though nothing had changed — because visually nothing had. The legacy stylesheet's element resets are unlayered, and an unlayered `button { background: none }` beats any layered utility regardless of specificity, so every shadcn control shipped with no fill and no border. The legacy styles now live in a named cascade layer between preflight and the new components, so the new design actually renders
- Fixed: the legacy blue accent (FAB, active tab) would have been repainted as a near-invisible grey by the coexisting theme; the shadcn accent variable is namespaced until the old tokens retire

## Version 1.8.3

- Changed: the layout helpers (Stack/Cluster/Spread) now emit Tailwind utilities while keeping their typed gap scale — an off-scale spacing value still cannot be expressed
- Added: a one-way ratchet on inline styles — the count may only fall as screens migrate

## Version 1.8.2

- Changed: form controls take the shadcn look — fields, chips, the segmented switch, empty states. Chips and the segmented switch now sit on Radix primitives, so the segmented control gains arrow-key navigation and chips get their pressed state from the platform rather than by hand
- Changed: every control keeps the 44px tap floor — shadcn's stock desktop heights are overridden in the vendored components

## Version 1.8.1

- Changed: buttons take the shadcn look — the first visible step of the design-system migration. Every size keeps the 44px tap floor, and the destructive style stays red-text-on-tinted-border, never a red fill
- Changed: chrome icons come from lucide (the shadcn icon set); same 2px-stroke visual language, near-identical shapes. Emoji for categories and accounts are untouched
- Note: until the per-screen sweep lands, a few older screens still show the previous button style beside the new one

## Version 1.8.0

- Changed: the design system is migrating to shadcn/ui (Tailwind v4, zinc palette, vendored components). This release lays the rails — theme, dark mode keyed to the existing setting, tooling — with no visible change yet; the look shifts screen by screen over the next releases
- Added: the colour palette is now closed — a colour outside the theme is a class that will not compile, rather than a review finding

## Version 1.7.2

- Fixed: "Reload the app" left a black screen that could only be escaped by force-quitting. It deleted the cached app files while the service worker was still serving the page, so the reload's own navigation went looking for a copy of the app that had just been removed. Clearing now happens on the next boot, once nothing is serving from those caches
- Changed: with the keypad open the entry sheet takes the whole screen and tightens its spacing, so the form and the keypad fit without one covering the other

## Version 1.7.1

- Changed: the account, category and exchange-rate pickers now open as sheets over the form instead of expanding inside it. The form has one height, so the keypad cannot push a field out of view — which is what left the date and the note unreachable
- Changed: the category picker shows every category with a search, instead of the seven that happened to fit inline
- Changed: keypad digits ascend from the top like every other keypad on a phone, operators run down the left, and `=` is a tall key on the right
- Added: division on the keypad, for splitting a bill, and `=` to settle an expression
- Changed: the Expense/Income/Transfer switch moved into the sheet header, where it replaces a heading that said the same thing — a row saved on a form that has to fit above the keypad
- Changed: one Save button on a bar above the keypad, present whether or not the keypad is open. There used to be two, and which one existed depended on the keypad
- Changed: Delete moved off that bar, away from the button the thumb reaches for to commit
- Fixed: on a transfer the destination row could not be collapsed once opened
- Fixed: the form opened with the category grid expanded, so the first tap on the amount made the screen jump
- Fixed: the receipt control was laid out as a block inside a row of buttons

## Version 1.7.0

- Changed: the transaction form is now one field per row, in the order you fill it in — type, amount, date, account, category, note — so the whole form is visible while the keypad is up. Before this the category grid sat in the middle and the keypad buried the date and the note with no way to dismiss it, so transactions were being saved having never shown those fields
- Changed: one field opens at a time, and opening one puts the keypad away. Choosing a category closes it, which brings the rest of the form back into view
- Changed: a field with nothing chosen still shows its name, so the form does not change shape as it is filled in
- Fixed: the Expense/Income/Transfer switch announced itself as "Amount" to a screen reader

## Version 1.6.2

- Changed: on a foreign-currency transaction the converted amount now sits above the figure you were charged, with the currency code beside it — the unit you reason in is read first
- Changed: the exchange rate is behind a tap on that converted figure instead of a permanent field. It still appears unasked when no rate was published for the date
- Changed: the account and destination are labelled rows with an icon rather than bare chips, so a transfer says which of the two accounts you are looking at

## Version 1.6.1

- Fixed: the app showed a blank screen after 1.6.0. The Worker had been deployed straight from source rather than from the vite build, so `__EXPECTED_MIGRATION__` survived as a bare identifier and every API request threw — the client read the resulting error page as a sign-in redirect and waited forever
- Added: a deploy now refuses to ship a Worker bundle that vite did not build, or a client bundle that does not carry the current version

## Version 1.6.0

- Added: pick the currency you report in, from 43 — everything quoted by either the National Bank of Ukraine or the European Central Bank, so anything on offer can be converted
- Added: choose which currencies your household uses; account, recurring and quick-tile pickers offer that set rather than all of them
- Added: two rate sources, chosen per pair rather than per household — the ECB publishes no hryvnia rate, so a euro household holding hryvnia is priced through NBU and the rest through the ECB
- Added: the exchange rate on a foreign-currency transaction is now shown and editable, with the converted amount updating as you type. A rate you correct is frozen on the transaction and never overwritten
- Added: change the reporting currency later — re-prices history at each transaction's own date, after a backup, and leaves account balances untouched
- Added: first-run currency setup, shown only on an installation with nothing recorded
- Fixed: minor units are now each currency's real ISO 4217 precision. The formatter asked for two digits regardless, so a yen amount would have rendered with a decimal point it has no units for and a Tunisian dinar would have lost its third digit
- Fixed: net worth summed only accounts already in the base currency, returning zero for any household not reporting in hryvnia
- Fixed: the reports TSV export divided by 100, writing a hundredth of every amount into a spreadsheet for a household reporting in yen
- Fixed: six amount fields prefilled by dividing by 100 — editing a ¥500 schedule would have shown "5" and saved five yen
- Fixed: the currency, theme, icon and colour pickers gave their whole field label to their first button as its accessible name, leaving the group unnamed to a screen reader
- Changed: no cap on household members. The old limit of four could not tell a household of six from an over-broad Access policy, so it blocked the legitimate case and only delayed the other — your Cloudflare Access policy is the control
- Changed: avatar colours go from 4 to 10 and come from the member id, so the fifth person stops wearing the first person's colour

## Version 1.5.2

- Fixed: the receipt viewer is now the same dialog as everything else. Its dismiss was on the left where
  every other dialog puts it on the right, that dismiss carried a scrim the others do not, the form
  underneath showed through its header, and its image had square corners against a rounded panel. None
  of those were decisions — they were the cost of a second dialog existing, so it was rebuilt on the one
  primitive and every one of them is now inherited.
- Fixed: a downloaded receipt was 797 kB. Now 150–250 kB, from WebP instead of JPEG and a 1280px frame
  instead of 1600. A receipt has to be legible, not beautiful.
- Added: category tiles, chips and list rows now respond to a press. All three were missing it, on the
  most-tapped surfaces in the app — a missing press does not look broken, it just makes everything feel
  slightly dead.
- Added: a consistency test that checks the cross-cutting rules by parsing the stylesheet and the
  components — one dialog, one dismiss, opaque overlays, every control with all of its states, no colour
  or corner outside the token file. It found the three missing press states above and two raw colours
  before anyone looked at a screen.
- Fixed: a duplicated block of dead CSS from the old viewer was overriding the new one.

## Version 1.5.1

- Changed: a receipt opens in an overlay with three icons — close, share, save — instead of a new
  browser tab. A tab left the app, lost the sheet that was open, and had to be dismissed through the
  browser's own gesture, all to look at a photo for two seconds. Share hands the file to the system
  sheet where there is one, since sending a receipt to someone is usually the point; the link itself is
  behind Access and no use to anyone else.
- Changed: the reports table alternates its rows, separates its columns and lights the row under the
  cursor. Reading one value meant tracking a row and a column at once across twelve columns with
  nothing to hold on to. Rows alternate rather than both axes — striping both makes a chequerboard,
  which is harder to read than either alone.
- Note: opening the entry sheet from an account's history already preselected that account. It now has
  five tests covering it, including the currency it implies and the case where the account has since
  been archived, so it stays that way.

## Version 1.5.0

- Added: **receipt photos**. Attach one to any transaction from the entry sheet — on a phone the button
  opens the camera directly. Photos are shrunk on the device before upload: a 4 MB shot becomes about
  300 kB, which matters on mobile data at a till, and iPhone HEIC is converted to JPEG so the receipt
  is viewable on a laptop afterwards. A split gets the same photo on every line, since one receipt
  across several categories is what a split is.
- Added: a small camera marker in the history list, so a receipt can be found without opening every
  transaction.
- Note on a deliberate limit: attaching a photo needs a connection. The transaction still saves
  offline and the photo can be added later. Queueing megabytes of image data through a sync layer built
  for JSON rows, on a device iOS evicts, is not a trade worth making for an optional field.

## Version 1.4.5

- Added: component tests. 24 of them, covering the gap that let several bugs through — a control
  rendered before its data arrived, a handler never connected, an icon button with no accessible name.
- Added: a pre-push guard that refuses to publish an installation's own Cloudflare identifiers, and
  fails closed if the check itself cannot run. Install with
  `git config core.hooksPath scripts/hooks`; see CONTRIBUTING.
- Note on scope, because a test that looks like it covers something is worse than none: the component
  layer runs in jsdom, which has no pointer capture and no layout. It cannot reproduce the bug that
  made the sheet's close button unclickable, and it cannot see two elements overlapping. Gesture
  decisions are pure functions with their own tests; appearance is checked in the gallery.

## Version 1.4.4

- Changed: the component gallery loads on demand instead of shipping with the app. It was 2.6 kB
  gzipped on every cold start for a page a household never opens, and cold start is what the
  three-second entry target is measured against. It is the only route that is code-split — the rest of
  the app is reachable within a few taps, and splitting it would trade a fast first paint for a stall
  on the second screen.
- Fixed: `.dev.vars.example` was excluded by the gitignore rule that hides `.dev.vars.*`, so it would
  never have reached the public repository — and the Deploy to Cloudflare button reads exactly that
  file to know which values to ask a new self-hoster for.
- Changed: the repository slug is filled in, so the Deploy button, the issue templates and the nightly
  release check point somewhere real.

## Version 1.4.3

- Added: **Перезагрузить приложение** in Settings → Ваши данные. Drops the cached app files and the
  service worker, then reloads from the network — for when a release has shipped and the phone is
  still showing the old one. Offline support returns on the next load, because the worker
  re-registers itself.
- Note on what it does not do: your data is untouched, including anything saved offline and not yet
  synced. That lives in the local database alongside the outbox, and nothing here goes near it. The
  button directly above it, "Синхронизировать заново", is the one that rebuilds data from the server.

## Version 1.4.2

- Fixed: things now line up. Four different left edges used to stack down the History screen — a
  section title 2px in, a day heading 4px, a transaction row 12px, a card's contents 16px. The visible
  one was the date sitting to the left of the icons beneath it. The day heading and its rows share one
  inset token, and a section title aligns with the block it labels.
- Fixed: a grid of category tiles in the gallery was set to align on a text baseline, which is not a
  thing a grid can be. One rule had been covering three containers that want three different
  alignments.
- Changed: every spacing value in the stylesheet is now a token. 48 were raw pixels, and 2px, 6px and
  10px recurred — not carelessly, but because a 4/8/12/16/24/32 ramp is too coarse inside a control.
  Fluent has the same fine steps for the same reason and calls them "nudge"; they are named here
  instead of argued with, and a test rejects a raw pixel.
- Fixed: the tab bar's height was written as a literal in the one place a page reserves room for it.

## Version 1.4.1

- Added: a component gallery at **Settings → Компоненты**, or `/design`. Every button variant against
  every state, the elevation ramp, the spacing scale, amounts, icons and fields — with theme and
  language switchers. It exists because the two visual defects in 1.3.9 were both obvious at a glance
  beside their siblings and both shipped anyway, since nothing in the app showed a control's states
  next to each other.
- Added: `Stack`, `Cluster` and `Spread` now take a `gap` that can only be a position on the spacing
  scale. They existed with one fixed gap each, which is why callers reached past them and put raw
  margins on children — 67 of the app's inline styles were spacing, and 6px and 10px had crept in
  against a 4/8/12/16/24/32 scale.
- Added: the linter now flags inline styles in the UI, pointing at the primitive to use instead.
  A warning rather than an error, because a dozen values genuinely are dynamic — a drag offset, a
  measured width — and those are marked as deliberate where they occur.

## Version 1.4.0

Groundwork for a design system, so that functionally identical things look identical. Fluent 2 is
adopted as a specification rather than a dependency — see
`docs/decisions/0005-design-tokens.md` for why its code, and especially its native mobile
libraries, do not fit a self-hosted PWA.

- Changed: design tokens are now two layers. Raw values live in a ramp named by lightness; components
  may only reference the semantic layer above it. A test enforces the boundary — it is the check that
  would have caught last release's keypad bug, where a page-level token was used on a sheet.
- Added: an elevation ramp, encoding the rule that elevation is directional — a raised surface gets
  darker on a light background and lighter on a dark one. That asymmetry is what a single greyscale
  token could not express.
- Added: interaction states as tokens. Hover had been ten separate colour expressions written inside
  individual component rules; there is now one definition of hover, pressed, selected and disabled.
- Fixed: choosing dark mode by hand on a light system left sheets with the light shadow.
  `--shadow-sheet` was missing from one of the two duplicated dark blocks. A test now asserts both
  define the same tokens.
- Added: `Button` and `IconButton` primitives. Every variant defines all its states, which is what a
  hand-assembled set of class names could not. `IconButton` exists because its absence is what made a
  labelled action borrow the 30×26px sort-arrow and print its text over the button above it.
- Fixed: disabled buttons had no defined appearance and fell back to whatever their base rule
  produced.

## Version 1.3.9

- Fixed: the keypad merged into the sheet behind it. Keys used the same token as cards on a page,
  which on the dark sheet made them *darker* than what they sat on by about eight units per channel —
  a different colour on paper, the same one to look at. Elevation is directional: a control recedes on
  a light background and has to rise on a dark one, so it is now its own token rather than a reused
  surface. The keypad also gets a hairline and a shadow, so category tiles scrolling past it clearly
  go behind something.
- Changed: sheets close with an ✕ instead of the word "Закрыть", and the header row is tighter. The
  row was spending the height of a category tile on one word that the primary action at the other end
  of the sheet already implied.
- Changed: the disabled "Ввод" key is an outline rather than a filled grey slab. It spans four rows,
  so a flat fill dominated the pad while saying only "not yet".

## Version 1.3.8

- Fixed: the focus ring on the search box and the filter dropdowns was sliced off. The ring is drawn
  4px outside the control, and the collapsible filter area clipped its overflow — so a control
  sitting flush against that area's edge lost the top or bottom of its outline. The clip region now
  leaves room for it.
- Fixed: a focused transaction row had its ring clipped on both edges, being inside a list and a
  swipe container that both have to clip. Rows draw their ring inwards now, which is the right look
  for a full-width row in any case.

## Version 1.3.7

Two regressions from 1.3.6, both caused by the same line.

- Fixed: transactions could not be opened from History. The swipe row captured the pointer on press,
  and a captured pointer makes the browser dispatch the click to the capturing element instead of the
  row button inside it — the same mechanism that had broken the sheet's close button two versions
  earlier, reintroduced. The capture now happens only once a movement is definitely a swipe, so a tap
  never involves it.
- Fixed: scrolling a list became jerky again. A captured element keeps receiving pointer moves while
  the *browser* is scrolling, so the swipe handler ran on every frame of every scroll and re-rendered
  the row each time. It now also skips the state update entirely when the row has not moved.
- Fixed: a short list could not be held near its end. Collapsing the filters frees about 320px of
  height, and on a page that only scrolls a little that makes the document shorter than the window —
  so the browser forces the scroll back to the top, which makes the page short again, which reveals
  the filters, which makes it scrollable. The chrome no longer collapses when there is less than
  420px to scroll, where it would gain nothing anyway.

## Version 1.3.6

- Fixed: swipe-to-delete was unreliable, and for several reasons at once. The gesture never captured
  the pointer, so a swipe that drifted off the row — most of them, since rows are 60px tall and the
  gesture is horizontal — stopped receiving events and left the row frozen half-open. The row did not
  claim the horizontal axis, so the browser could take it for back-navigation and cancel the swipe
  mid-drag. A diagonal first movement abandoned the swipe permanently, which killed roughly half of
  real swipes on their first event. And release read a displacement that could be a frame behind the
  one on screen, so a fast swipe sometimes did not commit.
- Changed: the swipe decision logic is now a pure module with 17 tests, including the diagonal start,
  swiping towards a side with no action, and a narrow row.
- Added: **Delete** and **Make recurring** inside an open transaction. Both were previously reachable
  only by swiping a list row — no help with a mouse, and no help on a phone once the sheet is open.
  Make recurring creates a monthly schedule on that transaction's day and says where to change it.
- Changed: part-typed arithmetic now shows its working. Entering 120+45 displayed a total of 165 and
  a lone "+" glyph, which told you an operation was pending but not what of; the running total, the
  operator and the term being typed now appear above the amount, as on a calculator.
- Fixed: the add button in the desktop sidebar was nearly as tall as three menu entries. Its base
  rule is a single-column grid, so the icon and label stacked — `justify-content` and `gap` are flex
  properties and did nothing to it. It is one row now, with the same metrics as the nav items.

## Version 1.3.5

- Added: keyboard shortcuts on the web. **N** opens the entry sheet, **E** on expense, **I** on
  income, **T** on transfer. Bound to the physical key rather than the character it produces, so
  they work on a Cyrillic layout too. Shortcuts are ignored while a sheet is open, so a stray letter
  cannot reset a half-filled form.
- Fixed: the sidebar appeared to repeat itself down a scrolled page — eight copies of the navigation
  on a long settings screen. A `backdrop-filter` on a `sticky` element makes the browser skip
  invalidating that region while the page scrolls, leaving the labels painted at every offset they
  had passed. The blur belongs on the floating bar of a phone, not on a solid sidebar with nothing
  passing beneath it.
- Fixed: field hints ran alongside their control instead of underneath it. `Field` renders the hint
  as a `<span>` and it had no `display: block`, so it flowed inline after the select and its top
  margin was ignored — the account hint began to the right of the dropdown and wrapped around it.
- Fixed: the install banner's heading ran straight into its dismiss button, for the same reason —
  a `<strong>` and an inline-flex button sharing a line.
- Changed: the reports matrix uses the full window width. At 1100px the later months fell off the
  right edge of a wide display while three hundred pixels sat empty on either side.
- Changed: account cards wrap into a grid on wide screens rather than scrolling sideways, which had
  been slicing the last card down the middle.
- Changed: a three-option toggle and a hint paragraph no longer stretch to the width of the page.

## Version 1.3.4

A pass over the desktop web experience, which had been built phone-first and left that way.

- Fixed: the close button on every sheet could not be clicked. The header sits inside the
  drag-to-dismiss surface, which captured the pointer on press — and a captured pointer makes the
  browser dispatch the click to the capturing element instead of the button inside it. It went
  unnoticed on a phone because sheets get dismissed by swiping.
- Fixed: dragging the header on a wide screen flung the sheet across the page. The desktop dialog is
  centred with a transform, and the inline drag transform replaced it wholesale, so the first pixel
  of movement moved the sheet half its own width and height. The offset now goes through a custom
  property that each layout folds into its own transform.
- Changed: drag-to-dismiss is a touch gesture only, and the grabber that advertises it no longer
  appears where it does not work. On a computer: Escape, the close button, or the backdrop.
- Added: the amount can be typed on a physical keyboard — digits, both decimal separators, + − ×,
  Backspace, and Enter to save. Entering 1550 on a computer used to mean clicking four keys on an
  on-screen phone dialler.
- Fixed: overlapping text in the Regular payments list. The "Add"/"Skip" buttons reused the 30×26px
  arrow button from the accounts list with a hardcoded width, so a word like "Пропустить" overflowed
  its box and printed over the button above it.
- Added: hover states. The stylesheet had none — every element had only `:active`, which is a touch
  idiom, so on a desktop nothing acknowledged the cursor and the whole interface felt inert.
- Changed: settings, accounts, categories, budgets, recurring and import use a reading-width column
  instead of stretching to 1100px, and a labelled field no longer grows to the width of the page.
- Changed: the add button in the desktop sidebar shows its label and leads the list, rather than
  sitting between History and Reports as a lone glyph in a wide rectangle.
- Changed: the desktop dialog has a border on all four sides and a slightly larger title, and the
  space reserved for the bottom tab bar is reclaimed where the bar is a sidebar.

## Version 1.3.3

- Added: a setup screen. A fresh deployment cannot have Cloudflare Access configured yet — nothing
  can turn on Zero Trust on your behalf — so the app now shows the two remaining steps instead of an
  error. The API refuses every request in that state either way, but "here is what is missing" beats
  "something went wrong" when the difference is whether anyone can sign in.
- Added: the Worker refuses to serve a database that is behind the code, naming the command to run.
  Deploying without applying migrations used to surface as a failure on whichever query first
  touched a missing column, which is the hardest kind of problem to diagnose from the outside.
- Added: `npm run deploy` now takes a full database snapshot and applies migrations before shipping
  anything. Backups are no longer something to remember.
- Added: `npm run db:restore`. Restoring was tested but not actually runnable by anyone; it takes
  either a `.sql` dump or one of the nightly JSON snapshots.
- Added: Settings tells you when a newer release exists. The check runs once a night from your own
  Worker and asks GitHub for the latest tag — nothing is reported anywhere. `UPDATE_CHECK: "off"`
  disables it.
- Added: a four-panel intro on first run, ending in your first transaction. Replayable from
  Settings.
- Fixed: migrations were not safe to retry. A first deploy that failed partway through the initial
  migration would fail again on the table it had already created. All migrations are now idempotent,
  and a test enforces that along with forward-only, additive, gap-free numbering — the rules that
  make jumping from an old version to a new one safe.

## Version 1.3.2

Groundwork for publishing the project under MIT so it can be self-hosted. No change to how the app
behaves, with one exception noted below.

- Fixed: Settings showed version 1.2.4 — a string literal that had drifted three releases behind.
  The version now comes from `package.json` at build time, which matters more than it used to
  because the update notice compares it against the latest upstream release.
- Changed: the test fixture for the Saldo summary format is now synthetic. It reproduces every
  awkward property of a real export — empty leading years, an uncategorised block, a loss-making
  year, two malformed category names, and category rows that do not quite sum to the stated totals
  — but the rounding shortfall is now *chosen* rather than inherited, so the parser test pins a
  known quantity instead of an artefact of one household's budget.
- Changed: `wrangler.jsonc` ships with placeholders. `TEAM_DOMAIN`, `POLICY_AUD` and the database id
  are per-installation, and the Worker already refuses to serve the app while they are unset.
- Added: MIT `LICENSE`, `SELF-HOSTING.md`, `CONTRIBUTING.md`, `SECURITY.md`, issue templates, and
  `.dev.vars.example`.
- Added: the README now states plainly that the base currency is UAH and rates come from the
  National Bank of Ukraine. It is not configurable yet, and that is better known before an import
  than after one.
- Removed: deployment notes and the original build plan, which described one specific installation
  and one household's figures. They live outside the repository now.

## Version 1.3.1

- Fixed: a date chosen from the picker was not marked as selected. The chip showed "31 июля" but
  stayed unhighlighted, so the sheet looked as though no date had been chosen while it was in fact
  about to save under that one. The picker is a `<label>` wrapping a hidden date input rather than
  the shared Chip component, and it never got the selected class the other two chips had.
- Fixed: today and yesterday are now computed once per render instead of per comparison, so an
  entry made across midnight cannot end up with no chip marked at all.
- Changed: seven frequently-used categories instead of six. The grid is four columns and the "All"
  button takes a cell, so six left one empty slot in the second row; seven fills both rows.

## Version 1.3.0

- Fixed: dragging past the end of the history list snapped the view back towards the top. The
  filters collapse by animating `max-height`, so revealing them grows the document — and with the
  viewport pinned at the bottom the browser has to clamp the scroll position, moving the rows
  under your thumb. Two paths were triggering that reveal at the worst possible moment: iOS
  reports a scroll position beyond the end of the range during rubber-band, and the spring back
  read as an 80px upward scroll; and collapsing the filters shrank the document, so the browser's
  own corrective scroll read as upward movement too, revealing them again in a loop.
- Changed: scroll positions outside the valid range now decide nothing, and the filters no longer
  toggle within the last 48px of the list, where any reflow is felt immediately.
- Changed: the list offset the virtualiser measures is read in a layout effect rather than after
  paint, so no frame is drawn against a stale offset when the filters collapse.

## Version 1.2.9

- Changed: the keypad now shows all arithmetic at once. Digits on the left, ⌫ × − + stacked in a
  column on the right, zero spanning two cells — the phone-calculator arrangement, in five
  columns instead of four because the fifth is the tall save key.
- Removed: the collapsible arithmetic row and the button that revealed it. × and − were invisible
  until you already knew they existed, which is the opposite of what a hidden control should do.
- Removed: the "00" shortcut, along with `pressDoubleZero` and its test. It saved two taps on
  round amounts and cost a key that arithmetic needed.
- Changed: operator keys are set back from the digits by glyph colour and weight rather than by a
  different fill, since a third surface level matched the sheet exactly in light mode.

## Version 1.2.8

- Added: transactions can be edited straight from the list on the Home screen, not only from
  History. Those are the rows you see right after saving, so that is where a typo gets noticed.
- Changed: the decimal separator moved onto the main keypad, taking the place of "00" in the
  bottom row. It had been hidden in the arithmetic row — but kopecks are not an arithmetic
  feature, and needing to find a second row to type "12,50" was wrong. "00" moved the other way,
  to the arithmetic chips. The key shows the locale's own separator: "," for Russian and
  Ukrainian, "." for English.
- Changed: the keypad's save key now reads "Ввод" instead of "Сохранить" — one column is too
  narrow for the full word. The footer button shown when the keypad is closed keeps it.
- Changed: keypad keys are 56px instead of 60px, so the pad takes less of the sheet.
- Changed: the "История Saldo" account is active again, so history can be entered by hand. It
  stays excluded from totals, so nothing entered there moves a current balance.
- Fixed: accounts excluded from totals are never predicted as the account for a new transaction,
  only chosen deliberately. Otherwise one backfilled grocery expense would teach the app that
  groceries belong to the history account, and the next real one would silently land there.
  The same pairing is no longer remembered for excluded accounts.

## Version 1.2.7

- Added: a monthly total on the Regular payments screen. Expenses and income are shown
  separately, each with a subtotal per currency and a combined figure converted to hryvnia at
  today's rate — the same treatment the Home total got, so euro and dollar subscriptions are not
  hidden behind a single UAH number.
- Added: every schedule is normalised to a monthly figure before being added up, because the list
  mixes weekly, monthly and yearly cadences and a sum of the raw amounts would mean nothing.
  Weekly uses 52/12; "four weeks to a month" understates a weekly commitment by about 8%.
- Changed: paused schedules are excluded from the total, and the screen says so when there are
  any. A combined total is withheld entirely if a rate for one currency is missing, rather than
  quietly understating what the household is committed to.

## Version 1.2.6

- Fixed: the undo toast was a near-white pill in dark mode. It used the inverted-toast pattern
  (`background: var(--text)`), which is right on a white page but fires a bright flash over a
  #0B0B0D one — roughly twenty times a day. Dark mode now uses a surface raised above the sheets
  with a hairline; light mode keeps the dark pill. New `--toast-*` tokens.
- Fixed: choosing a category from the full searchable list collapsed back to the six predicted
  tiles, which by definition did not include it — so nothing on screen confirmed what had been
  picked. The selection now collapses to a single confirmed chip, and any selection outside the
  top ranks is pulled into the tile grid so it is always visible.
- Fixed: the History filters overflowed the right edge of the screen, leaving the member filter
  invisible. They now wrap instead of scrolling horizontally.
- Removed: the "Сменить категорию" button below the History list. It was the entry point into
  bulk-selection mode but was mislabelled and seeded the selection with an arbitrary first row.
  Bulk selection now starts by long-pressing a transaction.

## Version 1.2.5

- Fixed: the settings icon rendered as a full-colour gear on iOS while its neighbours were thin
  monochrome outlines. Cause was Unicode, not CSS — `⚙` (U+2699) carries the Emoji_Presentation
  property, so the platform draws it as emoji, whereas `◎`, `≡` and `◫` beside it are text glyphs.
- Changed: all navigation icons are now inline SVG in one family — 24×24 box, 2px stroke, round
  caps, `currentColor`. Home, history (a clock, so it can't be confused with the settings sliders),
  reports (bars on an axis), settings (sliders — a gear at 22px either muddies or reads as a sun),
  and the add button. Transfers in the transaction list use the same SVG family.
- Changed: empty-state illustrations on Reports and Budgets were mixed text glyphs and emoji;
  they are now emoji throughout.
- Added: `src/ui/icons.tsx` documents the rule this settles — SVG for chrome, emoji for data.
  Chrome must look identical on every platform, so it cannot depend on per-platform Unicode
  presentation defaults; emoji stay where they *are* the data (category and account icons).

## Version 1.2.4

- Changed: the app is now called **SAYings**. Renamed in the interface, the browser title, the PWA
  manifest and home-screen label, the onboarding copy, and the identity written into exports and
  nightly backups. Exported files are now named `sayings-*`.
- Unchanged, deliberately: the Worker, its URL, the D1 database, the R2 bucket, and the local
  IndexedDB name are all still `sayfinance`. Renaming the Worker changes the hostname, which
  invalidates the Access application bound to it, and renaming the IndexedDB store would orphan
  every device's mirror. See "Names on Cloudflare" in the README.

## Version 1.2.3

- Fixed: long-pressing a quick add tile started a text selection and showed the iOS copy callout
  instead of opening the editor. It used `onContextMenu`, which iOS Safari does not fire for touch,
  and the tile did not suppress selection. The hold now uses the tested press-gesture state
  machine, and the tile suppresses the callout and text selection.
- Added: an explicit edit mode (the ✎ button beside the tiles), in which a plain tap edits. A long
  press is undiscoverable, unreachable by keyboard, and on iOS competes with the system gesture, so
  it should never be the only way in. Tiles show a dashed border while editing.
- Added: keyboard activation on tiles — Enter and Space fire a tile, or edit it in edit mode.

## Version 1.2.2

- Fixed: "Выберите счёт" appeared while the account dropdown visibly showed an account. The sheets
  ran their own Dexie queries, so on their first render — the render where `useState` initialisers
  execute — the account and category lists were still empty. State fell back to `""`, and because
  the select had no empty option the browser displayed the *first* account while React held
  nothing. It looked chosen and was not.
- Changed: the quick tile, recurring, budget and split sheets now receive their accounts and
  categories as props from the screen that already has them loaded, rather than re-querying on
  mount. That removes the whole class of bug — the same defect was present in all four, and was
  also silently losing the "prefilled from your most recent transaction" behaviour.
- Added: an explicit empty option on the account selects, so a value matching no option renders as
  "—" rather than appearing to be a valid selection.

## Version 1.2.1

- Fixed: creating a quick add tile failed with "Введите сумму" while the amount was perfectly
  valid. Two causes. Tapping the *already selected* Расход/Доход toggle cleared the chosen
  category, because the handler fired on every tap rather than on an actual change. And one error
  message covered three different failures, so a missing category reported itself as a missing
  amount — which is why this looked like the input not being read.
- Changed: each validation failure now names its own field, in the quick tile and recurring sheets.
- Fixed: the same tap-clears-category bug in the main entry sheet's type toggle.
- Fixed: "most recent transaction" ignored whether the account was excluded from totals, so
  repeat-last would offer to repeat an imported Saldo monthly summary onto the archived history
  account, and a new tile would prefill from one.
- Fixed: a prefilled account that is not in the dropdown is no longer carried silently — the
  select looked valid while holding an unselectable id.

## Version 1.2.0

- Added: adding a transaction while viewing one account's transactions preselects that account.
  Navigating to an account's list is an explicit statement of intent, so it outranks every guess.
  The filter now lives in the URL, which is what lets the add button elsewhere in the shell see
  which account is being viewed.
- Added: a per-member default account, in Settings. Stored on the member row rather than in device
  preferences, because it belongs to the person — his card and her card are different answers, and
  each should follow them across devices.
- Changed: account selection is now one documented precedence chain with eight tests, rather than
  logic spread across the entry sheet: context, then this device's memory for the category, then
  category history, then the member default, then most recent, then first available. Every
  candidate is checked for selectability, so an archived or deleted account can never be
  preselected regardless of what points at it.

## Version 1.1.7

- Changed: the category grid collapses to the current selection when a transaction is opened for
  editing, with a "Изменить" button to expand it. Two rows of alternatives were answering a
  question that had already been answered. A new entry still opens expanded, because there the
  grid *is* the question.
- Changed: the account is shown as a single chip that expands the full list in place, replacing a
  horizontal scroller in which four of six accounts were invisible with no hint they existed. The
  expanded list wraps rather than scrolls, so everything is reachable without a swipe. Same for a
  transfer's destination, which starts expanded since it has no sensible default.

## Version 1.1.6

- Changed: category tiles are a 4-column grid with shorter tiles, so seven categories take two
  rows instead of three. The amount field lost most of its empty space and the display type is a
  little smaller. Together these reclaim well over 100px — the difference between the date row
  being on screen or below the fold.
- Changed: the date chips no longer share a row with "Ещё" and "Разделить". Dates answer *when*,
  those buttons are *actions*, and mixing them put the actions in the first thing to get clipped.
- Added: the account row fades at its trailing edge, so it is visible that it scrolls. With six
  accounts and room for two, four of them simply appeared not to exist.
- Added: an install prompt on Home, dismissible and remembered. Running in Safari costs about
  160px to the address bar and toolbar on a screen already short of vertical space, and installing
  also stops iOS evicting the local database.
- Removed: a stale lint suppression left behind when the history list moved to window scrolling.

## Version 1.1.5

- Changed: the keypad now stays closed until the amount field is tapped, as originally asked. The
  previous compromise kept it open for new entries, which hid the date, category and note fields
  and made the form look like it had a single input.
- Fixed: sheets were nearly invisible against the page. The sheet used the page background —
  #0B0B0D on #0B0B0D in dark mode — so the only separation was a 40% black scrim, which reads as
  nothing against near-black. Sheets now sit on a raised surface with a hairline border, and the
  backdrop is darker and blurred. Fields and cards inside a sheet get their own contrast so they
  stay legible on the raised surface.
- Fixed: the grabber advertised swipe-to-dismiss and did nothing. It now works — drag down past a
  threshold, or flick, and the sheet closes; a short drag springs back. The drag surface is the
  grabber and header only, so it does not fight scrolling or the form controls. An affordance that
  lies is worse than no affordance.
- Changed: History scrolls as one page instead of a fixed-height list nested inside a scrollable
  page, which on a phone meant two competing scroll areas and a list you could get stuck in.
- Added: search and filters collapse while scrolling down and return on any upward scroll, with a
  movement threshold so jitter does not toggle them and always visible near the top.

## Version 1.1.4

- Added: split transactions — one receipt across several categories. The lines must sum to the
  total exactly, with the remainder always on screen and saving blocked until it reaches zero,
  because a split that does not reconcile quietly loses money from a report. The last line
  auto-fills with the remainder, so the common two-way split needs one amount typed rather than
  two that have to agree. Written as one transaction per line sharing a `split_parent_id`, so
  every existing report aggregates them without special-casing.
- Added: recurring transactions for rent, utilities and subscriptions, as a review queue rather
  than an auto-poster. Due items offer themselves on Home with Add or Skip, and nothing is
  written until confirmed — a background job silently inventing a ₴25 000 transaction is a worse
  failure than being asked about one. Both actions advance the schedule, so a skipped month does
  not reappear tomorrow, and a template left untouched for months produces one prompt, not many.
- Added: 15 tests for recurring date arithmetic, covering the cases that actually bite — a rent
  day of the 31st clamping to 28/29/30 in short months and then *returning* to the 31st rather
  than drifting earlier, 29 February anniversaries in non-leap years, and stale schedules
  terminating instead of looping.

## Version 1.1.3

- Added: quick add tiles on Home — pinned one-tap transactions like "Кофе ₴80". Per person, since
  habits differ. A tap writes immediately with undo, the same optimistic path as the entry sheet;
  long-press edits. New tiles are prefilled from your most recent transaction. This closes the
  gap between a three-second entry and a one-tap one for the third of transactions that repeat.
- Added: a range control on the category matrix, defaulting to 12 months. It previously rendered
  every month from the first transaction onwards — 33 columns of sideways scrolling once the
  Saldo history landed — just to reach the current month.
- Changed: History hides the imported Saldo rows by default, with a chip to show them. All 612
  sit on the 1st of their month, so thirty stacked on a single day and buried real entries. They
  are summary figures for Reports, not events to scroll through.

## Version 1.1.2

- Changed: the sync pill shows just the elapsed time next to the status dot ("только что") instead
  of a full sentence. The dot's colour already says "synced"; screen readers still get the
  sentence, since colour conveys nothing to them.
- Changed: the keypad is summoned rather than permanent. It opens by default for a new entry,
  because amount-first is the fast path, but closes when any other field is touched — so the
  date, category and note fields are all visible instead of being pushed below the keypad. The
  amount doubles as the control that brings it back. Editing an existing transaction opens with
  the keypad away, since the amount is already right.
- Fixed: the "spent this month" comparison was badly wrong. The imported Saldo history sits on
  the 1st of each month, so a whole month of July spending counted as having happened "by this
  day" — showing ₴357 423 as the comparison figure. That card now covers real accounts only.
- Added: tapping an account on Home opens its transactions. The cards were inert, and the
  obvious question about a balance is what went through it.

## Version 1.1.1

- Changed: all 30 categories renamed to Russian. Ids are untouched, so the 612 imported
  transactions, budgets and history are unaffected — every category kept its transaction count.
- Fixed: editing a transaction opened with the amount showing 0 while its category and account
  were correctly preselected. The keypad never seeded itself from the row being edited, so
  saving would have overwritten a real amount with whatever was retyped.
- Fixed: the Home total counted only hryvnia, silently ignoring all three euro accounts. Now a
  subtotal per currency plus a grand total converted at today's rate — shown only when every
  currency has a rate, since a partial "grand total" would be a wrong number.
- Removed: the "Готово" link beside Accounts on Home. It was the generic "done" string used as a
  label, described nothing, and accounts are managed from Settings.
- Changed: the note field on the entry sheet is always visible instead of hidden behind an icon
  toggle, which made it read as unavailable.
- Added: reorder accounts with up/down controls, so the frequently-used ones sit on top. That
  order drives the account chips on the entry screen too.
- Changed: swipe actions rewritten to current conventions. Previously a swipe fired on release
  past a threshold, so a slightly-too-long swipe deleted a transaction with no confirmation.
  Now a short drag snaps back, a medium drag reveals a real button you tap deliberately, and a
  long drag commits — and the buttons are focusable, so the actions work without the gesture.
- Changed: "Последние" on Home excludes the synthetic Saldo history, which lives on an excluded
  account and was filling the list with monthly summary rows instead of real activity.

## Version 1.1.0

- Changed: category resolution during import no longer depends on category *names*. It resolves
  against current names first, then the original English seed names, then creates. This makes
  renaming categories (English to Russian, say) safe even for a future import of an
  English-labelled export, which would otherwise have created a duplicate set alongside the
  renamed originals.
- Fixed: unmatched import rows found their Uncategorised destination by matching
  `/^uncategorised/` against the category name, which would have broken silently the moment that
  category was renamed. Now addressed by id.

## Version 1.0.9

- Added: Saldo history imported — 612 transactions covering Dec 2023 to Jul 2026, reconstructed
  from the category × month export (529 expense, 83 income). The category × month matrix now
  reproduces the source file exactly: 612 of 612 cells match, zero missing, zero extra, zero
  value mismatches.
- Added: `scripts/import-saldo-monthly.mjs`, which generates the import. Idempotent via a
  readable `import_hash` (`saldo:<period>:<category>`), so re-running changes nothing and the
  synthetic rows stay identifiable if a real per-transaction export ever replaces them.
- Changed: history lands on one dedicated "Saldo history" account, archived and excluded from
  totals. Verified that all six real account balances are byte-identical before and after the
  import — reports gain the history, balances do not move.

### Note on the numbers

Yearly totals from the imported data fall a few hryvnia short of the yearly totals Saldo states
(2024: −₴6, 2025: −₴21, 2026: −₴35). This is Saldo's own per-cell rounding, not an import error:
each monthly cell is rounded to whole hryvnia, so a year accumulates twelve roundings instead of
one. The import matches the *monthly* source cell for cell, which was verified directly.

## Version 1.0.8

- Fixed: list rows were badly broken — `.row__title` and `.row__sub` are `<span>` elements and
  never had `display: block`, so they flowed inline. Titles ran straight into subtitles
  (a member's name butted against their email), and because `text-overflow: ellipsis` is ignored on inline
  boxes, long account names overlapped the amount instead of truncating.
- Fixed: the Settings group containing Accounts, Categories, Budgets and Import was headed
  "Categories" — it reused that translation key as a section title. Now has its own "Manage"
  heading in all three languages.
- Changed: navigation rows inherit text colour instead of rendering as accent-blue links, so a
  settings list reads as list rows rather than a column of links. Chevrons are muted.
- Changed: tightened row metrics (smaller icon chip, tighter gaps, slightly smaller amount) to
  give long account names more room before truncating, and page action buttons are now compact
  so the heading leads.
- Changed: more bottom padding on scrollable pages — the last line previously sat flush against
  the tab bar and read as cut off.

## Version 1.0.7

- Fixed: the add (+) button did nothing on an empty ledger, which made it impossible to create
  a first transaction at all. The hold timer was armed only when a previous transaction
  existed, and the entry sheet then opened only if that timer had been armed — so with no
  history the primary action of the app was dead. It would also have been flaky with history,
  since the timer was held in state and read within the same gesture.
- Changed: the tap-versus-hold gesture is now a pure state machine (`src/lib/press-gesture.ts`)
  with 14 tests, including one asserting the invariant the bug broke: a tap fires whether or
  not a long press is available.
- Added: keyboard activation for the add button. Enter and Space open the entry sheet, which
  pointer-only handling left unreachable for keyboard and assistive tech.

## Version 1.0.6

- Added: five years of FX history loaded — USD and EUR for all 2 043 days from 2021-01-01 to
  2026-08-05, fetched from NBU with zero failures. Multi-currency history import will price
  correctly with no further setup. Spot-checked against independently fetched values, including
  a Sunday rate that confirms NBU's weekend carry-forward.

## Version 1.0.5

- Added: Cloudflare Access is live. The policy allows exactly the two household addresses; the
  account email that was auto-added when Access was first enabled has been removed. Session
  duration set to 1 month.
- Added: real `TEAM_DOMAIN` and `POLICY_AUD`, so JWT verification is active rather than
  fail-closed. Verified in production that every path redirects to the Access login when
  unauthenticated, and that a forged JWT never reaches the Worker.

## Version 1.0.4

- Added: tested restore path. The backup tests write real data, snapshot it to a real R2
  bucket, wipe the database, restore from the snapshot alone, and assert the reports agree —
  including both legs of a cross-currency transfer and soft-deleted rows, since a backup that
  dropped deletions would resurrect every transaction ever removed.
- Added: DEPLOY.md with the full sequence, and ADRs for the local-first and money decisions.
- Added: ARCHITECTURE.md describing the layers, the save path, and the invariants.
- Fixed: a test fixture hardcoded `base_amount_minor` independently of `amount_minor`, so any
  fixture with a custom amount was internally inconsistent and quietly broke tests that summed
  base amounts.

## Version 1.0.3

- Added: FX rates from the National Bank of Ukraine, fetched nightly by a Cron Trigger, with
  a bounded historical backfill for importing multi-currency history.
- Added: transactions saved offline without an available rate are kept and flagged, then
  re-priced automatically once the real rate arrives. Losing the entry would be worse than an
  approximate figure.
- Added: nightly backup of the entire household to R2, keeping 30 daily and 12 monthly
  snapshots, with the last backup date shown in Settings.
- Added: CSV importer with column mapping, a preview showing exactly how each row parsed, and
  content-hash idempotency so re-running the same file never duplicates anything.
- Added: budgets — monthly limits per category, optional rollover of unspent (and overspent)
  amounts, and an end-of-month projection from the run rate so far.
- Changed: the import reconciliation target. Saldo's own summary export does not add up: its
  category rows fall short of its stated totals by ₴5 in 2024, ₴6 in 2025, and ₴9 in 2026,
  scaling with the number of categories, because each cell is rounded to whole hryvnia while
  the totals are not. "Reproduce to the hryvnia" was therefore impossible; the target is now
  agreement within ₴1 per category, and the exact shortfalls are pinned by a test.
- Fixed: the entry keypad's amount parser stripped Unicode group separators inconsistently.

## Version 1.0.2

- Added: local-first data layer — the full dataset is mirrored into IndexedDB, so every read
  and every report runs locally. The app works completely offline, including five years of
  history, and there are no loading states anywhere.
- Added: background sync with an outbox. Saving never waits on the network; writes drain in
  the background with exponential backoff, and a write made mid-sync is not dropped.
- Added: Access session-expiry handling in the sync client. An expired session returns a
  redirect rather than a 401, which would otherwise stop the installed app syncing silently.
- Added: design tokens with first-class dark mode. Colour carries one meaning only — red out,
  green in, neutral transfer — and the accent is blue so it can never read as a money value.
- Added: English, Ukrainian, and Russian interfaces, per person. Ukrainian and Russian plural
  forms come from Intl.PluralRules, which gets 1/2/5/21 right where a naive check does not.
- Added: amount-first entry sheet — custom keypad, category tiles ranked by learned habit,
  and an account chip that remembers what each category is usually paid from.
- Added: inline arithmetic on the keypad (120+45+90) for splitting a receipt, implemented as
  a hand-written evaluator. No eval, no new Function, no expression-parser dependency.
- Added: duplicate detection. If the other person logged a similar amount in the same
  category within six hours, a non-blocking note says so before you double-enter it.
- Added: repeat-last on a long press of the add button, for the third of transactions that
  are the same thing again.
- Added: history with day grouping, running balances, swipe to delete or duplicate, search,
  filters, and bulk recategorise. Virtualised, because 35k rows of real DOM freezes Safari.
- Added: reports — category × period matrix, month overview, net worth, cashflow, and spend
  by person. Every figure is tappable and opens the transactions behind it.
- Added: accounts and categories management, including merge-with-history and archiving.
- Added: full data export from Settings — one JSON plus a CSV per table, generated entirely
  on-device, so it works with no network and would still work if this backend disappeared.
- Fixed: backspacing after typing an operator ("120+") discarded the committed term and
  collapsed the amount to zero.
- Fixed: currency formatting fell back to ISO codes — UAH showed as "UAH 1,240" in English
  and EUR as "1 240 EUR" in Ukrainian. Now uses narrow symbols in every locale.

## Version 1.0.1

- Added: D1 schema — households, members, accounts, categories, transactions, budgets,
  recurring, quick tiles, FX rates, and backups, with the sync columns every replicated
  table needs.
- Added: the 24 expense and 6 income categories from the Saldo export, seeded in descending
  order of 2026 spend so the entry screen's predicted category tiles are useful on day one,
  before any history exists.
- Added: `POST /api/sync` — bidirectional sync in one round trip. Whole-row upserts make a
  replayed batch a no-op, so the client can retry freely after a dropped mobile connection.
- Added: last-write-wins conflict resolution. A row older than the stored one loses, and the
  winning version comes back in `conflicts` so the client heals instead of retrying forever.
- Added: server-side enforcement of household and authorship. A client cannot write into
  another household or forge who made a change, whatever the payload claims.
- Added: ledger invariants enforced at the schema level — transfers need a destination and
  cannot target their own source, expenses and income need a category, and amounts must be
  positive integers so a float can never reach the ledger.
- Added: members are provisioned on first authenticated request rather than hardcoded in a
  migration, with a cap as a backstop against an over-broad Access policy.
- Fixed: `parseMajorToMinor` used float multiplication, which rounded some inputs to the
  wrong kopiyka (`1.005` became 1.00, not 1.01). Now decimal string arithmetic on BigInt,
  with no float anywhere in the path.
- Added: 42 tests, including sync against a real local D1 — cursor paging, monotonic
  revisions, soft-delete propagation, replay idempotency, cross-household isolation, and
  cross-currency transfer balances.

## Version 1.0.0

- Added: project skeleton — one Cloudflare Worker serving both the SPA and the API, with
  `run_worker_first: ["/api/*"]` so static assets and API routes share a single deploy.
- Added: Cloudflare Access authentication. The Worker verifies the `Cf-Access-Jwt-Assertion`
  JWT signature, issuer, and audience against the team's JWKS rather than trusting that the
  header is present.
- Added: fail-closed configuration check — `/api/*` returns 500 if the Access audience is
  unset or still holds the placeholder, so a misconfigured deploy can never accept
  unverified requests.
- Added: `GET /api/me` returning the verified caller's email, and `GET /api/health`.
- Added: PWA manifest, generated icon set (192/512/maskable/apple-touch), and a service
  worker that never precaches `/api/*` — an expired Access session must surface as a redirect
  rather than a stale cached response.
- Added: Access-aware API client. Uses `redirect: "manual"` to detect the redirect an expired
  Access session produces, then hands the browser back to Access for re-authentication,
  guarded so it cannot loop.
- Added: `npm run verify` — lint, typecheck across the client/worker/tooling configs, and
  tests. `shared/` is checked under both the DOM and no-DOM configs so shared code cannot
  reach for environment-specific APIs.
- Added: lint rules banning `eval`, `new Function`, and implied eval across the codebase.
