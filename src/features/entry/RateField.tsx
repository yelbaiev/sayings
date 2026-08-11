import { minorUnitDigits, type Currency } from "@shared/currency";
import { useApp } from "~/app/AppContext";
import { formatMoney } from "~/lib/format";
import { Amount, Field } from "~/ui";

/**
 * A rate as text for the input, at eight significant digits with trailing zeros trimmed.
 *
 * Significant digits rather than decimal places, because the same field holds 51.6423 hryvnia per euro
 * and 0.0000355 euro per dong. Six decimal places would round the second to 0.000036 — a 1.4% error,
 * quietly applied to every amount in that currency.
 */
export function formatRate(rate: number): string {
  return String(Number(rate.toPrecision(8)));
}

/**
 * The exchange rate on a transaction in a currency other than the household's own.
 *
 * Shown rather than applied silently, and editable, because for a household ledger the rate that
 * matters is **the one the bank actually used**. A central bank's reference rate differs from a card
 * issuer's by a percent or two plus whatever the issuer adds, so a euro purchase that shows up on the
 * statement as a specific number of hryvnia is not an approximation to be corrected — it is the fact.
 * An app that quietly used the reference rate would produce totals that never quite match the
 * statement, with nothing to point at.
 *
 * The converted amount updates as the rate is typed, so the number being confirmed is the number on
 * screen. That matters more than it sounds: the rate is a figure with no intuition attached — 51.64 is
 * as plausible as 5.164 — and the base amount is where a misplaced decimal point becomes obvious.
 *
 * Whatever is here is frozen onto the transaction. Later rate movements do not reach it, which is what
 * keeps last year's totals from moving.
 */
export function RateField({
  amountMinor,
  currency,
  rate,
  estimated,
  edited,
  onChange,
  onReset,
}: {
  amountMinor: number;
  currency: Currency;
  /** The rate as typed, kept as text so a half-typed "51." is not rounded away mid-entry. */
  rate: string;
  /** True when no source had a rate for this date, so the prefill is a guess. */
  estimated: boolean;
  /** True when this differs from what the source said, which is what earns the reset control. */
  edited: boolean;
  onChange: (next: string) => void;
  onReset: () => void;
}) {
  const { t, locale, baseCurrency } = useApp();

  const parsed = Number(rate.replace(",", "."));
  const usable = Number.isFinite(parsed) && parsed > 0;
  const converted = usable ? Math.round(amountMinor * parsed) : null;

  return (
    <Field
      label={t("entry.rate", { quote: currency, base: baseCurrency })}
      hint={
        estimated
          ? t("entry.rateEstimated")
          : edited
            ? t("entry.rateEdited")
            : t("entry.rateHint")
      }
    >
      <div data-slot="rate-field" className="flex flex-wrap items-center gap-2">
        <input
          className="w-[9ch] flex-none text-right tabular-nums"
          // `decimal` rather than `numeric`: it brings up a keypad with a separator, which a rate
          // always needs. `text` with a pattern rather than `number`, because a number input silently
          // discards a value it considers half-typed and swallows the comma many locales type.
          type="text"
          inputMode="decimal"
          value={rate}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={!usable}
        />
        {/* The consequence, not the input: this is where a misplaced decimal point is visible. */}
        <span className="flex min-w-0 flex-auto items-center gap-0.5 text-[13px] text-muted-foreground">
          {converted === null ? (
            <span>—</span>
          ) : (
            <>
              {formatMoney(amountMinor, currency, locale, {
                cents: minorUnitDigits(currency) > 0,
              })}
              {" = "}
              <Amount minor={converted} currency={baseCurrency} tone="neutral" cents />
            </>
          )}
        </span>
        {edited && (
          <button
            type="button"
            className="flex-none text-[13px] text-transfer hover:underline active:opacity-70"
            onClick={onReset}
          >
            {t("entry.rateReset")}
          </button>
        )}
      </div>
    </Field>
  );
}
