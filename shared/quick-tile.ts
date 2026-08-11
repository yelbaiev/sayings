import { z } from "zod";
import { CURRENCIES } from "./currency";

/**
 * A pinned one-tap transaction: "Кофе ₴80", "Метро ₴8", "Аренда ₴25 000".
 *
 * Roughly a third of a household's transactions are the same thing again. For those, even a
 * three-second entry flow is wasted motion — this makes them a single tap.
 *
 * The template is stored as JSON in a text column rather than as columns of its own, because it
 * is a snapshot of intent rather than a ledger row: it never participates in balances, reports,
 * or FX, and giving it real columns would invite it to drift from the transaction schema.
 * Validated on the way in and out, so a hand-edited or stale row degrades to "skip this tile"
 * rather than crashing the screen it appears on.
 */
export const quickTileTemplateSchema = z.object({
  kind: z.enum(["expense", "income"]),
  amount_minor: z.number().int().positive(),
  currency: z.enum(CURRENCIES),
  category_id: z.string().min(1),
  account_id: z.string().min(1),
  note: z.string().max(200).nullable().optional(),
});

export type QuickTileTemplate = z.infer<typeof quickTileTemplateSchema>;

export function serialiseTemplate(template: QuickTileTemplate): string {
  return JSON.stringify(template);
}

/** Returns null for anything unparseable, so one bad row cannot take down the Home screen. */
export function parseTemplate(raw: string): QuickTileTemplate | null {
  try {
    const parsed = quickTileTemplateSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
