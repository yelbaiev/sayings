# The press flash, app-wide

## Why

The keypad's press flash works — it is the one piece of touch feedback in the app that reliably
says "that press landed", and it is the reason the pad now feels right. Everything else in the app
relies on `:active`, which lasts exactly as long as the finger is down. On a quick tap that is a
handful of milliseconds, so most presses outside the pad still show nothing at all.

Haptics are not an option to pair it with: iOS has no route to one from a web page, and the
hidden-switch trick was tried on the actual phone and did nothing. The flash is the feedback.

## Phase 1 — one delegated listener, one keyframe (single phase, ~200 lines)

**Goal.** Every button, chip and tappable row in the app flashes when pressed, without wiring a
handler into each one.

**Allowed files**
- `src/lib/press-flash.ts` (new)
- `src/styles/components.css`
- `src/main.tsx` — install the listener
- `src/features/entry/Keypad.tsx` — use the shared helper, opt out of the global one
- `src/ui/HoldButton.tsx`, `src/app/Shell.tsx` — opt out, both have their own press animation
- `tests/unit/press-flash.test.ts` (new), `tests/dom/press-flash.test.tsx` (new)
- `CHANGELOG.md`

**Forbidden files**
- `src/ui/Button.tsx`, `src/ui/index.tsx` — the point of delegation is that the primitives do not
  change. Fifteen feature files also hand-roll `<button>`; wiring props into components would miss
  every one of them and would drift again with the next button written.
- `src/lib/press-gesture.ts`, `src/lib/swipe-gesture.ts` — the gesture state machines decide what a
  press *means*. This is only what it looks like, and the two must not get tangled.
- Anything under `worker/`, `shared/`, `migrations/`.

**Behaviour change**
- One `pointerdown` listener on the document flashes the nearest `button`, `[role=button]` or
  `a[href]`, unless it sits under `[data-press-flash=off]` or is disabled.
- The flash is a 200ms neutral tint — `color-mix` of the foreground over whatever the surface is —
  so it reads on a card, a row, a primary button and a dark theme without a per-variant colour.
- Real buttons and chips also squeeze slightly; rows only tint. A full-width row shrinking by 3%
  looks like a bug, a key that does not looks dead.
- The keypad keeps its own stronger flash: it inverts to the primary colour, which is right for a
  deliberate 56px target and much too loud for a list row.
- `prefers-reduced-motion` drops the squeeze, keeps the tint.

**Verification**
- `npm run verify`.
- Unit tests for the target resolution: nearest pressable ancestor, disabled skipped, opt-out
  subtree skipped.
- A DOM test that a rendered `Button` carries the class on pointerdown and a keypad key does not
  take the global flash on top of its own.
