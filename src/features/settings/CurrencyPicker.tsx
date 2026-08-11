import { CURRENCIES, sourcesFor, type Currency, type Locale } from "@shared/currency";
import { useMemo } from "react";
import { useApp } from "~/app/AppContext";
import { Chip, Field, FieldGroup } from "~/ui";

/**
 * Choosing a reporting currency and the currencies a household transacts in.
 *
 * One component, used by both the first-run setup and Settings, because they are the same decision
 * made at different times. Two would drift: the second would end up with its own idea of whether the
 * base can be removed from the list, and only one of them would be right.
 *
 * A currency's name comes from `Intl.DisplayNames` rather than from a table in this repo. Forty-three
 * names in three languages is 129 strings to maintain and get wrong, and the platform already has
 * them — correctly declined, which no hand-written list of ours would be.
 */

/** "Euro", "євро", "японский иена" — whatever the reader's own language calls it. */
function currencyName(code: Currency, locale: Locale): string {
  try {
    return new Intl.DisplayNames([locale], { type: "currency" }).of(code) ?? code;
  } catch {
    // Older engines may not have the currency type. The code alone is still usable.
    return code;
  }
}

export function BaseCurrencyField({
  value,
  onChange,
  disabled,
  hint,
}: {
  value: Currency;
  onChange: (next: Currency) => void;
  disabled?: boolean;
  hint: string;
}) {
  const { t, locale } = useApp();

  const options = useMemo(
    () =>
      CURRENCIES.map((code) => ({ code, name: currencyName(code, locale) })).sort((a, b) =>
        a.name.localeCompare(b.name, locale),
      ),
    [locale],
  );

  return (
    <Field label={t("settings.baseCurrency")} hint={hint}>
      <select
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as Currency)}
      >
        {options.map(({ code, name }) => (
          <option key={code} value={code}>
            {code} · {name}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function EnabledCurrenciesField({
  base,
  value,
  onChange,
  locked,
}: {
  base: Currency;
  value: Currency[];
  onChange: (next: Currency[]) => void;
  /**
   * Currencies an account or a transaction still uses. Removable only in the sense that the row
   * would immediately stop being convertible, so the chip is shown as on and refuses to turn off.
   */
  locked: Set<string>;
}) {
  const { t, locale } = useApp();
  const selected = new Set(value);

  // Sorted by code, because the code is what the chip says. Sorting by name while showing something
  // else is a list with no visible order at all.
  const rest = useMemo(
    () =>
      CURRENCIES.filter((code) => code !== base).map((code) => ({
        code,
        name: currencyName(code, locale),
      })),
    [base, locale],
  );

  function toggle(code: Currency) {
    if (code === base || locked.has(code)) return;
    onChange(
      selected.has(code) ? value.filter((c) => c !== code) : [...value, code].sort(),
    );
  }

  return (
    <FieldGroup label={t("settings.enabledCurrencies")} hint={t("settings.enabledCurrenciesHint")}>
      {/*
        Chips rather than a multi-select. A select's multiple form is unusable on a phone — it needs
        a modifier key to deselect — and the chosen few need to be visible without opening anything,
        because this is the list that decides what the account editor offers.

        A grid rather than a Cluster: forty-three equal-width codes in a wrapping flex row come out
        ragged, and these are meant to read as one block to scan.
      */}
      {/* A grid of equal columns rather than a wrapping row: forty-three same-shaped codes read as
          one block to scan, where a ragged flex wrap reads as noise. */}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(4.5rem,1fr))] gap-2 [&_[data-slot=chip]]:justify-center">
        {/*
          `aria-disabled` rather than `disabled` for the two cases that cannot be turned off. A
          disabled chip renders greyed, which reads as "off" — the opposite of what is true here:
          the base and any currency still held are the ones that are on and must stay on.
        */}
        <Chip
          active
          aria-disabled
          title={`${currencyName(base, locale)} · ${t("settings.baseCurrency")}`}
        >
          {base}
        </Chip>
        {rest.map(({ code, name }) => (
          <Chip
            key={code}
            active={selected.has(code)}
            aria-disabled={locked.has(code) || undefined}
            title={
              locked.has(code)
                ? t("settings.currencyInUse")
                : `${name} · ${sourcesFor(code).join(", ").toUpperCase()}`
            }
            onClick={() => toggle(code)}
          >
            {code}
          </Chip>
        ))}
      </div>
    </FieldGroup>
  );
}
