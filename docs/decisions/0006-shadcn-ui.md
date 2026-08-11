# 6. shadcn/ui as the design system

Date: 2026-08-07
Status: accepted — supersedes [0005](0005-design-tokens.md) in part

## Context

ADR 0005 adopted Fluent 2's *structure* — two token layers, machine-checked invariants — while
rejecting any design-system *code*, on the grounds that a runtime component library costs bundle,
loses control of the DOM, and styles someone else's way. Those arguments were correct for what they
weighed, and they do not apply to shadcn/ui: it is copy-in source, vendored into this repository,
compiled by Tailwind at build time. There is no runtime framework to depend on and nothing an
upstream can change under us.

What changed is the project's audience. The app is published and self-hostable, and the design
system a contributor most likely already knows is shadcn. A hand-rolled system — however disciplined —
is a system every contributor must learn from scratch, and the owner has decided the trade the other
way: **shadcn's architecture and its aesthetic**, with this app's own invariants carried over.

## Decision

- **Tailwind v4, CSS-first.** Theme in `src/styles/tailwind.css` via `@theme inline`; no
  `tailwind.config.js`. The zinc base palette, verbatim.
- **`--color-*: initial`** ahead of the semantic definitions, so the default palette does not exist:
  `bg-red-500` is not a lint finding, it is a class that will not compile. Colour goes through
  semantic variables only.
- **Dark mode keys off `data-theme`**, not shadcn's `.dark` class. The three-value preference
  (system/light/dark) resolves in CSS with zero boot flash; a class would need a script to resolve
  "system" before first paint. A block-form `@custom-variant dark` covers both the attribute and the
  media-query form, and a test keeps the two dark blocks twins.
- **Hover re-gated on `(hover: hover) and (pointer: fine)`** via `@custom-variant hover` — v4's
  default matches some phones, and a sticky hover on the last-tapped control is a bug this app has
  already fixed once.
- **Money colours are first-class extensions**: `--color-expense/income/transfer/warning`, defined in
  both themes. Colour carries exactly one meaning, and no button ever takes a red fill — shadcn's
  destructive variant is rewritten to outline-red.
- **Components vendored into `src/ui/`** next to thin wrappers that keep the existing call-site APIs
  (`Button`, `Field`, `Chip`, `Segmented`, `EmptyState`, `Sheet`, …). Wrappers are where house
  invariants live — `IconButton` still requires a `label`; `Field` still never wraps a button.
- **Radix behaviour adopted where it adds behaviour** (Toggle, ToggleGroup, Label, Dialog), **vaul**
  for the mobile drawer, **Sonner** for toasts, **lucide-react** for chrome icons (emoji stay for
  data). Native `<select>` stays — the OS picker beats Radix Select on phones.
- **Stays custom**: `Amount` (money renderer), `Keypad`, `SwipeRow` and its gesture state machine,
  `IconChip`/`Avatar` (data-driven colours), `SyncPill`, `Progress` (needs the >100% over-budget
  state Radix clamps away).

## What 0005 keeps

The invariants outlive the implementation they were written against: one primitive per job; every
control defines all its states; a surface is opaque or it is a scrim; tap targets ≥ 44px; the keypad
fits above the form. The test files migrate assertion-by-assertion as each phase lands — they are
never deleted wholesale.

## Consequences

- ~+31 kB gzipped JS at end state (tailwind-merge, radix pieces, vaul, lucide, cva/clsx);
  Tailwind itself is compile-time. Accepted for contributor familiarity.
- During the migration two systems coexisted in named cascade layers; `tokens.css` and `app.css`
  retired at the end. What outlives the sweep is `components.css` — the keypad grid, the
  two-axis-sticky reports matrix and the collapse animation, each genuinely awkward as utilities —
  referencing theme variables only, test-enforced.
- **One deliberate deviation from stock shadcn:** the toast stays custom rather than Sonner. This
  app shows exactly one toast at a time with one undo action; Sonner's stacking, portal and ~6 kB
  buy nothing here. Revisit only if multi-toast ever becomes a need.
