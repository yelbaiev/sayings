/**
 * The utility recipes every converted screen shares.
 *
 * Named once, because the alternative was observed, not imagined: each screen declaring its own
 * SECTION_TITLE constant is the same drift mechanism as each screen writing its own `.card` rule —
 * ten cards that each look slightly different for reasons nobody recorded. A screen that needs a
 * variation composes with `cn(CARD, "...")` and owns the difference explicitly.
 *
 * Values mirror what .section/.card/.row gave the legacy screens, so converted pages sit beside
 * unconverted ones without a visible seam while the sweep runs.
 */

/** Uppercase micro-heading above a section. */
export const SECTION_TITLE =
  "mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground";

/** A bordered surface with padding — the container for controls and summaries. */
export const CARD = "rounded-lg border border-border bg-card p-4 shadow-xs";

/** A bordered surface whose children are rows — no padding of its own. */
export const LIST = "overflow-hidden rounded-lg border border-border bg-card [&>:last-child]:border-b-0";

/**
 * One row of a list: icon, body, trailing figure. 60px minimum keeps rows tappable and steady —
 * a row with a two-line body and a row without must not differ in height.
 *
 * The separator is unconditional here and removed by LIST for its last direct child. It used to be
 * `last:border-b-0` on the row itself, which is correct in a plain list and silently wrong in a
 * virtualised one: there every row sits alone in an absolutely-positioned wrapper, so every row is
 * its own `:last-child` — the history lost all its separators, and each row came up 1px shorter
 * than the estimate, which the virtualiser corrected mid-scroll as visible jerks.
 */
export const ROW =
  "flex min-h-[60px] w-full items-center gap-2.5 border-b border-border px-3 py-2.5 text-left";

/** Row title and subtitle. `block` + truncate: inline spans ignore overflow entirely. */
export const ROW_TITLE = "block truncate font-medium leading-snug";
export const ROW_SUB = "mt-0.5 block truncate text-xs text-muted-foreground";

/** Muted explanatory line under a control. */
export const HINT = "mt-1.5 block text-xs leading-normal text-muted-foreground";

/** The page container. Wide enough for the reports matrix, centred on desktop. */
export const PAGE = "mx-auto w-full max-w-3xl p-4";

/** The page's h1. */
export const PAGE_TITLE = "mb-4 text-2xl font-bold tracking-tight";
