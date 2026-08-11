# 0005 — Fluent 2 as a specification, not a dependency

**Status**: superseded in part by [0006](0006-shadcn-ui.md) — the behavioural invariants stand; the "no design-system code" conclusion is reversed for compile-time, copy-in code
**Date**: 2026-08-06

## Context

Five visual bugs shipped in two days. Not one of them was a typo, and not one would have been
prevented by a component library:

| Bug | Cause |
|---|---|
| The keypad merged into the sheet behind it | Keys used `--surface`, the token for cards on a *page*, while sitting on a sheet. In dark mode that made them darker than what they sat on, by a margin too small to see |
| "Пропустить" printed on top of "Добавить" | The 30×26px sort-arrow class reused for a labelled button, with `style={{ width: 56 }}` |
| Hint text ran alongside its control instead of under it | `.field__hint` was a `<span>` with no `display: block` |
| The sidebar's add button was three menu-items tall | `.tabbar__fab` is a one-column grid, so the flex properties applied to it did nothing |
| The disabled "Ввод" key was a dead grey slab | No disabled state was defined for it, so it fell back to a fill |

The common thread is that each was a *legal* use of the system as it stood. `--surface` is a real
token. `.reorder__btn` is a real class. Nothing said which surface a control belongs on, or that a
labelled action needs a content-sized button, because the system had no way to say either.

The measured state: a flat token file, ten primitives but no `Button`, 120 inline `style={{…}}` of
which 67 were raw spacing values bypassing the `--space-*` scale, no gallery, and interaction states
written as ten separate `color-mix()` expressions inside individual component rules.

The question raised was whether to adopt [Fluent 2](https://fluent2.microsoft.design).

## Decision

Adopt Fluent 2's **architecture** and not its code.

Taken from Fluent: the two-layer token model — global tokens hold raw values and mean nothing on
their own, alias tokens carry meaning and are the only layer components may reference — and the
discipline of defining every interaction state once, centrally.

Not taken: `@fluentui/react-components`, Griffel, Fluent's palette, type ramp or icons.

### Why not the code

- **The mobile half is native.** `fluentui-apple` is Swift and UIKit; `fluentui-android` is Kotlin.
  Neither is reachable from a PWA. Fluent's documentation covers web and mobile; its code covers web.
  For this app "mobile" means the same web build in a narrow window, so the mobile half offers
  guidance and nothing installable.
- **The cost is disproportionate to what it buys.** Microsoft's own bundle fixtures put a single
  `Avatar` at 14.7 kB gzipped and `Accordion` at 24.3 kB, because each carries the shared Griffel
  runtime. This app ships 160 kB gzipped in total — React, Dexie, zod, the report engine and three
  languages included. Griffel injects styles at runtime, on the cold-start path that both the ≤3s
  entry target and the offline-first promise depend on.
- **It does not cover what broke.** Fluent has no numeric keypad, no drag-to-dismiss bottom sheet, no
  swipe-to-delete row, no currency amount, no category tile grid. `Drawer` and `Dialog` exist; a
  gesture-driven mobile sheet does not. Every bug above was in a component Fluent would not have
  supplied.
- **Two styling systems are worse than either one.** Adopting Fluent for the standard controls while
  keeping custom code for the rest would leave Griffel and our CSS side by side — which makes
  "functionally identical things look identical" harder, not easier, and that was the entire goal.
- **Licence detail.** The code is MIT, but the fonts and icons carry a separate assets licence. For a
  repository strangers are meant to fork, that is a footnote to get right rather than inherit.

Fluent's components do have better focus management and ARIA than ours. This decision does not close
that gap; it does put focus and state styling in one place, so closing it later is a token change
rather than an audit.

### The two rules the token layer now encodes

1. **Elevation is directional.** On a light background a raised surface gets darker; on a dark
   background it gets lighter. Same perceived height, opposite direction — which is precisely what a
   single greyscale token cannot express, and precisely the keypad bug. `--elevation-0…3` name the
   ramp: page, cards, sheets, controls-on-a-sheet.
2. **States are tokens, not expressions.** `--control-hover`, `--control-pressed`,
   `--control-selected`, `--control-disabled`, plus `--surface-hover`, `--ghost-hover`,
   `--accent-hover`, `--accent-pressed`. Written in terms of `--text` and the surface beneath, so
   they resolve correctly in both themes with no per-theme restatement: mixing towards the foreground
   is the direction "more prominent" points in either scheme.

### Enforcement

`tests/unit/tokens.test.ts` parses both stylesheets and asserts:

- `src/styles/app.css` never references a global ramp value, only aliases. **This is the check that
  would have caught the keypad at the moment it was written.**
- Every token a component references is actually defined, with an explicit allowlist for the three
  set per element from data (`--chip-color`, `--avatar-color`, `--drag-y`).
- The two dark blocks define identical token sets. Not hypothetical: they had already drifted, and
  `--shadow-sheet` was missing from the attribute block, so choosing dark by hand on a light system
  left sheets with the light shadow. Fixed here.

## Consequences

- `light-dark()` would collapse the two dark blocks into one and was rejected: Baseline only since
  May 2026, and its failure mode on an older browser is no colour at all, on an app deployed by
  strangers to devices nobody surveyed. Revisit once it is Widely Available (expected November 2026);
  the test makes the duplication safe until then.
- The ramp is named by CIE L\* lightness (`--grey-97`, `--blue-46`), so a number states where a value
  sits rather than needing to be looked up. Adding a shade means computing its lightness, not picking
  the next integer.
- Global ramp values must be literals. A ramp entry pointing at another token would make the layers
  circular and the boundary meaningless; the test asserts this too.
- The token reorganisation was verified to change nothing: all 57 resolved alias values across the
  three theme blocks are byte-identical to the previous file. The only behavioural difference is the
  `--shadow-sheet` fix.
