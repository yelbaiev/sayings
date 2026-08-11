# Contributing

Feedback is the thing this project needs most. It was built for one household, which means every
assumption in it is one household's assumption — if something is wrong for yours, that is useful to
hear even without a patch.

## Good first things to send

- **A bug from real use.** What you did, what happened, what you expected. A screenshot of a screen
  in your own language is worth a lot; the layout is only regularly tested in Russian and English.
- **A currency or locale that does not work.** See the base-currency limitation in the README — if
  you hit it, say so, because the number of people who do is the argument for fixing it.
- **A confusing screen.** "I could not work out how to X" is a real bug report. Most of the UI
  changes in `CHANGELOG.md` started as exactly that sentence.

## Install the push guard first

```sh
git config core.hooksPath scripts/hooks
```

`scripts/hooks/pre-push` refuses to push anything containing an installation's own Cloudflare
identifiers — a team domain, an audience tag, a resource id. If you keep a branch with your real
config in order to deploy (the recommended arrangement, see SELF-HOSTING.md), this is what stops it
reaching a public remote.

It fails closed: if the scan cannot run, the push is refused rather than allowed. That is not
theoretical caution — the first version of this hook ended its scan with `|| true`, and when `grep -P`
turned out to be unavailable inside a hook's environment it reported "nothing found" and let a
configuration branch through. Twice.

## Before opening a pull request

```sh
npm run verify   # lint + typecheck (4 tsconfigs) + tests. Must be clean.
```

Do not chain it with `;` — a failing lint has slipped past that way before.

A few rules the codebase enforces, worth knowing before you fight them:

- **Money is integer minor units, never a float.** All sign logic lives in `shared/money.ts`:
  `amount_minor` is a positive magnitude and direction comes from `kind`. A lint rule keeps
  arithmetic on amount fields out of the rest of the code.
- **Migrations are forward-only and additive.** Never rename or drop a column in place. Every
  migration must apply cleanly on top of `0001`, because somebody out there is on v1 and will
  upgrade straight to yours. See `docs/decisions/0004-forward-only-migrations.md`.
- **Bump `src/db/dexie.ts`'s `this.version(n)` when adding a store or index**, and never reuse a
  number. Existing devices carry a populated database.
- **No new runtime dependencies without a reason in the PR description**: what it does, why a
  built-in will not, and a glance at its release history. The deployed Worker bundle is currently
  Hono, jose, and the app.
- **No `eval` or `new Function`.** The keypad's inline arithmetic is a hand-written evaluator.
- **Never log** request bodies, `Authorization`/`Cookie` headers, raw env values, or anything
  token-shaped. Log the error message and code, not the input.

## Tests

Pure logic is where the correctness lives, and it is well covered: money, FX lookup, the report
engine, the arithmetic evaluator, category prediction, sync, backup and restore.

There are three layers, and knowing which one a bug belongs to saves writing a test that cannot see it:

- **`tests/unit`** — pure functions in Node. Money, FX lookup, the report engine, the arithmetic
  evaluator, category prediction, and the *decisions* behind every gesture: tap versus long press,
  swipe engage and release, whether scrolling should collapse the chrome. Gesture logic lives in pure
  state machines specifically so this layer can reach it.
- **`tests/worker`** — the Worker in workerd against a real local D1 and R2. Sync cursors, last-write
  wins, soft deletes, replay idempotency, backup and restore, the schema guard.
- **`tests/dom`** — components in jsdom. Wiring only: what renders for given data, whether a handler is
  connected, whether a control has an accessible name.

What `tests/dom` cannot see is worth stating plainly, because a test that appears to cover something
is worse than no test. jsdom has **no pointer capture** and **no layout**. So it cannot reproduce the
bug that made the sheet's close button unclickable for three releases (a captured pointer retargets
`pointerup`, so `click` lands on the wrapper instead of the button), and it cannot see two elements
overlapping. Appearance and alignment are checked in the gallery at `/design`, and the stylesheet's own
invariants — token layers, the spacing scale, shared insets — are asserted in
`tests/unit/tokens.test.ts` by parsing the CSS.

## Commit messages

Say what changed and why it was wrong before. `CHANGELOG.md` entries are read by self-hosters
deciding whether to update, so they describe consequences rather than diffs — no boilerplate, no
"various fixes".
